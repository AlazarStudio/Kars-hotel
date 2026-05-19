import { api } from './client';

export async function listRates(filter = {}) {
  const params = {};
  if (filter.ratePlanId) params.ratePlanId = filter.ratePlanId;
  if (filter.roomTypeId) params.roomTypeId = filter.roomTypeId;
  if (filter.from) params.from = filter.from;
  if (filter.to) params.to = filter.to;
  if (filter.occupancy != null) params.occupancy = filter.occupancy;
  const { data } = await api.get('/rates', { params });
  return data;
}

export async function bulkUpsertRates(items) {
  const { data } = await api.put('/rates/bulk', { items });
  return data;
}

export async function fillRates(payload) {
  const { data } = await api.post('/rates/fill', payload);
  return data;
}
