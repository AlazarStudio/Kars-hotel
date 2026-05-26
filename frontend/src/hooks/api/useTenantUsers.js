import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createUser, deleteUser, getRoles, getUsers, updateUser } from '../../api/tenantUsers';

export function useTenantUsers() {
  return useQuery({ queryKey: ['tenantUsers'], queryFn: getUsers });
}

export function useTenantRoles() {
  return useQuery({ queryKey: ['tenantRoles'], queryFn: getRoles });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createUser,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenantUsers'] }),
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, data }) => updateUser(userId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenantUsers'] }),
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteUser,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tenantUsers'] }),
  });
}
