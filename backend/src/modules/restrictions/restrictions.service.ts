import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

export type ViolationCode =
  | 'CLOSED'
  | 'STOP_SELL'
  | 'CTA'
  | 'CTD'
  | 'MIN_LOS'
  | 'MAX_LOS'
  | 'MIN_LOS_ARRIVAL'
  | 'MAX_LOS_ARRIVAL'
  | 'MIN_ADVANCE'
  | 'MAX_ADVANCE';

export interface Violation {
  code: ViolationCode;
  date?: string;
  detail: string;
}

export interface CheckRestrictionsInput {
  ratePlanId?: string | null;
  roomTypeId: string;
  arrival: Date;
  departure: Date;
  now?: Date;
}

export interface CheckRestrictionsResult {
  allowed: boolean;
  nights: number;
  violations: Violation[];
}

@Injectable()
export class RestrictionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Validate a hypothetical reservation against per-day restrictions.
   * If any rule is violated, `allowed = false` and the human-readable
   * violations are returned.
   *
   * Plan-specific rows override plan-agnostic rows: when both a row with
   * `ratePlanId = X` and `ratePlanId = NULL` exist for the same (roomType, date),
   * the plan-specific one wins.
   */
  async check(input: CheckRestrictionsInput): Promise<CheckRestrictionsResult> {
    const arrival = startOfUTC(input.arrival);
    const departure = startOfUTC(input.departure);
    const now = startOfUTC(input.now ?? new Date());
    const nights = daysBetween(arrival, departure);

    if (nights <= 0) {
      return { allowed: true, nights: 0, violations: [] };
    }

    const violations: Violation[] = [];

    // Verify the room type belongs to this tenant (404 otherwise via RLS).
    return this.prisma.forTenant(async (tx) => {
      const rt = await tx.roomType.findUnique({
        where: { id: input.roomTypeId },
        select: { id: true },
      });
      if (!rt) throw new NotFoundException('Категория номера не найдена');

      // Fetch all restriction rows in [arrival, departure-1] for plan-or-null.
      const lastNight = new Date(departure);
      lastNight.setUTCDate(lastNight.getUTCDate() - 1);

      const planFilter = input.ratePlanId
        ? { OR: [{ ratePlanId: null }, { ratePlanId: input.ratePlanId }] }
        : { ratePlanId: null };
      const rows = await tx.restriction.findMany({
        where: {
          roomTypeId: input.roomTypeId,
          date: { gte: arrival, lte: lastNight },
          ...planFilter,
        },
      });

      // Pick the best row per date (prefer plan-specific over null-plan).
      type Row = (typeof rows)[number];
      const byDate = new Map<string, Row>();
      for (const r of rows) {
        const key = toISO(r.date);
        const existing = byDate.get(key);
        if (!existing) {
          byDate.set(key, r);
        } else if (r.ratePlanId && !existing.ratePlanId) {
          byDate.set(key, r);
        }
      }

      // ── Per-night checks ────────────────────────────────────────────────
      for (let i = 0; i < nights; i++) {
        const d = addDays(arrival, i);
        const r = byDate.get(toISO(d));
        if (!r) continue;

        if (r.closed) violations.push({ code: 'CLOSED', date: toISO(d), detail: `Дата ${toISO(d)} закрыта для бронирования` });
        if (r.stopSell) violations.push({ code: 'STOP_SELL', date: toISO(d), detail: `Продажи на ${toISO(d)} остановлены` });

        // MinLOS / MaxLOS apply when the booking *touches* this date.
        if (r.minLos != null && nights < r.minLos) {
          violations.push({
            code: 'MIN_LOS',
            date: toISO(d),
            detail: `Минимум проживания на ${toISO(d)}: ${r.minLos} ночей (запрошено ${nights})`,
          });
        }
        if (r.maxLos != null && nights > r.maxLos) {
          violations.push({
            code: 'MAX_LOS',
            date: toISO(d),
            detail: `Максимум проживания на ${toISO(d)}: ${r.maxLos} ночей (запрошено ${nights})`,
          });
        }
      }

      // ── Arrival-only checks ─────────────────────────────────────────────
      const arrivalRow = byDate.get(toISO(arrival));
      if (arrivalRow) {
        if (arrivalRow.cta) {
          violations.push({ code: 'CTA', date: toISO(arrival), detail: `Заезд на ${toISO(arrival)} закрыт (CTA)` });
        }
        if (arrivalRow.minLosArrival != null && nights < arrivalRow.minLosArrival) {
          violations.push({
            code: 'MIN_LOS_ARRIVAL',
            date: toISO(arrival),
            detail: `Минимум при заезде ${toISO(arrival)}: ${arrivalRow.minLosArrival} ночей`,
          });
        }
        if (arrivalRow.maxLosArrival != null && nights > arrivalRow.maxLosArrival) {
          violations.push({
            code: 'MAX_LOS_ARRIVAL',
            date: toISO(arrival),
            detail: `Максимум при заезде ${toISO(arrival)}: ${arrivalRow.maxLosArrival} ночей`,
          });
        }

        // Advance booking window — measured from `now` to `arrival`.
        const advanceDays = daysBetween(now, arrival);
        if (arrivalRow.minAdvance != null && advanceDays < arrivalRow.minAdvance) {
          violations.push({
            code: 'MIN_ADVANCE',
            detail: `До заезда ${arrivalRow.minAdvance} дней (осталось ${advanceDays})`,
          });
        }
        if (arrivalRow.maxAdvance != null && advanceDays > arrivalRow.maxAdvance) {
          violations.push({
            code: 'MAX_ADVANCE',
            detail: `Можно бронировать максимум за ${arrivalRow.maxAdvance} дней до заезда`,
          });
        }
      }

      // ── Departure-only check (CTD) ──────────────────────────────────────
      // The "departure date" itself is the morning of checkout, not a night the guest stays.
      // We need to query the row for that date separately (it's outside our [arrival, departure-1] window).
      const departureRow = await tx.restriction.findFirst({
        where: {
          roomTypeId: input.roomTypeId,
          date: departure,
          ...planFilter,
        },
        orderBy: { ratePlanId: 'desc' }, // prefer not-null
      });
      if (departureRow?.ctd) {
        violations.push({
          code: 'CTD',
          date: toISO(departure),
          detail: `Выезд на ${toISO(departure)} закрыт (CTD)`,
        });
      }

      return {
        allowed: violations.length === 0,
        nights,
        violations,
      };
    });
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function startOfUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDays(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}
