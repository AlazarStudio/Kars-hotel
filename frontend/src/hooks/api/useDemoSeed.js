import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../../api/demoSeed';

export function useRunDemoSeed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.runDemoSeed,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rooms'] });
      qc.invalidateQueries({ queryKey: ['roomTypes'] });
    },
  });
}

export function useResetDemoSeed() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.resetDemoSeed,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rooms'] });
      qc.invalidateQueries({ queryKey: ['roomTypes'] });
    },
  });
}
