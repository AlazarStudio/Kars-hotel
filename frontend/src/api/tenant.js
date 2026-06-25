import { api } from './client';

export async function getTenantSettings() {
  const { data } = await api.get('/tenant/settings');
  return data;
}

export async function updateTenantSettings(payload) {
  const { data } = await api.patch('/tenant/settings', payload);
  return data;
}

export async function uploadTenantLogo(file) {
  const form = new FormData();
  form.append('file', file);
  const { data } = await api.post('/tenant/logo', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return data; // updated tenant (incl. logoUrl)
}

export async function removeTenantLogo() {
  const { data } = await api.delete('/tenant/logo');
  return data; // updated tenant (logoUrl = null)
}
