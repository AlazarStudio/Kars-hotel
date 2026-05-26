import { api } from './client';

export const getUsers = () =>
  api.get('/tenant/users').then((r) => r.data);

export const getRoles = () =>
  api.get('/tenant/roles').then((r) => r.data);

export const createUser = (data) =>
  api.post('/tenant/users', data).then((r) => r.data);

export const updateUser = (userId, data) =>
  api.patch(`/tenant/users/${userId}`, data).then((r) => r.data);

export const deleteUser = (userId) =>
  api.delete(`/tenant/users/${userId}`).then((r) => r.data);
