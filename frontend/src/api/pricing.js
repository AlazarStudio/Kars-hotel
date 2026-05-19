import { api } from './client';

export async function quotePricing(payload) {
  const { data } = await api.post('/pricing/quote', payload);
  return data;
}
