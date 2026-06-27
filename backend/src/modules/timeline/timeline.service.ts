import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { TenantContext } from '../../common/context/tenant-context';
import { format, parseISO } from 'date-fns';
import type {
  TimelineResponse,
  TimelineRoomType,
  TimelineRoom,
  TimelineReservation,
} from './timeline.types';

/** Redis TTL for cached timeline responses (seconds).
 *  Kept short so stale data auto-expires quickly even if WS invalidation
 *  misses. Real-time updates via WebSocket invalidate immediately anyway. */
const CACHE_TTL = 5;

// ─── Raw query row shapes ─────────────────────────────────────────────────────

interface RawRoomRow {
  room_id: string;
  room_number: string;
  floor: number;
  room_status: string;
  capacity: number;
  room_type_id: string;
  room_type_code: string;
  room_type_name: string;
  base_price: string;
  sort_order: number;
}

interface RawReservationRow {
  id: string;
  room_id: string;
  guest_name: string;
  phone: string | null;
  email: string | null;
  check_in: Date;
  check_out: Date;
  status: string;
  adults: number;
  children: number;
  notes: string | null;
  total_price: string | null;
  source: string;
  rate_plan_id: string | null;
  version: number;
  place_number: number;
}

@Injectable()
export class TimelineService {
  private readonly logger = new Logger(TimelineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // ── Cache helpers ─────────────────────────────────────────────────────────

  private cacheKey(tenantId: string, from: string, to: string): string {
    return `timeline:${tenantId}:${from}:${to}`;
  }

  /** Invalidate all timeline cache entries for this tenant. */
  async invalidate(tenantId: string): Promise<void> {
    const keys = await this.redis.raw.keys(`timeline:${tenantId}:*`);
    if (keys.length) {
      await this.redis.raw.del(...keys);
      this.logger.debug(`Timeline cache invalidated: ${keys.length} keys`);
    }
  }

  // ── Main query ────────────────────────────────────────────────────────────

  /**
   * Return the timeline data for `[from, to]` (both inclusive).
   *
   * Uses a single SQL query with two CTEs:
   *   1. `rooms_cte` — all active rooms joined with their room type.
   *   2. `res_cte`   — all reservations (any status) that overlap the window.
   *
   * Result is grouped into RoomType → Room → Reservation[] for the UI.
   * Cached in Redis for CACHE_TTL seconds.
   */
  async getTimeline(from: string, to: string): Promise<TimelineResponse> {
    const tenantId = TenantContext.getTenantIdOrThrow();
    const key = this.cacheKey(tenantId, from, to);

    // ── Cache hit ─────────────────────────────────────────────────────────
    const cached = await this.redis.raw.get(key);
    if (cached) {
      const ttl = await this.redis.raw.ttl(key);
      const data = JSON.parse(cached) as TimelineResponse;
      data.cacheTtl = ttl;
      this.logger.debug(`Timeline cache hit: ${key} (ttl=${ttl}s)`);
      return data;
    }

    // ── DB query ──────────────────────────────────────────────────────────
    const fromDate = parseISO(from);
    const toDate   = parseISO(to);

    const result = await this.prisma.forTenant(async (tx) => {
      // 1. All active rooms with their room type.
      const roomRows = await tx.$queryRaw<RawRoomRow[]>`
        WITH rooms_cte AS (
          SELECT
            r.id            AS room_id,
            r.number        AS room_number,
            r.floor,
            r.status        AS room_status,
            r.capacity,
            rt.id           AS room_type_id,
            rt.code         AS room_type_code,
            rt.name         AS room_type_name,
            rt.base_price::text AS base_price,
            rt.sort_order
          FROM room r
          JOIN room_type rt ON rt.id = r.room_type_id
          WHERE r.is_active = true
        )
        SELECT * FROM rooms_cte
        ORDER BY sort_order, floor, room_number
      `;

      // 2. All reservations that overlap the date window — every status.
      //    Cancelled / no-show / checked-out rows are returned so the UI can
      //    show them in the "Архив" / "Отменённые" views and fade completed
      //    stays in the timeline. The client decides what to hide where
      //    (cancelled & no-show are hidden from the chessboard; checked-out is
      //    rendered semi-transparent). Availability is computed client-side and
      //    already ignores cancelled / no-show, so returning them is safe.
      const resRows = await tx.$queryRaw<RawReservationRow[]>`
        SELECT
          id,
          room_id,
          guest_name,
          phone,
          email,
          check_in,
          check_out,
          status,
          adults,
          children,
          notes,
          total_price::text  AS total_price,
          source,
          rate_plan_id,
          version,
          place_number
        FROM reservation
        WHERE check_in  < ${toDate}::date + INTERVAL '1 day'
          AND check_out > ${fromDate}::date
        ORDER BY check_in
      `;

      // ── Assemble ──────────────────────────────────────────────────────────

      // Map reservations by roomId for fast lookup.
      const resByRoom = new Map<string, TimelineReservation[]>();
      for (const r of resRows) {
        if (!resByRoom.has(r.room_id)) resByRoom.set(r.room_id, []);
        resByRoom.get(r.room_id)!.push({
          id: r.id,
          roomId: r.room_id,
          guestName: r.guest_name,
          phone: r.phone,
          email: r.email,
          checkIn:  format(r.check_in,  'yyyy-MM-dd'),
          checkOut: format(r.check_out, 'yyyy-MM-dd'),
          status: r.status as TimelineReservation['status'],
          adults: r.adults,
          children: r.children,
          notes: r.notes,
          totalPrice: r.total_price,
          source: r.source as TimelineReservation['source'],
          ratePlanId: r.rate_plan_id,
          version: r.version,
          placeNumber: r.place_number,
        });
      }

      // Group rooms by room type.
      const rtMap = new Map<string, TimelineRoomType>();
      for (const row of roomRows) {
        if (!rtMap.has(row.room_type_id)) {
          rtMap.set(row.room_type_id, {
            id: row.room_type_id,
            code: row.room_type_code,
            name: row.room_type_name,
            sortOrder: row.sort_order,
            basePrice: row.base_price,
            rooms: [],
          });
        }
        const rt = rtMap.get(row.room_type_id)!;
        const room: TimelineRoom = {
          id: row.room_id,
          number: row.room_number,
          floor: row.floor,
          status: row.room_status as TimelineRoom['status'],
          capacity: row.capacity,
          reservations: resByRoom.get(row.room_id) ?? [],
        };
        rt.rooms.push(room);
      }

      return {
        from,
        to,
        roomTypes: Array.from(rtMap.values()),
        cacheTtl: 0,
      } satisfies TimelineResponse;
    });

    // ── Write to cache ─────────────────────────────────────────────────────
    await this.redis.raw.set(key, JSON.stringify(result), 'EX', CACHE_TTL);

    return result;
  }
}
