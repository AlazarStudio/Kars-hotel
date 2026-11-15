import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { isUUID } from 'class-validator';
import { TenantContext } from '../../common/context/tenant-context';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AvailabilityService } from '../inventory/availability.service';
import { mealCostOf, mealTermsOf, type Meal, type MealTermsInput } from '../rate-plans/meal-terms';
import { AviaReportsService, SquadronRow } from './avia-reports.service';
import { MAX_KOPECKS, SquadronSubmitDto } from './squadron-report.dto';

const DAY_MS = 86400000;
const MAX_ROWS = 5000;
const MATCH_BATCH = 500;

const reservationSelect = {
  id: true, checkIn: true, checkOut: true, checkedInAt: true, checkedOutAt: true, adults: true, children: true, status: true,
  totalPrice: true, ratePlanId: true, roomTypeId: true,
  room: { select: { number: true } },
  mealDays: { select: { date: true, breakfast: true, lunch: true, dinner: true }, orderBy: { date: 'asc' as const } },
} satisfies Prisma.ReservationSelect;
type Reservation = Prisma.ReservationGetPayload<{ select: typeof reservationSelect }>;
type MealDay = Reservation['mealDays'][number];
type PreviewRow = Omit<SquadronRow, 'accommodationKopecks' | 'mealKopecks'> & {
  accommodationKopecks: number | null;
  mealKopecks: number | null;
  requestNumber: string;
  factToken: string;
};

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function day(value: unknown): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) {
    throw new BadRequestException('Укажите корректные даты периода');
  }
  const result = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(result.getTime()) || result.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException('Укажите корректные даты периода');
  }
  return result;
}

function iso(value: Date): string { return value.toISOString().slice(0, 10); }

function hotelDay(value: Date, timezone: string): Date {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
    const part = (name: string) => parts.find((p) => p.type === name)?.value;
    return day(`${part('year')}-${part('month')}-${part('day')}`);
  } catch {
    throw new ServiceUnavailableException('Не удалось определить дату в часовом поясе гостиницы');
  }
}

/** Decimal рублей -> целые копейки; не округляем недопустимые или большие значения. */
function money(value: unknown): number | null {
  if (value == null) return null;
  try {
    const v = new Prisma.Decimal(String(value)).mul(100);
    if (!v.isFinite() || !v.isInteger() || v.isNegative() || v.greaterThan(MAX_KOPECKS)) return null;
    return v.toNumber();
  } catch { return null; }
}

function sumMoney(values: (number | null)[]): number | null {
  if (values.some((v) => v === null)) return null;
  const result = values.reduce<number>((total, value) => total + (value ?? 0), 0);
  return Number.isSafeInteger(result) && result <= MAX_KOPECKS ? result : null;
}

function totals(rows: PreviewRow[]): number | null {
  if (rows.some((r) => r.accommodationKopecks === null || r.mealKopecks === null)) return null;
  const result = rows.reduce((sum, r) => sum + r.accommodationKopecks! + r.mealKopecks!, 0);
  return Number.isSafeInteger(result) ? result : null;
}

function mealPrice(plan: MealTermsInput | null, meals: MealDay[]): number | null {
  if (!meals.length) return 0;
  if (!plan) return null;
  const counts = {
    breakfast: meals.reduce((n, m) => n + m.breakfast, 0),
    lunch: meals.reduce((n, m) => n + m.lunch, 0),
    dinner: meals.reduce((n, m) => n + m.dinner, 0),
  };
  const terms = mealTermsOf(plan);
  const ordered = (['breakfast', 'lunch', 'dinner'] as Meal[]).filter((m) => counts[m] > 0);
  if (ordered.some((m) => !terms.meals.includes(m))) return null;
  if (terms.included) return 0;
  if (terms.perDay === null && ordered.some((m) => money(terms.perMeal?.[m]) === null)) return null;
  const guestDays = meals.reduce((sum, m) => sum + Math.max(m.breakfast, m.lunch, m.dinner), 0);
  return money(mealCostOf(plan, counts, guestDays));
}

