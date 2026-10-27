// Mapping between the backend RoomStatus enum (UPPER_CASE) and the visual
// configuration that drives Housekeeping and Rooms UIs.
//
// Keep the legacy `HK_STATUS` (lower-case keys) in constants.js around for
// modules that still operate on mock data; this file is the bridge for any
// component that consumes the real API.

export const ROOM_STATUS_CONFIG = {
  DIRTY: { label: 'Грязный', color: '#EF5350', bg: '#FFEBEE' },
  CLEANING: { label: 'Убирается', color: '#FF9800', bg: '#FFF3E0' },
  INSPECTED: { label: 'На проверке', color: '#9C27B0', bg: '#F3E5F5' },
  CLEAN: { label: 'Чистый', color: '#43A047', bg: '#E8F5E9' },
  READY: { label: 'Готов', color: '#1E88E5', bg: '#E3F2FD' },
  OUT_OF_ORDER: { label: 'Не работает', color: '#B91C1C', bg: '#FEE2E2' },
  OUT_OF_SERVICE: { label: 'На ремонте', color: '#6B7280', bg: '#F3F4F6' },
};

export const ROOM_STATUSES = Object.keys(ROOM_STATUS_CONFIG);

/* А3 · договорный блок номера за партнёром.
 *
 * Признак ИНФОРМАЦИОННЫЙ: он не блокирует продажу. Блокировать значило бы
 * вынести коммерческую договорённость в техническое ограничение — а
 * договорённости меняются быстрее, чем данные в базе, и отель всё равно
 * продаст номер, если так решил. Задача признака — чтобы обе стороны видели
 * одно и то же, и расхождение было ЗАМЕТНО, а не случилось молча.
 *
 * Поэтому и цвета спокойные: это пометка, а не запрет. Красным здесь было бы
 * враньём — ничего не сломано.
 */
export const PARTNER_HOLD_CONFIG = {
  NONE: { label: 'Свободен', short: '', color: '#6B7280', bg: '#F3F4F6' },
  QUOTA: {
    label: 'Квота партнёра',
    short: 'Квота',
    color: '#1E88E5',
    bg: '#E3F2FD',
    hint: 'Держим за партнёром по договору — он вправе рассчитывать, что номер свободен',
  },
  RESERVE: {
    label: 'Резерв сверх квоты',
    short: 'Резерв',
    color: '#8E24AA',
    bg: '#F3E5F5',
    hint: 'Подстраховка на пиковые дни: партнёр видит номер, но это не гарантия',
  },
};

/** Suggested transitions for the Housekeeping quick-action buttons. */
export const ROOM_STATUS_FLOW = {
  DIRTY: ['CLEANING'],
  CLEANING: ['INSPECTED'],
  INSPECTED: ['CLEAN', 'DIRTY'],
  CLEAN: ['READY'],
  READY: ['DIRTY'],
  OUT_OF_ORDER: ['CLEAN', 'DIRTY'],
  OUT_OF_SERVICE: ['CLEAN', 'DIRTY'],
};

export const BED_TYPE_LABELS = {
  SINGLE: 'Односпальная',
  DOUBLE: 'Двуспальная',
  TWIN: 'Две односпальные',
  THREE_SINGLE: 'Три односпальные',
  FOUR_SINGLE: 'Четыре односпальные',
  FIVE_SINGLE: 'Пять односпальных',
  TWO_DOUBLE: 'Две двуспальные',
  DOUBLE_SINGLE: 'Двуспальная и односпальная',
  KING: 'King-size',
  QUEEN: 'Queen-size',
  SOFA: 'Диван-кровать',
};

const ruPlural = (n, one, few, many) => {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return one;
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return few;
  return many;
};

/* Кровати номера числами (27.10.2026): «1 двуспальная + 1 диван». Чисел нет
   (номер из старого API) — прежняя подпись вида. Число со словом склеены
   неразрывным пробелом: в узкой карточке номера строка иначе рвалась на
   «1 / двуспальная». */
export function bedsLabel(room) {
  const parts = [
    [room?.singleBeds, 'односпальная', 'односпальные', 'односпальных'],
    [room?.doubleBeds, 'двуспальная', 'двуспальные', 'двуспальных'],
    [room?.sofas, 'диван', 'дивана', 'диванов'],
    [room?.extraBeds, 'доп.\u00a0кровать', 'доп.\u00a0кровати', 'доп.\u00a0кроватей'],
  ]
    .filter(([n]) => n > 0)
    .map(([n, ...forms]) => `${n}\u00a0${ruPlural(n, ...forms)}`);
  return parts.length ? parts.join(' + ') : BED_TYPE_LABELS[room?.bedType] || room?.bedType || '';
}

export const ROOM_VIEW_LABELS = {
  NONE: 'Без вида',
  CITY: 'На город',
  GARDEN: 'На сад',
  POOL: 'На бассейн',
  SEA: 'На море',
  MOUNTAIN: 'На горы',
  COURTYARD: 'Во двор',
};
