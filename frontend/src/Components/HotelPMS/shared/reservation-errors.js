/* ОТКАЗЫ ПО БРОНИ — ПО-РУССКИ (25.10.2026).
 *
 * Бэкенд отказывает по-английски, а форма брони показывала текст как есть:
 * диспетчер видел «Reservation not found». Переводим самые частые отказы —
 * по коду ответа и началу текста. Всё прочее показываем как пришло: новый или
 * редкий отказ лучше прочитать по-английски, чем потерять за общей фразой. */

import { BOOKING_STATUS } from '../constants.js';

const st = (key) => `«${BOOKING_STATUS[key].label}»`;
const rub = (value) => Number(value).toLocaleString('ru-RU');

const RULES = [
  [404, /^Reservation not found/, () =>
    'Бронь не найдена в этой гостинице. Обновите страницу и проверьте, от имени какой гостиницы вы работаете.'],
  [409, /^Cannot check out: outstanding balance of ([\d.]+)/, (m) =>
    `Выезд не отмечен: по счёту брони долг ${rub(m[1])} ₽. Сначала примите оплату во вкладке «Счёт».`],
  [409, /^Cannot check out: reservation must be in CHECKED_IN status/, () =>
    `Выезд отмечается только у брони в статусе ${st('checked_in')}.`],
  [409, /^Cannot check in:/, () =>
    `Заселить можно только бронь в статусе ${st('new')} или ${st('confirmed')}.`],
  [409, /^Cannot mark as no-show:/, () =>
    `${st('no_show')} отмечается только у брони в статусе ${st('new')} или ${st('confirmed')}.`],
  [409, /^Reservation was modified by another user/, () =>
    'Бронь уже изменили — обновите страницу и повторите.'],
  [409, /^No available place in this room/, () =>
    'В этом номере на эти даты нет свободного места.'],
  [409, /^The requested place is already booked/, () =>
    'Это место на эти даты уже занято.'],
  [409, /^checkOut must be after checkIn/, () =>
    'Дата выезда должна быть позже даты заезда.'],
];

/** Текст отказа для формы: известный — по-русски, прочий — как пришёл. */
export function reservationErrorText(err, fallback) {
  const status = err?.response?.status;
  const message = err?.response?.data?.message;
  if (typeof message === 'string') {
    for (const [code, pattern, text] of RULES) {
      const m = status === code ? pattern.exec(message) : null;
      if (m) return text(m);
    }
  }
  return message ?? err?.message ?? fallback;
}
