import { api, setAccessToken, setImpersonatingFlag, performRefresh } from './client';

export async function registerTenant(payload) {
  const { data } = await api.post('/auth/register-tenant', payload);
  setAccessToken(data.accessToken);
  return data; // { tenantId, userId, accessToken, accessTtlSeconds }
}

export async function login(payload) {
  const { data } = await api.post('/auth/login', payload);
  setAccessToken(data.accessToken);
  return data; // { user, accessToken, accessTtlSeconds }
}

export async function logout() {
  try {
    await api.post('/auth/logout');
  } finally {
    setAccessToken(null);
  }
}

export async function refresh() {
  // performRefresh deduplicates concurrent calls via refreshInFlight —
  // React StrictMode double-mounts effects, firing two refresh() calls
  // simultaneously. Without deduplication the server rotates the cookie
  // on the first call, the second call gets 401, and the user is logged out.
  const accessToken = await performRefresh();
  return { accessToken };
}

export async function me() {
  const { data } = await api.get('/auth/me');
  return data;
}

/**
 * Partner SSO (вход по одноразовому коду из диспетчерской Kars Avia).
 * Кода хватает на один обмен; в ответ приходит только access-токен (без
 * refresh-cookie), поэтому включаем флаг impersonating — 401-интерсептор не
 * должен пытаться рефрешиться несуществующей кукой.
 */
export async function ssoExchange(code) {
  const { data } = await api.post('/auth/sso/exchange', { code });
  setImpersonatingFlag(true);
  setAccessToken(data.accessToken);
  return data; // { accessToken, accessTtlSeconds, mode: 'admin'|'hotel', tenant? }
}
