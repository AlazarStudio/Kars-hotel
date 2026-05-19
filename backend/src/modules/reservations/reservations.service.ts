import { Injectable, ConflictException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/context/tenant-context';
import { TimelineService } from '../timeline/timeline.service';
import { TimelineGateway } from '../timeline/timeline.gateway';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { UpdateReservationDto } from './dto/update-reservation.dto';
import { parseISO, format } from 'date-fns';

const VALID_SOURCES  = ['DIRECT', 'PHONE', 'ONLINE', 'OTA', 'CORPORATE'];
const VALID_STATUSES = ['NEW', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW'];

@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly timelineService: TimelineService,
    private readonly timelineGateway: TimelineGateway,
  ) {}

  async create(dto: CreateReservationDto) {
    const tenantId = TenantContext.getTenantIdOrThrow();

    // Normalise source and status to uppercase enum values
    const source = VALID_SOURCES.includes((dto.source ?? '').toUpperCase())
      ? (dto.source as string).toUpperCase()
      : 'DIRECT';

    const initialStatus = dto.status && VALID_STATUSES.includes(dto.status.toUpperCase())
      ? dto.status.toUpperCase()
      : 'CONFIRMED';

    const checkIn  = parseISO(dto.checkIn);
    const checkOut = parseISO(dto.checkOut);

    if (checkOut <= checkIn) {
      throw new ConflictException('checkOut must be after checkIn');
    }

    type CreateResult =
      | { ok: true; id: string; status: string; version: number }
      | { ok: false; reason: 'ROOM_NOT_FOUND' | 'BOOKING_CONFLICT' };

    const result = await this.prisma.forTenant(async (tx): Promise<CreateResult> => {
      // 1. Verify room exists
      const rooms = await tx.$queryRaw<{ id: string; room_type_id: string }[]>`
        SELECT id, room_type_id
        FROM room
        WHERE id = ${dto.roomId}::uuid
          AND is_active = true
        LIMIT 1
      `;
      if (!rooms.length) return { ok: false, reason: 'ROOM_NOT_FOUND' };

      // 2. Check for overlapping reservations (pessimistic — lock the room's rows)
      const conflicts = await tx.$queryRaw<{ id: string }[]>`
        SELECT id
        FROM reservation
        WHERE room_id  = ${dto.roomId}::uuid
          AND check_in  < ${checkOut}::date
          AND check_out > ${checkIn}::date
          AND status NOT IN ('CANCELLED', 'NO_SHOW')
        LIMIT 1
      `;
      if (conflicts.length > 0) return { ok: false, reason: 'BOOKING_CONFLICT' };

      const roomTypeId = rooms[0].room_type_id;

      // 3. Insert reservation (room_type_id is a NOT NULL denormalised column)
      const [res] = await tx.$queryRaw<{
        id: string;
        status: string;
        check_in: Date;
        check_out: Date;
        version: number;
      }[]>`
        INSERT INTO reservation (
          tenant_id, room_id, room_type_id, guest_name, phone,
          check_in, check_out,
          status, source, adults, children,
          notes, total_price, rate_plan_id, version
        ) VALUES (
          ${tenantId}::uuid,
          ${dto.roomId}::uuid,
          ${roomTypeId}::uuid,
          ${dto.guestName},
          ${dto.phone ?? null},
          ${dto.checkIn}::date,
          ${dto.checkOut}::date,
          ${initialStatus}::"ReservationStatus",
          ${source}::"ReservationSource",
          ${dto.adults},
          ${dto.children ?? 0},
          ${dto.notes ?? null},
          ${dto.totalPrice != null ? dto.totalPrice : null},
          ${dto.ratePlanId ?? null},
          1
        )
        RETURNING id, status, check_in, check_out, version
      `;

      this.logger.log(`Reservation created: ${res.id} for room ${dto.roomId}`);
      return { ok: true, ...res };
    });

    // Throw HTTP exceptions OUTSIDE the Prisma transaction so NestJS catches them properly
    if (!result.ok) {
      switch (result.reason) {
        case 'ROOM_NOT_FOUND':
          throw new NotFoundException('Room not found or inactive');
        case 'BOOKING_CONFLICT':
          throw new ConflictException('Room is already booked for this period');
      }
    }

    // Invalidate timeline cache so the next GET returns fresh data
    await this.timelineService.invalidate(tenantId);

    // Broadcast real-time update to all connected clients for this tenant
    this.timelineGateway.notifyUpdate(tenantId, { action: 'created' });

    return { id: result.id, status: result.status, version: result.version };
  }

  // ─── Update ───────────────────────────────────────────────────────────────

  async update(id: string, dto: UpdateReservationDto) {
    const tenantId = TenantContext.getTenantIdOrThrow();

    type TxResult =
      | { ok: true; id: string; version: number; status: string }
      | { ok: false; reason: 'NOT_FOUND' | 'VERSION_MISMATCH' | 'DATE_CONFLICT' | 'BOOKING_CONFLICT' | 'ROOM_NOT_FOUND' };

    const result = await this.prisma.forTenant(async (tx): Promise<TxResult> => {
      // 1. Fetch the current row (all fields needed for defaults)
      const rows = await tx.$queryRaw<{
        id: string;
        room_id: string;
        room_type_id: string;
        check_in: Date;
        check_out: Date;
        version: number;
        guest_name: string;
        phone: string | null;
        email: string | null;
        adults: number;
        children: number;
        status: string;
        source: string;
        notes: string | null;
        total_price: string | null;
        rate_plan_id: string | null;
      }[]>`
        SELECT
          id, room_id, room_type_id, check_in, check_out, version,
          guest_name, phone, email, adults, children, status, source,
          notes, total_price::text, rate_plan_id
        FROM reservation
        WHERE id = ${id}::uuid
        LIMIT 1
      `;

      if (!rows.length) return { ok: false, reason: 'NOT_FOUND' };
      const cur = rows[0];

      // 2. Optimistic-lock check
      if (cur.version !== dto.version) {
        return { ok: false, reason: 'VERSION_MISMATCH' };
      }

      // 3. Resolve final values (dto fields override current values)
      const roomId   = dto.roomId  ?? cur.room_id;
      const checkIn  = dto.checkIn  ? parseISO(dto.checkIn)  : cur.check_in;
      const checkOut = dto.checkOut ? parseISO(dto.checkOut) : cur.check_out;

      if (checkOut <= checkIn) {
        return { ok: false, reason: 'DATE_CONFLICT' };
      }

      const status = dto.status
        ? (VALID_STATUSES.includes(dto.status.toUpperCase()) ? dto.status.toUpperCase() : cur.status)
        : cur.status;

      const source = dto.source
        ? (VALID_SOURCES.includes(dto.source.toUpperCase()) ? dto.source.toUpperCase() : cur.source)
        : cur.source;

      // 4. If room or dates changed, check for conflicts (exclude self)
      if (dto.roomId || dto.checkIn || dto.checkOut) {
        const conflicts = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM reservation
          WHERE room_id  = ${roomId}::uuid
            AND id      != ${id}::uuid
            AND check_in  < ${checkOut}::date
            AND check_out > ${checkIn}::date
            AND status NOT IN ('CANCELLED', 'NO_SHOW')
          LIMIT 1
        `;
        if (conflicts.length) return { ok: false, reason: 'BOOKING_CONFLICT' };
      }

      // 5. If room changed, look up new room_type_id
      let roomTypeId = cur.room_type_id;
      if (dto.roomId && dto.roomId !== cur.room_id) {
        const roomRows = await tx.$queryRaw<{ room_type_id: string }[]>`
          SELECT room_type_id FROM room
          WHERE id = ${dto.roomId}::uuid AND is_active = true
          LIMIT 1
        `;
        if (!roomRows.length) return { ok: false, reason: 'ROOM_NOT_FOUND' };
        roomTypeId = roomRows[0].room_type_id;
      }

      // 6. Update — bump version atomically
      const checkInStr  = format(checkIn,  'yyyy-MM-dd');
      const checkOutStr = format(checkOut, 'yyyy-MM-dd');
      const guestName   = dto.guestName  ?? cur.guest_name;
      const phone       = dto.phone  !== undefined ? (dto.phone  || null) : cur.phone;
      const email       = dto.email  !== undefined ? (dto.email  || null) : cur.email;
      const adults      = dto.adults    ?? cur.adults;
      const children    = dto.children  ?? cur.children;
      const notes       = dto.notes  !== undefined ? (dto.notes  || null) : cur.notes;
      const totalPrice  = dto.totalPrice !== undefined ? dto.totalPrice : (cur.total_price ? Number(cur.total_price) : null);

      const [res] = await tx.$queryRaw<{ id: string; version: number; status: string }[]>`
        UPDATE reservation SET
          room_id      = ${roomId}::uuid,
          room_type_id = ${roomTypeId}::uuid,
          check_in     = ${checkInStr}::date,
          check_out    = ${checkOutStr}::date,
          guest_name   = ${guestName},
          phone        = ${phone},
          email        = ${email},
          adults       = ${adults},
          children     = ${children},
          status       = ${status}::"ReservationStatus",
          source       = ${source}::"ReservationSource",
          notes        = ${notes},
          total_price  = ${totalPrice},
          version      = version + 1
        WHERE id = ${id}::uuid
        RETURNING id, version, status
      `;

      this.logger.log(`Reservation updated: ${res.id}`);
      return { ok: true, ...res };
    });

    // Throw HTTP exceptions OUTSIDE the Prisma transaction so NestJS catches them properly
    if (!result.ok) {
      switch (result.reason) {
        case 'NOT_FOUND':
          throw new NotFoundException('Reservation not found');
        case 'VERSION_MISMATCH':
          throw new ConflictException(
            'Reservation was modified by another user — please reload and try again.',
          );
        case 'DATE_CONFLICT':
          throw new ConflictException('checkOut must be after checkIn');
        case 'BOOKING_CONFLICT':
          throw new ConflictException('Room is already booked for this period');
        case 'ROOM_NOT_FOUND':
          throw new NotFoundException('Room not found or inactive');
      }
    }

    await this.timelineService.invalidate(tenantId);
    this.timelineGateway.notifyUpdate(tenantId, { action: 'updated' });

    return { id: result.id, status: result.status, version: result.version };
  }
}
