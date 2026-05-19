import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../../api/roomTypes';

const KEY = ['roomTypes'];

export function useRoomTypes() {
  return useQuery({
    queryKey: KEY,
    queryFn: api.listRoomTypes,
    staleTime: 30_000,
  });
}

export function useCreateRoomType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createRoomType,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateRoomType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }) => api.updateRoomType(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ['rooms'] });
    },
  });
}

export function useDeleteRoomType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.deleteRoomType,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
