import { api } from './client';

/**
 * Create a new reservation.
 * @returns {Promise<{ id: string, status: string, version: number }>}
 */
export async function createReservation(data) {
  const resp = await api.post('/reservations', data);
  return resp.data;
}

/**
 * Update an existing reservation (partial — only changed fields needed).
 * `version` is required for optimistic-locking.
 *
 * @param {string} id
 * @param {object} data
 * @param {number} data.version  – current version (required)
 * @param {string} [data.roomId]
 * @param {string} [data.checkIn]    – 'YYYY-MM-DD'
 * @param {string} [data.checkOut]   – 'YYYY-MM-DD'
 * @param {string} [data.guestName]
 * @param {string} [data.phone]
 * @param {string} [data.status]
 * @param {string} [data.source]
 * @param {string} [data.notes]
 * @param {number} [data.totalPrice]
 * @param {number} [data.adults]
 * @param {number} [data.children]
 * @returns {Promise<{ id: string, status: string, version: number }>}
 */
export async function updateReservation(id, data) {
  const resp = await api.patch(`/reservations/${id}`, data);
  return resp.data;
}
