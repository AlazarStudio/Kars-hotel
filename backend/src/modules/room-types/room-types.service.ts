import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  PRISMA_RECORD_NOT_FOUND,
  PRISMA_UNIQUE_VIOLATION,
  asError,
  prismaErrorCode,
} from '../../common/prisma/prisma-error';
import { StorageService, UploadedFile } from '../../common/storage/storage.service';
import { TenantContext } from '../../common/context/tenant-context';
import { CreateRoomTypeDto } from './dto/create-room-type.dto';
import { UpdateRoomTypeDto } from './dto/update-room-type.dto';

/* Число номеров категории — без удалённых «в архив» (25.10.2026). Архивный
   номер остаётся строкой и ссылкой на категорию; считай его — и пустая
   категория «не удаляется: привязаны 16 номеров», а каталог партнёра
   показывает номера, которых в гостинице больше нет. */
const LIVE_ROOMS_COUNT = {
  _count: { select: { rooms: { where: { archivedAt: null } } } },
} as const;

@Injectable()
export class RoomTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async list() {
    return this.prisma.forTenant((tx) =>
      tx.roomType.findMany({
        where: { archivedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: LIVE_ROOMS_COUNT,
      }),
    );
  }

  async get(id: string) {
    const rt = await this.prisma.forTenant((tx) =>
      tx.roomType.findUnique({
        where: { id },
        include: LIVE_ROOMS_COUNT,
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

  /* Удаление — «в архив», как у номера: строку не стираем (решение владельца
     25.10.2026), да и не смогли бы — на категорию ссылаются архивные номера.
     Архивная выключается (каталог партнёра и продажа берут только включённые)
     и скрывается из номерного фонда. Код освобождаем хвостом: иначе завести
     категорию с тем же кодом заново было бы нельзя, а архивной в кабинете не
     видно — человек упёрся бы в «код уже существует» без выхода. */
  async remove(id: string) {
    const tenantId = this.currentTenantId();
    const actor = TenantContext.get()?.userId || null;
    const existing = await this.prisma.forTenant((tx) =>
      tx.roomType.findUnique({ where: { id }, include: LIVE_ROOMS_COUNT }),
    );
    if (!existing) throw new NotFoundException(`RoomType ${id} not found`);
    if (existing.archivedAt) return { ok: true };
    if (existing._count.rooms > 0) {
      throw new ConflictException(
        `Нельзя удалить категорию: к ней привязаны ${existing._count.rooms} номеров. Сначала удалите номера или перенесите их в другую категорию.`,
      );
    }
    const archivedAt = new Date();
    const code = `${existing.code}~${archivedAt.getTime().toString(36)}`;
    await this.prisma.forTenant((tx) =>
      tx.roomType.update({
        where: { id },
        data: { isActive: false, archivedAt, archivedBy: actor, code },
      }),
    );
    await this.prisma.writeAuditLog({
      tenantId,
      entity: 'room_type',
      entityId: id,
      action: 'archive',
      diff: {
        before: { code: existing.code, name: existing.name, isActive: existing.isActive },
        after: { code, isActive: false, archivedAt },
      },
    });
    return { ok: true };
  }

  // ── photos ───────────────────────────────────────────────────────────────

  /** Upload one image, append its public URL to the category's photo list. */
  async addPhoto(id: string, file: UploadedFile): Promise<{ photos: string[] }> {
    const existing = await this.get(id);
    const url = await this.storage.uploadRoomTypePhoto(this.currentTenantId(), id, file);
    const photos = [...this.readPhotos(existing.photos), url];
    await this.persistPhotos(id, photos);
    return { photos };
  }

  /** Remove one photo by URL (also deletes the stored object, best-effort). */
  async removePhoto(id: string, url: string): Promise<{ photos: string[] }> {
    const existing = await this.get(id);
    const current = this.readPhotos(existing.photos);
    if (!current.includes(url)) {
      throw new NotFoundException('Это фото не найдено у категории');
    }
    const photos = current.filter((p) => p !== url);
    await this.persistPhotos(id, photos);
    await this.storage.deleteByUrl(url);
    return { photos };
  }

  /**
   * Replace the full ordered photo list (used for reorder / bulk remove).
   * Objects dropped from the list are deleted from storage, best-effort.
   */
  async setPhotos(id: string, photos: string[]): Promise<{ photos: string[] }> {
    const existing = await this.get(id);
    const before = this.readPhotos(existing.photos);
    const clean = photos.map((p) => String(p).trim()).filter(Boolean);
    await this.persistPhotos(id, clean);
    const removed = before.filter((p) => !clean.includes(p));
    await Promise.all(removed.map((url) => this.storage.deleteByUrl(url)));
    return { photos: clean };
  }

  private readPhotos(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((p): p is string => typeof p === 'string') : [];
  }

  private async persistPhotos(id: string, photos: string[]): Promise<void> {
    await this.prisma.forTenant((tx) => tx.roomType.update({ where: { id }, data: { photos } }));
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
    switch (prismaErrorCode(e)) {
      case PRISMA_UNIQUE_VIOLATION:
        return new ConflictException(
          `Категория с кодом "${code ?? '?'}" уже существует в этом отеле`,
        );
      case PRISMA_RECORD_NOT_FOUND:
        return new NotFoundException('Категория не найдена');
      default:
        return asError(e);
    }
  }
}
