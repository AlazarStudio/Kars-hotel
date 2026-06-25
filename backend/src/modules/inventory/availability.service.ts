import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/context/tenant-context';
import { RedisService } from '../../common/redis/redis.service';
import { InventoryService } from './inventory.service';
import { BaselineResolver, isoDay } from '../pricing/rate-resolution';
import { eachDayOfInterval, parseISO, format, differenceInCalendarDays } from 'date-fns';

/** Per-day availability result. */
export interface DayAvailability {
  date: string;            // 'YYYY-MM-DD'
  available: number;       // rooms that can be booked
  totalRooms: number;
  bookedRooms: number;
  blockedRooms: number;
  stopSell: boolean;
  /** Minimum price across all active rate plans for this date (null = not configured). */
  minPrice: string | null;
  /** Aggregated restrictions for this date (union of all applicable rules). */
  restrictions: {
    closed: boolean;
    cta: boolean;         // closed to arrival
    ctd: boolean;         // closed to departure
    minLos: number | null;
    maxLos: number | null;
  };
}

export interface AvailabilityResult {
  roomTypeId: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  /** true if ALL days have available >= 1 and no blocking restrictions. */
  bookable: boolean;
  days: DayAvailability[];
}

/** Redis TTL for cached availability responses (seconds). */
const CACHE_TTL_SECONDS = 60;

