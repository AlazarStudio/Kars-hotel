import { api } from './client';

export async function getTenantSettings() {
  const { data } = await api.get('/tenant/settings');
  return data;
}

export async function updateTenantSettings(payload) {
  const { data } = await api.patch('/tenant/settings', payload);
  return data;
}