@Injectable()
export class SquadronReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly avia: AviaReportsService,
    private readonly availability: AvailabilityService,
  ) {}

  list(tenantId: string) { return this.avia.squadronList(tenantId); }
  detail(tenantId: string, id: string) { return this.avia.squadronDetail(tenantId, id); }

  async preview(tenantId: string, startDate: string, endDate: string) {
    const start = day(startDate);
    const end = day(endDate);
    if (start > end) throw new BadRequestException('Начало периода позже окончания');
    const partnerId = await this.avia.squadronPartnerId(tenantId);
    const { tenant, reservations } = await this.prisma.forTenantExplicit(tenantId, async (tx) => {
      const [tenant, reservations] = await Promise.all([
        tx.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } }),
        tx.reservation.findMany({
          where: {
            tenantId, partnerId, channelManaged: true, status: { in: ['CHECKED_IN', 'CHECKED_OUT'] },
            AND: [
              { OR: [{ checkIn: { lte: end } }, { checkedInAt: { lt: new Date(end.getTime() + 2 * DAY_MS) } }] },
              { OR: [{ checkOut: { gte: start } }, { checkedOutAt: { gte: new Date(start.getTime() - DAY_MS) } }] },
            ],
          },
          select: reservationSelect,
          orderBy: { id: 'asc' },
        }),
      ]);
      return { tenant, reservations };
    });
    if (!tenant) throw new NotFoundException('Гостиница не найдена');
    const today = hotelDay(new Date(), tenant.timezone);
    const matches = new Map<string, string>();
    for (let i = 0; i < reservations.length; i += MATCH_BATCH) {
      const ids = reservations.slice(i, i + MATCH_BATCH).map((r) => r.id);
      const allowed = new Set(ids);
      const batch = await this.avia.squadronMatch(tenantId, ids);
      if (!Array.isArray(batch)) throw new BadRequestException('Kars Avia вернула некорректные связи бронирований');
      for (const entry of batch) {
        if (entry && allowed.has(entry.reservationId) && typeof entry.requestNumber === 'string' && entry.requestNumber) {
          matches.set(entry.reservationId, entry.requestNumber);
        }
      }
    }
    const linked = reservations.filter((r) => matches.has(r.id));
    const data = linked.length ? await this.prisma.forTenantExplicit(tenantId, async (tx) => {
      const [folios, categories, plans] = await Promise.all([
        tx.folio.findMany({
          where: { tenantId, reservationId: { in: linked.map((r) => r.id) } },
          select: { reservationId: true, charges: { where: { tenantId, type: 'MEAL' }, select: { total: true } } },
        }),
        tx.roomType.findMany({
          where: { tenantId, id: { in: [...new Set(linked.map((r) => r.roomTypeId))] } },
          select: { id: true, basePrice: true },
        }),
        tx.ratePlan.findMany({
          where: { tenantId, id: { in: [...new Set(linked.flatMap((r) => r.ratePlanId ? [r.ratePlanId] : []))] } },
          select: { id: true, mealPlan: true, mealIncluded: true, mealPriceBreakfast: true,
            mealPriceLunch: true, mealPriceDinner: true, mealPricePerDay: true, allInclusiveNote: true },
        }),
      ]);
      return { folios, categories, plans };
    }) : { folios: [], categories: [], plans: [] };
    const { folios, categories, plans } = data;
    const charges = new Map(folios.map((f) => [f.reservationId, f.charges.map((c) => String(c.total)).sort()]));
    const basePrices = new Map(categories.map((category) => [category.id, category.basePrice]));
    const mealPlans = new Map(plans.map((plan) => [plan.id, plan]));
    const rows: PreviewRow[] = [];
    for (const r of linked) {
      const row = await this.row(tenantId, r, start, end, tenant.timezone, today, matches.get(r.id)!,
        charges.get(r.id) ?? [], basePrices.get(r.roomTypeId) ?? null, r.ratePlanId ? mealPlans.get(r.ratePlanId) ?? null : null);
      if (row) rows.push(row);
      if (rows.length > MAX_ROWS) throw new BadRequestException('В отчёте не может быть больше 5000 строк. Выберите меньший период');
    }
    rows.sort((a, b) => a.stayStart.localeCompare(b.stayStart) || a.roomNumber.localeCompare(b.roomNumber, 'ru') || a.reservationId.localeCompare(b.reservationId));
    return { startDate, endDate, rows, totalKopecks: totals(rows), previewToken: hash({ tenantId, startDate, endDate, rows }) };
  }

  private async row(tenantId: string, r: Reservation, start: Date, end: Date, timezone: string, today: Date,
    requestNumber: string, charges: string[], basePrice: Prisma.Decimal | null, plan: MealTermsInput | null): Promise<PreviewRow | null> {
    const bookedIn = r.checkIn.getTime();
    const bookedOut = r.checkOut.getTime();
    const checkIn = (r.checkedInAt ? hotelDay(r.checkedInAt, timezone) : r.checkIn).getTime();
    const checkOut = r.status === 'CHECKED_IN'
      ? Math.min(bookedOut, today.getTime())
      : (r.checkedOutAt ? hotelDay(r.checkedOutAt, timezone) : r.checkOut).getTime();
    if (checkOut < checkIn) return null;
    const from = Math.max(checkIn, start.getTime());
    const until = Math.min(checkOut, end.getTime() + DAY_MS);
    const nights = Math.max(0, (until - from) / DAY_MS);
    const allMeals = r.mealDays.filter((m) => m.date.getTime() >= checkIn && m.date.getTime() <= checkOut && (m.breakfast || m.lunch || m.dinner));
    const meals = allMeals.filter((m) => m.date >= start && m.date <= end);
    const breakfastCount = meals.reduce((n, m) => n + m.breakfast, 0);
    const lunchCount = meals.reduce((n, m) => n + m.lunch, 0);
    const dinnerCount = meals.reduce((n, m) => n + m.dinner, 0);
    const fullNights = from === checkIn && until === checkOut;
    // A charge has no service date: without an ordered meal day it can only be
    // attributed when the entire stay including checkout is in the period.
    const fullMeals = allMeals.every((m) => m.date >= start && m.date <= end)
      && (allMeals.length > 0 || !charges.length || (start.getTime() <= checkIn && end.getTime() >= checkOut));
    const mealKopecks = charges.length
      ? (r.status === 'CHECKED_OUT' && fullNights && fullMeals ? sumMoney(charges.map(money)) : null)
      : mealPrice(plan, meals);
    if (!nights && !meals.length && !(fullNights && fullMeals && charges.length)) return null;

    let accommodationKopecks: number | null = nights ? null : 0;
    let breakdown: { date: string; price: string | null }[] | null = null;
    const saved = money(r.totalPrice);
    const wholeBookedStay = checkIn === bookedIn && checkOut === bookedOut;
    const coveredByBookedStay = from >= bookedIn && until <= bookedOut;
    if (nights && fullNights && wholeBookedStay && r.totalPrice !== null) {
      accommodationKopecks = saved;
    } else if (nights && coveredByBookedStay && r.ratePlanId) {
      const priceFrom = saved === null && r.totalPrice === null ? iso(new Date(from)) : iso(r.checkIn);
      const priceUntil = saved === null && r.totalPrice === null ? iso(new Date(until)) : iso(r.checkOut);
      const existing = TenantContext.get();
      const context = existing ? { ...existing, tenantId } : { tenantId, userId: '', roleCode: '', permissions: [] };
      const plans = await TenantContext.run(context, () => this.availability.priceByPlan(
        r.roomTypeId, priceFrom, priceUntil, basePrice, r.adults + r.children,
      ));
      const plan = plans.find((p) => p.ratePlanId === r.ratePlanId);
      breakdown = plan?.perNight.map((p) => ({ date: p.date, price: p.price })) ?? null;
      const count = (day(priceUntil).getTime() - day(priceFrom).getTime()) / DAY_MS;
      const valid = breakdown?.length === count && breakdown.every((p, i) =>
        p.date === iso(new Date(day(priceFrom).getTime() + i * DAY_MS)) && money(p.price) !== null,
      );
      const fullPrice = valid ? sumMoney(breakdown!.map((p) => money(p.price))) : null;
      if (valid && (r.totalPrice === null || (saved !== null && fullPrice === saved))) {
        accommodationKopecks = sumMoney(breakdown!.filter((p) => {
          const d = day(p.date).getTime();
          return d >= from && d < until;
        }).map((p) => money(p.price)));
      }
    }
    const serviceDays = [...meals.map((m) => iso(m.date))];
    if (nights) serviceDays.push(iso(new Date(from)), iso(new Date(until - DAY_MS)));
    if (!serviceDays.length) serviceDays.push(iso(new Date(checkIn)));
    serviceDays.sort();
    const factToken = hash({ id: r.id, requestNumber, checkIn: iso(r.checkIn), checkOut: iso(r.checkOut),
      actualIn: iso(new Date(checkIn)), actualOut: iso(new Date(checkOut)), status: r.status,
      room: r.room.number, roomTypeId: r.roomTypeId, ratePlanId: r.ratePlanId, guests: r.adults + r.children,
      totalPrice: r.totalPrice === null ? null : String(r.totalPrice),
      meals: r.mealDays.map((m) => [iso(m.date), m.breakfast, m.lunch, m.dinner]), charges, plan, breakdown });
    return { reservationId: r.id, roomNumber: r.room.number, guestCount: r.adults + r.children,
      stayStart: serviceDays[0], stayEnd: serviceDays[serviceDays.length - 1], nights,
      accommodationKopecks, mealKopecks, breakfastCount, lunchCount, dinnerCount, requestNumber, factToken };
  }

  async submit(tenantId: string, dto: SquadronSubmitDto) {
    if (!dto || !Number.isSafeInteger(dto.version) || dto.version < 0 || dto.version > 2147483646 ||
        typeof dto.submissionId !== 'string' || !isUUID(dto.submissionId, 'all') ||
        typeof dto.previewToken !== 'string' || !/^[a-f0-9]{64}$/.test(dto.previewToken) ||
        !Array.isArray(dto.corrections) || dto.corrections.length > MAX_ROWS) {
      throw new BadRequestException('Некорректные данные отчёта');
    }
    const preview = await this.preview(tenantId, dto.startDate, dto.endDate);
    if (dto.previewToken !== preview.previewToken) {
      throw new ConflictException('Данные бронирований изменились. Обновите предварительный расчёт');
    }
    if (!preview.rows.length) throw new BadRequestException('В отчёте нет записей');
    const corrections = new Map<string, { accommodationKopecks?: number; mealKopecks?: number }>();
    const ids = new Set(preview.rows.map((r) => r.reservationId));
    for (const item of dto.corrections) {
      if (!item || !ids.has(item.reservationId) || corrections.has(item.reservationId)) throw new BadRequestException('Некорректные исправления отчёта');
      for (const value of [item.accommodationKopecks, item.mealKopecks]) {
        if (value !== undefined && (!Number.isSafeInteger(value) || value < 0 || value > MAX_KOPECKS)) {
          throw new BadRequestException('Сумма должна быть неотрицательной и указана в копейках');
        }
      }
      corrections.set(item.reservationId, item);
    }
    let total = 0;
    const rows: SquadronRow[] = preview.rows.map((r) => {
      const correction = corrections.get(r.reservationId);
      const accommodationKopecks = correction?.accommodationKopecks ?? r.accommodationKopecks;
      const mealKopecks = correction?.mealKopecks ?? r.mealKopecks;
      if (accommodationKopecks === null || mealKopecks === null) throw new BadRequestException('Заполните все суммы отчёта');
      if (!r.nights && (accommodationKopecks !== 0 || !(mealKopecks || r.breakfastCount || r.lunchCount || r.dinnerCount))) {
        throw new BadRequestException('В день без ночёвки проживание должно быть равно нулю');
      }
      total += accommodationKopecks + mealKopecks;
      if (!Number.isSafeInteger(total)) throw new BadRequestException('Общая сумма отчёта слишком велика');
      return { reservationId: r.reservationId, roomNumber: r.roomNumber, guestCount: r.guestCount,
        stayStart: r.stayStart, stayEnd: r.stayEnd, nights: r.nights, accommodationKopecks, mealKopecks,
        breakfastCount: r.breakfastCount, lunchCount: r.lunchCount, dinnerCount: r.dinnerCount };
    });
    return this.avia.squadronSubmit(tenantId, { startDate: dto.startDate, endDate: dto.endDate,
      version: dto.version, submissionId: dto.submissionId, rows });
  }
}
