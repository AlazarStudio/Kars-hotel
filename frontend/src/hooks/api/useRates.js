import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
/* Правка ЛЮБОЙ цены роняет подтверждение корпоративного тарифа: статус сверки
   считает сервер по всем трём источникам цены. Не сбросить список тарифов
   значит оставить на экране зелёное «подтверждён» под цифрой, которую только
   что поменяли, — а верят именно экрану. */
import { RATE_PLANS_KEY } from './useRatePlans';
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: RATE_PLANS_KEY });
    },
  });
}

export function useFillRates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.fillRates,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: RATE_PLANS_KEY });
    },
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
      qc.invalidateQueries({ queryKey: RATE_PLANS_KEY });
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
      qc.invalidateQueries({ queryKey: RATE_PLANS_KEY });
      if (vars?.ratePlanId) qc.invalidateQueries({ queryKey: [...SEASONS_KEY, vars.ratePlanId] });
    },
  });
}
