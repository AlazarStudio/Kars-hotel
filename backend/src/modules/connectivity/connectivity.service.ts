import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { OwnerInviteService } from '../auth/owner-invite.service';
import { PartnerPlanQuery, pickPartnerPlans } from '../rate-plans/partner-tariff-match';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext, RequestContext } from '../../common/context/tenant-context';
import { AuthService } from '../auth/auth.service';
import { AvailabilityService } from '../inventory/availability.service';
import {
  ReservationsService,
  type ReservationChannelContext,
} from '../reservations/reservations.service';
import { roomFits, type PlaceHolder } from '../reservations/room-places';
import { ConnectAvailabilityDto } from './dto/connect-availability.dto';
import { ConnectCreateReservationDto } from './dto/connect-create-reservation.dto';
import { ConnectUpdateReservationDto } from './dto/connect-update-reservation.dto';
import { ConnectReservationMealsDto } from './dto/connect-reservation-meals.dto';
import { ConnectRegisterHotelDto } from './dto/connect-register-hotel.dto';
import { ConnectContractPricesDto } from './dto/connect-contract-prices.dto';
import { ReviewCorporateTariffDto } from './dto/review-corporate-tariff.dto';
import { RatePlansService } from '../rate-plans/rate-plans.service';
import { slugifyHotelName } from '../auth/slug.util';
import { PartnerWebhookService } from './partner-webhook.service';

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
    private readonly ownerInvites: OwnerInviteService,
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
    private readonly reservations: ReservationsService,
    private readonly auth: AuthService,
    private readonly ratePlans: RatePlansService,
    private readonly partnerWebhooks: PartnerWebhookService,
  ) {}

  // ─── Catalog (cross-tenant) ────────────────────────────────────────────────

  /**
   * Каталог гостиниц.
   *
   * `includeProvisional` — показать и разовые, заведённые из сбойной заявки.
   * По умолчанию их НЕТ: диспетчер, размещающий экипаж планово, не должен
   * натыкаться на гостиницу, куда однажды ночью отвезли людей и с которой нет
   * договора. Просит их ровно один экран — проживание сбойной заявки.
   *
   * `includeHidden` — вместе со скрытыми (`partnerVisible=false`), а
   * `includeInactive` — с выключенными. Решение владельца Kars Avia
   * 22.10.2026, как в старой системе: скрытая — рабочая гостиница, которую
   * ещё не доделали; её видят диспетчеры, но не авиакомпании, а выключенную —
   * только администратор. Кому что показать, решает партнёр по правам своих
   * людей, поэтому здесь это просьба, а не отбор: признаки едут в карточке
   * (`partnerVisible`, `isActive`).
   */
  async listHotels(
    opts: { includeProvisional?: boolean; includeHidden?: boolean; includeInactive?: boolean } = {},
  ) {
    const tenants = await this.prisma.admin.tenant.findMany({
      /* В3 · partnerVisible скрывает отель из каталога, не выключая его самого:
       * «пока не берём заявки» не должно означать «сотрудники не могут войти». */
      where: {
        ...(opts.includeInactive ? {} : { isActive: true }),
        /* Удалённая «в архив» (25.10.2026) — не в каталоге и с includeInactive:
           выключенная — это «временно не работает», архивная — «удалена». */
        archivedAt: null,
        slug: { not: ConnectivityService.PLATFORM_SLUG },
        /* Разовая гостиница видимости в каталоге не имеет по определению
           (partnerVisible у неё выключен), поэтому она идёт своей веткой, а не
           «скрытой»: иначе `includeHidden` подмешивал бы разовые туда, где их
           не просили. */
        OR: [
          { provisional: false, ...(opts.includeHidden ? {} : { partnerVisible: true }) },
          ...(opts.includeProvisional ? [{ provisional: true }] : []),
        ],
      },
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

  /**
   * Регистрация гостиницы партнёром.
   *
   * Заводится ТОЛЬКО запись гостиницы: ни пользователей, ни ролей, ни
   * номерного фонда. Диспетчер сбойной заявки знает название, город и адрес —
   * требовать от него почту администратора и пароль посреди ночи значит не
   * дать поселить людей. Кабинет заводят потом, если с гостиницей заключат
   * договор; тогда же снимают признак `provisional`.
   *
   * По умолчанию гостиница разовая и в каталоге не показывается.
   */
  async registerHotel(dto: ConnectRegisterHotelDto) {
    const name = dto.name.trim();
    const slug = await this.resolveFreeSlug(name);
    const tenant = await this.prisma.admin.tenant.create({
      data: {
        slug,
        name,
        city: dto.city?.trim() || null,
        address: [dto.region?.trim(), dto.address?.trim()].filter(Boolean).join(', ') || null,
        phone: dto.phone?.trim() || null,
        airportCode: dto.airportCode?.trim().toUpperCase() || null,
        capacity: dto.capacity ?? null,
        provisional: dto.provisional ?? true,
        /* Разовая не предлагается в каталоге — это и есть смысл признака.
           Обычную (provisional: false) заводят видимой сразу. */
        partnerVisible: !(dto.provisional ?? true),
      },
    });
    this.logger.log(
      `Partner registered hotel «${tenant.name}» (${tenant.slug})` +
        `${tenant.provisional ? ' as provisional' : ''}`,
    );
    return { ...this.mapHotel(tenant), categoryCount: 0 };
  }

  /**
   * Снятие признака «разовая»: с гостиницей заключён договор.
   *
   * Разовую заводит диспетчер сбойной заявки — ночью, по телефону, без
   * договора. Дальше с ней либо больше никогда не работают, либо договор
   * заключают; второе и есть это событие. Гостиница перестаёт быть разовой и
   * появляется в общем каталоге: с этого момента её законно предлагать при
   * плановом размещении экипажа.
   *
   * Идемпотентно: повторный вызов на обычной гостинице — не ошибка, а тот же
   * ответ. Партнёр не должен помнить, снимал он признак или нет.
   *
   * Обратного метода нет намеренно: «сделать обычную гостиницу разовой» —
   * не событие предметной области, а способ незаметно убрать её из каталога.
   * Для этого есть `partnerVisible` в кабинете самой гостиницы.
   */
  async activateHotel(slug: string) {
    const tenant = await this.resolveTenant(slug);
    if (!tenant.provisional) {
      return { ...this.mapHotel(tenant), categoryCount: await this.countCategories(tenant.id) };
    }
    const updated = await this.prisma.admin.tenant.update({
      where: { id: tenant.id },
      data: { provisional: false, partnerVisible: true },
    });
    /* В журнал гостиницы: партнёр читает его через `/hotels/:slug/history`, и
       «почему эта гостиница вдруг в каталоге» должно иметь ответ. */
    await this.prisma.admin.auditLog.create({
      data: {
        tenantId: tenant.id,
        entity: 'tenant',
        entityId: tenant.id,
        action: 'activate',
        diff: { provisional: [true, false], partnerVisible: [tenant.partnerVisible, true] },
      },
    });
    this.logger.log(
      `Partner activated hotel «${updated.name}» (${updated.slug}): provisional → false`,
    );
    return { ...this.mapHotel(updated), categoryCount: await this.countCategories(tenant.id) };
  }

  /** Сколько активных категорий у гостиницы — как в каталоге. */
  private async countCategories(tenantId: string) {
    return this.prisma.admin.roomType.count({ where: { tenantId, isActive: true } });
  }

  /** Свободный slug под именем гостиницы: «Кавказ» → kavkaz, kavkaz-2, … */
  private async resolveFreeSlug(name: string): Promise<string> {
    const base = slugifyHotelName(name);
    for (let n = 1; n < 50; n++) {
      const candidate = n === 1 ? base : `${base}-${n}`;
      const taken = await this.prisma.admin.tenant.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });
      if (!taken) return candidate;
    }
    throw new ConflictException('Не удалось подобрать адрес для гостиницы');
  }

  /**
   * Partner SSO (Kars Avia dispatcher): mint a one-time entry code for the given
   * dispatcher (identified by email — their own PMS account is provisioned on
   * first use). With a hotel slug the link lands inside that hotel («от имени
   * <name>»); without — in the admin panel as the dispatcher. Single-use, 60 s.
   */
  async createSso(dispatcher: { email: string; fullName: string }, hotelSlug?: string) {
    let tenantId: string | null = null;
    if (hotelSlug) {
      const tenant = await this.resolveTenant(hotelSlug);
      tenantId = tenant.id;
    }
    const { code, expiresInSeconds } = await this.auth.createSsoCode(dispatcher, tenantId);
    this.logger.log(
      `Partner SSO code minted for ${dispatcher.email} → ${hotelSlug ?? 'platform'} (ttl ${expiresInSeconds}s)`,
    );
    return { code, expiresInSeconds };
  }

  async deactivateDispatcher(email: string) {
    return this.auth.deactivateDispatcher(email);
  }

  async getHotel(slug: string) {
    const tenant = await this.resolveTenant(slug, { allowInactive: true });
    const { roomTypes, ratePlans, standardRates, services } = await this.prisma.forTenantExplicit(
      tenant.id,
      async (tx) => {
        /* «Сколько таких номеров» — без удалённых в архив: архивный номер
           остаётся строкой, и карточка гостиницы у оператора не менялась бы
           после удаления номеров (жалоба 27.10.2026). */
        const roomTypes = await tx.roomType.findMany({
          where: { isActive: true, archivedAt: null },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          include: { _count: { select: { rooms: { where: { archivedAt: null } } } } },
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
        const services = await tx.partnerService.findMany({
          where: { isActive: true },
          orderBy: [{ group: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
        });
        return { roomTypes, ratePlans, standardRates, services };
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
      /* Б5/Е2/Е4 · питание и доп. услуги отдельными группами. Тарифные планы
       * отвечают за проживание, а обед и поздний выезд попадают в заявку
       * отдельными строками — партнёру нужно и то, и другое. */
      services: services.map((sv) => ({
        id: sv.id,
        group: sv.group,
        name: sv.name,
        // Рубли: перевод в копейки — на стороне Авиа, как и для остальных цен.
        priceNet: sv.priceNet != null ? Number(sv.priceNet) : null,
        vatRate: Number(sv.vatRate),
        onRequest: sv.onRequest,
      })),
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

  /**
   * НОМЕРНОЙ ФОНД гостиницы — статический список номеров.
   *
   * Зачем партнёру: в сбойной заявке диспетчер расселяет людей ПО НОМЕРАМ и
   * вводит номер руками. Без фонда он печатает «12» там, где в гостинице
   * «112», и отчёт с гостиничным счётом потом не сходится. Доступность на
   * даты этого не решает: она отвечает «сколько свободно по категориям», а
   * нужен сам перечень — номер, этаж, категория, вместимость.
   *
   * Отдаём ВСЕ активные номера, включая занятые: заселение в сбойной заявке
   * ведётся вручную и задним числом, и «занят сейчас» ничего не говорит о
   * ночи, которая уже прошла. Состояние уборки не отдаём вовсе — это
   * внутренняя кухня гостиницы.
   */
  async listRooms(slug: string) {
    const tenant = await this.resolveTenant(slug, { allowInactive: true });
    const rooms = await this.prisma.forTenantExplicit(tenant.id, (tx) =>
      tx.room.findMany({
        where: { isActive: true },
        orderBy: [{ floor: 'asc' }, { number: 'asc' }],
        include: { roomType: { select: { id: true, code: true, name: true } } },
      }),
    );
    return {
      hotel: { slug: tenant.slug, name: tenant.name },
      rooms: rooms.map((r) => ({
        id: r.id,
        number: r.number,
        floor: r.floor,
        capacity: r.capacity,
        bedType: r.bedType,
        // Кровати числами (27.10.2026); bedType — прежнее описание, для старых клиентов.
        singleBeds: r.singleBeds,
        doubleBeds: r.doubleBeds,
        sofas: r.sofas,
        extraBeds: r.extraBeds,
        categoryId: r.roomType?.id ?? null,
        categoryCode: r.roomType?.code ?? null,
        categoryName: r.roomType?.name ?? null,
      })),
    };
  }

  async availabilityFor(slug: string, dto: ConnectAvailabilityDto, partnerId: string) {
    const tenant = await this.resolveTenant(slug);
    const query = await this.partnerQuery(partnerId, dto);

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

      type OfferRatePlan = {
        ratePlanId: string;
        code: string | null;
        name: string;
        mealPlan: string;
        nights: number;
        perNight: Array<{ date: string; price: number | null }>;
        total: number | null;
        nightlyFrom: number | null;
        /** Тот самый корпоративный тариф — оператор платит по нему. */
        forOperator: boolean;
        /** НДС тарифа партнёра, %; цены тарифа партнёра — без НДС. */
        vatRate: number | null;
      };
      type OfferRoom = {
        id: string;
        number: string;
        floor: number;
        capacity: number;
        bedType: string;
        singleBeds: number;
        doubleBeds: number;
        sofas: number;
        extraBeds: number;
        view: string;
        available: boolean;
      };
      /* КОРПОРАТИВНЫЙ ТАРИФ РЕШАЕТ, ПО КАКОЙ ЦЕНЕ СПРАШИВАЕТ ОПЕРАТОР.
       *
       * Раньше «ценой предложения» была самая дешёвая из всех тарифов отеля.
       * Для витрины это разумно, для нас — нет: платим мы по договору, а не по
       * тому, что сегодня дешевле, и случайно дешёвый тариф выходного дня
       * показал бы оператору цену, по которой ему счёт не выставят.
       *
       * Подтверждённый корпоративный тариф становится ценой предложения.
       * Неподтверждённый из списка убирается совсем: предложить его значило бы
       * дать выбрать цену, которую никто не сверял, — а подтверждение ровно
       * для того и заведено. Причину оператор получает отдельным полем и
       * показывает диспетчеру, вместо того чтобы гадать, куда делся тариф. */
      /* Тарифы партнёра под ЭТОТ запрос (29.09.2026): самые точные из
         подходящих по юрлицу, заказчику и виду брони. Неподтверждённые не
         предлагаются, а называются — диспетчер должен знать, почему цена не
         договорная. Тарифы других партнёров и с другими условиями не
         показываются вовсе. */
      const chosen = pickPartnerPlans(await this.ratePlans.partnerPlans(partnerId), query);
      const applying = new Set(
        chosen.filter((p) => p.operatorStatus?.applies === true).map((p) => p.id),
      );
      const corporate = chosen[0] ?? null;
      const corporateApplies = applying.size > 0;

      const offers: Array<{
        categoryId: string;
        categoryName: string;
        capacity: number;
        roomsAvailable: number;
        nightlyRate: number;
        currency: string;
        ratePlans: OfferRatePlan[];
        rooms: OfferRoom[];
      }> = [];

      let nights = 0;
      for (const rt of targets) {
        if (dto.guests && rt.maxOccupancy < dto.guests) continue;

        const avail = await this.availability.check(rt.id, dto.checkIn, dto.checkOut);
        nights = avail.nights;
        if (!avail.days.length) continue;

        const roomsAvailable = Math.min(...avail.days.map((d) => d.available));
        if (roomsAvailable < 1 || !avail.bookable) continue;

        // Per-rate-plan offers (TravelLine-style): each plan gets a per-night
        // breakdown + total via the shared resolution chain (override → season
        // → standard → basePrice).
        const planPrices = await this.availability.priceByPlan(
          rt.id,
          dto.checkIn,
          dto.checkOut,
          rt.basePrice as never,
          dto.guests,
        );
        const ratePlans: OfferRatePlan[] = planPrices
          // Свои тарифы отеля — всем; тариф партнёра — только выбранный и подтверждённый.
          .filter((p) => p.partnerId == null || applying.has(p.ratePlanId))
          .map((p) => ({
            ratePlanId: p.ratePlanId,
            code: p.code,
            name: p.name,
            mealPlan: p.mealPlan,
            nights: p.nights,
            perNight: p.perNight.map((n) => ({
              date: n.date,
              price: n.price != null ? Number(n.price) : null,
            })),
            total: p.total != null ? Number(p.total) : null,
            nightlyFrom: p.nightlyFrom != null ? Number(p.nightlyFrom) : null,
            forOperator: applying.has(p.ratePlanId),
            vatRate: p.vatRate != null ? Number(p.vatRate) : null,
          }));

        // Back-compat nightly rate: cheapest plan's nightly, else cheapest
        // configured rate on the first night, else the category base price.
        const corporateNightly = corporateApplies
          ? (ratePlans.find((p) => p.forOperator)?.nightlyFrom ?? null)
          : null;
        const cheapestPlanNightly = ratePlans
          .map((p) => p.nightlyFrom)
          .filter((n): n is number => n != null)
          .reduce<number | null>((min, n) => (min === null || n < min ? n : min), null);
        const firstNight = avail.days[0];
        const nightlyRate =
          corporateNightly ??
          cheapestPlanNightly ??
          (firstNight.minPrice != null ? Number(firstNight.minPrice) : Number(rt.basePrice));

        // Physical rooms of this category, each with its parameters and whether
        // it is free for the whole stay — so the partner's dispatcher can pick a
        // specific room and see occupied ones up-front (not at booking time).
        const rooms = await this.listRoomsForCategory(tenant.id, rt.id, dto.checkIn, dto.checkOut);

        offers.push({
          categoryId: rt.id,
          categoryName: rt.name,
          capacity: rt.maxOccupancy,
          roomsAvailable,
          nightlyRate,
          currency: tenant.currency,
          ratePlans,
          rooms,
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
        /* Почему предложение выглядит так. Убрать тариф молча значило бы
           оставить диспетчера гадать, отчего цена не договорная. */
        corporateTariff: corporate
          ? {
              ratePlanId: corporate.id,
              name: corporate.name,
              state: corporate.operatorStatus?.state ?? 'DRAFT',
              applies: corporateApplies,
              reason: corporate.operatorStatus?.reason ?? '',
              /* Все тарифы, выбранные под условия запроса (разное питание). */
              plans: chosen.map((p) => ({
                ratePlanId: p.id,
                name: p.name,
                mealPlan: p.mealPlan,
                state: p.operatorStatus?.state ?? 'DRAFT',
                applies: p.operatorStatus?.applies === true,
                reason: p.operatorStatus?.reason ?? '',
              })),
            }
          : null,
      };
    });
  }

  // ─── Reservations (tenant-scoped) ──────────────────────────────────────────

  async createReservation(
    slug: string,
    dto: ConnectCreateReservationDto,
    partnerId: string,
    idempotencyKey?: string | string[],
  ) {
    const channel: ReservationChannelContext = { partnerId };
    if (idempotencyKey !== undefined) {
      if (
        typeof idempotencyKey !== 'string' ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(idempotencyKey)
      ) {
        throw new BadRequestException(
          'X-Idempotency-Key must be a 1–200 character ASCII token (letters, digits, . _ : -)',
        );
      }
      // DTO содержит только скалярные поля: порядок ключей JSON не меняет запрос.
      const original = JSON.stringify(
        Object.fromEntries(Object.entries(dto).sort(([a], [b]) => a.localeCompare(b))),
      );
      channel.idempotency = {
        key: idempotencyKey,
        payloadHash: createHash('sha256').update(original).digest('hex'),
      };
    }
    const tenant = await this.resolveTenant(slug);

    return this.runAsTenant(tenant.id, async () => {
      if (channel.idempotency) {
        const replay = await this.reservations.findChannelReservation(channel);
        if (replay) return { hotelId: tenant.id, slug: tenant.slug, ...replay };
      }
      const query = await this.partnerQuery(partnerId, dto);
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

      // Resolve the rate plan and price the stay so the reservation carries a
      // total. The partner picks a specific plan (TravelLine-style); we price it
      // via the same resolution chain used for availability.
      let ratePlanId: string | undefined;
      let totalPrice: number | undefined;
      /* Корпоративный тариф брони (29.09.2026) — только подходящий условиям и
         подтверждённый. Раньше проходил любой тариф по id, и партнёр мог
         забронировать по неподтверждённому или чужому. Без тарифа в запросе —
         берётся подходящий сам, если он один. */
      const chosen = pickPartnerPlans(await this.ratePlans.partnerPlans(partnerId), query);
      const planPrices = await this.availability.priceByPlan(
        dto.categoryId,
        dto.checkIn,
        dto.checkOut,
        category.basePrice as never,
        guests,
      );
      /* Сам — только тариф, в котором ЕСТЬ цена на эту категорию и этих
         гостей (30.09.2026, Э12). Раньше брался единственный подходящий и
         бронь падала «в тарифе нет цены»: наличие его не предлагало, и
         партнёр честно бронировал без тарифа, а мы подставляли его сами. */
      const priced = new Set(planPrices.filter((p) => p.total != null).map((p) => p.ratePlanId));
      const applying = chosen.filter((p) => p.operatorStatus?.applies === true && priced.has(p.id));
      let planIdToUse = dto.ratePlanId;
      if (!planIdToUse && applying.length === 1) planIdToUse = applying[0].id;
      if (!planIdToUse && applying.length > 1) {
        throw new ConflictException(
          `Под эти условия подходит несколько тарифов (${applying.map((p) => p.name).join(', ')}) — укажите ratePlanId`,
        );
      }
      if (planIdToUse) {
        const plan = await this.prisma.forTenantExplicit(tenant.id, (tx) =>
          tx.ratePlan.findUnique({ where: { id: planIdToUse } }),
        );
        if (!plan || !plan.isActive) {
          throw new NotFoundException(`Rate plan ${planIdToUse} not found in hotel ${slug}`);
        }
        if (plan.partnerId) {
          const mine = chosen.find((p) => p.id === plan.id);
          if (plan.partnerId !== partnerId || !mine) {
            throw new ConflictException('Этот корпоративный тариф не для этих условий брони');
          }
          if (mine.operatorStatus?.applies !== true) {
            throw new ConflictException(
              `Корпоративный тариф «${plan.name}» не подтверждён: ${mine.operatorStatus?.reason ?? ''}`.trim(),
            );
          }
        }
        ratePlanId = plan.id;
        const match = planPrices.find((p) => p.ratePlanId === plan.id);
        if (!match || match.total == null) {
          throw new ConflictException(
            `Тариф «${plan.name}» не считается на эти даты и число гостей — в нём нет цены`,
          );
        }
        totalPrice = match.total != null ? Number(match.total) : undefined;
      }

      // Partner pinned a specific room → validate it belongs to the category and
      // still has a free place; otherwise auto-assign any free room (back-compat).
      let roomId: string | null;
      if (dto.roomId) {
        roomId = await this.resolvePinnedRoom(
          tenant.id,
          dto.roomId,
          dto.categoryId,
          dto.checkIn,
          dto.checkOut,
          (dto.adults ?? 1) + ((dto as { children?: number }).children ?? 0),
        );
      } else {
        roomId = await this.pickAvailableRoom(
          tenant.id,
          dto.categoryId,
          dto.checkIn,
          dto.checkOut,
          (dto.adults ?? 1) + ((dto as { children?: number }).children ?? 0),
        );
      }
      if (!roomId) {
        throw new ConflictException('No room available in this category for the selected dates');
      }

      const notes = [dto.comment, dto.operatorRef ? `[ref:${dto.operatorRef}]` : null]
        .filter(Boolean)
        .join(' ');

      const created = await this.reservations.create(
        {
          roomId,
          guestName: dto.guestName,
          phone: dto.phone,
          email: dto.email,
          checkIn: dto.checkIn,
          checkOut: dto.checkOut,
          adults: dto.adults,
          children: dto.children ?? 0,
          status: 'CONFIRMED',
          source: 'CORPORATE',
          // Owned by the partner channel — hotel staff can view but not cancel it
          // locally; only this connectivity API can release it (see cancel below).
          channelManaged: true,
          guestKind: dto.guestKind,
          notes: notes || undefined,
          ratePlanId,
          totalPrice,
        },
        // Прилёт и отъезд по заявке и рейс — их ведёт партнёр (stay-times.ts).
        { arrivalAt: dto.arrivalAt, departureAt: dto.departureAt, flight: dto.flight },
        channel,
      );

      this.logger.log(
        `Partner reservation created in hotel ${slug}: ${created.id} (ref=${dto.operatorRef ?? '-'})`,
      );
      return { hotelId: tenant.id, slug: tenant.slug, ...created };
    }).catch(async (error: unknown) => {
      // Первый запрос мог закоммититься между ранним lookup и availability.
      // Его занятый номер не должен превращать параллельный повтор в отказ.
      if (channel.idempotency) {
        const replay = await this.runAsTenant(tenant.id, () =>
          this.reservations.findChannelReservation(channel),
        );
        if (replay) return { hotelId: tenant.id, slug: tenant.slug, ...replay };
      }
      throw error;
    });
  }

  /* ТОЛЬКО СВОИ БРОНИ (152-ФЗ, Р-35; план 13.10). RLS отсекает чужую
   * гостиницу, а внутри гостиницы партнёру видна только бронь, которую завёл
   * он сам: бронь гостиницы и бронь другого партнёра неотличимы от
   * несуществующей. Раньше по UUID читалась (и отменялась) любая. Через этот
   * метод идут и правка, и отмена, и питание, и факты. */
  async getReservation(slug: string, id: string, partnerId: string) {
    const tenant = await this.resolveTenant(slug);
    // Pull the room number so the partner can show which room was assigned.
    const row = await this.prisma.forTenantExplicit(tenant.id, (tx) =>
      tx.reservation.findUnique({
        where: { id },
        include: { room: { select: { number: true } } },
      }),
    );
    if (!row || !row.channelManaged || row.partnerId !== partnerId) {
      throw new NotFoundException(`Reservation ${id} not found in hotel ${slug}`);
    }
    return this.mapReservation(tenant, row);
  }

  /**
   * Правка брони партнёра: даты, номер, гость, число гостей, комментарий,
   * время прилёта и отъезда и рейс.
   *
   * ЗАЧЕМ. До этого у партнёра был один способ изменить бронь — отменить и
   * создать заново. Для смены фамилии члена экипажа или сдвига дат на сутки
   * это значит потерять номер: между отменой и новой бронью его может занять
   * кто угодно. Отсюда же в Авии стояло «перенести даты нельзя» и бронь
   * молча расходилась с заявкой.
   *
   * ВСЯ РАБОТА УЖЕ ЕСТЬ ВНУТРИ: `reservations.update` проверяет наложения,
   * свободные места в номере, принадлежность номера гостинице и поднимает
   * версию под замком. Здесь только граница: чья это бронь и можно ли её
   * трогать снаружи.
   *
   * ТРОГАТЬ МОЖНО ТОЛЬКО СВОИ БРОНИ. Гостиница заводит и свои — их партнёру
   * не сопоставить ни с одной заявкой, и править их снаружи он не вправе.
   * Признак тот же, по которому работает отмена: `channelManaged`.
   */
  async updateReservation(slug: string, id: string, dto: ConnectUpdateReservationDto, partnerId: string) {
    const tenant = await this.resolveTenant(slug);
    /* Заодно убеждаемся, что бронь принадлежит ЭТОЙ гостинице: RLS не пустит
       к чужой, и `getReservation` бросит «не найдено» раньше правки. */
    const before = await this.getReservation(slug, id, partnerId);

    const row = await this.prisma.forTenantExplicit(tenant.id, (tx) =>
      tx.reservation.findUnique({
        where: { id },
        select: { channelManaged: true, version: true },
      }),
    );
    if (!row?.channelManaged) {
      throw new ForbiddenException(
        `Reservation ${id} belongs to the hotel, not to the partner channel — it cannot be changed through this API`,
      );
    }

    await this.runAsTenant(tenant.id, () =>
      this.reservations.update(id, {
        // Версию партнёр может не знать — тогда работаем от текущей.
        version: dto.version ?? row.version,
        checkIn: dto.checkIn,
        checkOut: dto.checkOut,
        roomId: dto.roomId,
        guestName: dto.guestName,
        phone: dto.phone,
        email: dto.email,
        adults: dto.adults,
        children: dto.children,
        notes: dto.comment,
      } as never, {
        fromChannel: true,
        stay: { arrivalAt: dto.arrivalAt, departureAt: dto.departureAt, flight: dto.flight },
      }),
    );

    const after = await this.getReservation(slug, id, partnerId);
    this.logger.log(
      `Partner reservation updated in hotel ${slug}: ${id} (${before.checkIn}…${before.checkOut} → ${after.checkIn}…${after.checkOut})`,
    );
    /* «Бронь изменена» сообщает сама правка (`ReservationsService.update`) —
       и для правок гостиницы, и для правок партнёра, одним форматом. */
    return after;
  }

  /* ЗАЕЗД И ВЫЕЗД ОТ ПАРТНЁРА (26.10.2026, правка заказчика Kars Avia:
   * «отмечаем выезд в Эскадрилье, а потом ещё заходим в шахматку выселить» —
   * одна работа дважды).
   *
   * Время — партнёра: он отмечает, когда гость заехал или выехал. Будущее не
   * принимаем: выселить «на завтра» значит сегодня показать номер свободным, а
   * гость ещё в нём. Ждёт момента партнёр.
   *
   * Повтор — не ошибка: уже заселённого «заселить» и уже выселенного
   * «выселить» отвечают тем, что есть, — партнёр может прислать факт повторно
   * после сбоя связи. Выселить не заселённого нельзя: сначала заезд. */
  async recordStayFact(
    slug: string,
    id: string,
    partnerId: string,
    fact: 'CHECKED_IN' | 'CHECKED_OUT',
    atIso?: string,
  ) {
    const tenant = await this.resolveTenant(slug);
    const r = await this.getReservation(slug, id, partnerId);
    const at = atIso ? new Date(atIso) : new Date();
    if (at.getTime() > Date.now() + 5 * 60 * 1000) {
      throw new BadRequestException('Факт заезда или выезда не может быть в будущем');
    }
    const done = fact === 'CHECKED_IN' ? ['CHECKED_IN', 'CHECKED_OUT'] : ['CHECKED_OUT'];
    if (!done.includes(r.status)) {
      await this.runAsTenant(tenant.id, () => this.reservations.recordPartnerFact(id, fact, at));
    }
    return this.getFacts(slug, id, partnerId);
  }

  async cancelReservation(slug: string, id: string, partnerId: string, reason?: string) {
    const tenant = await this.resolveTenant(slug);
    // Только своя бронь партнёра: бронь гостиницы снаружи не отменить.
    await this.getReservation(slug, id, partnerId);
    // fromChannel: the partner owns this booking, so it is allowed to release it
    // even though hotel staff are blocked from cancelling channel-managed rows.
    return this.runAsTenant(tenant.id, () =>
      this.reservations.cancel(id, undefined as unknown as string, reason, { fromChannel: true }),
    );
  }

  /**
   * Заказ питания по дням у брони: полная замена раскладки.
   *
   * ЗАЧЕМ. Раньше питание жило только у оператора, а гостиница узнавала о нём
   * голосом или из комментария к брони свободным текстом — и считала дни
   * второй раз по-своему. Расхождение всплывало в акте, когда спорить поздно.
   *
   * ЗАМЕНА, А НЕ ДОПОЛНЕНИЕ. Раскладка у брони одна: оператор пересчитывает её
   * целиком всякий раз, когда меняются даты, число людей или набор приёмов.
   * Дописывание превратило бы её в ленту версий, по которой не понять, что
   * готовить.
   *
   * ДНИ ВНЕ ПЕРИОДА НЕ ПРИНИМАЕМ. Заказать завтрак на день, когда гость уже
   * уехал, нельзя — это не заказ, а ошибка счёта на стороне партнёра, и
   * молчаливо её принять значит однажды приготовить эти порции.
   */
  async setReservationMeals(
    slug: string,
    id: string,
    dto: ConnectReservationMealsDto,
    partnerId: string,
  ) {
    const tenant = await this.resolveTenant(slug);
    const reservation = await this.getReservation(slug, id, partnerId);

    const from = reservation.checkIn;
    const to = reservation.checkOut;
    const outside = dto.days
      .map((d) => d.date.slice(0, 10))
      .filter((day) => day < from || day > to);
    if (outside.length) {
      throw new ConflictException(
        `Meal days outside the stay ${from}…${to}: ${outside.join(', ')}`,
      );
    }
    /* Один день — одна строка. Дубль в присланном наборе означает, что у
       партнёра разъехался расчёт: принять и «последний побеждает» — значит
       спрятать его ошибку до самого счёта. */
    const seen = new Set<string>();
    for (const d of dto.days) {
      const day = d.date.slice(0, 10);
      if (seen.has(day)) {
        throw new ConflictException(`Duplicate meal day ${day}`);
      }
      seen.add(day);
    }

    await this.prisma.forTenantExplicit(tenant.id, async (tx) => {
      await tx.reservationMealDay.deleteMany({ where: { reservationId: id } });
      /* Дни без единой порции не храним: «ноль завтраков» и «завтрака нет» —
         одно и то же, а строка-ноль заставила бы гостиницу их различать. */
      const rows = dto.days
        .filter((d) => d.breakfast + d.lunch + d.dinner > 0)
        .map((d) => ({
          tenantId: tenant.id,
          reservationId: id,
          date: new Date(`${d.date.slice(0, 10)}T00:00:00.000Z`),
          breakfast: d.breakfast,
          lunch: d.lunch,
          dinner: d.dinner,
        }));
      if (rows.length) await tx.reservationMealDay.createMany({ data: rows });
    });

    this.logger.log(
      `Partner meals set for reservation ${id} in hotel ${slug}: ${dto.days.length} day(s)`,
    );
    return this.getReservationMeals(slug, id, partnerId);
  }

  /** Раскладка питания брони — то, что гостиница готовит по дням. */
  async getReservationMeals(slug: string, id: string, partnerId: string) {
    const tenant = await this.resolveTenant(slug);
    await this.getReservation(slug, id, partnerId);
    const rows = await this.prisma.forTenantExplicit(tenant.id, (tx) =>
      tx.reservationMealDay.findMany({
        where: { reservationId: id },
        orderBy: { date: 'asc' },
      }),
    );
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
  }

  /** Stay facts for reconciliation on the partner side. */
  async getFacts(slug: string, id: string, partnerId: string) {
    const r = await this.getReservation(slug, id, partnerId);
    const arrived = r.status === 'CHECKED_IN' || r.status === 'CHECKED_OUT';
    const guestsBooked = r.adults + r.children;
    return {
      reservationId: r.id,
      status: r.status,
      noShow: r.status === 'NO_SHOW',
      guestsBooked,
      guestsArrived: arrived ? guestsBooked : 0,
      // Фактическое время (Р-41), а не время последней правки брони.
      checkedInAt: arrived ? r.checkedInAt : null,
      checkedOutAt: r.status === 'CHECKED_OUT' ? r.checkedOutAt : null,
    };
  }

  /* История изменений гостиницы для партнёра (перенос В7).
   *
   * У оператора есть свой журнал аудита, но событий PMS он не видит: отель
   * поменял тариф или выключил категорию — на стороне партнёра это выглядит
   * как «цены вдруг другие». Отдаём хвост нашего журнала по этому тенанту.
   *
   * Что НЕ отдаём: `diff` целиком, ip и user-agent. Партнёру нужен ответ на
   * вопрос «что и когда поменялось у отеля», а не операционная телеметрия
   * чужой системы; ip сотрудника отеля — вообще не его дело. Имя автора
   * отдаём: без него запись «тариф изменён» не с кем обсуждать.
   */
  /* КОРПОРАТИВНЫЙ ТАРИФ — обе стороны читают ОДИН расчёт.
   *
   * Соблазн — посчитать статус на стороне Авии: там и договор, и цены. Но
   * тогда «подтверждён» в кабинете гостиницы и «подтверждён» у оператора стали
   * бы двумя разными вычислениями, и однажды разошлись бы. Спорить о том, чей
   * экран прав, стороны договора не должны: считает тот, у кого тариф. */
  async getCorporateTariff(slug: string) {
    const tenant = await this.resolveTenant(slug);
    return this.runAsTenant(tenant.id, () => this.ratePlans.operatorTariff());
  }

  async reviewCorporateTariff(slug: string, dto: ReviewCorporateTariffDto, partnerId: string) {
    const tenant = await this.resolveTenant(slug);
    return this.runAsTenant(tenant.id, async () => {
      /* Решение — по ЛЮБОМУ действующему тарифу этого партнёра (29.09.2026):
         тарифов у гостиницы теперь несколько. Чужой тариф (другого партнёра
         или выключенный) — отказ: решение уехало бы на чужие цифры. */
      const mine = (await this.ratePlans.partnerPlans(partnerId)).find(
        (p) => p.id === dto.ratePlanId,
      );
      if (!mine) {
        throw new ConflictException(
          'Такого действующего корпоративного тарифа у гостиницы нет — откройте тарифы заново',
        );
      }
      return this.ratePlans.applyOperatorReview(mine.id, {
        verdict: dto.verdict,
        reviewedBy: dto.reviewedBy,
        seenFingerprint: dto.seenFingerprint,
        notes: dto.notes,
      });
    });
  }

  async getHotelHistory(slug: string, take = 50) {
    const tenant = await this.resolveTenant(slug);
    const rows = await this.prisma.admin.auditLog.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(take, 1), 200),
      include: { user: { select: { fullName: true } } },
    });
    return rows.map((r) => ({
      id: r.id,
      entity: r.entity,
      entityId: r.entityId,
      action: r.action,
      actorName: r.user?.fullName ?? null,
      occurredAt: r.createdAt.toISOString(),
    }));
  }

  /**
   * Э6 · Приём зеркала закупочных цен договора с оператором.
   *
   * Гостиница видит, по какой цене её посчитает оператор, и не ведёт вторую
   * копию: цена вводится один раз — в реестре договоров Авии. Здесь она
   * ТОЛЬКО ХРАНИТСЯ и показывается; править её в PMS нельзя, потому что
   * договор подписан двумя, и односторонняя правка снимка сделала бы его
   * ложью.
   *
   * Полная замена по документу: присланный набор строк заменяет предыдущий
   * целиком. Частичных правок нет намеренно — снимок, который дополняют по
   * кусочкам, разъезжается с оригиналом незаметно.
   *
   * Никакого пересчёта брони отсюда НЕ происходит: PMS считает по своим
   * тарифам, а корпоративный тариф для оператора гостиница заводит отдельно —
   * руками или «заполнить по договору», — и оператор его подтверждает.
   */
  async putContractPrices(slug: string, dto: ConnectContractPricesDto, partnerId: string) {
    const tenant = await this.resolveTenant(slug);
    const key = {
      tenantId: tenant.id,
      partnerId,
      contractNumber: dto.contractNumber,
      amendmentNumber: dto.amendmentNumber ?? null,
      service: dto.service,
      // Сезоны одного документа — разные листы (30.09.2026).
      validFrom: new Date(dto.validFrom),
    };
    const data = {
      ...key,
      validFrom: new Date(dto.validFrom),
      validTo: dto.validTo ? new Date(dto.validTo) : null,
      vatRate: dto.vatRate ?? null,
      accountCode: dto.account?.code ?? null,
      accountName: dto.account?.name ?? null,
      rows: dto.rows as unknown as Prisma.InputJsonValue,
      fill: (dto.fill ?? Prisma.DbNull) as unknown as Prisma.InputJsonValue,
      receivedAt: new Date(),
    };
    /* Не `upsert`: составной ключ содержит НУЛЛИРУЕМЫЙ номер ДС, а Prisma в
       compound-where null не принимает — приложение к самому договору (без
       ДС) через upsert не найти вовсе. Уникальность при этом обеспечена
       индексом с NULLS NOT DISTINCT, поэтому гонка двух зеркал упрётся в
       базу, а не создаст дубль. */
    const existing = await this.prisma.admin.partnerContractPrice.findFirst({
      where: key,
      select: { id: true },
    });
    if (existing) {
      await this.prisma.admin.partnerContractPrice.update({
        where: { id: existing.id },
        data,
      });
    } else {
      await this.prisma.admin.partnerContractPrice.create({ data });
    }
    return { ok: true as const };
  }

  /* СИНХРОНИЗАЦИЯ ЗЕРКАЛА: присланный набор — полная картина.
   *
   * Всё, чего в наборе нет, удаляется: у оператора этот документ перестал
   * действовать, и показывать его гостинице значит обещать цену, которой уже
   * нет. Раньше обратного хода не было вовсе.
   *
   * Одной транзакцией: между удалением лишнего и записью нового кабинет не
   * должен показывать полупустую картину — по ней как раз и спорят о деньгах. */
  async syncContractPrices(slug: string, documents: ConnectContractPricesDto[], partnerId: string) {
    const tenant = await this.resolveTenant(slug);
    /* Ключ документа — и день начала листа: у одного ДС бывает несколько
       сезонов, и без даты в ключе выживал последний (30.09.2026). */
    const dayOf = (v: string | Date) => new Date(v).toISOString().slice(0, 10);
    const keyOf = (d: {
      contractNumber: string;
      amendmentNumber?: string | null;
      service: string;
      validFrom: string | Date;
    }) => `${d.contractNumber}|${d.amendmentNumber ?? ''}|${d.service}|${dayOf(d.validFrom)}`;

    return this.prisma.admin.$transaction(async (tx) => {
      // Только документы ЭТОГО партнёра: набор одного не стирает договоры другого.
      const existing = await tx.partnerContractPrice.findMany({
        where: { tenantId: tenant.id, partnerId },
        select: {
          id: true,
          contractNumber: true,
          amendmentNumber: true,
          service: true,
          validFrom: true,
        },
      });
      const incoming = new Map(documents.map((d) => [keyOf(d), d]));

      const stale = existing.filter((e) => !incoming.has(keyOf(e)));
      if (stale.length) {
        await tx.partnerContractPrice.deleteMany({
          where: { id: { in: stale.map((e) => e.id) } },
        });
      }

      const byKey = new Map(existing.map((e) => [keyOf(e), e.id]));
      for (const [key, dto] of incoming) {
        const data = {
          tenantId: tenant.id,
          partnerId,
          contractNumber: dto.contractNumber,
          amendmentNumber: dto.amendmentNumber ?? null,
          service: dto.service,
          validFrom: new Date(dto.validFrom),
          validTo: dto.validTo ? new Date(dto.validTo) : null,
          vatRate: dto.vatRate ?? null,
          accountCode: dto.account?.code ?? null,
          accountName: dto.account?.name ?? null,
          rows: dto.rows as unknown as Prisma.InputJsonValue,
          fill: (dto.fill ?? Prisma.DbNull) as unknown as Prisma.InputJsonValue,
          receivedAt: new Date(),
        };
        const id = byKey.get(key);
        if (id) await tx.partnerContractPrice.update({ where: { id }, data });
        else await tx.partnerContractPrice.create({ data });
      }

      return { kept: incoming.size, removed: stale.length };
    });
  }

  /**
   * Цены договоров, присланные оператором, — для кабинета гостиницы.
   *
   * Свежие сверху: спорят обычно по последнему приложению. Отдаётся как есть,
   * без пересчёта: это чужой документ, и толковать его здесь не наше дело.
   */
  async listContractPrices(slug: string, partnerId: string) {
    const tenant = await this.resolveTenant(slug);
    const rows = await this.prisma.admin.partnerContractPrice.findMany({
      where: { tenantId: tenant.id, partnerId },
      orderBy: [{ validFrom: 'desc' }, { receivedAt: 'desc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      contractNumber: r.contractNumber,
      amendmentNumber: r.amendmentNumber,
      service: r.service,
      validFrom: r.validFrom.toISOString(),
      validTo: r.validTo?.toISOString() ?? null,
      vatRate: r.vatRate == null ? null : Number(r.vatRate),
      account: r.accountCode ? { code: r.accountCode, name: r.accountName ?? r.accountCode } : null,
      rows: r.rows,
      fill: r.fill ?? null,
      receivedAt: r.receivedAt.toISOString(),
    }));
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /** Resolve a hotel by slug across all tenants (admin client). */
  /* Условия запроса партнёра (29.09.2026): коды юрлица и заказчика — из его
   * справочника. Незнакомый код — как неназванный: тарифа под незнакомую
   * авиакомпанию у гостиницы быть не может, и подойдёт общий. */
  private async partnerQuery(
    partnerId: string,
    dto: { account?: string; customer?: string; guestKind?: 'CREW' | 'DISRUPTION' },
  ): Promise<PartnerPlanQuery> {
    const [account, customer] = await Promise.all([
      dto.account
        ? this.prisma.admin.partnerAccount.findUnique({
            where: { partnerId_code: { partnerId, code: dto.account } },
            select: { id: true, isActive: true },
          })
        : null,
      dto.customer
        ? this.prisma.admin.partnerCustomer.findUnique({
            where: { partnerId_code: { partnerId, code: dto.customer } },
            select: { id: true, isActive: true },
          })
        : null,
    ]);
    return {
      partnerId,
      accountId: account?.isActive ? account.id : null,
      customerId: customer?.isActive ? customer.id : null,
      guestKind: dto.guestKind ?? null,
    };
  }

  /* Э10 · кабинет гостиницы: ведёт ли она его сама, ждёт ли приглашение. */
  async cabinet(slug: string) {
    const tenant = await this.resolveTenant(slug);
    return this.ownerInvites.status(tenant.id);
  }

  /* Э10 · пригласить владельца. Ссылку партнёр собирает сам из своего адреса
     PMS (как для входа диспетчера): PMS отдаёт только одноразовый токен. */
  async inviteOwner(slug: string, dto: { email: string; fullName: string }, partnerId: string) {
    const tenant = await this.resolveTenant(slug);
    const invite = await this.ownerInvites.create(tenant.id, dto, partnerId);
    return { ...invite, cabinet: await this.ownerInvites.status(tenant.id) };
  }

  /** Ключ гостиницы к «Отчётам Kars Avia» (план 11.3). Приходит повторно —
   *  перезаписывается: ключ выводит партнёр, у него и правда. */
  async setReportsKey(slug: string, key: string, partnerId: string) {
    const tenant = await this.resolveTenant(slug);
    await this.prisma.admin.aviaReportsKey.upsert({
      where: { tenantId: tenant.id },
      create: { tenantId: tenant.id, key, partnerId },
      update: { key, partnerId },
    });
  }

  /** Все корпоративные тарифы партнёра у гостиницы — для его сверки. */
  async partnerTariffs(slug: string, partnerId: string) {
    const tenant = await this.resolveTenant(slug);
    return this.runAsTenant(tenant.id, () => this.ratePlans.partnerTariffs(partnerId));
  }

  private async resolveTenant(slug: string, opts: { allowInactive?: boolean } = {}) {
    if (slug === ConnectivityService.PLATFORM_SLUG) {
      throw new NotFoundException(`Hotel '${slug}' not found`);
    }
    const tenant = await this.prisma.admin.tenant.findUnique({ where: { slug } });
    /* Скрытую (`partnerVisible=false`) отдаём (решение владельца Kars Avia
     * 22.10.2026): это рабочая гостиница, которую ещё не доделали, —
     * диспетчеры селят в неё и доделывают карточку, не видят её только
     * авиакомпании. Это различие людей партнёра, а не гостиницы, поэтому
     * проводит его партнёр; раньше 404 здесь ломал заявки и договоры 98
     * перенесённых из старой системы гостиниц.
     *
     * Выключенную — только на чтение (`allowInactive`: карточка и номерной
     * фонд, их смотрит администратор): бронь и наличие мест в неё закрыты. */
    if (!tenant || (!tenant.isActive && !opts.allowInactive)) {
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

  /**
   * List the physical rooms in a category with their parameters and whether each
   * has a free place for the requested stay. Ordered floor then number so the
   * partner UI reads naturally.
   *
   * Свободен ли номер — ОДНИМ правилом мест (room-places.ts), тем же, что у
   * брони в кабинете гостиницы (23.10.2026). Раньше здесь складывали людей
   * всех броней, пересекающих период: двое, живущие на одном месте ДРУГ ЗА
   * ДРУГОМ (21–27 и 28.10–13.11), давали «2 из 2», и номер со свободным с 24-го
   * местом показывался занятым — диспетчер не мог в него поселить, хотя в
   * шахматке место пустое.
   */
  private async listRoomsForCategory(
    tenantId: string,
    roomTypeId: string,
    checkIn: string,
    checkOut: string,
  ): Promise<
    Array<{
      id: string;
      number: string;
      floor: number;
      capacity: number;
      bedType: string;
      singleBeds: number;
      doubleBeds: number;
      sofas: number;
      extraBeds: number;
      view: string;
      available: boolean;
      /** Д4 · держится ли номер за партнёром: NONE | QUOTA | RESERVE. */
      hold: string;
    }>
  > {
    return this.prisma.forTenantExplicit(tenantId, async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          number: string;
          floor: number;
          capacity: number;
          bed_type: string;
          single_beds: number;
          double_beds: number;
          sofas: number;
          extra_beds: number;
          view: string;
          partner_hold: string;
        }>
      >`
        SELECT r.id, r.number, r.floor, r.capacity, r.bed_type,
               r.single_beds, r.double_beds, r.sofas, r.extra_beds,
               r.view, r.partner_hold
        FROM room r
        WHERE r.room_type_id = ${roomTypeId}::uuid
          AND r.is_active = true
        ORDER BY r.floor ASC, r.number ASC
      `;
      const fits = await this.roomsFitByPlaces(tx, tenantId, rows, checkIn, checkOut, 1);
      return rows.map((r) => ({
        id: r.id,
        number: r.number,
        floor: r.floor,
        capacity: r.capacity,
        bedType: r.bed_type,
        singleBeds: r.single_beds,
        doubleBeds: r.double_beds,
        sofas: r.sofas,
        extraBeds: r.extra_beds,
        view: r.view,
        available: fits.get(r.id) === true,
        // Признак информационный: занятость считается одинаково для всех
        // номеров, блок лишь подсказывает диспетчеру, что номер «его».
        hold: r.partner_hold,
      }));
    });
  }

  /**
   * Validate a partner-pinned room: it must be active, belong to the requested
   * category, and still have a free place for the stay. Returns the room id when
   * bookable; throws a descriptive 404/409 otherwise so the partner sees why.
   */
  private async resolvePinnedRoom(
    tenantId: string,
    roomId: string,
    roomTypeId: string,
    checkIn: string,
    checkOut: string,
    /** Сколько людей в брони — при койко-местах столько мест и нужно. */
    guests = 1,
  ): Promise<string> {
    return this.prisma.forTenantExplicit(tenantId, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; room_type_id: string; capacity: number }>>`
        SELECT r.id, r.room_type_id, r.capacity
        FROM room r
        WHERE r.id = ${roomId}::uuid
          AND r.is_active = true
        LIMIT 1
      `;
      const room = rows[0];
      if (!room) throw new NotFoundException(`Room ${roomId} not found`);
      if (room.room_type_id !== roomTypeId) {
        throw new ConflictException('Chosen room does not belong to the requested category');
      }
      const fits = await this.roomsFitByPlaces(tx, tenantId, [room], checkIn, checkOut, guests);
      if (fits.get(room.id) !== true) {
        throw new ConflictException('Chosen room is no longer available for the selected dates');
      }
      return room.id;
    });
  }

  /** Pick the first active room in a category that has a free place for the period. */
  private async pickAvailableRoom(
    tenantId: string,
    roomTypeId: string,
    checkIn: string,
    checkOut: string,
    /** Сколько людей в брони — при койко-местах столько мест и нужно. */
    guests = 1,
  ): Promise<string | null> {
    return this.prisma.forTenantExplicit(tenantId, async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string; capacity: number }>>`
        SELECT r.id, r.capacity
        FROM room r
        WHERE r.room_type_id = ${roomTypeId}::uuid
          AND r.is_active = true
        ORDER BY r.number ASC
      `;
      const fits = await this.roomsFitByPlaces(tx, tenantId, rows, checkIn, checkOut, guests);
      return rows.find((r) => fits.get(r.id) === true)?.id ?? null;
    });
  }

  /* Какие из номеров примут бронь на `guests` человек на эти даты — правилом
     room-places.ts (roomFits): обычная гостиница — номер целиком, только если
     в нём никого; койко-места — нужно столько мест, ни одно из которых не
     занято НИ ОДНОЙ пересекающейся бронью. Брони — одним запросом на все
     номера. Выезд в день заезда не пересекается (check_out > check_in). */
  private async roomsFitByPlaces(
    tx: { $queryRaw: PrismaService['$queryRaw'] },
    tenantId: string,
    rooms: Array<{ id: string; capacity: number }>,
    checkIn: string,
    checkOut: string,
    guests: number,
  ): Promise<Map<string, boolean>> {
    const out = new Map<string, boolean>();
    if (rooms.length === 0) return out;
    const tenant = await this.prisma.admin.tenant.findUnique({
      where: { id: tenantId },
      select: { multiPlaceEnabled: true },
    });
    const multiPlace = tenant?.multiPlaceEnabled === true;
    const ids = rooms.map((r) => r.id);
    const res = await tx.$queryRaw<
      Array<{ room_id: string; place_number: number; adults: number; children: number | null }>
    >`
      SELECT res.room_id, res.place_number, res.adults, res.children
      FROM reservation res
      WHERE res.room_id = ANY(${ids}::uuid[])
        AND res.check_in  < ${checkOut}::date
        AND res.check_out > ${checkIn}::date
        AND res.status NOT IN ('CANCELLED', 'NO_SHOW')
    `;
    const byRoom = new Map<string, PlaceHolder[]>();
    for (const r of res) {
      const list = byRoom.get(r.room_id) ?? [];
      list.push({ placeNumber: r.place_number, adults: r.adults, children: r.children ?? 0 });
      byRoom.set(r.room_id, list);
    }
    for (const room of rooms) {
      out.set(
        room.id,
        roomFits({
          capacity: room.capacity,
          multiPlace,
          guests: { adults: Math.max(1, guests), children: 0 },
          others: byRoom.get(room.id) ?? [],
        }),
      );
    }
    return out;
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
    guestRating: number | null;
    capacity: number | null;
    airportCode: string | null;
    airportMinutes: number | null;
    mealBreakfast: string | null;
    mealLunch: string | null;
    mealDinner: string | null;
    infrastructure: unknown;
    provisional?: boolean;
    partnerVisible?: boolean;
    isActive?: boolean;
  }) {
    return {
      id: t.id,
      slug: t.slug,
      name: t.name,
      /* Разовая гостиница: заведена партнёром под конкретный случай, договора
         нет. Партнёр показывает её только там, где она и появилась. */
      provisional: t.provisional ?? false,
      /* Скрыта из общего каталога и выключена (22.10.2026): каталог и карточку
         партнёр получает и такими, кому их показать — решает он. */
      partnerVisible: t.partnerVisible ?? true,
      isActive: t.isActive ?? true,
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
      /* В2/В4 · профиль для каталога партнёра. Незаполненное отдаём как
       * отсутствующее (undefined), а не нулём: карточка опустит поле, а не
       * покажет «0 звёзд» и «0 мест» — выдуманное значение хуже пустого. */
      rating: t.guestRating ?? undefined,
      capacity: t.capacity ?? undefined,
      airportCode: t.airportCode ?? undefined,
      airportMinutes: t.airportMinutes ?? undefined,
      mealSchedule:
        t.mealBreakfast || t.mealLunch || t.mealDinner
          ? {
              breakfast: t.mealBreakfast ?? undefined,
              lunch: t.mealLunch ?? undefined,
              dinner: t.mealDinner ?? undefined,
            }
          : undefined,
      infrastructure: Array.isArray(t.infrastructure)
        ? (t.infrastructure as unknown[]).filter((x): x is string => typeof x === 'string')
        : undefined,
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
      checkedInAt?: Date | null;
      checkedOutAt?: Date | null;
      arrivalAt?: string | null;
      departureAt?: string | null;
      flight?: string | null;
      room?: { number: string } | null;
    },
  ) {
    return {
      id: r.id,
      hotelId: tenant.id,
      slug: tenant.slug,
      categoryId: r.roomTypeId,
      roomId: r.roomId,
      // Human room number assigned by the hotel, surfaced to the partner UI.
      roomNumber: r.room?.number ?? null,
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
      checkedInAt: r.checkedInAt ?? null,
      checkedOutAt: r.checkedOutAt ?? null,
      // Прилёт и отъезд по заявке и рейс — партнёр видит то, что прислал.
      arrivalAt: r.arrivalAt ?? null,
      departureAt: r.departureAt ?? null,
      flight: r.flight ?? null,
    };
  }
}
