import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import * as authApi from "../api/auth";
import * as superAdminApi from "../api/superadmin";
import { getTenantSettings } from "../api/tenant";
import { flushJournal, startJournal } from "../lib/journal";
import { isSessionDisplaced } from "../api/session-refresh";
import {
  API_BASE_URL,
  clearStoredSession,
  getAccessToken,
  onSessionDisplaced,
  readStoredSession,
  setAccessToken,
  setImpersonatedTenant as persistImpersonatedTenant,
  setImpersonatingFlag,
} from "../api/client";

const AuthContext = createContext(null);

const STATUS = Object.freeze({
  LOADING: "loading",
  AUTHENTICATED: "authenticated",
  UNAUTHENTICATED: "unauthenticated",
  // Вход браузера сменился под вкладкой — работа в ней остановлена (api/session-refresh.js).
  DISPLACED: "displaced",
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState(STATUS.LOADING);
  const [impersonatedTenant, setImpersonatedTenant] = useState(null);

  useEffect(() => onSessionDisplaced(() => setStatus(STATUS.DISPLACED)), []);

  /* На старте — ДВА пути, и порядок важен.
   *
   * 1. Сессия этой вкладки. Сначала пробуем восстановленный токен: отвечает
   *    `/auth/me` — сессия жива, кука не нужна вовсе.
   * 2. Иначе продлеваем кукой. Кука одна на браузер, и в ней может лежать
   *    вход ДРУГОЙ гостиницы, открытой в соседней вкладке, — поэтому токен
   *    вкладки держим до ответа: по нему продление сверит, что вход тот же.
   */
  useEffect(() => {
    let cancelled = false;
    /* Страница входа по ссылке заводит вход сама. Продление кукой рядом с ней
       гонялось: ответ, пришедший вторым, поворачивал куку и токен обратно на
       гостиницу из соседней вкладки (поймано живой проверкой 25.10.2026). */
    if (window.location.pathname === "/sso") {
      setStatus((s) => (s === STATUS.AUTHENTICATED ? s : STATUS.UNAUTHENTICATED));
      return undefined;
    }
    (async () => {
      const stored = readStoredSession();
      if (stored?.accessToken) {
        setImpersonatingFlag(!!stored.impersonating);
        setAccessToken(stored.accessToken);
        if (stored.tenant) persistImpersonatedTenant(stored.tenant);
        try {
          const profile = await authApi.me();
          if (!cancelled) {
            setUser(profile);
            setImpersonatedTenant(stored.tenant ?? null);
            setStatus(STATUS.AUTHENTICATED);
          }
          return;
        } catch {
          /* Вход «от имени» из панели платформы не продлевается вовсе: там,
             как и раньше, возвращаемся кукой в свою сессию. */
          if (stored.impersonating) {
            setAccessToken(null);
            setImpersonatingFlag(false);
            clearStoredSession();
          }
        }
      }
      try {
        await authApi.refresh();
        const profile = await authApi.me();
        /* Кука сессии по ссылке возвращает работу в гостинице — значит, и
           баннер «Вы работаете от имени …» должен вернуться. Название берём с
           сервера — ту гостиницу, куда на самом деле пойдёт «Сохранить»
           (21.10.2026: баннер «3А Казань» над данными Magrib Caspiy). Вход
           ДРУГОЙ гостиницы сюда уже не доходит — его отвергло продление. */
        let tenant = null;
        if (stored?.tenant) {
          const actual = await getTenantSettings().catch(() => null);
          tenant = actual
            ? { ...stored.tenant, id: actual.id, slug: actual.slug, name: actual.name }
            : stored.tenant;
        }
        if (!cancelled) {
          setUser(profile);
          if (tenant) {
            setImpersonatedTenant(tenant);
            persistImpersonatedTenant(tenant);
          }
          setStatus(STATUS.AUTHENTICATED);
        }
      } catch (err) {
        if (cancelled) return;
        if (isSessionDisplaced(err)) {
          // Экрану остановки — название гостиницы, в которой открыта вкладка.
          setImpersonatedTenant(stored?.tenant ?? null);
          setStatus(STATUS.DISPLACED);
          return;
        }
        // Never downgrade an already-authenticated session: a sign-in on this
        // tab may have landed while this cookie-refresh attempt was still
        // failing in parallel.
        setStatus((s) =>
          s === STATUS.AUTHENTICATED ? s : STATUS.UNAUTHENTICATED,
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (payload) => {
    const data = await authApi.login(payload);
    setUser(data.user);
    setStatus(STATUS.AUTHENTICATED);
    return data;
  }, []);

  const acceptInvite = useCallback(async (token, password) => {
    const data = await authApi.acceptOwnerInvite(token, password);
    setUser(data.user);
    setStatus(STATUS.AUTHENTICATED);
    return data;
  }, []);

  // Журнал действий: след нажатий и переходов, пока человек вошёл (lib/journal.js).
  useEffect(() => {
    if (!user?.id) return undefined;
    return startJournal(`${API_BASE_URL}/journal/ui`, getAccessToken);
  }, [user?.id]);

  const logout = useCallback(async () => {
    // Нажатие «Выйти» и всё до него — в журнал, пока токен ещё жив.
    flushJournal();
    setImpersonatingFlag(false);
    try {
      await authApi.logout();
    } finally {
      setAccessToken(null);
      setUser(null);
      setImpersonatedTenant(null);
      persistImpersonatedTenant(null);
      clearStoredSession();
      setStatus(STATUS.UNAUTHENTICATED);
    }
  }, []);

  /* Остановленная вкладка: забыть её вход, НЕ выходя на сервере — кука теперь
     принадлежит соседней вкладке, и выход оборвал бы работу там. */
  const dropTabSession = useCallback(() => {
    setImpersonatingFlag(false);
    persistImpersonatedTenant(null);
    setAccessToken(null);
    clearStoredSession();
    setUser(null);
    setImpersonatedTenant(null);
    setStatus(STATUS.UNAUTHENTICATED);
  }, []);

  const hasPermission = useCallback(
    (code) =>
      !!user &&
      Array.isArray(user.permissions) &&
      user.permissions.includes(code),
    [user],
  );

  /**
   * Start impersonating: swap access token to tenant owner's token.
   * IMPORTANT: we set the impersonating flag BEFORE changing the token
   * so the 401 interceptor never auto-refreshes (which would rotate the
   * admin's refresh cookie and make exit impossible).
   */
  const impersonate = useCallback(async (tenant) => {
    const result = await superAdminApi.impersonate(tenant.id);
    setImpersonatingFlag(true); // block auto-refresh from this point
    setAccessToken(result.accessToken);
    setImpersonatedTenant(tenant);
    persistImpersonatedTenant(tenant);
  }, []);

  /**
   * Partner SSO entry (Kars Avia dispatcher link): exchange the one-time code
   * for an access token and adopt the session. Returns { mode } so the /sso
   * page can route: 'admin' → /admin (dispatcher's own admin panel), 'hotel' →
   * /dashboard with the «Вы работаете от имени <name>» banner.
   */
  const ssoEnter = useCallback(async (code) => {
    const result = await authApi.ssoExchange(code); // sets token + imp flag
    const profile = await authApi.me();
    setUser(profile);
    setStatus(STATUS.AUTHENTICATED);
    // Hotel mode is an impersonation session — drive the same banner the
    // super-admin impersonation uses so the dispatcher always sees whose hotel
    // they're operating.
    const tenant = result.mode === "hotel" ? result.tenant : null;
    setImpersonatedTenant(tenant);
    persistImpersonatedTenant(tenant);
    return result;
  }, []);

  /**
   * Exit impersonation: re-issue the operator's own token from the `imp` claim
   * (server-side), NOT from the refresh cookie. This is what makes exit work for
   * an SSO dispatcher (who never had a refresh cookie) as well as a super-admin.
   * Auto-refresh stays blocked for dispatchers (cookieless), re-enabled for
   * native super-admins.
   */
  const exitImpersonation = useCallback(async () => {
    try {
      await authApi.exitImpersonation(); // sets the operator's access token
      const profile = await authApi.me();
      setUser(profile);
      /* Выход перевыпускает и куку — она теперь указывает на собственную
         сессию вышедшего, поэтому автообновление можно вернуть всем.
         Раньше диспетчеру его оставляли выключенным: куки у него не было
         вовсе. */
      setImpersonatingFlag(false);
    } finally {
      setImpersonatedTenant(null);
      persistImpersonatedTenant(null);
    }
  }, []);

  const value = useMemo(
    () => ({
      user,
      status,
      login,
      logout,
      hasPermission,
      impersonatedTenant,
      impersonate,
      exitImpersonation,
      ssoEnter,
      acceptInvite,
      dropTabSession,
      isSuperAdmin: user?.isSuperAdmin === true,
      isImpersonating: impersonatedTenant !== null,
    }),
    [
      user,
      status,
      login,
      logout,
      hasPermission,
      impersonatedTenant,
      impersonate,
      exitImpersonation,
      ssoEnter,
      acceptInvite,
      dropTabSession,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

export const AUTH_STATUS = STATUS;
