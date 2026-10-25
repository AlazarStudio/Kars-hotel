import { api } from './client';

export async function listRooms(filter = {}) {
  const params = {};
  if (filter.roomTypeId) params.roomTypeId = filter.roomTypeId;
  if (filter.floor != null) params.floor = filter.floor;
  if (filter.status) params.status = filter.status;
  if (filter.isActive != null) params.isActive = filter.isActive ? 'true' : 'false';
  if (filter.archived) params.archived = 'true';
  const { data } = await api.get('/rooms', { params });
  return data;
}

export async function getRoom(id) {
  const { data } = await api.get(`/rooms/${id}`);
  return data;
}

export async function createRoom(payload) {
  const { data } = await api.post('/rooms', payload);
  return data;
}

export async function updateRoom(id, payload) {
  const { data } = await api.patch(`/rooms/${id}`, payload);
  return data;
}

export async function updateRoomStatus(id, status) {
  const { data } = await api.patch(`/rooms/${id}/status`, { status });
  return data;
}

export async function deleteRoom(id) {
  const { data } = await api.delete(`/rooms/${id}`);
  return data;
}

/* Удаление «в архив» (25.10.2026): номер не стирается, его можно восстановить. */
export async function archiveRoom(id) {
  const { data } = await api.post(`/rooms/${id}/archive`);
  return data;
}

export async function restoreRoom(id) {
  const { data } = await api.post(`/rooms/${id}/restore`);
  return data;
}
