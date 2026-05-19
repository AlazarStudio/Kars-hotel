import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RoomStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/context/tenant-context';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';

export interface ListRoomsFilter {
  roomTypeId?: string;
  floor?: number;
  status?: RoomStatus;
  isActive?: boolean;
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

    try {
      return await this.prisma.forTenant((tx) =>
        tx.room.create({
          data: {
            tenantId: TenantContext.getTenantIdOrThrow(),
            roomTypeId: dto.roomTypeId,
            number: dto.number,
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
    } catch (e) {
      throw this.translatePrismaError(e, dto.number);
    }
  }

  async update(id: string, dto: UpdateRoomDto) {
    if (dto.roomTypeId) {
      const rt = await this.prisma.forTenant((tx) =>
        tx.roomType.findUnique({ where: { id: dto.roomTypeId }, select: { id: true } }),
      );
      if (!rt) throw new NotFoundException('Категория номера не найдена');
    }
    try {
      return await this.prisma.forTenant((tx) =>
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
            notes: dto.notes === undefined ? undefined : dto.notes,
          },
          include: { roomType: { select: { id: true, code: true, name: true } } },
        }),
      );
    } catch (e) {
      throw this.translatePrismaError(e, dto.number);
    }
  }

  async setStatus(id: string, status: RoomStatus) {
    try {
      return await this.prisma.forTenant((tx) =>
        tx.room.update({ where: { id }, data: { status } }),
      );
    } catch (e) {
      throw this.translatePrismaError(e);
    }
  }

  async remove(id: string) {
    try {
      await this.prisma.forTenant((tx) => tx.room.delete({ where: { id } }));
      return { ok: true };
    } catch (e) {
      throw this.translatePrismaError(e);
    }
  }

  private translatePrismaError(e: unknown, contextValue?: string): Error {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2002') {
        return new ConflictException(
          `Номер "${contextValue ?? '?'}" уже существует в этом отеле`,
        );
      }
      if (e.code === 'P2025') {
        return new NotFoundException('Номер не найден');
      }
    }
    return e instanceof Error ? e : new Error(String(e));
  }
}
