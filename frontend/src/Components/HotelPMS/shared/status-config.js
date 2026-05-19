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
  KING: 'King-size',
  QUEEN: 'Queen-size',
  SOFA: 'Диван-кровать',
};

export const ROOM_VIEW_LABELS = {
  NONE: 'Без вида',
  CITY: 'На город',
  GARDEN: 'На сад',
  POOL: 'На бассейн',
  SEA: 'На море',
  MOUNTAIN: 'На горы',
  COURTYARD: 'Во двор',
};
