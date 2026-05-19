import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../../api/tenant';

const KEY = ['tenantSettings'];

export function useTenantSettings() {
  return useQuery({
    queryKey: KEY,
    queryFn: api.getTenantSettings,
    staleTime: 60_000,
  });
}

export function useUpdateTenantSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.updateTenantSettings,
    onSuccess: (data) => {
      qc.setQueryData(KEY, data);
    },
  });
}