@Injectable()
export class AvailabilityService {
  private readonly logger = new Logger(AvailabilityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /**
   * Check availability for a room type over a stay period.
   *
   * Concurrency strategy:
   *   - For READ queries (this method): Redis cache with 60s TTL.
   *     Stale reads are acceptable for a short window.
   *   - For WRITE operations (reserve/release): callers must use
   *     InventoryService.acquireLock() + incrementBooked() inside a
   *     serializable/repeatable-read transaction.
   *
   * @param roomTypeId  UUID of the room type to check.
   * @param checkIn     ISO date string 'YYYY-MM-DD' (first night).
   * @param checkOut    ISO date string 'YYYY-MM-DD' (departure day — NOT a night).
   * @param ratePlanId  Optional: restrict min-price lookup to a specific rate plan.
   */
  async check(
    roomTypeId: string,
    checkIn: string,
    checkOut: string,
    ratePlanId?: string,
  ): Promise<AvailabilityResult> {
    const tenantId = TenantContext.getTenantIdOrThrow();
    const cacheKey = InventoryService.cacheKey(tenantId, roomTypeId, checkIn, checkOut) +
      (ratePlanId ? `:${ratePlanId}` : '');

    // ── Cache hit ────────────────────────────────────────────────────────────
    const cached = await this.redis.raw.get(cacheKey);
    if (cached) {
      this.logger.debug(`Availability cache hit: ${cacheKey}`);
      return JSON.parse(cached) as AvailabilityResult;
    }

    // ── DB query ─────────────────────────────────────────────────────────────
    const result = await this.prisma.forTenant(async (tx) => {
      const checkInDate  = parseISO(checkIn);
      const checkOutDate = parseISO(checkOut);

      // The nights of the stay are [checkIn, checkOut).
      // checkOut is the departure date — it is NOT a night of stay.
      const stayDates = eachDayOfInterval({ start: checkInDate, end: checkOutDate })
        .slice(0, -1); // drop checkOut itself

      if (!stayDates.length) {
        return this.emptyResult(roomTypeId, checkIn, checkOut);
      }

      // 1. Inventory rows
      const inventoryRows = await tx.$queryRaw<
        Array<{
          date: Date;
          total_rooms: number;
          booked_rooms: number;
          blocked_rooms: number;
          stop_sell: boolean;
        }>
      >`
        SELECT date, total_rooms, booked_rooms, blocked_rooms, stop_sell
        FROM inventory
        WHERE tenant_id   = ${tenantId}::uuid
          AND room_type_id = ${roomTypeId}::uuid
          AND date BETWEEN ${checkInDate}::date AND ${checkOutDate}::date
      `;

      // 2. Physical room count fallback (for dates without inventory rows)
      const roomCount = await tx.room.count({
        where: { roomTypeId, isActive: true },
      });

      // 3. Restrictions for the stay dates.
      // When ratePlanId is provided we include both rate-plan-specific and
      // catch-all (rate_plan_id IS NULL) rows; otherwise only catch-all rows.
      type RestrictionRow = {
        date: Date;
        closed: boolean;
        cta: boolean;
        ctd: boolean;
        stop_sell: boolean;
        min_los: number | null;
        max_los: number | null;
        min_los_arrival: number | null;
        max_los_arrival: number | null;
        min_advance: number | null;
        max_advance: number | null;
      };

      const restrictionRows: RestrictionRow[] = ratePlanId
        ? await tx.$queryRaw<RestrictionRow[]>`
            SELECT date, closed, cta, ctd, stop_sell,
                   min_los, max_los, min_los_arrival, max_los_arrival,
                   min_advance, max_advance
            FROM restriction
            WHERE tenant_id   = ${tenantId}::uuid
              AND room_type_id = ${roomTypeId}::uuid
              AND date BETWEEN ${checkInDate}::date AND ${checkOutDate}::date
              AND (rate_plan_id IS NULL OR rate_plan_id = ${ratePlanId}::uuid)
          `
        : await tx.$queryRaw<RestrictionRow[]>`
            SELECT date, closed, cta, ctd, stop_sell,
                   min_los, max_los, min_los_arrival, max_los_arrival,
                   min_advance, max_advance
            FROM restriction
            WHERE tenant_id   = ${tenantId}::uuid
              AND room_type_id = ${roomTypeId}::uuid
              AND date BETWEEN ${checkInDate}::date AND ${checkOutDate}::date
              AND rate_plan_id IS NULL
          `;

      // 4. Effective min price per stay date.
      //
      // The price for a (ratePlan × date) resolves as:
      //   per-day Rate row  →  covering season  →  standard price.
      // We then take the cheapest across all (optionally one) rate plans.
      // When no standard/season is configured this reduces to the previous
      // behaviour (MIN over the per-day Rate rows), so the partner contract is
      // unchanged for hotels that haven't set baseline prices yet.
      type DailyRow = { rate_plan_id: string; date: Date; price: string };
      const dailyRows: DailyRow[] = ratePlanId
        ? await tx.$queryRaw<DailyRow[]>`
            SELECT rate_plan_id, date, MIN(price)::text AS price
            FROM rate
            WHERE tenant_id   = ${tenantId}::uuid
              AND room_type_id = ${roomTypeId}::uuid
              AND date BETWEEN ${checkInDate}::date AND ${checkOutDate}::date
              AND rate_plan_id = ${ratePlanId}::uuid
            GROUP BY rate_plan_id, date
          `
        : await tx.$queryRaw<DailyRow[]>`
            SELECT rate_plan_id, date, MIN(price)::text AS price
            FROM rate
            WHERE tenant_id   = ${tenantId}::uuid
              AND room_type_id = ${roomTypeId}::uuid
              AND date BETWEEN ${checkInDate}::date AND ${checkOutDate}::date
            GROUP BY rate_plan_id, date
          `;

      const [seasonRows, standardRows] = await Promise.all([
        tx.rateSeason.findMany({
          where: {
            roomTypeId,
            ratePlanId: ratePlanId || undefined,
            dateFrom: { lte: checkOutDate },
            dateTo: { gte: checkInDate },
          },
          select: { ratePlanId: true, roomTypeId: true, dateFrom: true, dateTo: true, price: true, sortOrder: true },
        }),
        tx.standardRate.findMany({
          where: { roomTypeId, ratePlanId: ratePlanId || undefined },
          select: { ratePlanId: true, roomTypeId: true, price: true },
        }),
      ]);

      const baseline = new BaselineResolver(
        seasonRows.map((s) => ({
          ratePlanId: s.ratePlanId,
          roomTypeId: s.roomTypeId,
          dateFrom: isoDay(s.dateFrom),
          dateTo: isoDay(s.dateTo),
          price: s.price as unknown as Prisma.Decimal,
          sortOrder: s.sortOrder,
        })),
        standardRows.map((s) => ({
          ratePlanId: s.ratePlanId,
          roomTypeId: s.roomTypeId,
          price: s.price as unknown as Prisma.Decimal,
        })),
      );

      // Per-(plan, day) daily override lookup + the set of candidate plans.
      const dailyByPlanDay = new Map<string, string>();
      const planIds = new Set<string>();
      for (const r of dailyRows) {
        dailyByPlanDay.set(`${r.rate_plan_id}|${format(r.date, 'yyyy-MM-dd')}`, r.price);
        planIds.add(r.rate_plan_id);
      }
      for (const s of seasonRows) planIds.add(s.ratePlanId);
      for (const s of standardRows) planIds.add(s.ratePlanId);

      const priceRows: Array<{ date: Date; min_price: string }> = [];
      for (const date of stayDates) {
        const day = format(date, 'yyyy-MM-dd');
        let min: Prisma.Decimal | null = null;
        for (const planId of planIds) {
          const daily = dailyByPlanDay.get(`${planId}|${day}`);
          const eff = daily != null
            ? new Prisma.Decimal(daily)
            : baseline.resolve(planId, roomTypeId, day);
          if (eff != null && (min === null || eff.lessThan(min))) min = eff;
        }
        if (min !== null) priceRows.push({ date, min_price: min.toFixed(2) });
      }

      // Build lookup maps
      const invByDate = new Map(
        inventoryRows.map((r) => [format(r.date, 'yyyy-MM-dd'), r]),
      );
      const resByDate = new Map(
        restrictionRows.map((r) => [format(r.date, 'yyyy-MM-dd'), r]),
      );
      const priceByDate = new Map(
        priceRows.map((r) => [format(r.date, 'yyyy-MM-dd'), r.min_price]),
      );

      const nights = stayDates.length;

      const days: DayAvailability[] = stayDates.map((date) => {
        const key = format(date, 'yyyy-MM-dd');
        const inv = invByDate.get(key);
        const res = resByDate.get(key);

        const totalRooms   = inv?.total_rooms   ?? roomCount;
        const bookedRooms  = inv?.booked_rooms  ?? 0;
        const blockedRooms = inv?.blocked_rooms ?? 0;
        const stopSell     = inv?.stop_sell     ?? false;
        const available    = InventoryService.computeAvailable({ totalRooms, bookedRooms, blockedRooms });

        // Resolve LOS restrictions: per-date rules + arrival-specific rules on checkIn.
        const isArrivalDate = key === checkIn;
        const minLos = res
          ? Math.max(
              res.min_los ?? 0,
              isArrivalDate ? (res.min_los_arrival ?? 0) : 0,
            ) || null
          : null;
        const maxLos = res
          ? (res.max_los ?? res.max_los_arrival ?? null)
          : null;

        return {
          date: key,
          available,
          totalRooms,
          bookedRooms,
          blockedRooms,
          stopSell,
          minPrice: priceByDate.get(key) ?? null,
          restrictions: {
            closed:  res?.closed  ?? false,
            cta:     isArrivalDate ? (res?.cta ?? false) : false,
            ctd:     key === format(checkOutDate, 'yyyy-MM-dd') ? (res?.ctd ?? false) : false,
            minLos,
            maxLos,
          },
        };
      });

      // bookable = every night is available AND no blocking restriction applies
      const bookable = days.every(
        (d) =>
          d.available >= 1 &&
          !d.stopSell &&
          !d.restrictions.closed &&
          !(d.restrictions.cta && d.date === checkIn) &&
          (d.restrictions.minLos === null || nights >= d.restrictions.minLos) &&
          (d.restrictions.maxLos === null || nights <= d.restrictions.maxLos),
      );

      return {
        roomTypeId,
        checkIn,
        checkOut,
        nights,
        bookable,
        days,
      } satisfies AvailabilityResult;
    });

    // ── Write to cache ───────────────────────────────────────────────────────
    await this.redis.raw.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL_SECONDS);

    return result;
  }

  /**
   * Check availability for ALL active room types for a given date range.
   * Returns one AvailabilityResult per room type.
   */
  async checkAll(
    checkIn: string,
    checkOut: string,
    ratePlanId?: string,
  ): Promise<AvailabilityResult[]> {
    const roomTypes = await this.prisma.forTenant((tx) =>
      tx.roomType.findMany({
        where: { isActive: true },
        select: { id: true },
        orderBy: { sortOrder: 'asc' },
      }),
    );

    return Promise.all(
      roomTypes.map((rt) => this.check(rt.id, checkIn, checkOut, ratePlanId)),
    );
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private emptyResult(
    roomTypeId: string,
    checkIn: string,
    checkOut: string,
  ): AvailabilityResult {
    return {
      roomTypeId,
      checkIn,
      checkOut,
      nights: 0,
      bookable: false,
      days: [],
    };
  }
}
