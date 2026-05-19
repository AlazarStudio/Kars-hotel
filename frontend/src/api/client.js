import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

let accessToken = null;
const accessListeners = new Set();

// Flag: while impersonating, the 401 interceptor must NOT auto-refresh.
// Auto-refresh during impersonation rotates the admin's refresh token, making
// exit-impersonation impossible (rotated token → 401 → logout).
let impersonating = false;

export function setAccessToken(token) {
  accessToken = token;
  for (const cb of accessListeners) cb(token);
}

export function getAccessToken() { return accessToken; }

export function onAccessTokenChange(cb) {
  accessListeners.add(cb);
  return () => accessListeners.delete(cb);
}

export function setImpersonatingFlag(val) {
  impersonating = val;
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
    .finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

api.interceptors.response.use(
  (resp) => resp,
  async (err) => {
    const original = err.config;
    if (!original || original._retried) return Promise.reject(err);
    const url = original.url || '';
    const status = err.response?.status;

    if (status === 401 && !url.includes('/auth/') && !impersonating) {
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
