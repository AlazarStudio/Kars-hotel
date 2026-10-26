import {
  Injectable,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/context/tenant-context';
import { TimelineService } from '../timeline/timeline.service';
import { TimelineGateway } from '../timeline/timeline.gateway';
import { FolioService } from '../folio/folio.service';
import { HousekeepingService } from '../housekeeping/housekeeping.service';
import { PartnerWebhookService } from '../connectivity/partner-webhook.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { UpdateReservationDto } from './dto/update-reservation.dto';
import { allocatePlace, placesOf, type PlaceHolder } from './room-places';
import type { PartnerStayInfo } from './stay-times';
import { SwapReservationsDto } from './dto/swap-reservations.dto';
import { parseISO, format } from 'date-fns';

const VALID_SOURCES = ['DIRECT', 'PHONE', 'ONLINE', 'OTA', 'CORPORATE'];
const VALID_STATUSES = ['NEW', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW'];

/* Заезд, выезд и неявка — ФАКТЫ, а не поле формы: одно правило и для кнопки,
 * и для статуса в форме брони (25.10.2026). Из какого статуса можно, как
 * отказать и чем записать в журнал. */
type Fact = 'CHECKED_IN' | 'CHECKED_OUT' | 'NO_SHOW';
const FACTS: Record<Fact, { from: string[]; action: string; refusal: string }> = {
  CHECKED_IN: {
    from: ['NEW', 'CONFIRMED'],
    action: 'check_in',
    refusal: 'Cannot check in: current status must be NEW or CONFIRMED',
  },
  CHECKED_OUT: {
    from: ['CHECKED_IN'],
    action: 'check_out',
    refusal: 'Cannot check out: reservation must be in CHECKED_IN status',
  },
  NO_SHOW: {
    from: ['NEW', 'CONFIRMED'],
    action: 'no_show',
    refusal: 'Cannot mark as no-show: current status must be NEW or CONFIRMED',
  },
};
const isFact = (status: string): status is Fact => Object.keys(FACTS).includes(status);

/* Отмена — тоже действие, а не поле формы (25.10.2026): одно правило для
 * кнопки «Отменить бронь», статуса «Отменено» в форме и отмены партнёром.
 * Бронь партнёра (Kars Avia) отменяет только он; отменённую и выселенную
 * отменить нельзя. */
type CancelRefusal = 'CHANNEL_MANAGED' | 'ALREADY_CLOSED';
const cancelRefusal = (
  cur: { status: string; channel_managed: boolean },
  fromChannel?: boolean,
): CancelRefusal | null => {
  if (cur.channel_managed && !fromChannel) return 'CHANNEL_MANAGED';
  if (['CANCELLED', 'CHECKED_OUT'].includes(cur.status)) return 'ALREADY_CLOSED';
  return null;
};
const cancelRefused = (refusal: CancelRefusal) =>
  refusal === 'CHANNEL_MANAGED'
    ? new ForbiddenException(
        'This reservation belongs to an external partner (Kars Avia) and cannot be ' +
          'cancelled from the hotel. Please cancel it through the partner that created it.',
      )
    : new ConflictException(`Cannot cancel: reservation is already cancelled or checked out`);

@Injectable()
export class ReservationsService {
  private readonly logger = new Logger(ReservationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly timelineService: TimelineService,
    private readonly timelineGateway: TimelineGateway,
    private readonly folioService: FolioService,
    private readonly hkService: HousekeepingService,
    private readonly partnerWebhooks: PartnerWebhookService,
  ) {}

  /* Сколько гостей забронировано и (для заехавших) сколько фактически
   * разместилось. Партнёр по расхождению пересчитывает: платит за фактических.
   * Отдельного поля «сколько реально пришло» в PMS нет — при заезде считаем,
   * что приехали все забронированные; расхождение отель фиксирует правкой
   * брони, и оно приезжает следующим событием. */
  private async guestCounts(
    reservationId: string,
  ): Promise<{ guestsBooked: number; guestsArrived: number }> {
    const rows = await this.prisma.admin.$queryRaw<
      { adults: number; children: number }[]
    >`SELECT adults, children FROM reservation WHERE id = ${reservationId}::uuid LIMIT 1`;
    const booked = (rows[0]?.adults ?? 0) + (rows[0]?.children ?? 0);
    return { guestsBooked: booked, guestsArrived: booked };
  }

  /* `stay` — прилёт и отъезд по заявке и рейс; присылает только партнёрский API
     (stay-times.ts), у кабинета гостиницы этих полей нет. */
  async create(dto: CreateReservationDto, stay: PartnerStayInfo = {}) {
    const tenantId = TenantContext.getTenantIdOrThrow();

    const source = VALID_SOURCES.includes((dto.source ?? '').toUpperCase())
      ? (dto.source as string).toUpperCase()
      : 'DIRECT';

    const initialStatus =
      dto.status && VALID_STATUSES.includes(dto.status.toUpperCase())
        ? dto.status.toUpperCase()
        : 'CONFIRMED';

    const checkIn = parseISO(dto.checkIn);
    const checkOut = parseISO(dto.checkOut);

    if (checkOut <= checkIn) {
      throw new ConflictException('checkOut must be after checkIn');
    }

    type CreateResult =
      | { ok: true; id: string; status: string; version: number; placeNumber: number }
      | { ok: false; reason: 'ROOM_NOT_FOUND' | 'NO_PLACE_AVAILABLE' };

    const result = await this.prisma.forTenant(async (tx): Promise<CreateResult> => {
      // 1. Verify room exists and get capacity
      const rooms = await tx.$queryRaw<
        { id: string; room_type_id: string; capacity: number; multi_place: boolean }[]
      >`
        SELECT r.id, r.room_type_id, r.capacity, t.multi_place_enabled AS multi_place
        FROM room r
        JOIN tenant t ON t.id = r.tenant_id
        WHERE r.id = ${dto.roomId}::uuid
          AND r.is_active = true
        LIMIT 1
      `;
      if (!rooms.length) return { ok: false, reason: 'ROOM_NOT_FOUND' };

      const { room_type_id: roomTypeId, capacity, multi_place: multiPlace } = rooms[0];

      // 2–3. Места — одним правилом (room-places.ts): обычная гостиница отдаёт
      //      номер брони целиком, койко-места — по числу людей.
      const others = await this.overlapping(tx, dto.roomId, checkIn, checkOut, null);
      const placeNumber = allocatePlace({
        capacity,
        multiPlace,
        guests: { adults: dto.adults, children: dto.children ?? 0 },
        others,
      });
      if (placeNumber === null) return { ok: false, reason: 'NO_PLACE_AVAILABLE' };

      // 4. Insert reservation
      const [res] = await tx.$queryRaw<
        {
          id: string;
          status: string;
          version: number;
          place_number: number;
        }[]
      >`
        INSERT INTO reservation (
          tenant_id, room_id, room_type_id, guest_name, phone, email,
          check_in, check_out,
          status, source, adults, children,
          notes, total_price, rate_plan_id, place_number, channel_managed, guest_kind, version,
          arrival_at, departure_at, flight
        ) VALUES (
          ${tenantId}::uuid,
          ${dto.roomId}::uuid,
          ${roomTypeId}::uuid,
          ${dto.guestName},
          ${dto.phone ?? null},
          ${dto.email ?? null},
          ${dto.checkIn}::date,
          ${dto.checkOut}::date,
          ${initialStatus}::"ReservationStatus",
          ${source}::"ReservationSource",
          ${dto.adults},
          ${dto.children ?? 0},
          ${dto.notes ?? null},
          ${dto.totalPrice != null ? dto.totalPrice : null},
          ${dto.ratePlanId ?? null}::uuid,
          ${placeNumber},
          ${dto.channelManaged ?? false},
          ${dto.guestKind ?? null}::"GuestKind",
          1,
          ${stay.arrivalAt ?? null},
          ${stay.departureAt ?? null},
          ${stay.flight ?? null}
        )
        RETURNING id, status, version, place_number
      `;

      this.logger.log(`Reservation created: ${res.id} room ${dto.roomId} place ${placeNumber}`);
      return {
        ok: true,
        id: res.id,
        status: res.status,
        version: res.version,
        placeNumber: res.place_number,
      };
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

    await this.prisma.writeAuditLog({
      tenantId,
      entity: 'reservation',
      entityId: result.id,
      action: 'create',
      diff: {
        before: {},
        after: { status: result.status, roomId: dto.roomId, guestName: dto.guestName },
      },
    });

    return {
      id: result.id,
      status: result.status,
      version: result.version,
      placeNumber: result.placeNumber,
    };
  }

  // ─── Update ───────────────────────────────────────────────────────────────

  /* `fromChannel` — правку прислал партнёр (Kars Avia) через свой API.
     `stay` — его же прилёт, отъезд и рейс (stay-times.ts): кабинет гостиницы
     их не присылает и не меняет. */
  async update(
    id: string,
    dto: UpdateReservationDto,
    opts: { fromChannel?: boolean; stay?: PartnerStayInfo } = {},
  ) {
    const tenantId = TenantContext.getTenantIdOrThrow();

    type TxResult =
      | {
          ok: true;
          id: string;
          version: number;
          status: string;
          changes: { before: Record<string, unknown>; after: Record<string, unknown> };
          fact: { type: Fact; before: string; roomId: string } | null;
          cancelledFrom: string | null;
        }
      | {
          ok: false;
          reason:
            | 'NOT_FOUND'
            | 'VERSION_MISMATCH'
            | 'DATE_CONFLICT'
            | 'NO_PLACE_AVAILABLE'
            | 'ROOM_NOT_FOUND'
            | 'BOOKING_CONFLICT'
            | 'CHANNEL_GUESTS';
        }
      | { ok: false; reason: 'WRONG_STATUS'; fact: Fact }
      | { ok: false; reason: 'CANCEL_REFUSED'; refusal: CancelRefusal };

    const result = await this.prisma.forTenant(async (tx): Promise<TxResult> => {
      // 1. Fetch the current row
      const rows = await tx.$queryRaw<
        {
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
          channel_managed: boolean;
          arrival_at: string | null;
          departure_at: string | null;
          flight: string | null;
        }[]
      >`
        SELECT
          id, room_id, room_type_id, check_in, check_out, version,
          guest_name, phone, email, adults, children, status, source,
          notes, total_price::text, rate_plan_id, place_number, channel_managed,
          arrival_at, departure_at, flight
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

      /* 2a. ЧИСЛО ГОСТЕЙ брони партнёра ведёт партнёр (23.10.2026). Бронь
         из Kars Avia на одного гостя пересохранили в кабинете с «Взрослых: 2»
         — она заняла оба места номера, и второе место не давалось следующей
         заявке, а в Авии гость по-прежнему один. Меняется только из
         партнёрского API; та же цифра в форме — не изменение. */
      if (
        cur.channel_managed &&
        !opts.fromChannel &&
        ((dto.adults !== undefined && dto.adults !== cur.adults) ||
          (dto.children !== undefined && dto.children !== cur.children))
      ) {
        return { ok: false, reason: 'CHANNEL_GUESTS' };
      }

      // 3. Resolve final values
      const roomId = dto.roomId ?? cur.room_id;
      const checkIn = dto.checkIn ? parseISO(dto.checkIn) : cur.check_in;
      const checkOut = dto.checkOut ? parseISO(dto.checkOut) : cur.check_out;

      if (checkOut <= checkIn) {
        return { ok: false, reason: 'DATE_CONFLICT' };
      }

      const status = dto.status
        ? VALID_STATUSES.includes(dto.status.toUpperCase())
          ? dto.status.toUpperCase()
          : cur.status
        : cur.status;

      /* 3a. Заезд, выезд, неявка формой — тем же правилом, что кнопкой
         (25.10.2026, правка заказчика Kars Avia: «в PMS выселили, а в Авии
         заявка рабочая»). Статус «Выехал» из формы вставал напрямую: без
         сверки счёта, без времени выезда, номер не уходил в уборку, и
         партнёр не получал guest.checked_out. Тот же статус повторно —
         не новый факт: форма шлёт его при каждом сохранении. */
      const fact = status !== cur.status && isFact(status) ? status : null;
      if (fact && !(await this.admitFact(tx, id, fact, cur.status))) {
        return { ok: false, reason: 'WRONG_STATUS', fact };
      }

      /* 3b. «Отменено» формой — тем же правилом, что кнопкой «Отменить бронь»
         (25.10.2026). Сетка статусов ставила CANCELLED напрямую: бронь Kars
         Avia отменялась из кабинета в обход 403, а выселенная — «отменялась»
         задним числом. Тот же статус повторно — не новая отмена. */
      const cancelling = status !== cur.status && status === 'CANCELLED';
      const refusal = cancelling ? cancelRefusal(cur, opts.fromChannel) : null;
      if (refusal) return { ok: false, reason: 'CANCEL_REFUSED', refusal };

      const source = dto.source
        ? VALID_SOURCES.includes(dto.source.toUpperCase())
          ? dto.source.toUpperCase()
          : cur.source
        : cur.source;

      // 4. Resolve place number — тем же правилом, что при создании
      //    (room-places.ts): обычная гостиница — номер целиком, койко-места —
      //    по числу людей в брони.
      let placeNumber = cur.place_number;
      const guests = {
        adults: dto.adults ?? cur.adults,
        children: dto.children ?? cur.children,
      };
      if (
        dto.placeNumber !== undefined ||
        dto.roomId ||
        dto.checkIn ||
        dto.checkOut ||
        dto.adults !== undefined ||
        dto.children !== undefined
      ) {
        const roomRows = await tx.$queryRaw<{ capacity: number; multi_place: boolean }[]>`
          SELECT r.capacity, t.multi_place_enabled AS multi_place
          FROM room r
          JOIN tenant t ON t.id = r.tenant_id
          WHERE r.id = ${roomId}::uuid AND r.is_active = true
          LIMIT 1
        `;
        if (!roomRows.length) return { ok: false, reason: 'ROOM_NOT_FOUND' };
        const { capacity, multi_place: multiPlace } = roomRows[0];
        const others = await this.overlapping(tx, roomId, checkIn, checkOut, id);
        const need = placesOf(guests, capacity, multiPlace);
        const spanFree = (start: number) =>
          start >= 1 &&
          start + (multiPlace ? need : 1) - 1 <= capacity &&
          (multiPlace
            ? others.every((o) => {
                const n = placesOf(o, capacity, true);
                return start + need - 1 < o.placeNumber || o.placeNumber + n - 1 < start;
              })
            : others.length === 0);

        if (dto.placeNumber !== undefined) {
          // Явно выбранное место — должно быть свободно (без самой брони).
          if (!spanFree(dto.placeNumber)) return { ok: false, reason: 'BOOKING_CONFLICT' };
          placeNumber = dto.placeNumber;
        } else if (dto.roomId && dto.roomId !== cur.room_id) {
          const assigned = allocatePlace({ capacity, multiPlace, guests, others });
          if (assigned === null) return { ok: false, reason: 'NO_PLACE_AVAILABLE' };
          placeNumber = assigned;
        } else if (!spanFree(placeNumber)) {
          // Тот же номер, новые даты или состав — текущее место занято: ищем другое.
          const assigned = allocatePlace({ capacity, multiPlace, guests, others });
          if (assigned === null) return { ok: false, reason: 'NO_PLACE_AVAILABLE' };
          placeNumber = assigned;
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
      const checkInStr = format(checkIn, 'yyyy-MM-dd');
      const checkOutStr = format(checkOut, 'yyyy-MM-dd');
      const guestName = dto.guestName ?? cur.guest_name;
      const phone = dto.phone !== undefined ? dto.phone || null : cur.phone;
      const email = dto.email !== undefined ? dto.email || null : cur.email;
      const adults = dto.adults ?? cur.adults;
      const children = dto.children ?? cur.children;
      const notes = dto.notes !== undefined ? dto.notes || null : cur.notes;
      /* Прилёт, отъезд и рейс — только из партнёрского API (`opts.stay`): не
         прислано — прежнее, `null` — стираем. Тело правки кабинета их не несёт. */
      const stay = opts.stay ?? {};
      const arrivalAt = stay.arrivalAt !== undefined ? stay.arrivalAt : cur.arrival_at;
      const departureAt = stay.departureAt !== undefined ? stay.departureAt : cur.departure_at;
      const flight = stay.flight !== undefined ? stay.flight : cur.flight;
      const totalPrice =
        dto.totalPrice !== undefined
          ? dto.totalPrice
          : cur.total_price
            ? Number(cur.total_price)
            : null;

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
          arrival_at   = ${arrivalAt},
          departure_at = ${departureAt},
          flight       = ${flight},
          version      = version + 1
        WHERE id = ${id}::uuid
        RETURNING id, version, status
      `;
      if (fact) await this.stampFact(tx, id, fact, roomId);

      this.logger.log(`Reservation updated: ${res.id} place ${placeNumber}`);
      /* Что именно поменялось — в журнал (23.10.2026): «взрослых 1 → 2» на
         брони 0913 восстанавливали по журналу прокси, потому что запись
         правки хранила только новый статус и номер версии. */
      const was: Record<string, unknown> = {
        roomId: cur.room_id, checkIn: format(cur.check_in, 'yyyy-MM-dd'), checkOut: format(cur.check_out, 'yyyy-MM-dd'),
        guestName: cur.guest_name, phone: cur.phone, email: cur.email, adults: cur.adults, children: cur.children,
        status: cur.status, source: cur.source, notes: cur.notes,
        totalPrice: cur.total_price ? Number(cur.total_price) : null, placeNumber: cur.place_number,
        arrivalAt: cur.arrival_at, departureAt: cur.departure_at, flight: cur.flight,
      };
      const now: Record<string, unknown> = {
        roomId, checkIn: checkInStr, checkOut: checkOutStr, guestName, phone, email, adults, children,
        status, source, notes, totalPrice, placeNumber, arrivalAt, departureAt, flight,
      };
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {};
      for (const k of Object.keys(now)) {
        if (String(was[k] ?? '') !== String(now[k] ?? '')) {
          before[k] = was[k];
          after[k] = now[k];
        }
      }
      return {
        ok: true,
        ...res,
        changes: { before, after },
        fact: fact && { type: fact, before: cur.status, roomId },
        cancelledFrom: cancelling ? cur.status : null,
      };
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
          throw new ConflictException(
            'The requested place is already booked for the selected period',
          );
        case 'CHANNEL_GUESTS':
          throw new ForbiddenException(
            'Число гостей брони из Kars Avia меняется в заявке Kars Avia, а не в кабинете гостиницы',
          );
        case 'WRONG_STATUS':
          throw new ConflictException(FACTS[result.fact].refusal);
        case 'CANCEL_REFUSED':
          throw cancelRefused(result.refusal);
      }
    }

    await this.timelineService.invalidate(tenantId);
    this.timelineGateway.notifyUpdate(tenantId, { action: 'updated' });

    await this.prisma.writeAuditLog({
      tenantId,
      entity: 'reservation',
      entityId: result.id,
      action: 'update',
      // Кто правил — из контекста запроса (writeAuditLog); откуда — партнёр или кабинет.
      diff: {
        before: result.changes.before,
        after: { ...result.changes.after, version: result.version, ...(opts.fromChannel ? { via: 'partner-api' } : {}) },
      },
    });

    if (result.fact) {
      const { type, before, roomId } = result.fact;
      await this.announceFact(tenantId, result.id, type, before, roomId);
    }
    if (result.cancelledFrom) {
      await this.journalCancel(tenantId, result.id, result.cancelledFrom);
    }

    /* Правка брони партнёра — ему сообщается ЗДЕСЬ, откуда бы она ни пришла:
       переселила гостиница на шахматке или перенёс даты сам партнёр. */
    await this.partnerWebhooks.emitReservationChanged(result.id);

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
      const rows = await tx.$queryRaw<
        {
          id: string;
          room_id: string;
          place_number: number;
          version: number;
        }[]
      >`
        SELECT id, room_id, place_number, version
        FROM reservation
        WHERE id IN (${dto.idA}::uuid, ${dto.idB}::uuid)
      `;

      if (rows.length !== 2) return { ok: false, reason: 'NOT_FOUND' };

      const rowA = rows.find((r) => r.id === dto.idA)!;
      const rowB = rows.find((r) => r.id === dto.idB)!;

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

  // ─── Arrivals ─────────────────────────────────────────────────────────────────

  async getArrivals(date: string) {
    const tenantId = TenantContext.getTenantIdOrThrow();
    return this.prisma.forTenant(async (tx) => {
      return tx.$queryRaw<
        {
          id: string;
          guest_name: string;
          phone: string | null;
          email: string | null;
          room_id: string;
          room_type_id: string;
          check_in: Date;
          check_out: Date;
          status: string;
          adults: number;
          children: number;
          notes: string | null;
          total_price: string | null;
          rate_plan_id: string | null;
          source: string;
        }[]
      >`
        SELECT id, guest_name, phone, email, room_id, room_type_id,
               check_in, check_out, status, adults, children, notes,
               total_price::text, rate_plan_id, source
        FROM reservation
        WHERE check_in = ${date}::date
          AND status IN ('NEW', 'CONFIRMED')
        ORDER BY "createdAt" ASC
      `;
    });
  }

  // ─── Departures ───────────────────────────────────────────────────────────────

  async getDepartures(date: string) {
    const tenantId = TenantContext.getTenantIdOrThrow();
    return this.prisma.forTenant(async (tx) => {
      return tx.$queryRaw<
        {
          id: string;
          guest_name: string;
          phone: string | null;
          email: string | null;
          room_id: string;
          room_type_id: string;
          check_in: Date;
          check_out: Date;
          status: string;
          adults: number;
          children: number;
          notes: string | null;
          total_price: string | null;
          rate_plan_id: string | null;
          source: string;
        }[]
      >`
        SELECT id, guest_name, phone, email, room_id, room_type_id,
               check_in, check_out, status, adults, children, notes,
               total_price::text, rate_plan_id, source
        FROM reservation
        WHERE check_out = ${date}::date
          AND status = 'CHECKED_IN'
        ORDER BY "createdAt" ASC
      `;
    });
  }

  // ─── Check-in / check-out / no-show ───────────────────────────────────────────

  /* Время с ресепшена (`actualCheckInTime`) не пишется и раньше не писалось:
     checked_in_at ставит сервер в момент заезда. */
  async checkIn(id: string, userId: string, _actualCheckInTime?: string) {
    return this.recordFact(id, 'CHECKED_IN', userId);
  }

  async checkOut(id: string, userId: string) {
    return this.recordFact(id, 'CHECKED_OUT', userId);
  }

  async noShow(id: string, userId: string) {
    return this.recordFact(id, 'NO_SHOW', userId);
  }

  /* Заезд и выезд от партнёра (26.10.2026, правка заказчика Kars Avia:
     «отмечаем выезд в Эскадрилье, а потом ещё заходим в шахматку выселить»).
     Время — его: диспетчер отмечает факт, когда гость заехал или выехал, а не
     когда дошли руки. Правила те же, что у кнопки. */
  async recordPartnerFact(id: string, fact: 'CHECKED_IN' | 'CHECKED_OUT', at: Date) {
    return this.recordFact(id, fact, undefined, at);
  }

  /** Отдельная операция факта (кнопка «Заселить», «Выселить», «Не явился»). */
  private async recordFact(id: string, fact: Fact, userId?: string, at?: Date) {
    const tenantId = TenantContext.getTenantIdOrThrow();

    type TxResult =
      | { ok: true; id: string; version: number; before: string; roomId: string }
      | { ok: false; reason: 'NOT_FOUND' | 'WRONG_STATUS' };

    const result = await this.prisma.forTenant(async (tx): Promise<TxResult> => {
      const rows = await tx.$queryRaw<{ id: string; status: string; room_id: string }[]>`
        SELECT id, status, room_id FROM reservation WHERE id = ${id}::uuid LIMIT 1
      `;
      if (!rows.length) return { ok: false, reason: 'NOT_FOUND' };
      const cur = rows[0];
      if (!(await this.admitFact(tx, id, fact, cur.status))) {
        return { ok: false, reason: 'WRONG_STATUS' };
      }

      const [res] = await tx.$queryRaw<{ id: string; version: number }[]>`
        UPDATE reservation
        SET status = ${fact}::"ReservationStatus",
            version = version + 1,
            "updatedAt" = now()
        WHERE id = ${id}::uuid
        RETURNING id, version
      `;
      await this.stampFact(tx, id, fact, cur.room_id, at);

      return { ok: true, ...res, before: cur.status, roomId: cur.room_id };
    });

    if (!result.ok) {
      if (result.reason === 'NOT_FOUND') throw new NotFoundException('Reservation not found');
      throw new ConflictException(FACTS[fact].refusal);
    }

    await this.timelineService.invalidate(tenantId);
    this.timelineGateway.notifyUpdate(tenantId, { action: 'updated' });

    await this.announceFact(tenantId, id, fact, result.before, result.roomId, userId, at);

    return { id: result.id, status: fact, version: result.version };
  }

  /** Можно ли зафиксировать факт из текущего статуса. Выезд — только с
   *  закрытым счётом: долг — 409 из сверки счёта. */
  private async admitFact(
    tx: Prisma.TransactionClient,
    id: string,
    fact: Fact,
    status: string,
  ): Promise<boolean> {
    if (!FACTS[fact].from.includes(status)) return false;
    if (fact === 'CHECKED_OUT') await this.folioService.assertZeroBalance(id, tx);
    return true;
  }

  /** Следы факта в той же транзакции: время заезда или выезда; освободившийся
   *  номер — грязный. */
  private async stampFact(tx: Prisma.TransactionClient, id: string, fact: Fact, roomId: string, at?: Date) {
    // `at` — время партнёра; без него — момент нажатия.
    if (fact === 'CHECKED_IN') {
      if (at) await tx.$executeRaw`UPDATE reservation SET checked_in_at = ${at} WHERE id = ${id}::uuid`;
      else await tx.$executeRaw`UPDATE reservation SET checked_in_at = now() WHERE id = ${id}::uuid`;
    }
    if (fact === 'CHECKED_OUT') {
      if (at) await tx.$executeRaw`UPDATE reservation SET checked_out_at = ${at} WHERE id = ${id}::uuid`;
      else await tx.$executeRaw`UPDATE reservation SET checked_out_at = now() WHERE id = ${id}::uuid`;
      await tx.$executeRaw`
        UPDATE room
        SET status = 'DIRTY'::"RoomStatus", "updatedAt" = now()
        WHERE id = ${roomId}::uuid
      `;
    }
  }

  /** После записи факта: журнал, уборка, партнёр. `userId` не передан —
   *  журнал берёт пользователя из запроса. */
  private async announceFact(
    tenantId: string,
    id: string,
    fact: Fact,
    before: string,
    roomId: string,
    userId?: string,
    at?: Date,
  ) {
    await this.prisma.writeAuditLog({
      tenantId,
      userId,
      entity: 'reservation',
      entityId: id,
      action: FACTS[fact].action,
      diff: { before: { status: before }, after: { status: fact } },
    });

    if (fact === 'CHECKED_OUT') {
      // Auto-create housekeeping cleaning task for the vacated room
      this.hkService.autoCreateOnCheckout(tenantId, roomId, id).catch((e) => {
        // Non-critical — log but don't fail checkout
        console.warn(`Failed to auto-create HK task: ${(e as Error).message}`);
      });
    }

    /* Г5 · партнёру факт нужен сразу: от него зависит расчёт с
     * авиакомпанией. Не ждём — отправка не блокирует ответ, а сорвавшийся
     * вебхук партнёр доберёт опросом фактов. */
    const counts = await this.guestCounts(id);
    const now = (at ?? new Date()).toISOString();
    if (fact === 'CHECKED_IN') {
      await this.partnerWebhooks.emitForReservation('guest.checked_in', id, {
        reservationId: id,
        status: 'checked_in',
        checkedInAt: now,
        noShow: false,
        ...counts,
      });
    } else if (fact === 'CHECKED_OUT') {
      await this.partnerWebhooks.emitForReservation('guest.checked_out', id, {
        reservationId: id,
        status: 'checked_out',
        checkedOutAt: now,
        noShow: false,
        ...counts,
      });
    } else {
      await this.partnerWebhooks.emitForReservation('guest.no_show', id, {
        reservationId: id,
        status: 'no_show',
        noShow: true,
        ...counts,
        // Никто не заехал — счётчик прибывших перекрываем нулём.
        guestsArrived: 0,
      });
    }
  }

  /** Открытие карточки брони — в журнал (план 13.5). Чужая бронь — 404. */
  async recordView(id: string, userId: string): Promise<void> {
    const tenantId = TenantContext.getTenantIdOrThrow();
    const found = await this.prisma.forTenant((tx) =>
      tx.reservation.findUnique({ where: { id }, select: { id: true } }),
    );
    if (!found) throw new NotFoundException('Reservation not found');
    await this.prisma.writeAuditLog({ tenantId, userId, entity: 'reservation', entityId: id, action: 'view' });
  }

  // ─── Cancel ───────────────────────────────────────────────────────────────────

  /**
   * Cancel a reservation.
   *
   * Channel-managed reservations (created by a partner such as Kars Avia via the
   * connectivity API) are owned by that partner — hotel staff may view them but
   * cannot cancel them from the PMS. Only the owning channel can release them, by
   * calling through with `fromChannel: true`. This keeps a single source of truth
   * for the booking's lifecycle and prevents the two systems drifting out of sync.
   */
  async cancel(id: string, userId: string, reason?: string, opts: { fromChannel?: boolean } = {}) {
    const tenantId = TenantContext.getTenantIdOrThrow();

    type TxResult =
      | { ok: true; id: string; version: number; before: string }
      | { ok: false; reason: 'NOT_FOUND' }
      | { ok: false; reason: 'CANCEL_REFUSED'; refusal: CancelRefusal };

    const result = await this.prisma.forTenant(async (tx): Promise<TxResult> => {
      const rows = await tx.$queryRaw<
        { id: string; status: string; version: number; channel_managed: boolean }[]
      >`
        SELECT id, status, version, channel_managed FROM reservation WHERE id = ${id}::uuid LIMIT 1
      `;
      if (!rows.length) return { ok: false, reason: 'NOT_FOUND' };
      const cur = rows[0];
      // A partner owns this booking — hotel staff cannot cancel it locally.
      const refusal = cancelRefusal(cur, opts.fromChannel);
      if (refusal) return { ok: false, reason: 'CANCEL_REFUSED', refusal };

      const notesSuffix = reason ? `\n[Cancelled: ${reason}]` : '';

      const [res] = await tx.$queryRaw<{ id: string; version: number }[]>`
        UPDATE reservation
        SET status = 'CANCELLED'::"ReservationStatus",
            notes  = COALESCE(notes, '') || ${notesSuffix},
            version = version + 1,
            "updatedAt" = now()
        WHERE id = ${id}::uuid
        RETURNING id, version
      `;

      return { ok: true, id: res.id, version: res.version, before: cur.status };
    });

    if (!result.ok) {
      if (result.reason === 'NOT_FOUND') throw new NotFoundException('Reservation not found');
      throw cancelRefused(result.refusal);
    }

    await this.journalCancel(tenantId, id, result.before, userId, reason);

    await this.timelineService.invalidate(tenantId);
    this.timelineGateway.notifyUpdate(tenantId, { action: 'updated' });

    return { id: result.id, status: 'CANCELLED', version: result.version, cancelled: true };
  }

  /** Отмена — в журнал: кнопкой, формой или партнёром. `userId` не передан —
   *  журнал берёт пользователя из запроса. */
  private async journalCancel(
    tenantId: string,
    id: string,
    before: string,
    userId?: string,
    reason?: string,
  ) {
    await this.prisma.writeAuditLog({
      tenantId,
      userId,
      entity: 'reservation',
      entityId: id,
      action: 'cancel',
      diff: {
        before: { status: before },
        after: { status: 'CANCELLED', reason: reason ?? null },
      },
    });
  }

  /* Раскладка питания брони — то, что кухня готовит по дням (KARV3-51).
   *
   * Данные пишет партнёр через connectivity-API (PUT …/meals), а читались они
   * до сих пор только им же: у самой гостиницы экрана не было, и порции она
   * считала второй раз по-своему. Форма ответа та же, что у партнёра, — один
   * источник, две двери. */
  async getMeals(id: string) {
    const tenantId = TenantContext.getTenantIdOrThrow();
    return this.prisma.forTenant(async (tx) => {
      const reservation = await tx.reservation.findFirst({
        where: { id, tenantId },
        select: { id: true },
      });
      if (!reservation) throw new NotFoundException('Reservation not found');
      const rows = await tx.reservationMealDay.findMany({
        where: { reservationId: id },
        orderBy: { date: 'asc' },
      });
      return {
        reservationId: id,
        days: rows.map((r) => ({
          date: r.date.toISOString().slice(0, 10),
          breakfast: r.breakfast,
          lunch: r.lunch,
          dinner: r.dinner,
        })),
        totals: {
          breakfast: rows.reduce((n, r) => n + r.breakfast, 0),
          lunch: rows.reduce((n, r) => n + r.lunch, 0),
          dinner: rows.reduce((n, r) => n + r.dinner, 0),
        },
      };
    });
  }

  /* «Что готовить на день»: все порции по гостинице за дату, по броням.
   * Отменённые и неявившиеся не считаем — их порции никто не съест; заказ у
   * них может остаться (партнёр снимает его своим ходом), но кухне он не
   * нужен. Индекс (tenant_id, date) под этот отбор заведён вместе с таблицей. */
  async getMealsForDay(date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new ConflictException('date must be YYYY-MM-DD');
    }
    const tenantId = TenantContext.getTenantIdOrThrow();
    return this.prisma.forTenant(async (tx) => {
      const rows = await tx.reservationMealDay.findMany({
        where: {
          tenantId,
          date: new Date(`${date}T00:00:00.000Z`),
          reservation: { status: { notIn: ['CANCELLED', 'NO_SHOW'] } },
        },
        include: {
          reservation: {
            select: {
              id: true,
              guestName: true,
              status: true,
              adults: true,
              children: true,
              room: { select: { number: true } },
            },
          },
        },
        orderBy: { reservation: { room: { number: 'asc' } } },
      });
      return {
        date,
        rows: rows.map((r) => ({
          reservationId: r.reservation.id,
          guestName: r.reservation.guestName,
          roomNumber: r.reservation.room.number,
          status: r.reservation.status.toLowerCase(),
          guests: r.reservation.adults + r.reservation.children,
          breakfast: r.breakfast,
          lunch: r.lunch,
          dinner: r.dinner,
        })),
        totals: {
          breakfast: rows.reduce((n, r) => n + r.breakfast, 0),
          lunch: rows.reduce((n, r) => n + r.lunch, 0),
          dinner: rows.reduce((n, r) => n + r.dinner, 0),
        },
      };
    });
  }
  /** Брони номера, пересекающиеся по датам (кроме `excludeId`) — для правила мест. */
  private async overlapping(
    tx: { $queryRaw: PrismaService['$queryRaw'] },
    roomId: string,
    checkIn: Date,
    checkOut: Date,
    excludeId: string | null,
  ): Promise<PlaceHolder[]> {
    const rows = excludeId
      ? await tx.$queryRaw<{ place_number: number; adults: number; children: number }[]>`
          SELECT place_number, adults, children FROM reservation
          WHERE room_id = ${roomId}::uuid
            AND id != ${excludeId}::uuid
            AND check_in  < ${checkOut}::date
            AND check_out > ${checkIn}::date
            AND status NOT IN ('CANCELLED', 'NO_SHOW')
        `
      : await tx.$queryRaw<{ place_number: number; adults: number; children: number }[]>`
          SELECT place_number, adults, children FROM reservation
          WHERE room_id = ${roomId}::uuid
            AND check_in  < ${checkOut}::date
            AND check_out > ${checkIn}::date
            AND status NOT IN ('CANCELLED', 'NO_SHOW')
        `;
    return rows.map((r) => ({ placeNumber: r.place_number, adults: r.adults, children: r.children ?? 0 }));
  }
}
