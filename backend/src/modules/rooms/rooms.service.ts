import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ReservationStatus, RoomPartnerHold, RoomStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  PRISMA_FOREIGN_KEY_VIOLATION,
  PRISMA_RECORD_NOT_FOUND,
  PRISMA_UNIQUE_VIOLATION,
  asError,
  prismaErrorCode,
} from '../../common/prisma/prisma-error';
import { TenantContext } from '../../common/context/tenant-context';
import { bedsForCreate, bedsForUpdate } from './room-beds';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { CreateManyRoomsDto } from './dto/create-many-rooms.dto';
import { roomDeleteSwitch } from './room-delete.switch';

export interface ListRoomsFilter {
  roomTypeId?: string;
  floor?: number;
  status?: RoomStatus;
  isActive?: boolean;
  /** Д7 · поиск по номеру и заметке. */
  q?: string;
  /** Д4/Д7 · фильтр по договорному блоку: NONE | QUOTA | RESERVE. */
  partnerHold?: RoomPartnerHold;
  /** true — только удалённые в архив; иначе архивные не отдаются. */
  archived?: boolean;
}

/** Брони, которые ещё впереди или идут сейчас: с ними номер в архив не убрать. */
const LIVE_RESERVATION_STATUSES: ReservationStatus[] = ['NEW', 'CONFIRMED', 'CHECKED_IN'];

