import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../../api/rates';

const KEY = ['rates'];

export function useRates(filter = {}) {
  return useQuery({
    queryKey: [...KEY, filter],
    queryFn: () => api.listRates(filter),
    staleTime: 15_000,
    enabled: !!filter.ratePlanId,
  });
}

export function useBulkUpsertRates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.bulkUpsertRates,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useFillRates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.fillRates,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
