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
