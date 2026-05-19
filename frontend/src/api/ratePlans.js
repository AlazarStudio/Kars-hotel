import { api } from './client';

export async function listRatePlans() {
  const { data } = await api.get('/rate-plans');
  return data;
}

export async function getRatePlan(id) {
  const { data } = await api.get(`/rate-plans/${id}`);
  return data;
}

export async function createRatePlan(payload) {
  const { data } = await api.post('/rate-plans', payload);
  return data;
}

export async function updateRatePlan(id, payload) {
  const { data } = await api.patch(`/rate-plans/${id}`, payload);
  return data;
}

export async function deleteRatePlan(id) {
  const { data } = await api.delete(`/rate-plans/${id}`);
  return data;
}
