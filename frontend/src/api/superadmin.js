import { api } from './client';

export async function getStats() {
  const { data } = await api.get('/admin/stats');
  return data;
}

export async function listTenants() {
  const { data } = await api.get('/admin/tenants');
  return data;
}

export async function getTenant(id) {
  const { data } = await api.get(`/admin/tenants/${id}`);
  return data;
}

export async function createTenant(payload) {
  const { data } = await api.post('/admin/tenants', payload);
  return data;
}

export async function updateTenant(id, payload) {
  const { data } = await api.patch(`/admin/tenants/${id}`, payload);
  return data;
}

/** Сколько в гостинице броней, номеров, категорий и учёток — для окон правки и удаления. */
export async function getTenantSummary(id) {
  const { data } = await api.get(`/admin/tenants/${id}/summary`);
  return data; // { reservations, rooms, roomTypes, users }
}

/** Удаление пустой гостиницы (без броней). С бронями сервер отвечает 409 — только по акту. */
export async function deleteTenant(id) {
  const { data } = await api.delete(`/admin/tenants/${id}`);
  return data; // { actId, counts, files }
}

export async function toggleTenantActive(id) {
  const { data } = await api.patch(`/admin/tenants/${id}/toggle-active`);
  return data;
}

export async function listUsers() {
  const { data } = await api.get('/admin/users');
  return data;
}

export async function toggleUserActive(id) {
  const { data } = await api.patch(`/admin/users/${id}/toggle-active`);
  return data;
}

export async function changeAdminPassword(password) {
  const { data } = await api.patch('/admin/settings/password', { password });
  return data;
}

export async function impersonate(tenantId) {
  const { data } = await api.post(`/admin/impersonate/${tenantId}`);
  return data; // { accessToken, accessTtlSeconds }
}

/* Уход гостиницы (152-ФЗ, план 13.8): выгрузка, затем уничтожение по акту. */
export async function exportTenant(id) {
  const { data, headers } = await api.get(`/admin/tenants/${id}/export`, { responseType: 'blob' });
  const name = /filename="?([^"]+)"?/.exec(headers['content-disposition'] ?? '')?.[1] ?? 'hotel.json';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(data);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export async function destroyTenant(id, confirmSlug) {
  const { data } = await api.post(`/admin/tenants/${id}/destroy`, { confirmSlug });
  return data;
}

/* Функции гостиниц массово (22.10.2026): каталог с состоянием у каждой
   гостиницы и включение / выключение сразу у выбранных. */
export async function listFeatures() {
  const { data } = await api.get('/admin/features');
  return data; // { features: [{ key, label, description }], tenants: [{ id, name, city, isActive, features }] }
}

export async function applyFeature(feature, enabled, tenantIds) {
  const { data } = await api.post('/admin/features/apply', { feature, enabled, tenantIds });
  return data; // { feature, enabled, changed, requested }
}

/** Журнал действий (23.10.2026): каждый запрос и каждое нажатие, по всем гостиницам. */
export async function listJournal(params = {}) {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== '' && v !== false));
  const { data } = await api.get('/admin/journal', { params: clean });
  return data;
}
