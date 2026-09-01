import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../../api/ratePlans';

/* Экспортируется намеренно: список тарифов надо сбрасывать и из соседних
   хуков — статус сверки корпоративного тарифа считает сервер, и он меняется от
   правки цен. Копия ключа строкой в другом файле промахнулась бы молча:
   невалидный ключ не ошибка, а просто ничего. */
export const RATE_PLANS_KEY = ['ratePlans'];
const KEY = RATE_PLANS_KEY;

export function useRatePlans() {
  return useQuery({ queryKey: KEY, queryFn: api.listRatePlans, staleTime: 30_000 });
}

export function useCreateRatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createRatePlan,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateRatePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }) => api.updateRatePlan(id, payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
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
