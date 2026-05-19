import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateRoomTypeDto } from './dto/create-room-type.dto';
import { UpdateRoomTypeDto } from './dto/update-room-type.dto';

@Injectable()
export class RoomTypesService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    return this.prisma.forTenant((tx) =>
      tx.roomType.findMany({
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: { _count: { select: { rooms: true } } },
      }),
    );
  }

  async get(id: string) {
    const rt = await this.prisma.forTenant((tx) =>
      tx.roomType.findUnique({
        where: { id },
        include: { _count: { select: { rooms: true } } },
      }),
    );
    if (!rt) throw new NotFoundException(`RoomType ${id} not found`);
    return rt;
  }

  async create(dto: CreateRoomTypeDto) {
    this.assertOccupancyConsistent(dto.baseOccupancy, dto.maxOccupancy);
    try {
      return await this.prisma.forTenant((tx) =>
        tx.roomType.create({
          data: {
            tenantId: this.currentTenantId(),
            code: dto.code,
            name: dto.name,
            description: dto.description ?? null,
            baseOccupancy: dto.baseOccupancy ?? 2,
            maxOccupancy: dto.maxOccupancy ?? dto.baseOccupancy ?? 2,
            extraBeds: dto.extraBeds ?? 0,
            basePrice: dto.basePrice ?? 0,
            sortOrder: dto.sortOrder ?? 0,
            isActive: dto.isActive ?? true,
          },
        }),
      );
    } catch (e) {
      throw this.translatePrismaError(e, dto.code);
    }
  }

  async update(id: string, dto: UpdateRoomTypeDto) {
    if (dto.baseOccupancy != null || dto.maxOccupancy != null) {
      const existing = await this.get(id);
      this.assertOccupancyConsistent(
        dto.baseOccupancy ?? existing.baseOccupancy,
        dto.maxOccupancy ?? existing.maxOccupancy,
      );
    }
    try {
      return await this.prisma.forTenant((tx) =>
        tx.roomType.update({
          where: { id },
          data: {
            code: dto.code ?? undefined,
            name: dto.name ?? undefined,
            description: dto.description === undefined ? undefined : dto.description,
            baseOccupancy: dto.baseOccupancy ?? undefined,
            maxOccupancy: dto.maxOccupancy ?? undefined,
            extraBeds: dto.extraBeds ?? undefined,
            basePrice: dto.basePrice ?? undefined,
            sortOrder: dto.sortOrder ?? undefined,
            isActive: dto.isActive ?? undefined,
          },
        }),
      );
    } catch (e) {
      throw this.translatePrismaError(e, dto.code);
    }
  }

  async remove(id: string) {
    // Soft requirement: can't delete a category that still has rooms.
    const existing = await this.prisma.forTenant((tx) =>
      tx.roomType.findUnique({ where: { id }, include: { _count: { select: { rooms: true } } } }),
    );
    if (!existing) throw new NotFoundException(`RoomType ${id} not found`);
    if (existing._count.rooms > 0) {
      throw new ConflictException(
        `Нельзя удалить категорию: к ней привязаны ${existing._count.rooms} номеров. Сначала удалите номера или перенесите их в другую категорию.`,
      );
    }
    await this.prisma.forTenant((tx) => tx.roomType.delete({ where: { id } }));
    return { ok: true };
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private assertOccupancyConsistent(baseOccupancy?: number, maxOccupancy?: number) {
    if (baseOccupancy != null && maxOccupancy != null && maxOccupancy < baseOccupancy) {
      throw new BadRequestException('maxOccupancy не может быть меньше baseOccupancy');
    }
  }

  private currentTenantId(): string {
    // PrismaService.forTenant has already validated the GUC; this is only used
    // to populate the foreign-key column on the row itself.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { TenantContext } = require('../../common/context/tenant-context');
    return TenantContext.getTenantIdOrThrow();
  }

  private translatePrismaError(e: unknown, code?: string): Error {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2002') {
        return new ConflictException(
          `Категория с кодом "${code ?? '?'}" уже существует в этом отеле`,
        );
      }
      if (e.code === 'P2025') {
        return new NotFoundException('Категория не найдена');
      }
    }
    return e instanceof Error ? e : new Error(String(e));
  }
}
