export const DAY_WIDTH = 44;
export const ROW_HEIGHT = 52;
export const CAT_HEADER_HEIGHT = 38;
export const LEFT_PANEL_WIDTH = 210;
export const TIMELINE_HEADER_HEIGHT = 64;

export const BOOKING_STATUS = {
  new:         { label: 'Новое',        color: '#78909C', text: '#fff', hint: 'Бронь поступила автоматически из OTA или сайта. Требует проверки менеджером.' },
  confirmed:   { label: 'Подтверждено', color: '#43A047', text: '#fff', hint: 'Менеджер подтвердил бронь — созвонился с гостем, получил депозит или письменное подтверждение.' },
  checked_in:  { label: 'Заселён',      color: '#1E88E5', text: '#fff', hint: 'Гость зарегистрирован и находится в номере. Дату заезда и номер уже нельзя изменить.' },
  checked_out: { label: 'Выехал',       color: '#B0BEC5', text: '#fff', hint: 'Гость выехал и полностью рассчитался. Бронь закрыта.' },
  cancelled:   { label: 'Отменено',     color: '#EF5350', text: '#fff', hint: 'Бронь отменена. Номер освобождён, бронь не отображается в шахматке.' },
  no_show:     { label: 'Не явился',    color: '#8D6E63', text: '#fff', hint: 'Гость не приехал в дату заезда. Фиксируется для аналитики и начисления штрафа.' },
};

export const HK_STATUS = {
  dirty:    { label: 'Грязный',   color: '#EF5350', bg: '#FFEBEE' },
  cleaning: { label: 'Убирается', color: '#FF9800', bg: '#FFF3E0' },
  checking: { label: 'Проверка',  color: '#9C27B0', bg: '#F3E5F5' },
  clean:    { label: 'Чистый',    color: '#43A047', bg: '#E8F5E9' },
  ready:    { label: 'Готов',     color: '#1E88E5', bg: '#E3F2FD' },
};

export const BOOKING_SOURCE = {
  direct:      'Стойка',
  online:      'Онлайн',
  phone:       'Телефон',
  ota:         'ОТА',
  corporate:   'Корпоратив',
};

export const NAV_ITEMS = [
  { id: 'dashboard',    label: 'Дашборд',        icon: 'dashboard' },
  { id: 'timeline',     label: 'Шахматка',       icon: 'timeline' },
  { id: 'bookings',     label: 'Бронирования',   icon: 'bookings' },
  { id: 'rooms',        label: 'Номерной фонд',  icon: 'rooms' },
  { id: 'housekeeping', label: 'Уборка',         icon: 'housekeeping' },
  { id: 'tariffs',      label: 'Тарифы',         icon: 'tariffs' },
  { id: 'revenue',      label: 'Revenue',        icon: 'revenue' },
  { id: 'reports',      label: 'Отчёты',         icon: 'reports' },
  { id: 'settings',    label: 'Настройки',      icon: 'settings' },
];
