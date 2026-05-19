/**
 * System-wide permission catalogue. Seeded once on app startup.
 *
 * Naming pattern: `<resource>.<action>` or `<resource>.<scope>.<action>`.
 * Future modules will add their own permissions. Each Role grants a subset
 * via the RolePermission join table.
 */
export const SYSTEM_PERMISSIONS: ReadonlyArray<{ code: string; name: string }> = [
  // ── User management ─────────────────────────────────────────────────────────
  { code: 'user.read', name: 'View users' },
  { code: 'user.create', name: 'Create users' },
  { code: 'user.update', name: 'Update users' },
  { code: 'user.delete', name: 'Delete users' },
  { code: 'role.read', name: 'View roles' },
  { code: 'role.update', name: 'Update roles' },

  // ── Reservations (will be wired in phase G) ─────────────────────────────────
  { code: 'reservation.read', name: 'View reservations' },
  { code: 'reservation.create', name: 'Create reservations' },
  { code: 'reservation.update', name: 'Update reservations' },
  { code: 'reservation.cancel', name: 'Cancel reservations' },
  { code: 'reservation.checkin', name: 'Check guests in' },
  { code: 'reservation.checkout', name: 'Check guests out' },

  // ── Room inventory (phase D) ────────────────────────────────────────────────
  { code: 'room.read', name: 'View rooms' },
  { code: 'room.update', name: 'Update rooms' },
  { code: 'room_type.update', name: 'Manage room types' },

  // ── Pricing & rates (phase E) ───────────────────────────────────────────────
  { code: 'rate.read', name: 'View rates' },
  { code: 'rate.update', name: 'Update rates' },
  { code: 'restriction.update', name: 'Update restrictions' },

  // ── Guests (phase H) ────────────────────────────────────────────────────────
  { code: 'guest.read', name: 'View guests' },
  { code: 'guest.update', name: 'Update guest profiles' },

  // ── Finance (phase I) ───────────────────────────────────────────────────────
  { code: 'folio.read', name: 'View folios' },
  { code: 'folio.update', name: 'Update folios' },
  { code: 'payment.create', name: 'Process payments' },
  { code: 'payment.refund', name: 'Process refunds' },
  { code: 'cashregister.open', name: 'Open / close cashier shifts' },

  // ── Housekeeping (phase K) ──────────────────────────────────────────────────
  { code: 'hk.task.read', name: 'View housekeeping tasks' },
  { code: 'hk.task.update', name: 'Update housekeeping tasks' },

  // ── Reports (phase M) ───────────────────────────────────────────────────────
  { code: 'report.view.operations', name: 'View operational reports' },
  { code: 'report.view.finance', name: 'View financial reports' },
  { code: 'report.export', name: 'Export reports to XLSX/PDF' },

  // ── Settings ────────────────────────────────────────────────────────────────
  { code: 'settings.property.update', name: 'Update hotel/property settings' },
  { code: 'settings.notifications.update', name: 'Update notification templates' },
];

/** Permissions granted to each default role. */
export const DEFAULT_ROLE_PERMISSIONS: Record<string, ReadonlyArray<string>> = {
  OWNER: SYSTEM_PERMISSIONS.map((p) => p.code), // everything
  MANAGER: SYSTEM_PERMISSIONS.filter((p) => !p.code.startsWith('user.delete')).map((p) => p.code),
  FRONT_DESK: [
    'user.read',
    'reservation.read',
    'reservation.create',
    'reservation.update',
    'reservation.checkin',
    'reservation.checkout',
    'room.read',
    'rate.read',
    'guest.read',
    'guest.update',
    'folio.read',
    'folio.update',
    'payment.create',
    'cashregister.open',
    'hk.task.read',
    'report.view.operations',
  ],
  HOUSEKEEPING: ['user.read', 'room.read', 'hk.task.read', 'hk.task.update'],
  ACCOUNTANT: [
    'user.read',
    'reservation.read',
    'folio.read',
    'payment.create',
    'payment.refund',
    'cashregister.open',
    'report.view.operations',
    'report.view.finance',
    'report.export',
  ],
  CHANNEL_MANAGER: ['user.read', 'reservation.read', 'rate.read', 'rate.update', 'restriction.update'],
  READ_ONLY: SYSTEM_PERMISSIONS.filter((p) => /\.(read|view)/.test(p.code)).map((p) => p.code),
};

/** Display names shown in admin UI. */
export const DEFAULT_ROLE_NAMES: Record<string, string> = {
  OWNER: 'Владелец',
  MANAGER: 'Управляющий',
  FRONT_DESK: 'Служба приёма',
  HOUSEKEEPING: 'Горничная',
  ACCOUNTANT: 'Бухгалтер',
  CHANNEL_MANAGER: 'Менеджер каналов',
  READ_ONLY: 'Только просмотр',
};
