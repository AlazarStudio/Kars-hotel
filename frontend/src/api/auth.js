import {
  api,
  setAccessToken,
  setImpersonatingFlag,
  performRefresh,
} from "./client";

export async function registerTenant(payload) {
  const { data } = await api.post("/auth/register-tenant", payload);
  setAccessToken(data.accessToken);
  return data; // { tenantId, userId, accessToken, accessTtlSeconds }
}

export async function login(payload) {
  const { data } = await api.post("/auth/login", payload);
  setAccessToken(data.accessToken);
  return data; // { user, accessToken, accessTtlSeconds }
}

export async function logout() {
  try {
    await api.post("/auth/logout");
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
  const { data } = await api.get("/auth/me");
  return data;
}

/**
 * Partner SSO (вход по одноразовому коду из диспетчерской Kars Avia).
 *
 * Кода хватает на один обмен, но сессия теперь ПОЛНОЦЕННАЯ: сервер ставит
 * refresh-куку, привязанную к этой же гостинице. Поэтому автообновление здесь
 * НЕ блокируется — раньше блокировка стояла из-за отсутствия куки, и вместе с
 * коротким токеном давала выход на форму входа через час работы.
 *
 * Запрет остаётся только для входа супер-админа «от имени» из панели: у него
 * есть СВОЯ сессия с кукой, и обновление затёрло бы её, сделав выход из
 * режима невозможным.
 */
export async function ssoExchange(code) {
  const { data } = await api.post("/auth/sso/exchange", { code });
  setImpersonatingFlag(false);
  setAccessToken(data.accessToken);
  return data; // { accessToken, accessTtlSeconds, mode: 'admin'|'hotel', tenant? }
}

// Exit impersonation via the operator's `imp` claim — no refresh cookie needed,
// so it works for SSO dispatchers (no cookie at all) and super-admins alike.
export async function exitImpersonation() {
  const { data } = await api.post("/auth/exit-impersonation");
  setAccessToken(data.accessToken);
  return data; // { accessToken, accessTtlSeconds }
}
