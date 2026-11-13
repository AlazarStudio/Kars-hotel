import { useQuery } from '@tanstack/react-query';
import { fetchContractPrices, listContracts } from '../../api/contracts';

/* Договоры приходят из Авии и меняются при её синхронизации — держим
   недолго, чтобы новая ДС появлялась без перезагрузки страницы. */
export function useContracts() {
  return useQuery({ queryKey: ['contracts'], queryFn: listContracts, staleTime: 60_000 });
}

/** Цены договора для тарифа. Без периода — сервер отдаёт сегодняшний день. */
export function useContractPrices(planId, from, to, enabled = true) {
  return useQuery({
    queryKey: ['contract-prices', planId, from ?? null, to ?? null],
    queryFn: () => fetchContractPrices(planId, from, to),
    enabled: enabled && !!planId,
    staleTime: 60_000,
  });
}
