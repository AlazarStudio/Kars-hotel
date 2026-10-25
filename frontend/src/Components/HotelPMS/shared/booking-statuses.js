/* СТАТУСЫ В СЕТКЕ ФОРМЫ БРОНИ (25.10.2026).
 *
 * Бронь Kars Avia отменяет только партнёр: кнопки «Отменить бронь» у неё нет,
 * и «Отменено» из формы сервер не примет (403). Поэтому в сетке у неё этого
 * статуса нет. Уже отменённая показывает свой статус как есть. */

import { BOOKING_STATUS } from '../constants.js';

/** Ключи BOOKING_STATUS, которые форма предлагает для брони. */
export function formStatuses(booking) {
  const keys = Object.keys(BOOKING_STATUS);
  if (!booking?.channelManaged || booking.status === 'cancelled') return keys;
  return keys.filter((key) => key !== 'cancelled');
}
