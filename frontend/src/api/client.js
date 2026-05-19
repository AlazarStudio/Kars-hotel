import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';

// In-memory access token storage. Refresh token lives in an httpOnly cookie
// managed by the backend, so the SPA never sees it directly.
let accessToken = null;
const accessListeners = new Set();

export function setAccessToken(token) {
  accessToken = token;
  for (const cb of accessListeners) cb(token);
}

export function getAccessToken() {
  return accessToken;
}

export function onAccessTokenChange(cb) {
  accessListeners.add(cb);
  return () => accessListeners.delete(cb);
}

export const api = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true, // send/receive httpOnly refresh cookie
});

// ─── Request: attach Bearer ────────────────────────────────────────────────
api.interceptors.request.use((cfg) => {
  if (accessToken) {
    cfg.headers = cfg.headers || {};
    cfg.headers.Authorization = `Bearer ${accessToken}`;
  }
  return cfg;
});

// ─── Response: on 401 try a single refresh + retry, otherwise pass-through ─
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

    const url = original.url || '';
    const status = err.response?.status;

    // Avoid loops: don't refresh on auth endpoints themselves.
    if (status === 401 && !url.includes('/auth/')) {
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
