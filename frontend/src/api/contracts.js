import { api } from './client';

/* Договоры партнёров и цены договора (11.11.2026).
 *
 * Реестр договоров ведёт Авиа; ПМС только читает. Цены корпоративного тарифа
 * считает сервер тем же правилом, что и расчёт брони, — экран показывает
 * ровно то, по чему посчитают. */

/** Договоры гостиницы: реестр и приложения. Договор без цен тоже в списке. */
export async function listContracts() {
  const { data } = await api.get('/contracts');
  return data;
}

/** Цены договора для корпоративного тарифа на период. */
export async function fetchContractPrices(planId, from, to) {
  const url = '/rate-plans/' + encodeURIComponent(planId) + '/contract-prices';
  const { data } = await api.get(url, { params: { from, to } });
  return data;
}
