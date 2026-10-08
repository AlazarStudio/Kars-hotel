import { Prisma, PrismaClient } from '@prisma/client';

/* ПРАВИЛА СРОКОВ ХРАНЕНИЯ ПДн В PMS (152-ФЗ, Р-11, решение владельца 21; план 13.9).
 *
 * По образцу Авиа: каждое правило — один отбор «созревшего» и одно действие;
 * повторный прогон безопасен (отбор «ещё не обезличено»), правило идёт в своей
 * транзакции под pg_try_advisory_xact_lock — второй экземпляр его пропустит.
 * Журнал — в журнал гостиницы, числами, без ФИО.
 *
 * Сроки (решение 21): отмена и неявка без начислений — 30 дн. от заезда;
 * телефон и почта гостя — 92 дн. (3 мес.) от выезда; ФИО в счёте — 5 лет;
 * журнал — не дольше записи (следы брони стираются вместе с ней; записи
 * удалённых гостиниц — 30 дн.); истёкшие сессии — сразу; уволенный
 * сотрудник — 30 дн. после выключения. Гостиница вправе СОКРАТИТЬ первые два
 * (tenant.retention_*_days); удлинить — нет: LEAST с системным сроком. */

export type RetentionMode = 'off' | 'dry' | 'on';

export function retentionMode(env: NodeJS.ProcessEnv = process.env): RetentionMode {
  const v = (env.PMS_RETENTION_MODE ?? '').trim().toLowerCase();
  return v === 'dry' || v === 'on' ? v : 'off';
}

export const ANONYMIZED_GUEST = 'Гость (обезличен)';
export const ANONYMIZED_STAFF = 'Сотрудник (обезличен)';
export const CANCELLED_DAYS = 30;
export const CONTACTS_DAYS = 92;
export const FOLIO_NAME_DAYS = 1826;
export const ORPHAN_JOURNAL_DAYS = 30;
export const STAFF_DAYS = 30;
const GUEST_PD_KEYS = ['guestName', 'phone', 'email', 'notes'];
const CONTACT_KEYS = ['phone', 'email'];
const LOCK_NS = 152_013;

type Tx = Prisma.TransactionClient;
interface Rule {
  id: string;
  /** Созревшее: { tenantId, count } по гостиницам. */
  count(tx: Tx): Promise<Array<{ tenant_id: string | null; n: bigint }>>;
  /** Действие; возвращает затронутое по гостиницам. */
  apply(tx: Tx): Promise<Array<{ tenant_id: string | null; n: bigint }>>;
}

/** Стереть поля гостя из «до/после» журнала о бронях. */
async function scrubJournal(tx: Tx, ids: string[], keys: string[]) {
  if (!ids.length) return;
  await tx.$executeRaw`
    UPDATE audit_log
       SET diff = jsonb_set(
             jsonb_set(diff, '{before}', COALESCE(diff->'before', '{}'::jsonb) - ${keys}::text[]),
             '{after}', COALESCE(diff->'after', '{}'::jsonb) - ${keys}::text[])
     WHERE entity = 'reservation' AND entity_id = ANY(${ids}::text[])
       AND diff IS NOT NULL AND jsonb_typeof(diff) = 'object'`;
}

const byTenant = (rows: Array<{ id: string; tenant_id: string }>) => {
  const m = new Map<string, bigint>();
  for (const r of rows) m.set(r.tenant_id, (m.get(r.tenant_id) ?? 0n) + 1n);
  return [...m].map(([tenant_id, n]) => ({ tenant_id, n }));
};

/* Отбор созревших броней — общий для «посчитать» и «сделать». */
const cancelledRipe = Prisma.sql`
  SELECT r.id, r.tenant_id FROM reservation r JOIN tenant t ON t.id = r.tenant_id
   WHERE r.status IN ('CANCELLED', 'NO_SHOW') AND r.guest_name <> ${ANONYMIZED_GUEST}
     AND r.check_in < now() - make_interval(days => (LEAST(${CANCELLED_DAYS}, COALESCE(t.retention_cancelled_days, ${CANCELLED_DAYS})))::int)
     AND NOT EXISTS (SELECT 1 FROM folio f JOIN folio_charge c ON c.folio_id = f.id WHERE f.reservation_id = r.id)`;

const contactsRipe = Prisma.sql`
  SELECT r.id, r.tenant_id FROM reservation r JOIN tenant t ON t.id = r.tenant_id
   WHERE r.status IN ('CHECKED_OUT', 'CANCELLED', 'NO_SHOW') AND (r.phone IS NOT NULL OR r.email IS NOT NULL)
     AND r.check_out < now() - make_interval(days => (LEAST(${CONTACTS_DAYS}, COALESCE(t.retention_contacts_days, ${CONTACTS_DAYS})))::int)`;

const folioNameRipe = Prisma.sql`
  SELECT r.id, r.tenant_id FROM reservation r
   WHERE r.status IN ('CHECKED_OUT', 'CANCELLED', 'NO_SHOW') AND r.guest_name <> ${ANONYMIZED_GUEST}
     AND r.check_out < now() - make_interval(days => (${FOLIO_NAME_DAYS})::int)`;

