import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext, RequestContext } from '../../common/context/tenant-context';
import { AvailabilityService } from '../inventory/availability.service';
import { ReservationsService } from '../reservations/reservations.service';
import { ConnectAvailabilityDto } from './dto/connect-availability.dto';
import { ConnectCreateReservationDto } from './dto/connect-create-reservation.dto';

/**
 * Cross-tenant connectivity service backing the partner API.
 *
 * Catalog reads (list/detail) use the admin (BYPASSRLS) client because they
 * span all hotels. Per-hotel reads/writes are routed through the same
 * tenant-isolated machinery the rest of the app uses — either
 * `PrismaService.forTenantExplicit` directly, or by establishing an
 * AsyncLocalStorage tenant context (`TenantContext.run`) so reused services
 * (AvailabilityService, ReservationsService) resolve the right tenant and stay
 * subject to RLS. A partner key can therefore never read or write outside the
 * hotel addressed in the request path.
 */
@Injectable()
export class ConnectivityService {
  private readonly logger = new Logger(ConnectivityService.name);

  /** The internal super-admin tenant — never exposed as a bookable hotel. */
  private static readonly PLATFORM_SLUG = 'platform';

  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
    private readonly reservations: ReservationsService,
  ) {}

  // ─── Catalog (cross-tenant) ────────────────────────────────────────────────

  async listHotels() {
    const tenants = await this.prisma.admin.tenant.findMany({
      where: { isActive: true, slug: { not: ConnectivityService.PLATFORM_SLUG } },
      orderBy: { name: 'asc' },
    });
    // The directory omits the full room-category list (it's only on the detail
    // endpoint), but partners need the per-hotel category count for their hotel
    // list. Aggregate it in one cross-tenant query (admin/BYPASSRLS) rather than
    // making the partner open every hotel just to count its categories.
    const counts = await this.prisma.admin.roomType.groupBy({
      by: ['tenantId'],
      where: { isActive: true, tenantId: { in: tenants.map((t) => t.id) } },
      _count: { _all: true },
    });
    const countByTenant = new Map(counts.map((c) => [c.tenantId, c._count._all]));
    return tenants.map((t) => ({
      ...this.mapHotel(t),
      categoryCount: countByTenant.get(t.id) ?? 0,
    }));
  }

  async getHotel(slug: string) {
    const tenant = await this.resolveTenant(slug);
    const { roomTypes, ratePlans, standardRates } = await this.prisma.forTenantExplicit(
      tenant.id,
      async (tx) => {
        const roomTypes = await tx.roomType.findMany({
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          include: { _count: { select: { rooms: true } } },
        });
        const ratePlans = await tx.ratePlan.findMany({
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        });
        const standardRates = ratePlans.length
          ? await tx.standardRate.findMany({
              where: { ratePlanId: { in: ratePlans.map((p) => p.id) } },
            })
          : [];
        return { roomTypes, ratePlans, standardRates };
      },
    );

    return {
      ...this.mapHotel(tenant),
      categoryCount: roomTypes.length,
      roomTypes: roomTypes.map((rt) => this.mapRoomType(rt)),
      // Published price list: one entry per active rate plan, with a baseline
      // price per category. The price is the plan's StandardRate when set,
      // otherwise the category base price — so partners always see a number.
      // Seasonal/daily overrides are date-specific and surface via availability.
      ratePlans: this.buildRatePlanPriceList(tenant.currency, roomTypes, ratePlans, standardRates),
    };
  }

  /** Flatten rate plans + standard prices into a partner-facing price list. */
  private buildRatePlanPriceList(
    currency: string,
    roomTypes: Array<{ id: string; name: string; basePrice: unknown }>,
    ratePlans: Array<{ id: string; code: string; name: string; mealPlan: string }>,
    standardRates: Array<{ ratePlanId: string; roomTypeId: string; price: unknown }>,
  ) {
    const stdByKey = new Map(
      standardRates.map((s) => [`${s.ratePlanId}|${s.roomTypeId}`, Number(s.price)]),
    );
    return ratePlans
      .map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        mealPlan: p.mealPlan,
        currency,
        prices: roomTypes
          .map((rt) => {
            const std = stdByKey.get(`${p.id}|${rt.id}`);
            const price = std ?? (rt.basePrice != null ? Number(rt.basePrice) : null);
            return price != null && price > 0
              ? { categoryId: rt.id, categoryName: rt.name, price }
              : null;
          })
          .filter(
            (x): x is { categoryId: string; categoryName: string; price: number } => x !== null,
          ),
      }))
      .filter((p) => p.prices.length > 0);
  }

  // ─── Availability (tenant-scoped) ──────────────────────────────────────────

  async availabilityFor(slug: string, dto: ConnectAvailabilityDto) {
    const tenant = await this.resolveTenant(slug);

    return this.runAsTenant(tenant.id, async () => {
      const roomTypes = await this.prisma.forTenantExplicit(tenant.id, (tx) =>
        tx.roomType.findMany({ where: { isActive: true } }),
      );

      const targets = dto.categoryId
        ? roomTypes.filter((rt) => rt.id === dto.categoryId)
        : roomTypes;

      if (dto.categoryId && !targets.length) {
        throw new NotFoundException(`Category ${dto.categoryId} not found in hotel ${slug}`);
      }

      const offers: Array<{
        categoryId: string;
        categoryName: string;
        capacity: number;
        roomsAvailable: number;
        nightlyRate: number;
        currency: string;
      }> = [];

      let nights = 0;
      for (const rt of targets) {
        if (dto.guests && rt.maxOccupancy < dto.guests) continue;

        const avail = await this.availability.check(rt.id, dto.checkIn, dto.checkOut);
        nights = avail.nights;
        if (!avail.days.length) continue;

        const roomsAvailable = Math.min(...avail.days.map((d) => d.available));
        if (roomsAvailable < 1 || !avail.bookable) continue;

        // Nightly rate: cheapest configured rate on the first night, else the
        // category base price (rates may not be configured for every hotel).
        const firstNight = avail.days[0];
        const nightlyRate =
          firstNight.minPrice != null ? Number(firstNight.minPrice) : Number(rt.basePrice);

        offers.push({
          categoryId: rt.id,
          categoryName: rt.name,
          capacity: rt.maxOccupancy,
          roomsAvailable,
          nightlyRate,
          currency: tenant.currency,
        });
      }

      return {
        hotelId: tenant.id,
        slug: tenant.slug,
        checkIn: dto.checkIn,
        checkOut: dto.checkOut,
        nights,
        currency: tenant.currency,
        offers,
      };
    });
  }

  // ─── Reservations (tenant-scoped) ──────────────────────────────────────────

  async createReservation(slug: string, dto: ConnectCreateReservationDto) {
    const tenant = await this.resolveTenant(slug);

    return this.runAsTenant(tenant.id, async () => {
      // Validate the category belongs to this hotel.
      const category = await this.prisma.forTenantExplicit(tenant.id, (tx) =>
        tx.roomType.findUnique({ where: { id: dto.categoryId } }),
      );
      if (!category || !category.isActive) {
        throw new NotFoundException(`Category ${dto.categoryId} not found in hotel ${slug}`);
      }

      const guests = dto.adults + (dto.children ?? 0);
      if (guests > category.maxOccupancy) {
        throw new ConflictException(
          `Category capacity is ${category.maxOccupancy}, requested ${guests} guests`,
        );
      }

      const roomId = await this.pickAvailableRoom(
        tenant.id,
        dto.categoryId,
        dto.checkIn,
        dto.checkOut,
      );
      if (!roomId) {
        throw new ConflictException('No room available in this category for the selected dates');
      }

      const notes = [dto.comment, dto.operatorRef ? `[ref:${dto.operatorRef}]` : null]
        .filter(Boolean)
        .join(' ');

      const created = await this.reservations.create({
        roomId,
        guestName: dto.guestName,
        phone: dto.phone,
        checkIn: dto.checkIn,
        checkOut: dto.checkOut,
        adults: dto.adults,
        children: dto.children ?? 0,
        status: 'CONFIRMED',
        source: 'CORPORATE',
        notes: notes || undefined,
      });

      this.logger.log(
        `Partner reservation created in hotel ${slug}: ${created.id} (ref=${dto.operatorRef ?? '-'})`,
      );
      return { hotelId: tenant.id, slug: tenant.slug, ...created };
    });
  }

  async getReservation(slug: string, id: string) {
    const tenant = await this.resolveTenant(slug);
    // RLS guarantees this only resolves if the reservation belongs to `tenant`.
    const row = await this.prisma.forTenantExplicit(tenant.id, (tx) =>
      tx.reservation.findUnique({ where: { id } }),
    );
    if (!row) throw new NotFoundException(`Reservation ${id} not found in hotel ${slug}`);
    return this.mapReservation(tenant, row);
  }

  async cancelReservation(slug: string, id: string, reason?: string) {
    const tenant = await this.resolveTenant(slug);
    // Ensure it belongs to this hotel before touching it.
    await this.getReservation(slug, id);
    return this.runAsTenant(tenant.id, () =>
      this.reservations.cancel(id, undefined as unknown as string, reason),
    );
  }

  /** Stay facts for reconciliation on the partner side. */
  async getFacts(slug: string, id: string) {
    const r = await this.getReservation(slug, id);
    const arrived = r.status === 'CHECKED_IN' || r.status === 'CHECKED_OUT';
    const guestsBooked = r.adults + r.children;
    return {
      reservationId: r.id,
      status: r.status,
      noShow: r.status === 'NO_SHOW',
      guestsBooked,
      guestsArrived: arrived ? guestsBooked : 0,
      checkedInAt: r.status === 'CHECKED_IN' || r.status === 'CHECKED_OUT' ? r.updatedAt : null,
      checkedOutAt: r.status === 'CHECKED_OUT' ? r.updatedAt : null,
    };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /** Resolve a hotel by slug across all tenants (admin client). */
  private async resolveTenant(slug: string) {
    if (slug === ConnectivityService.PLATFORM_SLUG) {
      throw new NotFoundException(`Hotel '${slug}' not found`);
    }
    const tenant = await this.prisma.admin.tenant.findUnique({ where: { slug } });
    if (!tenant || !tenant.isActive) {
      throw new NotFoundException(`Hotel '${slug}' not found`);
    }
    return tenant;
  }

  /**
   * Establish an AsyncLocalStorage tenant context so reused services resolve
   * the correct tenant and remain RLS-isolated. No real user — system actor.
   */
  private runAsTenant<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    const ctx: RequestContext = {
      tenantId,
      userId: '',
      roleCode: 'CHANNEL_MANAGER',
      permissions: [],
      isSuperAdmin: false,
    };
    return TenantContext.run(ctx, fn);
  }

  /** Pick the first active room in a category that has a free place for the period. */
  private async pickAvailableRoom(
    tenantId: string,
    roomTypeId: string,
    checkIn: string,
    checkOut: string,
  ): Promise<string | null> {
    return this.prisma.forTenantExplicit(tenantId, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT r.id
        FROM room r
        WHERE r.room_type_id = ${roomTypeId}::uuid
          AND r.is_active = true
          AND (
            SELECT COUNT(*) FROM reservation res
            WHERE res.room_id = r.id
              AND res.check_in  < ${checkOut}::date
              AND res.check_out > ${checkIn}::date
              AND res.status NOT IN ('CANCELLED', 'NO_SHOW')
          ) < r.capacity
        ORDER BY r.number ASC
        LIMIT 1
      `;
      return rows[0]?.id ?? null;
    });
  }

  private mapHotel(t: {
    id: string;
    slug: string;
    name: string;
    city: string | null;
    address: string | null;
    country: string;
    phone: string | null;
    email: string | null;
    website: string | null;
    stars: number | null;
    description: string | null;
    timezone: string;
    currency: string;
    checkInTime: string;
    checkOutTime: string;
    logoUrl: string | null;
    galleryPhotos: unknown;
  }) {
    return {
      id: t.id,
      slug: t.slug,
      name: t.name,
      city: t.city,
      address: t.address,
      country: t.country,
      phone: t.phone,
      email: t.email,
      website: t.website,
      stars: t.stars,
      description: t.description,
      timezone: t.timezone,
      currency: t.currency,
      checkInTime: t.checkInTime,
      checkOutTime: t.checkOutTime,
      logoUrl: t.logoUrl,
      // Hotel hero gallery shown as a slider on partner sites; first = cover.
      photos: Array.isArray(t.galleryPhotos)
        ? (t.galleryPhotos as unknown[]).filter((p): p is string => typeof p === 'string')
        : [],
    };
  }

  private mapRoomType(rt: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    baseOccupancy: number;
    maxOccupancy: number;
    extraBeds: number;
    basePrice: unknown;
    photos: unknown;
    _count?: { rooms: number };
  }) {
    return {
      id: rt.id,
      code: rt.code,
      name: rt.name,
      description: rt.description,
      baseOccupancy: rt.baseOccupancy,
      maxOccupancy: rt.maxOccupancy,
      extraBeds: rt.extraBeds,
      basePrice: Number(rt.basePrice),
      roomCount: rt._count?.rooms ?? undefined,
      photos: Array.isArray(rt.photos) ? rt.photos : [],
    };
  }

  private mapReservation(
    tenant: { id: string; slug: string; currency: string },
    r: {
      id: string;
      guestName: string;
      phone: string | null;
      roomId: string;
      roomTypeId: string;
      checkIn: Date;
      checkOut: Date;
      status: string;
      adults: number;
      children: number;
      totalPrice: unknown;
      placeNumber: number;
      version: number;
      notes: string | null;
      createdAt: Date;
      updatedAt: Date;
    },
  ) {
    return {
      id: r.id,
      hotelId: tenant.id,
      slug: tenant.slug,
      categoryId: r.roomTypeId,
      roomId: r.roomId,
      placeNumber: r.placeNumber,
      guestName: r.guestName,
      phone: r.phone,
      checkIn: r.checkIn.toISOString().slice(0, 10),
      checkOut: r.checkOut.toISOString().slice(0, 10),
      status: r.status,
      adults: r.adults,
      children: r.children,
      totalPrice: r.totalPrice != null ? Number(r.totalPrice) : null,
      currency: tenant.currency,
      version: r.version,
      notes: r.notes,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }
}
