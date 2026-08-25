import axios from "axios";

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
 * Вход по ссылке из Kars Avia НЕ ставит refresh-куку: код одноразовый, в
 * ответ приходит только access-токен. Токен жил в памяти модуля, и любая
 * перезагрузка страницы его теряла — диспетчера выбрасывало на форму входа,
 * хотя сессия действующая. Возврат в Avia и повторное нажатие кнопки лечили
 * симптом до следующего F5.
 *
 * Держим сессию в `sessionStorage`: это ВКЛАДКА, а не браузер. Ссылка из
 * Avia открывается новой вкладкой — она и переживает перезагрузки, а
 * закрытие вкладки сессию заканчивает. В `localStorage` такой токен жил бы
 * во всех вкладках и после ухода человека с рабочего места.
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
  return cfg;
});

// ─── Response: on 401 try ONE refresh+retry — but never while impersonating ─
let refreshInFlight = null;

async function performRefresh() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = axios
    .post(`${API_BASE_URL}/auth/refresh`, null, { withCredentials: true })
    .then((r) => {
      setAccessToken(r.data.accessToken);
      return r.data.accessToken;
    })
    .catch((err) => {
      setAccessToken(null);
      throw err;
    })
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

api.interceptors.response.use(
  (resp) => resp,
  async (err) => {
    const original = err.config;
    if (!original || original._retried) return Promise.reject(err);
    const url = original.url || "";
    const status = err.response?.status;

    if (status === 401 && !url.includes("/auth/") && !impersonating) {
      try {
        const newToken = await performRefresh();
        original._retried = true;
        original.headers = original.headers || {};
        original.headers.Authorization = `Bearer ${newToken}`;
        return api.request(original);
      } catch {
        return Promise.reject(err);
      }
    }
    return Promise.reject(err);
  },
);

export { API_BASE_URL, performRefresh };
