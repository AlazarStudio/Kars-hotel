import { api } from './client';

export async function getInventory({ roomTypeId, from, to }) {
  const { data } = await api.get('/inventory', { params: { roomTypeId, from, to } });
  return data;
}

export async function bulkUpdateInventory(roomTypeId, rows) {
  const { data } = await api.put(`/inventory/${roomTypeId}`, { rows });
  return data;
}
