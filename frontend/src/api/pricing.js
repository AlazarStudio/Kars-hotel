import { api } from './client';

export async function quotePricing(payload) {
  const { data } = await api.post('/pricing/quote', payload);
  return data;
}

/* Э6 · Цены договора с оператором — снимок, присланный Kars Avia.
   Только чтение: цену вводят в реестре договоров оператора, договор подписан
   двумя, и править его снимок у себя гостиница не может. */
export async function fetchOperatorContractPrices() {
  const { data } = await api.get('/pricing/operator-contract-prices');
  return data;
}
