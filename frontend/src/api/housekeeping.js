import { api } from './client';

const base = '/housekeeping/tasks';

export const listTasks = (status) =>
  api.get(base, { params: status ? { status } : {} }).then((r) => r.data);

export const createTask = (data) =>
  api.post(base, data).then((r) => r.data);

export const assignTask = (taskId, data) =>
  api.post(`${base}/${taskId}/assign`, data).then((r) => r.data);

export const completeTask = (taskId) =>
  api.post(`${base}/${taskId}/complete`).then((r) => r.data);
