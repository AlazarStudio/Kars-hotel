import { api } from './client';

export async function runDemoSeed() {
  const { data } = await api.post('/demo-seed');
  return data; // { inserted: { roomTypes, rooms }, hadExisting }
}

export async function resetDemoSeed() {
  const { data } = await api.delete('/demo-seed');
  return data;
}
