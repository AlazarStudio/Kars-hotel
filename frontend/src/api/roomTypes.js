import { api } from './client';

export async function listRoomTypes() {
  const { data } = await api.get('/room-types');
  return data;
}

export async function getRoomType(id) {
  const { data } = await api.get(`/room-types/${id}`);
  return data;
}

export async function createRoomType(payload) {
  const { data } = await api.post('/room-types', payload);
  return data;
}

export async function updateRoomType(id, payload) {
  const { data } = await api.patch(`/room-types/${id}`, payload);
  return data;
}

export async function deleteRoomType(id) {
  const { data } = await api.delete(`/room-types/${id}`);
  return data;
}
