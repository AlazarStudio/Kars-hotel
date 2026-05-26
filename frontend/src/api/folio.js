import { api } from './client';

const base = (reservationId) => `/reservations/${reservationId}/folio`;

export const getFolio = (reservationId) =>
  api.get(base(reservationId)).then((r) => r.data);

export const addCharge = (reservationId, data) =>
  api.post(`${base(reservationId)}/charges`, data).then((r) => r.data);

export const deleteCharge = (reservationId, chargeId) =>
  api.delete(`${base(reservationId)}/charges/${chargeId}`).then((r) => r.data);

export const addPayment = (reservationId, data) =>
  api.post(`${base(reservationId)}/payments`, data).then((r) => r.data);