@Injectable()
export class RoomsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(filter: ListRoomsFilter = {}) {
    return this.prisma.forTenant((tx) =>
      tx.room.findMany({
        where: {
          roomTypeId: filter.roomTypeId,
          floor: filter.floor,
          status: filter.status,
          isActive: filter.isActive,
          partnerHold: filter.partnerHold,
          archivedAt: filter.archived ? { not: null } : null,
          /* Д7 · поиск. Ищем по номеру и заметке: заметка — единственное место,
           * где живёт «угловой, шумно от лифта», и искать по ней приходится
           * ровно тогда, когда гость просит «не как в прошлый раз». */
          ...(filter.q
            ? {
                OR: [
                  { number: { contains: filter.q, mode: 'insensitive' as const } },
                  { notes: { contains: filter.q, mode: 'insensitive' as const } },
                ],
              }
            : {}),
        },
        orderBy: [{ floor: 'asc' }, { number: 'asc' }],
        include: { roomType: { select: { id: true, code: true, name: true } } },
      }),
    );
  }

  async get(id: string) {
    const room = await this.prisma.forTenant((tx) =>
      tx.room.findUnique({
        where: { id },
        include: { roomType: { select: { id: true, code: true, name: true } } },
      }),
    );
    if (!room) throw new NotFoundException(`Room ${id} not found`);
    return room;
  }

  async create(dto: CreateRoomDto) {
    // Verify the RoomType belongs to this tenant (RLS will block otherwise,
    // but we want a clear 404 message before going to insert).
    const rt = await this.prisma.forTenant((tx) =>
      tx.roomType.findUnique({ where: { id: dto.roomTypeId }, select: { id: true } }),
    );
    if (!rt) throw new NotFoundException('Категория номера не найдена');

    const tenantId = TenantContext.getTenantIdOrThrow();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let room: any;
    try {
      room = await this.prisma.forTenant((tx) =>
        tx.room.create({
          data: {
            tenantId,
            roomTypeId: dto.roomTypeId,
            number: dto.number,
            floor: dto.floor ?? 1,
            bedType: dto.bedType ?? 'DOUBLE',
            ...bedsForCreate(dto),
            view: dto.view ?? 'NONE',
            status: dto.status ?? 'CLEAN',
            isActive: dto.isActive ?? true,
            capacity: dto.capacity ?? 1,
            partnerHold: dto.partnerHold ?? 'NONE',
            notes: dto.notes ?? null,
          },
          include: { roomType: { select: { id: true, code: true, name: true } } },
        }),
      );
    } catch (e) {
      /* Номер уникален и среди архивных: «такой уже есть» про невидимый в
         фонде номер ставит в тупик — подсказываем, где он. */
      if (prismaErrorCode(e) === PRISMA_UNIQUE_VIOLATION) {
        const archived = await this.prisma.forTenant((tx) =>
          tx.room.findFirst({ where: { number: dto.number, archivedAt: { not: null } }, select: { id: true } }),
        );
        if (archived) {
          throw new ConflictException(
            `Номер "${dto.number}" есть в архиве удалённых — восстановите его вместо нового`,
          );
        }
      }
      throw this.translatePrismaError(e, dto.number);
    }
    await this.prisma.writeAuditLog({
      tenantId,
      entity: 'room',
      entityId: room.id,
      action: 'create',
      diff: { before: {}, after: { number: dto.number, roomTypeId: dto.roomTypeId } },
    });
    return room;
  }

  /* Д2 · массовое создание номеров одной категории.
   *
   * Одна транзакция на всю пачку: этаж заводится целиком либо не заводится —
   * половина созданных номеров хуже, чем ни одного, потому что вторую половину
   * придётся досоздавать вручную, гадая, докуда дошло.
   *
   * Занятые номера по умолчанию пропускаем, а не роняем операцию: чаще всего
   * пачкой ДОзаполняют этаж, и падение из-за одного существующего номера
   * заставило бы человека вычислять диапазон заново. Что пропустили — говорим
   * в ответе: молча «создать 20, создалось 17» недопустимо.
   */
  async createMany(dto: CreateManyRoomsDto) {
    const rt = await this.prisma.forTenant((tx) =>
      tx.roomType.findUnique({ where: { id: dto.roomTypeId }, select: { id: true } }),
    );
    if (!rt) throw new NotFoundException('Категория номера не найдена');

    const tenantId = TenantContext.getTenantIdOrThrow();
    const prefix = dto.prefix ?? '';
    const suffix = dto.suffix ?? '';
    const numbers = Array.from(
      { length: dto.count },
      (_, i) => `${prefix}${dto.startNumber + i}${suffix}`,
    );

    const existing = await this.prisma.forTenant((tx) =>
      tx.room.findMany({
        where: { number: { in: numbers } },
        select: { number: true, archivedAt: true },
      }),
    );
    const taken = new Set(existing.map((r) => r.number));
    /* Удалённые — отдельным списком (28.10.2026): номер в архиве в фонде не
       виден, и «уже есть» про него ставит в тупик — как и в одиночном create,
       где подсказываем восстановить. */
    const archived = new Set(existing.filter((r) => r.archivedAt).map((r) => r.number));
    const skipped = numbers.filter((n) => taken.has(n) && !archived.has(n));
    const skippedArchived = numbers.filter((n) => archived.has(n));

    if (taken.size && dto.skipExisting === false) {
      throw new ConflictException(
        `Уже существуют номера: ${[...skipped, ...skippedArchived].join(', ')}`,
      );
    }
    const toCreate = numbers.filter((n) => !taken.has(n));
    if (!toCreate.length) {
      return { created: 0, skipped, skippedArchived, rooms: [] as unknown[] };
    }

    const rooms = await this.prisma.forTenant(async (tx) => {
      const made: unknown[] = [];
      for (const number of toCreate) {
        made.push(
          await tx.room.create({
            data: {
              tenantId,
              roomTypeId: dto.roomTypeId,
              number,
              floor: dto.floor ?? 1,
              bedType: dto.bedType ?? 'DOUBLE',
              ...bedsForCreate(dto),
              view: dto.view ?? 'NONE',
              status: dto.status ?? 'CLEAN',
              isActive: dto.isActive ?? true,
              capacity: dto.capacity ?? 1,
              partnerHold: dto.partnerHold ?? 'NONE',
              notes: dto.notes ?? null,
            },
            include: { roomType: { select: { id: true, code: true, name: true } } },
          }),
        );
      }
      return made;
    });

    // Одна запись аудита на пачку: сорок строк «создан номер» в журнале
    // прячут всё остальное, а произошло одно действие.
    await this.prisma.writeAuditLog({
      tenantId,
      entity: 'room',
      entityId: dto.roomTypeId,
      action: 'create_many',
      diff: {
        before: {},
        after: { created: toCreate, skipped, skippedArchived, roomTypeId: dto.roomTypeId },
      },
    });

    return { created: rooms.length, skipped, skippedArchived, rooms };
  }

  async update(id: string, dto: UpdateRoomDto) {
    const tenantId = TenantContext.getTenantIdOrThrow();
    /* Архивный номер не правится: правкой (isActive) его можно было бы
       незаметно вернуть в продажу мимо «Восстановить». */
    const current = await this.prisma.forTenant((tx) =>
      tx.room.findUnique({ where: { id }, select: { archivedAt: true } }),
    );
    if (current?.archivedAt) {
      throw new ConflictException('Номер в архиве удалённых — сначала восстановите его');
    }
    if (dto.roomTypeId) {
      const rt = await this.prisma.forTenant((tx) =>
        tx.roomType.findUnique({ where: { id: dto.roomTypeId }, select: { id: true } }),
      );
      if (!rt) throw new NotFoundException('Категория номера не найдена');
    }
    let updated: unknown;
    try {
      updated = await this.prisma.forTenant((tx) =>
        tx.room.update({
          where: { id },
          data: {
            roomTypeId: dto.roomTypeId ?? undefined,
            number: dto.number ?? undefined,
            floor: dto.floor ?? undefined,
            bedType: dto.bedType ?? undefined,
            ...bedsForUpdate(dto),
            view: dto.view ?? undefined,
            status: dto.status ?? undefined,
            isActive: dto.isActive ?? undefined,
            capacity: dto.capacity ?? undefined,
            partnerHold: dto.partnerHold ?? undefined,
            notes: dto.notes === undefined ? undefined : dto.notes,
          },
          include: { roomType: { select: { id: true, code: true, name: true } } },
        }),
      );
    } catch (e) {
      throw this.translatePrismaError(e, dto.number);
    }
    await this.prisma.writeAuditLog({
      tenantId,
      entity: 'room',
      entityId: id,
      action: 'update',
      diff: { before: {}, after: { ...dto } },
    });
    return updated;
  }

  async setStatus(id: string, status: RoomStatus) {
    const tenantId = TenantContext.getTenantIdOrThrow();
    let result: unknown;
    try {
      result = await this.prisma.forTenant((tx) =>
        tx.room.update({ where: { id }, data: { status } }),
      );
    } catch (e) {
      throw this.translatePrismaError(e);
    }
    await this.prisma.writeAuditLog({
      tenantId,
      entity: 'room',
      entityId: id,
      action: 'status_change',
      diff: { before: {}, after: { status } },
    });
    return result;
  }

  /**
   * Удаление номера «в архив» (25.10.2026, решение владельца: удаление не
   * должно стирать данные из базы). Строка номера остаётся со всеми бронями и
   * историей; ставится пометка кто и когда, и номер выключается
   * (isActive=false) — продажа, шахматка, наличие и партнёрский API смотрят
   * только на включённые, так что архивный не всплывёт и там, где фильтр по
   * архиву забыли. Из номерного фонда его прячет `list`.
   *
   * Ограничение: номер с действующей бронью (новая, подтверждённая, гость
   * живёт) в архив не убрать — бронь осталась бы на номере, которого нет в
   * шахматке. Сначала её переносят. Прошлые и отменённые брони не мешают:
   * это история, она остаётся при номере.
   *
   * Повторный вызов на архивном — тот же ответ, без второй записи в журнале.
   */
  async archive(id: string) {
    const tenantId = TenantContext.getTenantIdOrThrow();
    const actor = TenantContext.get()?.userId || null;
    const result = await this.prisma.forTenant(async (tx) => {
      const room = await tx.room.findUnique({
        where: { id },
        select: { number: true, isActive: true, archivedAt: true },
      });
      if (!room) throw new NotFoundException('Номер не найден');
      if (room.archivedAt) return { room, changed: false };
      const live = await tx.reservation.count({
        where: { roomId: id, status: { in: LIVE_RESERVATION_STATUSES } },
      });
      if (live > 0) {
        throw new ConflictException(
          `Номер №${room.number} нельзя удалить: на нём ${live} ${plural(live, 'действующая бронь', 'действующие брони', 'действующих броней')}. ` +
            'Перенесите их на другой номер, затем удалите.',
        );
      }
      const archivedAt = new Date();
      await tx.room.update({
        where: { id },
        data: { isActive: false, archivedAt, archivedBy: actor },
      });
      return { room: { ...room, archivedAt }, changed: true };
    });
    if (result.changed) {
      await this.prisma.writeAuditLog({
        tenantId,
        entity: 'room',
        entityId: id,
        action: 'archive',
        diff: {
          before: { number: result.room.number, isActive: result.room.isActive, archivedAt: null },
          after: { isActive: false, archivedAt: result.room.archivedAt },
        },
      });
    }
    return { ok: true, archivedAt: result.room.archivedAt };
  }

  /**
   * Удаление «в архив» пачкой (28.10.2026). Правило то же, что у `archive`:
   * номер с действующей бронью не трогаем. Отличий два:
   * - результат частичный: удаляем, что можно, остальное называем с числом
   *   броней — падать целиком из-за двух номеров значило бы заставить снимать
   *   с них галочки и пробовать снова;
   * - запись журнала одна на пачку: журнал гостиницы виден оператору в её
   *   истории, и сорок строк «номер удалён» вытеснили бы из неё всё прочее.
   *   Кто и когда удалил каждый номер, записано в нём самом.
   * Удалённый раньше номер не правится и в журнал не идёт, но в ответе он
   * среди удалённых: повтор безвреден, как у одного номера.
   */
  async archiveMany(ids: string[]) {
    const tenantId = TenantContext.getTenantIdOrThrow();
    const actor = TenantContext.get()?.userId || null;
    const unique = [...new Set(ids)];
    const result = await this.prisma.forTenant(async (tx) => {
      const rooms = await tx.room.findMany({
        where: { id: { in: unique } },
        select: { id: true, number: true, archivedAt: true },
      });
      const live = await tx.reservation.groupBy({
        by: ['roomId'],
        where: {
          roomId: { in: rooms.map((r) => r.id) },
          status: { in: LIVE_RESERVATION_STATUSES },
        },
        _count: { _all: true },
      });
      const liveByRoom = new Map(live.map((g) => [g.roomId, g._count._all]));
      const fresh = rooms.filter((r) => !r.archivedAt && !liveByRoom.has(r.id));
      if (fresh.length) {
        await tx.room.updateMany({
          where: { id: { in: fresh.map((r) => r.id) }, archivedAt: null },
          data: { isActive: false, archivedAt: new Date(), archivedBy: actor },
        });
      }
      const found = new Set(rooms.map((r) => r.id));
      return {
        fresh: fresh.map((r) => r.number),
        archived: rooms
          .filter((r) => r.archivedAt || !liveByRoom.has(r.id))
          .map(({ id, number }) => ({ id, number })),
        blocked: rooms
          .filter((r) => !r.archivedAt && liveByRoom.has(r.id))
          .map((r) => ({ id: r.id, number: r.number, liveReservations: liveByRoom.get(r.id) ?? 0 })),
        notFound: unique.filter((id) => !found.has(id)),
      };
    });
    if (result.fresh.length) {
      await this.prisma.writeAuditLog({
        tenantId,
        entity: 'room',
        action: 'archive_many',
        diff: {
          before: {},
          after: { archived: result.fresh, blocked: result.blocked.map((r) => r.number) },
        },
      });
    }
    const { archived, blocked, notFound } = result;
    return { archived, blocked, notFound };
  }

  /**
   * Восстановление номера из архива: пометка снимается, номер снова включён
   * и виден в фонде, шахматке и продаже. Повторный вызов — тот же ответ.
   */
  async restore(id: string) {
    const tenantId = TenantContext.getTenantIdOrThrow();
    const result = await this.prisma.forTenant(async (tx) => {
      const room = await tx.room.findUnique({
        where: { id },
        select: {
          number: true,
          archivedAt: true,
          archivedBy: true,
          roomType: { select: { id: true, code: true, archivedAt: true } },
        },
      });
      if (!room) throw new NotFoundException('Номер не найден');
      if (!room.archivedAt) return { room, changed: false };
      /* Категория номера удалена (27.10.2026) — возвращаем и её: иначе номер
         восстановился бы вне номерного фонда (фонд показывает номера по живым
         категориям), а завести такой номер заново не даёт архивный тёзка.
         Код — прежний, если его не заняла новая категория. */
      if (room.roomType.archivedAt) {
        const original = room.roomType.code.replace(/~[0-9a-z]+$/, '');
        const taken = await tx.roomType.findFirst({
          where: { code: original, archivedAt: null },
          select: { id: true },
        });
        await tx.roomType.update({
          where: { id: room.roomType.id },
          data: {
            isActive: true,
            archivedAt: null,
            archivedBy: null,
            code: taken ? room.roomType.code : original,
          },
        });
      }
      await tx.room.update({
        where: { id },
        data: { isActive: true, archivedAt: null, archivedBy: null },
      });
      return { room, changed: true };
    });
    if (result.changed) {
      await this.prisma.writeAuditLog({
        tenantId,
        entity: 'room',
        entityId: id,
        action: 'restore',
        diff: {
          before: { number: result.room.number, archivedAt: result.room.archivedAt, archivedBy: result.room.archivedBy },
          after: {
            isActive: true,
            archivedAt: null,
            ...(result.room.roomType.archivedAt ? { roomTypeRestored: result.room.roomType.id } : {}),
          },
        },
      });
    }
    return { ok: true };
  }

  /**
   * Удаление номера — чтобы убирать лишние записи (дубли переноса из старой
   * системы, 24.10.2026: «61» и «61 (2)» — одна комната).
   *
   * Номер, на котором есть хоть одна бронь — действующая, прошлая или
   * отменённая, — НЕ удаляется: на брони держатся счёт, оплаты и отчёты, и
   * удаление оборвало бы их историю (в схеме это Restrict). Отказ — 409 со
   * словами, а не 500 от внешнего ключа: сперва брони переносят на другой
   * номер. Проверка и удаление — в одной транзакции, а внешний ключ ловит
   * бронь, заведённую между ними. Задачи уборки уходят вместе с номером
   * (каскад в схеме).
   *
   * В журнал пишется, каким номер был: восстановить его можно только по нему.
   *
   * Выключатель — `room-delete.switch.ts`: выключенное удаление отказывает
   * раньше любого обращения к базе.
   */
  async remove(id: string) {
    if (!roomDeleteSwitch.enabled) {
      throw new ForbiddenException('Удаление номеров пока выключено');
    }
    const tenantId = TenantContext.getTenantIdOrThrow();
    let before: Record<string, unknown>;
    try {
      before = await this.prisma.forTenant(async (tx) => {
        const room = await tx.room.findUnique({
          where: { id },
          select: {
            number: true,
            roomTypeId: true,
            floor: true,
            capacity: true,
            bedType: true,
            singleBeds: true,
            doubleBeds: true,
            sofas: true,
            extraBeds: true,
            view: true,
            status: true,
            isActive: true,
            partnerHold: true,
            notes: true,
          },
        });
        if (!room) throw new NotFoundException('Номер не найден');
        const reservations = await tx.reservation.count({ where: { roomId: id } });
        if (reservations > 0) throw hasReservations(room.number, reservations);
        await tx.room.delete({ where: { id } });
        return room;
      });
    } catch (e) {
      if (prismaErrorCode(e) === PRISMA_FOREIGN_KEY_VIOLATION) throw hasReservations();
      throw this.translatePrismaError(e);
    }
    await this.prisma.writeAuditLog({
      tenantId,
      entity: 'room',
      entityId: id,
      action: 'delete',
      diff: { before: { id, ...before }, after: {} },
    });
    return { ok: true };
  }

  private translatePrismaError(e: unknown, contextValue?: string): Error {
    switch (prismaErrorCode(e)) {
      case PRISMA_UNIQUE_VIOLATION:
        return new ConflictException(`Номер "${contextValue ?? '?'}" уже существует в этом отеле`);
      case PRISMA_RECORD_NOT_FOUND:
        return new NotFoundException('Номер не найден');
      default:
        return asError(e);
    }
  }
}

/** Отказ в удалении номера с бронями. Без числа — когда бронь поймал внешний ключ. */
function hasReservations(number?: string, count?: number): ConflictException {
  const which = number ? `Номер №${number}` : 'Номер';
  const what = count ? `${count} ${plural(count, 'бронь', 'брони', 'броней')}` : 'есть брони';
  return new ConflictException(
    `${which} нельзя удалить: на нём ${what}, а на них держатся счёт и история. Перенесите брони на другой номер, затем удалите.`,
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
