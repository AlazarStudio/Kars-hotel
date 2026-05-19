import { Injectable, ConflictException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/context/tenant-context';
import { TimelineService } from '../timeline/timeline.service';
import { TimelineGateway } from '../timeline/timeline.gateway';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { UpdateReservationDto } from './dto/update-reservation.dto';
import { SwapReservationsDto } from './dto/swap-reservations.dto';
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
      | { ok: true; id: string; status: string; version: number; placeNumber: number }
      | { ok: false; reason: 'ROOM_NOT_FOUND' | 'NO_PLACE_AVAILABLE' };

    const result = await this.prisma.forTenant(async (tx): Promise<CreateResult> => {
      // 1. Verify room exists and get capacity
      const rooms = await tx.$queryRaw<{ id: string; room_type_id: string; capacity: number }[]>`
        SELECT id, room_type_id, capacity
        FROM room
        WHERE id = ${dto.roomId}::uuid
          AND is_active = true
        LIMIT 1
      `;
      if (!rooms.length) return { ok: false, reason: 'ROOM_NOT_FOUND' };

      const { room_type_id: roomTypeId, capacity } = rooms[0];

      // 2. Find which places are already occupied for this period
      const occupied = await tx.$queryRaw<{ place_number: number }[]>`
        SELECT place_number
        FROM reservation
        WHERE room_id   = ${dto.roomId}::uuid
          AND check_in  < ${checkOut}::date
          AND check_out > ${checkIn}::date
          AND status NOT IN ('CANCELLED', 'NO_SHOW')
      `;

      const takenPlaces = new Set(occupied.map((r) => r.place_number));

      // 3. Auto-assign: pick the lowest available place number
      let placeNumber: number | null = null;
      for (let p = 1; p <= capacity; p++) {
        if (!takenPlaces.has(p)) { placeNumber = p; break; }
      }
      if (placeNumber === null) return { ok: false, reason: 'NO_PLACE_AVAILABLE' };

      // 4. Insert reservation
      const [res] = await tx.$queryRaw<{
        id: string;
        status: string;
        version: number;
        place_number: number;
      }[]>`
        INSERT INTO reservation (
          tenant_id, room_id, room_type_id, guest_name, phone,
          check_in, check_out,
          status, source, adults, children,
          notes, total_price, rate_plan_id, place_number, version
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
          ${placeNumber},
          1
        )
        RETURNING id, status, version, place_number
      `;

      this.logger.log(`Reservation created: ${res.id} room ${dto.roomId} place ${placeNumber}`);
      return { ok: true, id: res.id, status: res.status, version: res.version, placeNumber: res.place_number };
    });

    if (!result.ok) {
      switch (result.reason) {
        case 'ROOM_NOT_FOUND':
          throw new NotFoundException('Room not found or inactive');
        case 'NO_PLACE_AVAILABLE':
          throw new ConflictException('No available place in this room for the selected period');
      }
    }

    await this.timelineService.invalidate(tenantId);
    this.timelineGateway.notifyUpdate(tenantId, { action: 'created' });

    return { id: result.id, status: result.status, version: result.version, placeNumber: result.placeNumber };
  }

  // ─── Update ───────────────────────────────────────────────────────────────

  async update(id: string, dto: UpdateReservationDto) {
    const tenantId = TenantContext.getTenantIdOrThrow();

    type TxResult =
      | { ok: true; id: string; version: number; status: string }
      | { ok: false; reason: 'NOT_FOUND' | 'VERSION_MISMATCH' | 'DATE_CONFLICT' | 'NO_PLACE_AVAILABLE' | 'ROOM_NOT_FOUND' | 'BOOKING_CONFLICT' };

    const result = await this.prisma.forTenant(async (tx): Promise<TxResult> => {
      // 1. Fetch the current row
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
        place_number: number;
      }[]>`
        SELECT
          id, room_id, room_type_id, check_in, check_out, version,
          guest_name, phone, email, adults, children, status, source,
          notes, total_price::text, rate_plan_id, place_number
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

      // 3. Resolve final values
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

      // 4. Resolve place number
      let placeNumber = cur.place_number;

      if (dto.placeNumber !== undefined) {
        // Explicit place requested — validate it's free (exclude self)
        placeNumber = dto.placeNumber;
        const conflicts = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM reservation
          WHERE room_id      = ${roomId}::uuid
            AND place_number = ${placeNumber}
            AND id          != ${id}::uuid
            AND check_in    < ${checkOut}::date
            AND check_out   > ${checkIn}::date
            AND status NOT IN ('CANCELLED', 'NO_SHOW')
          LIMIT 1
        `;
        if (conflicts.length) return { ok: false, reason: 'BOOKING_CONFLICT' };
      } else if (dto.roomId || dto.checkIn || dto.checkOut) {
        // Room/dates changed — auto-reassign place
        if (dto.roomId && dto.roomId !== cur.room_id) {
          const roomRows = await tx.$queryRaw<{ room_type_id: string; capacity: number }[]>`
            SELECT room_type_id, capacity FROM room
            WHERE id = ${dto.roomId}::uuid AND is_active = true
            LIMIT 1
          `;
          if (!roomRows.length) return { ok: false, reason: 'ROOM_NOT_FOUND' };

          const occupied = await tx.$queryRaw<{ place_number: number }[]>`
            SELECT place_number FROM reservation
            WHERE room_id   = ${roomId}::uuid
              AND id        != ${id}::uuid
              AND check_in  < ${checkOut}::date
              AND check_out > ${checkIn}::date
              AND status NOT IN ('CANCELLED', 'NO_SHOW')
          `;
          const takenPlaces = new Set(occupied.map((r) => r.place_number));
          let assigned: number | null = null;
          for (let p = 1; p <= roomRows[0].capacity; p++) {
            if (!takenPlaces.has(p)) { assigned = p; break; }
          }
          if (assigned === null) return { ok: false, reason: 'NO_PLACE_AVAILABLE' };
          placeNumber = assigned;
        } else {
          // Same room, dates changed — check current place is still free
          const conflicts = await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM reservation
            WHERE room_id      = ${roomId}::uuid
              AND place_number = ${placeNumber}
              AND id          != ${id}::uuid
              AND check_in    < ${checkOut}::date
              AND check_out   > ${checkIn}::date
              AND status NOT IN ('CANCELLED', 'NO_SHOW')
            LIMIT 1
          `;
          if (conflicts.length) {
            const roomRows = await tx.$queryRaw<{ capacity: number }[]>`
              SELECT capacity FROM room WHERE id = ${roomId}::uuid LIMIT 1
            `;
            const capacity = roomRows[0]?.capacity ?? 1;
            const occupied = await tx.$queryRaw<{ place_number: number }[]>`
              SELECT place_number FROM reservation
              WHERE room_id   = ${roomId}::uuid
                AND id        != ${id}::uuid
                AND check_in  < ${checkOut}::date
                AND check_out > ${checkIn}::date
                AND status NOT IN ('CANCELLED', 'NO_SHOW')
            `;
            const takenPlaces = new Set(occupied.map((r) => r.place_number));
            let assigned: number | null = null;
            for (let p = 1; p <= capacity; p++) {
              if (!takenPlaces.has(p)) { assigned = p; break; }
            }
            if (assigned === null) return { ok: false, reason: 'NO_PLACE_AVAILABLE' };
            placeNumber = assigned;
          }
        }
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
          place_number = ${placeNumber},
          version      = version + 1
        WHERE id = ${id}::uuid
        RETURNING id, version, status
      `;

      this.logger.log(`Reservation updated: ${res.id} place ${placeNumber}`);
      return { ok: true, ...res };
    });

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
        case 'NO_PLACE_AVAILABLE':
          throw new ConflictException('No available place in this room for the selected period');
        case 'ROOM_NOT_FOUND':
          throw new NotFoundException('Room not found or inactive');
        case 'BOOKING_CONFLICT':
          throw new ConflictException('The requested place is already booked for the selected period');
      }
    }

    await this.timelineService.invalidate(tenantId);
    this.timelineGateway.notifyUpdate(tenantId, { action: 'updated' });

    return { id: result.id, status: result.status, version: result.version };
  }

  // ─── Swap places ──────────────────────────────────────────────────────────────
  /** Atomically swap place_number between two reservations in the same room. */
  async swap(dto: SwapReservationsDto) {
    const tenantId = TenantContext.getTenantIdOrThrow();

    type SwapResult =
      | { ok: true; a: { id: string; version: number }; b: { id: string; version: number } }
      | { ok: false; reason: 'NOT_FOUND' | 'VERSION_MISMATCH' | 'DIFFERENT_ROOMS' };

    const result = await this.prisma.forTenant(async (tx): Promise<SwapResult> => {
      const rows = await tx.$queryRaw<{
        id: string; room_id: string; place_number: number; version: number;
      }[]>`
        SELECT id, room_id, place_number, version
        FROM reservation
        WHERE id IN (${dto.idA}::uuid, ${dto.idB}::uuid)
      `;

      if (rows.length !== 2) return { ok: false, reason: 'NOT_FOUND' };

      const rowA = rows.find(r => r.id === dto.idA)!;
      const rowB = rows.find(r => r.id === dto.idB)!;

      if (rowA.version !== dto.versionA || rowB.version !== dto.versionB) {
        return { ok: false, reason: 'VERSION_MISMATCH' };
      }
      if (rowA.room_id !== rowB.room_id) {
        return { ok: false, reason: 'DIFFERENT_ROOMS' };
      }

      // Swap in two UPDATE statements within the same transaction
      const [resA] = await tx.$queryRaw<{ id: string; version: number }[]>`
        UPDATE reservation
        SET place_number = ${rowB.place_number}, version = version + 1
        WHERE id = ${dto.idA}::uuid
        RETURNING id, version
      `;
      const [resB] = await tx.$queryRaw<{ id: string; version: number }[]>`
        UPDATE reservation
        SET place_number = ${rowA.place_number}, version = version + 1
        WHERE id = ${dto.idB}::uuid
        RETURNING id, version
      `;

      this.logger.log(`Reservations swapped: ${dto.idA} ↔ ${dto.idB}`);
      return { ok: true, a: resA, b: resB };
    });

    if (!result.ok) {
      switch (result.reason) {
        case 'NOT_FOUND':
          throw new NotFoundException('One or both reservations not found');
        case 'VERSION_MISMATCH':
          throw new ConflictException('Reservation was modified by another user — please reload');
        case 'DIFFERENT_ROOMS':
          throw new ConflictException('Cannot swap reservations from different rooms');
      }
    }

    await this.timelineService.invalidate(tenantId);
    this.timelineGateway.notifyUpdate(tenantId, { action: 'updated' });

    return { a: result.a, b: result.b };
  }
}