async function anonymizeGuests(tx: Tx, ripe: Prisma.Sql) {
  const rows = await tx.$queryRaw<Array<{ id: string; tenant_id: string }>>`
    UPDATE reservation SET guest_name = ${ANONYMIZED_GUEST}, phone = NULL, email = NULL, notes = NULL
      FROM (${ripe}) ripe WHERE reservation.id = ripe.id
    RETURNING reservation.id, reservation.tenant_id`;
  const ids = rows.map((r) => r.id);
  if (ids.length) {
    await tx.$executeRaw`UPDATE payment p SET note = NULL FROM folio f WHERE p.folio_id = f.id AND f.reservation_id = ANY(${ids}::uuid[])`;
  }
  await scrubJournal(tx, ids, GUEST_PD_KEYS);
  return byTenant(rows);
}

const countRipe = (tx: Tx, ripe: Prisma.Sql) =>
  tx.$queryRaw<Array<{ tenant_id: string; n: bigint }>>`SELECT tenant_id, count(*)::bigint AS n FROM (${ripe}) x GROUP BY tenant_id`;

export const RULES: Rule[] = [
  {
    id: 'cancelled-noshow',
    count: (tx) => countRipe(tx, cancelledRipe),
    apply: (tx) => anonymizeGuests(tx, cancelledRipe),
  },
  {
    id: 'guest-contacts',
    count: (tx) => countRipe(tx, contactsRipe),
    apply: async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; tenant_id: string }>>`
        UPDATE reservation SET phone = NULL, email = NULL
          FROM (${contactsRipe}) ripe WHERE reservation.id = ripe.id
        RETURNING reservation.id, reservation.tenant_id`;
      await scrubJournal(tx, rows.map((r) => r.id), CONTACT_KEYS);
      return byTenant(rows);
    },
  },
  {
    id: 'folio-names',
    count: (tx) => countRipe(tx, folioNameRipe),
    apply: (tx) => anonymizeGuests(tx, folioNameRipe),
  },
  {
    /* Журнал удалённых гостиниц: гостиницы нет — и хранить записи с ФИО её
       гостей не для кого (171 запись, 75 с ФИО на 03.10.2026). */
    id: 'orphan-journal',
    count: (tx) =>
      tx.$queryRaw`SELECT NULL::uuid AS tenant_id, count(*)::bigint AS n FROM audit_log
                    WHERE tenant_id IS NULL AND "createdAt" < now() - make_interval(days => (${ORPHAN_JOURNAL_DAYS})::int)`,
    apply: async (tx) => {
      const n = await tx.$executeRaw`DELETE FROM audit_log
                    WHERE tenant_id IS NULL AND "createdAt" < now() - make_interval(days => (${ORPHAN_JOURNAL_DAYS})::int)`;
      return [{ tenant_id: null, n: BigInt(n) }];
    },
  },
  {
    id: 'sessions',
    count: (tx) =>
      tx.$queryRaw`SELECT tenant_id, count(*)::bigint AS n FROM refresh_token
                    WHERE expires_at < now() OR revoked_at < now() - interval '1 day' GROUP BY tenant_id`,
    apply: (tx) =>
      tx.$queryRaw`WITH d AS (DELETE FROM refresh_token WHERE expires_at < now() OR revoked_at < now() - interval '1 day' RETURNING tenant_id)
                   SELECT tenant_id, count(*)::bigint AS n FROM d GROUP BY tenant_id`,
  },
  {
    /* Уволенный сотрудник: ФИО и почта — заглушки (почта уникальна, поэтому
       своя на каждого). Учётка выключена, войти ею нельзя. */
    id: 'dismissed-staff',
    count: (tx) =>
      tx.$queryRaw`SELECT tenant_id, count(*)::bigint AS n FROM app_user
                    WHERE NOT "isActive" AND full_name <> ${ANONYMIZED_STAFF}
                      AND deactivated_at < now() - make_interval(days => (${STAFF_DAYS})::int) GROUP BY tenant_id`,
    apply: (tx) =>
      tx.$queryRaw`WITH u AS (
                     UPDATE app_user SET full_name = ${ANONYMIZED_STAFF}, email = 'removed-' || id || '@invalid.local'
                      WHERE NOT "isActive" AND full_name <> ${ANONYMIZED_STAFF}
                        AND deactivated_at < now() - make_interval(days => (${STAFF_DAYS})::int)
                     RETURNING tenant_id)
                   SELECT tenant_id, count(*)::bigint AS n FROM u GROUP BY tenant_id`,
  },
];

export interface RuleResult {
  rule: string;
  skipped?: 'locked';
  byTenant: Array<{ tenantId: string | null; count: number }>;
}

/** Один прогон всех правил. В режиме dry — только подсчёт. */
export async function runRetention(db: PrismaClient, mode: Exclude<RetentionMode, 'off'>): Promise<RuleResult[]> {
  const out: RuleResult[] = [];
  for (const rule of RULES) {
    const res = await db.$transaction(async (tx) => {
      const [{ locked }] = await tx.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_xact_lock(${LOCK_NS}::int, hashtext(${rule.id})) AS locked`;
      if (!locked) return { rule: rule.id, skipped: 'locked' as const, byTenant: [] };
      const rows = mode === 'on' ? await rule.apply(tx) : await rule.count(tx);
      const byTenantRows = rows.filter((r) => Number(r.n) > 0).map((r) => ({ tenantId: r.tenant_id, count: Number(r.n) }));
      for (const r of byTenantRows) {
        if (!r.tenantId) continue;
        await tx.auditLog.create({
          data: {
            tenantId: r.tenantId,
            entity: 'retention',
            action: `${mode === 'on' ? 'retention.destroy' : 'retention.dry'}.${rule.id}`,
            diff: { before: {}, after: { count: r.count } },
          },
        });
      }
      return { rule: rule.id, byTenant: byTenantRows };
    }, { timeout: 120_000 });
    out.push(res);
  }
  return out;
}
