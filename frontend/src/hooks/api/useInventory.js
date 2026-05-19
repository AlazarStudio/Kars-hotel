import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../../api/inventory';

const KEY = ['inventory'];

export function useInventory({ roomTypeId, from, to }) {
  return useQuery({
    queryKey: [...KEY, roomTypeId, from, to],
    queryFn: () => api.getInventory({ roomTypeId, from, to }),
    enabled: !!roomTypeId && !!from && !!to,
    staleTime: 15_000,
  });
}

export function useBulkUpdateInventory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ roomTypeId, rows }) => api.bulkUpdateInventory(roomTypeId, rows),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
