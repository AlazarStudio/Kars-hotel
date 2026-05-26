import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addCharge, addPayment, deleteCharge, getFolio } from '../../api/folio';

export function useFolio(reservationId) {
  return useQuery({
    queryKey: ['folio', reservationId],
    queryFn: () => getFolio(reservationId),
    enabled: !!reservationId,
  });
}

export function useAddCharge(reservationId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => addCharge(reservationId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['folio', reservationId] }),
  });
}

export function useAddPayment(reservationId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => addPayment(reservationId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['folio', reservationId] }),
  });
}

export function useDeleteCharge(reservationId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (chargeId) => deleteCharge(reservationId, chargeId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['folio', reservationId] }),
  });
}
