import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as api from '../../api/housekeeping';

const KEY = ['hk-tasks'];

export function useHousekeepingTasks(status) {
  return useQuery({
    queryKey: [...KEY, status ?? 'all'],
    queryFn: () => api.listTasks(status),
    staleTime: 15_000,
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createTask,
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useAssignTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, assigneeId }) => api.assignTask(taskId, { assigneeId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useCompleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (taskId) => api.completeTask(taskId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ['rooms'] });
    },
  });
}
