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
import {
  clearStoredSession,
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
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState(STATUS.LOADING);
  const [impersonatedTenant, setImpersonatedTenant] = useState(null);

  /* На старте — ДВА пути, и порядок важен.
   *
   * 1. Сессия этой вкладки (вход по ссылке из Kars Avia). Refresh-куки у неё
   *    нет, поэтому запрос обновления вернёт 401 и уведёт на форму входа —
   *    именно так перезагрузка и выбрасывала диспетчера из работающей
   *    сессии. Сначала пробуем восстановленный токен: отвечает `/auth/me` —
   *    сессия жива, и куки не нужны вовсе.
   * 2. Обычный вход паролем: там кука есть, идём прежним путём.
   */
  useEffect(() => {
    let cancelled = false;
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
          /* Токен просрочен или отозван — чистим и идём обычным путём с
             кукой: у сессии по ссылке она теперь тоже есть, поэтому работа
             продолжится, а не оборвётся формой входа. */
          setAccessToken(null);
          setImpersonatingFlag(false);
          clearStoredSession();
        }
      }
      try {
        await authApi.refresh();
        const profile = await authApi.me();
        if (!cancelled) {
          setUser(profile);
          /* Кука сессии по ссылке возвращает работу В ТОЙ ЖЕ гостинице —
             значит, и баннер «Вы работаете от имени …» должен вернуться.
             Название берём из записи вкладки: в профиле его нет, а работать
             в чужой гостинице, не видя чьей, нельзя. */
          if (stored?.tenant) setImpersonatedTenant(stored.tenant);
          setStatus(STATUS.AUTHENTICATED);
        }
      } catch {
        // Never downgrade an already-authenticated session: the /sso entry
        // page may have signed in (access-token-only, no refresh cookie)
        // while this cookie-refresh attempt was still failing in parallel.
        if (!cancelled) {
          setStatus((s) =>
            s === STATUS.AUTHENTICATED ? s : STATUS.UNAUTHENTICATED,
          );
        }
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

  const registerTenant = useCallback(async (payload) => {
    const data = await authApi.registerTenant(payload);
    const profile = await authApi.me();
    setUser(profile);
    setStatus(STATUS.AUTHENTICATED);
    return { ...data, profile };
  }, []);

  const logout = useCallback(async () => {
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
      registerTenant,
      logout,
      hasPermission,
      impersonatedTenant,
      impersonate,
      exitImpersonation,
      ssoEnter,
      isSuperAdmin: user?.isSuperAdmin === true,
      isImpersonating: impersonatedTenant !== null,
    }),
    [
      user,
      status,
      login,
      registerTenant,
      logout,
      hasPermission,
      impersonatedTenant,
      impersonate,
      exitImpersonation,
      ssoEnter,
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
