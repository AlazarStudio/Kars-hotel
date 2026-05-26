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

/**
 * Atomically swap place numbers of two reservations in the same room.
 * @param {string} idA
 * @param {number} versionA
 * @param {string} idB
 * @param {number} versionB
 */
export async function swapReservations(idA, versionA, idB, versionB) {
  const resp = await api.post('/reservations/swap', { idA, versionA, idB, versionB });
  return resp.data;
}

/**
 * Get reservations arriving on a given date.
 * @param {string} date – 'YYYY-MM-DD'
 */
export async function getArrivals(date) {
  const resp = await api.get(`/reservations/arrivals?date=${date}`);
  return resp.data;
}

/**
 * Get reservations departing on a given date.
 * @param {string} date – 'YYYY-MM-DD'
 */
export async function getDepartures(date) {
  const resp = await api.get(`/reservations/departures?date=${date}`);
  return resp.data;
}

/** Check in a reservation. */
export async function checkIn(id) {
  const resp = await api.post(`/reservations/${id}/check-in`);
  return resp.data;
}

/** Check out a reservation. */
export async function checkOut(id) {
  const resp = await api.post(`/reservations/${id}/check-out`);
  return resp.data;
}

/** Mark a reservation as no-show. */
export async function noShow(id) {
  const resp = await api.post(`/reservations/${id}/no-show`);
  return resp.data;
}

/**
 * Cancel a reservation with an optional reason.
 * @param {string} id
 * @param {string} [reason]
 */
export async function cancelReservation(id, reason) {
  const resp = await api.post(`/reservations/${id}/cancel`, { reason });
  return resp.data;
}
