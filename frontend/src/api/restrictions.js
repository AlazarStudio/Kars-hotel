import { api } from './client';

export async function listRestrictions(filter = {}) {
  const { data } = await api.get('/restrictions', { params: filter });
  return data;
}

export async function upsertRestriction(payload) {
  const { data } = await api.post('/restrictions/upsert', payload);
  return data;
}

export async function deleteRestriction(id) {
  await api.delete(`/restrictions/${id}`);
}
