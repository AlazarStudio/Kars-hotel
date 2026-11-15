import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchContractPrices, listContracts, previewContractPrices } from '../../api/contracts';
import { CONTRACT_PRICES_KEY } from './ratePlanCache';
import { PARTNERS_KEY } from './usePartners';

/* Договоры приходят из Авии и меняются при её синхронизации — держим
   недолго, чтобы новая ДС появлялась без перезагрузки страницы. */
export function useContracts() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['contracts'], queryFn: listContracts, staleTime: 60_000, refetchInterval: 60_000 });
  const { dataUpdatedAt } = query;

  // Синхронизация может добавить юрлицо или АК даже при прежнем списке договоров.
  useEffect(() => {
    if (dataUpdatedAt) void queryClient.refetchQueries({ queryKey: PARTNERS_KEY, exact: true, type: 'active' });
  }, [queryClient, dataUpdatedAt]);

  return query;
}

/** Цены договора для тарифа. Без периода — сервер отдаёт сегодняшний день. */
export function useContractPrices(planId, from, to, enabled = true, revision = null) {
  return useQuery({
    queryKey: [...CONTRACT_PRICES_KEY, planId, from ?? null, to ?? null, revision],
    queryFn: () => fetchContractPrices(planId, from, to),
    enabled: enabled && !!planId,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
}

export function useContractPreview(conditions, from, to, enabled = true) {
  return useQuery({
    queryKey: ['contract-price-preview', conditions, from ?? null, to ?? null],
    queryFn: () => previewContractPrices(conditions, from, to),
    enabled: enabled && !!conditions?.partnerId && !!conditions?.operatorContract,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}
