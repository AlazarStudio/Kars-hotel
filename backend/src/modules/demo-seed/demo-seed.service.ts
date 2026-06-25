import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/context/tenant-context';
import { DEMO_CATEGORIES, DEMO_PROFILE, DEMO_ROOMS } from './demo-data';

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
            photos: cat.photos ?? [],
          },
        });
        typeIdByCode.set(cat.code, rt.id);
      }

      // 1b. Populate the hotel profile (name/stars/address/contacts) that
      // partners read over the connectivity API. Without this a demo hotel
      // shows up with no stars/address downstream (e.g. in Kars Avia).
      // The tenant table is written via the admin (BYPASSRLS) client — same
      // as TenantService.updateSettings — because the runtime app_user role
      // is intentionally restricted on `tenant` (see B.2 RLS migration).
      await this.prisma.admin.tenant.update({
        where: { id: tenantId },
        data: DEMO_PROFILE,
      });

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
          capacity: r.capacity ?? 1,
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
   * Apply the demo PROFILE + category PHOTOS to a tenant that has ALREADY been
   * seeded (seed() refuses to run on a non-empty tenant). Idempotent: re-running
   * just re-applies the same values. Resolves the tenant by slug so it can be
   * driven from an admin script without owner credentials.
   *
   * Profile is written via the admin client (tenant table is RLS-restricted for
   * app_user). Category photos are matched by `code` and written through the
   * RLS-scoped tx so isolation still holds for room_type writes.
   */
  async enrichExisting(slug: string): Promise<{
    tenantId: string;
    profileUpdated: boolean;
    photosUpdated: number;
  }> {
    const tenant = await this.prisma.admin.tenant.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!tenant) {
      throw new ConflictException(`No tenant with slug="${slug}"`);
    }
    const tenantId = tenant.id;

    // 1. Hotel profile (admin — tenant table is RLS-restricted for app_user).
    await this.prisma.admin.tenant.update({
      where: { id: tenantId },
      data: DEMO_PROFILE,
    });

    // 2. Category photos, matched by code (RLS-scoped).
    const photosUpdated = await this.prisma.forTenantExplicit(tenantId, async (tx) => {
      let n = 0;
      for (const cat of DEMO_CATEGORIES) {
        const res = await tx.roomType.updateMany({
          where: { code: cat.code },
          data: { photos: cat.photos ?? [] },
        });
        n += res.count;
      }
      return n;
    });

    await this.prisma.writeAuditLog({
      tenantId,
      userId: TenantContext.get()?.userId,
      entity: 'demo-seed',
      action: 'enrich',
      diff: {
        before: {},
        after: { profile: true, photosUpdated },
      },
    });

    this.logger.log(
      `Demo enrich for tenant=${tenantId} (slug=${slug}): profile + ${photosUpdated} room-type photos`,
    );

    return { tenantId, profileUpdated: true, photosUpdated };
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
