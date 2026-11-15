import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../../api/ratePlans';
import { RATE_PLANS_KEY, invalidateRatePlanQueries } from './ratePlanCache';

/* Экспортируется намеренно: список тарифов надо сбрасывать и из соседних
   хуков — применимость корпоративного тарифа считает сервер по договору.
   Копия ключа строкой в другом файле промахнулась бы молча:
   невалидный ключ не ошибка, а просто ничего. */
export { RATE_PLANS_KEY } from './ratePlanCache';
const KEY = RATE_PLANS_KEY;

export function useRatePlans() {
  return useQuery({ queryKey: KEY, queryFn: api.listRatePlans, staleTime: 30_000, refetchInterval: 60_000 });
}

export function useTariffRoomTypes() {
  // Shares category invalidation, but never the full catalog's cached data.
  return useQuery({ queryKey: ['roomTypes', 'tariffs'], queryFn: api.listTariffRoomTypes, staleTime: 30_000 });
}

export function useCreateRatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createRatePlan,
    onSuccess: (data) => invalidateRatePlanQueries(qc, data.id),
  });
}

export function useUpdateRatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }) => api.updateRatePlan(id, payload),
    onSuccess: (_data, { id }) => invalidateRatePlanQueries(qc, id),
  });
}

export function useDeleteRatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.deleteRatePlan,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ['rates'] });
    },
  });
}
