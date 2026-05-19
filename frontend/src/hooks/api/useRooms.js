import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../../api/rooms';

const KEY = ['rooms'];

export function useRooms(filter = {}) {
  return useQuery({
    queryKey: [...KEY, filter],
    queryFn: () => api.listRooms(filter),
    staleTime: 30_000,
  });
}

export function useCreateRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createRoom,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ['roomTypes'] });
    },
  });
}

export function useUpdateRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }) => api.updateRoom(id, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ['roomTypes'] });
    },
  });
}

export function useUpdateRoomStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }) => api.updateRoomStatus(id, status),
    // Optimistic update for snappy housekeeping UX.
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: KEY });
      const snapshots = qc.getQueriesData({ queryKey: KEY });
      for (const [key, value] of snapshots) {
        if (Array.isArray(value)) {
          qc.setQueryData(
            key,
            value.map((r) => (r.id === id ? { ...r, status } : r)),
          );
        }
      }
      return { snapshots };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.snapshots) for (const [key, value] of ctx.snapshots) qc.setQueryData(key, value);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.deleteRoom,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ['roomTypes'] });
    },
  });
}
