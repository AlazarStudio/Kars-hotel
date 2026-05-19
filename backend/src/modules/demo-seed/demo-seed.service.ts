import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/context/tenant-context';
import { DEMO_CATEGORIES, DEMO_ROOMS } from './demo-data';

export interface DemoSeedResult {
  inserted: { roomTypes: number; rooms: number };
  hadExisting: boolean;
}

@Injectable()
export class DemoSeedService {
  private readonly logger = new Logger(DemoSeedService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Populate the current tenant with the legacy mock dataset (4 categories,
   * 21 rooms). Idempotent for empty tenants. Refuses to run on a tenant that
   * already has any room types or rooms — we don't want to mix demo data
   * with real production rooms.
   */
  async seed(): Promise<DemoSeedResult> {
    const tenantId = TenantContext.getTenantIdOrThrow();

    return this.prisma.forTenantExplicit(tenantId, async (tx) => {
      const [existingRoomTypes, existingRooms] = await Promise.all([
        tx.roomType.count(),
        tx.room.count(),
      ]);
      if (existingRoomTypes > 0 || existingRooms > 0) {
        throw new ConflictException(
          'У отеля уже есть номерной фонд. Демо-данные можно засеять только в пустой отель. ' +
            'Если хотите начать заново, удалите все номера и категории через UI.',
        );
      }

      // 1. Create room types — collect their ids by code.
      const typeIdByCode = new Map<string, string>();
      for (const cat of DEMO_CATEGORIES) {
        const rt = await tx.roomType.create({
          data: {
            tenantId,
            code: cat.code,
            name: cat.name,
            description: cat.description ?? null,
            baseOccupancy: cat.baseOccupancy,
            maxOccupancy: cat.maxOccupancy,
            basePrice: cat.basePrice,
            sortOrder: cat.sortOrder,
          },
        });
        typeIdByCode.set(cat.code, rt.id);
      }

      // 2. Create rooms.
      await tx.room.createMany({
        data: DEMO_ROOMS.map((r) => ({
          tenantId,
          roomTypeId: typeIdByCode.get(r.categoryCode)!,
          number: r.number,
          floor: r.floor,
          bedType: r.bedType,
          view: r.view ?? 'NONE',
          status: r.status,
        })),
      });

      // 3. Audit.
      await tx.auditLog.create({
        data: {
          tenantId,
          userId: TenantContext.get()?.userId,
          entity: 'demo-seed',
          action: 'run',
          diff: {
            roomTypes: DEMO_CATEGORIES.length,
            rooms: DEMO_ROOMS.length,
          },
        },
      });

      this.logger.log(
        `Demo seed for tenant=${tenantId}: ${DEMO_CATEGORIES.length} types, ${DEMO_ROOMS.length} rooms`,
      );

      return {
        inserted: { roomTypes: DEMO_CATEGORIES.length, rooms: DEMO_ROOMS.length },
        hadExisting: false,
      };
    });
  }

  /**
   * Wipe ALL rooms + room types for the current tenant. Used to "reset to demo".
   * Will fail in later phases once Reservations exist (FK constraints).
   */
  async reset(): Promise<{ deleted: { rooms: number; roomTypes: number } }> {
    const tenantId = TenantContext.getTenantIdOrThrow();
    return this.prisma.forTenantExplicit(tenantId, async (tx) => {
      const r = await tx.room.deleteMany({});
      const rt = await tx.roomType.deleteMany({});
      await tx.auditLog.create({
        data: {
          tenantId,
          userId: TenantContext.get()?.userId,
          entity: 'demo-seed',
          action: 'reset',
          diff: { deletedRooms: r.count, deletedRoomTypes: rt.count },
        },
      });
      return { deleted: { rooms: r.count, roomTypes: rt.count } };
    });
  }
}
