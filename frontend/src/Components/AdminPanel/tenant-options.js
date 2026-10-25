/* Списки и подписи для форм гостиницы в панели платформы — общие для
   «Добавить отель» и окна правки, чтобы списки не разошлись. */

/* Удаление ПУСТОЙ гостиницы ВЫКЛЮЧЕНО (решение владельца 25.10.2026, вечер):
   удаление не должно стирать данные из базы. Пока выключено, кнопки «Удалить»
   и «Выгрузить» видит только суперадмин, и пустую гостиницу окно ведёт тем же
   путём, что и с бронями, — по акту. Переключать вместе с `tenantDeleteSwitch`
   (backend/src/modules/super-admin/tenant-delete.switch.ts). */
export const TENANT_EMPTY_DELETE_ENABLED = false;

export const TIMEZONES = [
  ['Europe/Kaliningrad', 'Калининград (UTC+2)'],
  ['Europe/Moscow', 'Москва (UTC+3)'],
  ['Europe/Samara', 'Самара (UTC+4)'],
  ['Asia/Yekaterinburg', 'Екатеринбург (UTC+5)'],
  ['Asia/Omsk', 'Омск (UTC+6)'],
  ['Asia/Novosibirsk', 'Новосибирск (UTC+7)'],
  ['Asia/Krasnoyarsk', 'Красноярск (UTC+7)'],
  ['Asia/Irkutsk', 'Иркутск (UTC+8)'],
  ['Asia/Yakutsk', 'Якутск (UTC+9)'],
  ['Asia/Vladivostok', 'Владивосток (UTC+10)'],
  ['Asia/Magadan', 'Магадан (UTC+11)'],
  ['Asia/Kamchatka', 'Камчатка (UTC+12)'],
  ['UTC', 'UTC'],
];

export const CURRENCIES = [
  ['RUB', 'RUB — Рубль'],
  ['USD', 'USD — Доллар'],
  ['EUR', 'EUR — Евро'],
  ['KZT', 'KZT — Тенге'],
];

export const PLANS = [
  ['LITE', 'Lite — базовый'],
  ['STANDART', 'Standart — стандартный'],
  ['PREMIUM', 'Premium — расширенный'],
];

/** Значение из базы, которого нет в списке (например, Europe/Volgograd), — тоже вариант выбора. */
export function withCurrent(list, value) {
  return !value || list.some(([v]) => v === value) ? list : [[value, value], ...list];
}

/** «1 бронь», «3 брони», «12 броней». */
export function bookings(n) {
  const m10 = n % 10;
  const m100 = n % 100;
  const w = m10 === 1 && m100 !== 11 ? 'бронь' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'брони' : 'броней';
  return `${n} ${w}`;
}

export function errorText(err, fallback = 'Что-то пошло не так') {
  const msg = err?.response?.data?.message ?? err?.message ?? fallback;
  return Array.isArray(msg) ? msg.join(', ') : String(msg);
}
