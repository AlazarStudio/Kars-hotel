import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { RoomPartnerHold, RoomStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  PRISMA_RECORD_NOT_FOUND,
  PRISMA_UNIQUE_VIOLATION,
  asError,
  prismaErrorCode,
} from '../../common/prisma/prisma-error';
import { TenantContext } from '../../common/context/tenant-context';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { CreateManyRoomsDto } from './dto/create-many-rooms.dto';

export interface ListRoomsFilter {
  roomTypeId?: string;
  floor?: number;
  status?: RoomStatus;
  isActive?: boolean;
  /** Д7 · поиск по номеру и заметке. */
  q?: string;
  /** Д4/Д7 · фильтр по договорному блоку: NONE | QUOTA | RESERVE. */
  partnerHold?: RoomPartnerHold;
}

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
        select: { number: true },
      }),
    );
    const taken = new Set(existing.map((r) => r.number));
    const skipped = numbers.filter((n) => taken.has(n));

    if (skipped.length && dto.skipExisting === false) {
      throw new ConflictException(
        `Уже существуют номера: ${skipped.join(', ')}`,
      );
    }
    const toCreate = numbers.filter((n) => !taken.has(n));
    if (!toCreate.length) {
      return { created: 0, skipped, rooms: [] as unknown[] };
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
              view: dto.view ?? 'NONE',
              status: dto.status ?? 'CLEAN',
              isActive: dto.isActive ?? true,
              capacity: dto.capacity ?? 1,
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
        after: { created: toCreate, skipped, roomTypeId: dto.roomTypeId },
      },
    });

    return { created: rooms.length, skipped, rooms };
  }

  async update(id: string, dto: UpdateRoomDto) {
    const tenantId = TenantContext.getTenantIdOrThrow();
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

  async remove(id: string) {
    const tenantId = TenantContext.getTenantIdOrThrow();
    try {
      await this.prisma.forTenant((tx) => tx.room.delete({ where: { id } }));
    } catch (e) {
      throw this.translatePrismaError(e);
    }
    await this.prisma.writeAuditLog({
      tenantId,
      entity: 'room',
      entityId: id,
      action: 'delete',
      diff: { before: { id }, after: {} },
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
