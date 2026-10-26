/* ПРИЛЁТ И ОТЪЕЗД БРОНИ ИЗ KARS AVIA (24.10.2026, правка заказчика: «в бронях
   видна дата, но не видно время прибытия»). У квартир нет круглосуточной
   стойки — без времени экипаж встречать некому.

   Время — местное время города текстом «ГГГГ-ММ-ДДTЧЧ:ММ», как его видит
   диспетчер. Разбираем руками, без Date: Date пересчитал бы его по поясу
   браузера, и 02:00 стало бы чем угодно. Непонятное не показываем — лучше
   промолчать, чем назвать гостинице неверный час. */

const MONTH_SHORT = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})$/;

/** «22 окт, 02:00»; непонятное — null. */
export function fmtStayTime(value) {
  const m = LOCAL.exec(value ?? '');
  const month = m && MONTH_SHORT[Number(m[2]) - 1];
  if (!month) return null;
  return `${Number(m[3])} ${month}, ${m[4]}`;
}

/** Только «02:00», если время приходится на день `day` (его показывают рядом); иначе — с датой. */
export function stayClock(value, day) {
  const m = LOCAL.exec(value ?? '');
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}` === day ? m[4] : fmtStayTime(value);
}

/** Строки подсказки шахматки — [подпись, значение], только известное.
    Заселён и выселен — когда это было на самом деле (26.10.2026: «не пишет
    время заезда и время выезда в шахматке»). */
export function stayRows(booking) {
  const arrival = fmtStayTime(booking?.arrivalAt);
  const departure = fmtStayTime(booking?.departureAt);
  const checkedIn = fmtStayTime(booking?.checkedInAt);
  const checkedOut = fmtStayTime(booking?.checkedOutAt);
  return [
    arrival && ['Прибытие:', arrival],
    departure && ['Отъезд:', departure],
    booking?.flight && ['Рейс:', booking.flight],
    checkedIn && ['Заселён:', checkedIn],
    checkedOut && ['Выселен:', checkedOut],
  ].filter(Boolean);
}

/** «прибытие 22 окт, 02:00 · отъезд 24 окт, 10:40 · рейс S7 178» — что известно. */
export function stayLine(booking) {
  const arrival = fmtStayTime(booking?.arrivalAt);
  const departure = fmtStayTime(booking?.departureAt);
  return [
    arrival && `прибытие ${arrival}`,
    departure && `отъезд ${departure}`,
    booking?.flight && `рейс ${booking.flight}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Заезды по времени прибытия: известное раньше, неизвестное — в конце, в прежнем порядке. */
export function byArrival(a, b) {
  if (!a.arrivalAt || !b.arrivalAt) return (a.arrivalAt ? 0 : 1) - (b.arrivalAt ? 0 : 1);
  return a.arrivalAt.localeCompare(b.arrivalAt);
}
