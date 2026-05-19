import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/context/tenant-context';
import { RedisService } from '../../common/redis/redis.service';
import { eachDayOfInterval, parseISO, format } from 'date-fns';

export interface InventoryRow {
  id: string;
  tenantId: string;
  roomTypeId: string;
  date: Date;
  totalRooms: number;
  bookedRooms: number;
  blockedRooms: number;
  stopSell: boolean;
  available: number;
}

export interface BulkUpdateRow {
  date: string; // ISO date string 'YYYY-MM-DD'
  totalRooms?: number;
  blockedRooms?: number;
  stopSell?: boolean;
}

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // ── Helpers ──────────────────────────────────────────────────────────────

  /** Compute available count from inventory row fields. */
  static computeAvailable(row: {
    totalRooms: number;
    bookedRooms: number;
    blockedRooms: number;
  }): number {
    return Math.max(0, row.totalRooms - row.bookedRooms - row.blockedRooms);
  }

  /** Redis cache key for availability range. */
  static cacheKey(tenantId: string, roomTypeId: string, checkIn: string, checkOut: string): string {
    return `avail:${tenantId}:${roomTypeId}:${checkIn}:${checkOut}`;
  }

  /** Invalidate all cached availability keys that overlap with `dates`. */
  async invalidateCache(tenantId: string, roomTypeId: string, dates: Date[]): Promise<void> {
    if (!dates.length) return;
    // We use a scan pattern per roomType — safe for dev-scale.
    // For large tenants with many cached ranges, a smarter approach
    // (tagging / pub-sub invalidation) should be adopted.
    const pattern = `avail:${tenantId}:${roomTypeId}:*`;
    const keys = await this.redis.raw.keys(pattern);
    if (keys.length) {
      await this.redis.raw.del(...keys);
      this.logger.debug(`Cache invalidated: ${keys.length} keys for roomType ${roomTypeId}`);
    }
  }

  // ── Advisory lock ────────────────────────────────────────────────────────

  /**
   * Acquire a PostgreSQL advisory transaction lock scoped to a (tenant, roomType) pair.
   * The lock is automatically released when the transaction ends.
   *
   * Using `pg_advisory_xact_lock(bigint)` which takes a 64-bit key.
   * We derive it from hashtext(tenantId || ':' || roomTypeId) cast to bigint.
   * Collision probability across all (tenant, roomType) pairs is negligible.
   */
  async acquireLock(
    tx: Prisma.TransactionClient,
    tenantId: string,
    roomTypeId: string,
  ): Promise<void> {
    // Concatenate on the DB side to avoid JS operator precedence confusion.
    const lockKey = `${tenantId}:${roomTypeId}`;
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        ('x' || substr(md5(${lockKey}), 1, 16))::bit(64)::bigint
      )
    `;
  }

  // ── Core operations ──────────────────────────────────────────────────────

  /**
   * Ensure inventory rows exist for `roomTypeId` on each date in `dates`.
   * If a row is missing, it is created with totalRooms = count of active rooms for that type.
   * Must be called INSIDE a tenant transaction (tx from prisma.forTenant).
   */
  async ensure(
    tx: Prisma.TransactionClient,
    tenantId: string,
    roomTypeId: string,
    dates: Date[],
  ): Promise<void> {
    if (!dates.length) return;

    // Count active physical rooms for this room type (once per call).
    const roomCount = await tx.room.count({
      where: { roomTypeId, isActive: true },
    });

    for (const date of dates) {
      await tx.$executeRaw`
        INSERT INTO inventory (id, tenant_id, room_type_id, date, total_rooms, booked_rooms, blocked_rooms, stop_sell)
        VALUES (gen_random_uuid(), ${tenantId}::uuid, ${roomTypeId}::uuid, ${date}::date, ${roomCount}, 0, 0, false)
        ON CONFLICT (tenant_id, room_type_id, date) DO NOTHING
      `;
    }
  }

  /**
   * Atomically increment `booked_rooms` for each date in `dates` by `delta`.
   * Validates that available >= delta before updating (pessimistic check).
   * Must be called inside a transaction AFTER acquireLock().
   *
   * Throws BadRequestException if any date would go over-capacity.
   */
  async incrementBooked(
    tx: Prisma.TransactionClient,
    tenantId: string,
    roomTypeId: string,
    dates: Date[],
    delta = 1,
  ): Promise<void> {
    if (!dates.length) return;

    // First ensure rows exist.
    await this.ensure(tx, tenantId, roomTypeId, dates);

    // Re-read rows with FOR UPDATE to prevent phantom reads between ensure and update.
    const rows = await tx.$queryRaw<
      Array<{ date: Date; total_rooms: number; booked_rooms: number; blocked_rooms: number }>
    >`
      SELECT date, total_rooms, booked_rooms, blocked_rooms
      FROM inventory
      WHERE tenant_id = ${tenantId}::uuid
        AND room_type_id = ${roomTypeId}::uuid
        AND date = ANY(${dates}::date[])
      FOR UPDATE
    `;

    for (const row of rows) {
      const available = row.total_rooms - row.booked_rooms - row.blocked_rooms;
      if (available < delta) {
        throw new BadRequestException(
          `No availability for room type ${roomTypeId} on ${format(row.date, 'yyyy-MM-dd')}` +
            ` (available: ${available}, requested: ${delta})`,
        );
      }
    }

    await tx.$executeRaw`
      UPDATE inventory
      SET booked_rooms = booked_rooms + ${delta},
          updated_at   = now()
      WHERE tenant_id   = ${tenantId}::uuid
        AND room_type_id = ${roomTypeId}::uuid
        AND date = ANY(${dates}::date[])
    `;
  }

  /**
   * Atomically decrement `booked_rooms` for each date by `delta`.
   * Called when a reservation is cancelled or the dates change.
   * Must be called inside a tenant transaction.
   */
  async decrementBooked(
    tx: Prisma.TransactionClient,
    tenantId: string,
    roomTypeId: string,
    dates: Date[],
    delta = 1,
  ): Promise<void> {
    if (!dates.length) return;

    await tx.$executeRaw`
      UPDATE inventory
      SET booked_rooms = GREATEST(0, booked_rooms - ${delta}),
          updated_at   = now()
      WHERE tenant_id   = ${tenantId}::uuid
        AND room_type_id = ${roomTypeId}::uuid
        AND date = ANY(${dates}::date[])
    `;
  }

  // ── Public API operations ─────────────────────────────────────────────────

  /**
   * Return inventory grid for a room type over a date range (inclusive both ends).
   * Rows missing from DB are synthesized with totalRooms = active room count.
   */
  async getGrid(roomTypeId: string, from: string, to: string): Promise<InventoryRow[]> {
    return this.prisma.forTenant(async (tx) => {
      const tenantId = TenantContext.getTenantIdOrThrow();

      // Verify room type exists (RLS guards tenant scope).
      const rt = await tx.roomType.findUnique({
        where: { id: roomTypeId },
        select: { id: true },
      });
      if (!rt) throw new NotFoundException('Категория номеров не найдена');

      const fromDate = parseISO(from);
      const toDate = parseISO(to);
      const allDates = eachDayOfInterval({ start: fromDate, end: toDate });

      const existing = await tx.$queryRaw<
        Array<{
          id: string;
          tenant_id: string;
          room_type_id: string;
          date: Date;
          total_rooms: number;
          booked_rooms: number;
          blocked_rooms: number;
          stop_sell: boolean;
        }>
      >`
        SELECT id, tenant_id, room_type_id, date, total_rooms, booked_rooms, blocked_rooms, stop_sell
        FROM inventory
        WHERE tenant_id   = ${tenantId}::uuid
          AND room_type_id = ${roomTypeId}::uuid
          AND date BETWEEN ${fromDate}::date AND ${toDate}::date
        ORDER BY date
      `;

      const byDate = new Map(
        existing.map((r) => [format(r.date, 'yyyy-MM-dd'), r]),
      );

      const roomCount = await tx.room.count({
        where: { roomTypeId, isActive: true },
      });

      return allDates.map((date) => {
        const key = format(date, 'yyyy-MM-dd');
        const row = byDate.get(key);
        if (row) {
          return {
            id: row.id,
            tenantId: row.tenant_id,
            roomTypeId: row.room_type_id,
            date: row.date,
            totalRooms: row.total_rooms,
            bookedRooms: row.booked_rooms,
            blockedRooms: row.blocked_rooms,
            stopSell: row.stop_sell,
            available: InventoryService.computeAvailable({
              totalRooms: row.total_rooms,
              bookedRooms: row.booked_rooms,
              blockedRooms: row.blocked_rooms,
            }),
          };
        }
        // Synthetic row for dates without an explicit record.
        return {
          id: '',
          tenantId,
          roomTypeId,
          date,
          totalRooms: roomCount,
          bookedRooms: 0,
          blockedRooms: 0,
          stopSell: false,
          available: roomCount,
        };
      });
    });
  }

  /**
   * Bulk-update inventory rows (totalRooms, blockedRooms, stopSell).
   * Upserts rows; does NOT touch bookedRooms (managed by reservations only).
   */
  async bulkUpdate(roomTypeId: string, rows: BulkUpdateRow[]): Promise<{ updated: number }> {
    return this.prisma.forTenant(async (tx) => {
      const tenantId = TenantContext.getTenantIdOrThrow();

      const rt = await tx.roomType.findUnique({
        where: { id: roomTypeId },
        select: { id: true },
      });
      if (!rt) throw new NotFoundException('Категория номеров не найдена');

      let updated = 0;
      for (const row of rows) {
        const date = parseISO(row.date);
        await tx.$executeRaw`
          INSERT INTO inventory (id, tenant_id, room_type_id, date, total_rooms, booked_rooms, blocked_rooms, stop_sell)
          VALUES (
            gen_random_uuid(),
            ${tenantId}::uuid,
            ${roomTypeId}::uuid,
            ${date}::date,
            ${row.totalRooms ?? 0},
            0,
            ${row.blockedRooms ?? 0},
            ${row.stopSell ?? false}
          )
          ON CONFLICT (tenant_id, room_type_id, date) DO UPDATE
            SET total_rooms   = EXCLUDED.total_rooms,
                blocked_rooms = EXCLUDED.blocked_rooms,
                stop_sell     = EXCLUDED.stop_sell,
                updated_at    = now()
        `;
        updated++;
      }

      // Invalidate cache for the affected dates.
      const dates = rows.map((r) => parseISO(r.date));
      await this.invalidateCache(tenantId, roomTypeId, dates);

      return { updated };
    });
  }
}
