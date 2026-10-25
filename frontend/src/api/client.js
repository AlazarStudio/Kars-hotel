import axios from "axios";
import { journalHeaders } from "../lib/journal";
import { createSessionRefresh, sessionCookiePath, sessionOf } from "./session-refresh";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:3001/api";

let accessToken = null;
const accessListeners = new Set();

// Flag: while impersonating, the 401 interceptor must NOT auto-refresh.
// Auto-refresh during impersonation rotates the admin's refresh token, making
// exit-impersonation impossible (rotated token → 401 → logout).
let impersonating = false;

/* ── Сессия, пережившая F5 ────────────────────────────────────────────────
 *
 * Токен держим в `sessionStorage`: это ВКЛАДКА, а не браузер. Ссылка из
 * Avia открывается новой вкладкой — она и переживает перезагрузки, а
 * закрытие вкладки сессию заканчивает. В `localStorage` такой токен жил бы
 * во всех вкладках и после ухода человека с рабочего места.
 *
 * Продление же — по куке браузера: общей у входа паролем и панели, своей у
 * каждой гостиницы для входа по ссылке из Kars Avia. Какой — решает вход
 * вкладки, и принимается только он же — см. `session-refresh.js`.
 */
const SESSION_KEY = "kars-pms.session";

function persistSession() {
  try {
    if (!accessToken) {
      sessionStorage.removeItem(SESSION_KEY);
      return;
    }
    sessionStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        accessToken,
        impersonating,
        tenant: impersonatedTenant,
      }),
    );
  } catch {
    // Приватный режим и запрет хранилища не должны ронять вход: без
    // сохранения сессия просто не переживёт перезагрузку, как раньше.
  }
}

/** Что осталось от прошлой загрузки этой вкладки. */
export function readStoredSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearStoredSession() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* см. выше */
  }
}

/* Гостиница, от имени которой работает диспетчер, — для баннера «Вы работаете
   от имени …». Без неё после перезагрузки баннер пропадал, и человек не видел,
   в чьей гостинице он нажимает кнопки. */
let impersonatedTenant = null;

export function setImpersonatedTenant(tenant) {
  impersonatedTenant = tenant ?? null;
  persistSession();
}

export function setAccessToken(token) {
  accessToken = token;
  persistSession();
  for (const cb of accessListeners) cb(token);
}

export function getAccessToken() {
  return accessToken;
}

export function onAccessTokenChange(cb) {
  accessListeners.add(cb);
  return () => accessListeners.delete(cb);
}

const stopListeners = new Set();

/** Вкладку остановили: вход браузера чужой или вход в гостиницу кончился. */
export function onSessionStopped(cb) {
  stopListeners.add(cb);
  return () => stopListeners.delete(cb);
}

/** Ручки куки входа этой вкладки — для выхода. Вход «от имени» из панели
 *  платформы своей куки не имеет: выходит общей, гася сессию суперадмина. */
export function authCookiePath() {
  return impersonating ? "/auth" : sessionCookiePath(sessionOf(accessToken));
}

export function setImpersonatingFlag(val) {
  impersonating = val;
  persistSession();
}

export const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

// ─── Request: attach Bearer ────────────────────────────────────────────────
api.interceptors.request.use((cfg) => {
  if (accessToken) {
    cfg.headers = cfg.headers || {};
    cfg.headers.Authorization = `Bearer ${accessToken}`;
  }
  // Журнал действий: вкладка, экран и нажатие, от которого пошёл запрос.
  if (cfg.headers?.set) journalHeaders(cfg.headers);
  return cfg;
});

// ─── Response: on 401 try ONE refresh+retry — but never while impersonating ─
const sessionRefresh = createSessionRefresh({
  post: (path) =>
    axios
      .post(`${API_BASE_URL}${path}`, null, { withCredentials: true })
      .then((r) => r.data.accessToken),
  retry: (cfg) => api.request(cfg),
  getToken: () => accessToken,
  setToken: setAccessToken,
  canRefresh: () => !impersonating,
  onStopped: (err) => {
    for (const cb of stopListeners) cb(err);
  },
});

const performRefresh = sessionRefresh.refresh;

api.interceptors.response.use((resp) => resp, sessionRefresh.onAuthError);

export { API_BASE_URL, performRefresh };
