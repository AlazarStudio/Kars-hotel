import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../../api/restrictions';

const KEY = ['restrictions'];

export function useRestrictions(filter = {}) {
  return useQuery({
    queryKey: [...KEY, filter],
    queryFn: () => api.listRestrictions(filter),
    enabled: !!filter.roomTypeId,
    staleTime: 15_000,
  });
}

export function useUpsertRestriction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.upsertRestriction,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteRestriction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.deleteRestriction,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
