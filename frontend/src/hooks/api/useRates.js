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

// ─── Standard (baseline) prices ──────────────────────────────────────────────

const STANDARD_KEY = ['standardRates'];

export function useStandardRates(ratePlanId) {
  return useQuery({
    queryKey: [...STANDARD_KEY, ratePlanId],
    queryFn: () => api.listStandardRates(ratePlanId),
    staleTime: 15_000,
    enabled: !!ratePlanId,
  });
}

export function useSetStandardRates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.setStandardRates,
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: STANDARD_KEY });
      qc.invalidateQueries({ queryKey: KEY });
      if (vars?.ratePlanId) qc.invalidateQueries({ queryKey: [...STANDARD_KEY, vars.ratePlanId] });
    },
  });
}

// ─── Seasons ─────────────────────────────────────────────────────────────────

const SEASONS_KEY = ['rateSeasons'];

export function useSeasons(ratePlanId) {
  return useQuery({
    queryKey: [...SEASONS_KEY, ratePlanId],
    queryFn: () => api.listSeasons(ratePlanId),
    staleTime: 15_000,
    enabled: !!ratePlanId,
  });
}

export function useReplaceSeasons() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.replaceSeasons,
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: SEASONS_KEY });
      qc.invalidateQueries({ queryKey: KEY });
      if (vars?.ratePlanId) qc.invalidateQueries({ queryKey: [...SEASONS_KEY, vars.ratePlanId] });
    },
  });
}
