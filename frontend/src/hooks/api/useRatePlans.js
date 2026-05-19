import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../../api/ratePlans';

const KEY = ['ratePlans'];

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
