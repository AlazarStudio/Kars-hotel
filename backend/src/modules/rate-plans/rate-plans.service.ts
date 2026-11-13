import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PartnerWebhookService } from '../connectivity/partner-webhook.service';
import { contractNightRub, contractVatRate } from '../contracts/contract-price';
import { ContractsService } from '../contracts/contracts.service';
import { PlanSliceSource } from '../contracts/slice';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { InventoryService } from '../inventory/inventory.service';
import {
  PRISMA_RECORD_NOT_FOUND,
  PRISMA_UNIQUE_VIOLATION,
  asError,
  prismaErrorCode,
} from '../../common/prisma/prisma-error';
import { TenantContext } from '../../common/context/tenant-context';
import { CreateRatePlanDto } from './dto/create-rate-plan.dto';
import { UpdateRatePlanDto } from './dto/update-rate-plan.dto';
import {
  ContractPriceDoc,
  PlanPriceRow,
  ReviewedPlan,
  TariffStatus,
  docsOfContract,
  documentsLabel,
  operatorTariffStatus,
  tariffFingerprint,
} from './operator-tariff-status';
import { mealTermsOf } from './meal-terms';

/* 5.3 · поля цены питания из формы: не пришло — не трогаем, пришло пустым —
   снимаем. Пустая строка «что входит» — тоже «не задано». */
function mealData(dto: {
  mealIncluded?: boolean;
  mealPriceBreakfast?: number | null;
  mealPriceLunch?: number | null;
  mealPriceDinner?: number | null;
  mealPricePerDay?: number | null;
  allInclusiveNote?: string | null;
}) {
  return {
    ...(dto.mealIncluded !== undefined ? { mealIncluded: dto.mealIncluded } : {}),
    ...(dto.mealPriceBreakfast !== undefined ? { mealPriceBreakfast: dto.mealPriceBreakfast } : {}),
    ...(dto.mealPriceLunch !== undefined ? { mealPriceLunch: dto.mealPriceLunch } : {}),
    ...(dto.mealPriceDinner !== undefined ? { mealPriceDinner: dto.mealPriceDinner } : {}),
    ...(dto.mealPricePerDay !== undefined ? { mealPricePerDay: dto.mealPricePerDay } : {}),
    ...(dto.allInclusiveNote !== undefined ? { allInclusiveNote: dto.allInclusiveNote?.trim() || null } : {}),
  };
}

@Injectable()
export class RatePlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly webhooks: PartnerWebhookService,
    private readonly redis: RedisService,
    /* Цены корпоративного тарифа живут в договоре (11.11.2026): срез тарифа и
       сетки документа читает модуль договоров, а не своя копия запроса здесь. */
    private readonly contracts: ContractsService,
  ) {}

  /* Состав, условия и активность тарифов входят в кеш цен предложения —
     после правки его сбросить, иначе минуту предлагается старое (Э12). */
  private dropPriceCache(): Promise<void> {
    return InventoryService.dropPriceCache(this.redis, TenantContext.getTenantIdOrThrow());
  }

  async list() {
    const plans = await this.prisma.forTenant((tx) =>
      tx.ratePlan.findMany({
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: {
          _count: { select: { rates: true } },
          parentRatePlan: { select: { id: true, code: true, name: true } },
        },
      }),
    );
    return this.withOperatorStatus(plans);
  }

  async get(id: string) {
    const rp = await this.prisma.forTenant((tx) =>
      tx.ratePlan.findUnique({
        where: { id },
        include: {
          _count: { select: { rates: true } },
          parentRatePlan: { select: { id: true, code: true, name: true } },
        },
      }),
    );
    if (!rp) throw new NotFoundException('Тариф не найден');
    return (await this.withOperatorStatus([rp]))[0];
  }

  async create(dto: CreateRatePlanDto) {
    const scope = await this.partnerScope(dto, null);
    this.assertOperatorPlanStandsAlone(scope.partnerId != null, dto.parentRatePlanId);
    await this.assertUniquePartnerScope(scope, dto.mealPlan ?? 'NONE', dto.isActive ?? true);
    try {
      const created = await this.prisma.forTenant((tx) =>
        tx.ratePlan.create({
          data: {
            tenantId: TenantContext.getTenantIdOrThrow(),
            code: dto.code,
            name: dto.name,
            description: dto.description ?? null,
            mealPlan: dto.mealPlan ?? 'NONE',
            ...mealData(dto),
            occupancyPricing: dto.occupancyPricing ?? false,
            parentRatePlanId: dto.parentRatePlanId ?? null,
            priceModifierType: dto.priceModifierType ?? 'PERCENT',
            priceModifierValue: dto.priceModifierValue ?? 0,
            cancellationPolicyId: dto.cancellationPolicyId ?? null,
            paymentPolicyId: dto.paymentPolicyId ?? null,
            sortOrder: dto.sortOrder ?? 0,
            isActive: dto.isActive ?? true,
            ...scope,
            forOperator: scope.partnerId != null,
            operatorContract: dto.operatorContract ?? null,
          },
          include: { parentRatePlan: { select: { id: true, code: true, name: true } } },
        }),
      );
      await this.dropPriceCache();
      return created;
    } catch (e) {
      throw this.translatePrismaError(e, dto.code);
    }
  }

  async update(id: string, dto: UpdateRatePlanDto) {
    if (dto.parentRatePlanId === id) {
      throw new ConflictException('Тариф не может быть родителем самого себя');
    }
    const before = await this.prisma.forTenant((tx) =>
      tx.ratePlan.findUnique({
        where: { id },
        select: {
          forOperator: true,
          parentRatePlanId: true,
          isActive: true,
          mealPlan: true,
          partnerId: true,
          partnerAccountId: true,
          partnerCustomerId: true,
          guestKind: true,
          vatRate: true,
        },
      }),
    );
    if (!before) throw new NotFoundException('Тариф не найден');
    const scope = await this.partnerScope(dto, before);
    this.assertOperatorPlanStandsAlone(
      scope.partnerId != null,
      dto.parentRatePlanId === undefined ? before.parentRatePlanId : dto.parentRatePlanId,
    );
    await this.assertUniquePartnerScope(
      scope,
      dto.mealPlan ?? before.mealPlan,
      dto.isActive ?? before.isActive,
      id,
    );
    try {
      const updated = await this.prisma.forTenant((tx) =>
        tx.ratePlan.update({
          where: { id },
          data: {
            code: dto.code ?? undefined,
            name: dto.name ?? undefined,
            description: dto.description === undefined ? undefined : dto.description,
            mealPlan: dto.mealPlan ?? undefined,
            ...mealData(dto),
            occupancyPricing: dto.occupancyPricing ?? undefined,
            parentRatePlanId: dto.parentRatePlanId === undefined ? undefined : dto.parentRatePlanId,
            priceModifierType: dto.priceModifierType ?? undefined,
            priceModifierValue: dto.priceModifierValue ?? undefined,
            cancellationPolicyId:
              dto.cancellationPolicyId === undefined ? undefined : dto.cancellationPolicyId,
            paymentPolicyId: dto.paymentPolicyId === undefined ? undefined : dto.paymentPolicyId,
            sortOrder: dto.sortOrder ?? undefined,
            isActive: dto.isActive ?? undefined,
            ...scope,
            forOperator: scope.partnerId != null,
            operatorContract:
              dto.operatorContract === undefined ? undefined : dto.operatorContract,
          },
        }),
      );
      await this.dropPriceCache();
      // Э9 · партнёру: условия его тарифа поменялись — сверка снова нужна.
      await this.webhooks.emitForRatePlan(id, 'conditions');
      return updated;
    } catch (e) {
      throw this.translatePrismaError(e, dto.code);
    }
  }

  async remove(id: string) {
    // Prisma cascades Rate rows; child rate plans get parentRatePlanId set to null (SetNull).
    try {
      const meta = await this.webhooks.planMeta(id);
      await this.prisma.forTenant((tx) => tx.ratePlan.delete({ where: { id } }));
      await this.dropPriceCache();
      // Э9 · партнёру: тарифа больше нет — брони по нему надо пересмотреть.
      await this.webhooks.emitTariffChanged(meta, 'removed');
      return { ok: true };
    } catch (e) {
      throw this.translatePrismaError(e);
    }
  }

  /** Действующие тарифы партнёра со статусом сверки — выбор тарифа для
   *  наличия и брони (29.09.2026). День приходит от вызывающего: у предложения
   *  и брони — день заезда, кабинет не передаёт его вовсе, и тогда берётся
   *  сегодня. «Применяется» значит «есть цена договора на нужные ночи», а не
   *  «на сегодня» (11.11.2026). */
  async partnerPlans(partnerId: string, day?: string) {
    const plans = await this.prisma.forTenant((tx) =>
      tx.ratePlan.findMany({
        where: { partnerId, isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
    );
    return this.withOperatorStatus(plans, day);
  }

  /* КОРПОРАТИВНЫЕ ТАРИФЫ ПАРТНЁРА ДЛЯ СВЕРКИ (29.09.2026).
   *
   * Все тарифы партнёра у гостиницы: условия (юрлицо, заказчик, вид брони —
   * кодами партнёра и названиями), НДС, статус и цены по категориям и числу
   * гостей. Партнёр сверяет каждый тариф со «срезом» своего договора, и видеть
   * обязан те же цифры, что считает PMS. */
  async partnerTariffs(partnerId: string) {
    const plans = await this.prisma.forTenant((tx) =>
      tx.ratePlan.findMany({
        where: { partnerId, isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: {
          partnerAccount: { select: { code: true, name: true } },
          partnerCustomer: { select: { code: true, name: true } },
        },
      }),
    );
    if (!plans.length) return [];
    const [decorated, docs, roomTypes, prices] = await Promise.all([
      this.withOperatorStatus(plans),
      this.contractDocs(),
      this.prisma.forTenant((tx) =>
        tx.roomType.findMany({
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          select: { id: true, name: true, maxOccupancy: true },
        }),
      ),
      this.planPrices(plans.map((p) => p.id)),
    ]);
    return decorated.map((plan) => {
      const rows = prices.get(plan.id) ?? [];
      const categories = roomTypes.map((rt) => {
        const standard = rows
          .filter((r) => r.kind === 'STANDARD' && r.roomTypeId === rt.id)
          .map((r) => ({ occupancy: r.occupancy ?? 0, price: Number(r.price), currency: r.currency }))
          .sort((a, b) => a.occupancy - b.occupancy);
        const others = rows.filter((r) => r.kind !== 'STANDARD' && r.roomTypeId === rt.id);
        const amounts = others.map((r) => Number(r.price));
        return {
          categoryId: rt.id,
          categoryName: rt.name,
          capacity: rt.maxOccupancy,
          /** Базовые цены по числу гостей (0 — на любое), рубли без НДС. */
          prices: standard,
          overrides: amounts.length
            ? { count: amounts.length, min: Math.min(...amounts), max: Math.max(...amounts) }
            : null,
        };
      });
      return {
        id: plan.id,
        code: plan.code,
        name: plan.name,
        mealPlan: plan.mealPlan,
        // 5.3 · условия питания — партнёр видит, в цене ли оно и почём.
        meal: mealTermsOf(plan),
        operatorContract: plan.operatorContract,
        conditions: {
          account: plan.partnerAccount,
          customer: plan.partnerCustomer,
          guestKind: plan.guestKind,
        },
        vatRate: plan.vatRate != null ? Number(plan.vatRate) : null,
        status: plan.operatorStatus,
        fingerprint: plan.fingerprint,
        reviewedAt: plan.reviewedAt,
        reviewedBy: plan.reviewedBy,
        reviewDocuments: plan.reviewDocuments,
        contractDocs: docsOfContract(docs, plan.operatorContract, plan.partnerId),
        categories,
      };
    });
  }

  /** Тариф оператора со статусом и приложениями договора — для кабинета и
   *  для самого оператора: обе стороны обязаны видеть ОДНУ картину. */
  async operatorTariff() {
    const plan = await this.prisma.forTenant((tx) =>
      tx.ratePlan.findFirst({ where: { forOperator: true, isActive: true } }),
    );
    if (!plan) return null;
    const [decorated] = await this.withOperatorStatus([plan]);
    const docs = docsOfContract(await this.contractDocs(), plan.operatorContract, plan.partnerId);

    /* Сверять оператор будет ЦИФРЫ, а не наличие тарифа, — значит их и надо
       отдать. Базовая цена по категориям это то, с чем сопоставляется строка
       приложения; про сезоны и цены на день говорится отдельной сводкой, а не
       умалчивается: «всё по 2 800» при сорока днях по 4 500 в календаре —
       ровно та полуправда, из-за которой потом спорят по акту. */
    const [roomTypes, prices] = await Promise.all([
      this.prisma.forTenant((tx) =>
        tx.roomType.findMany({
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          select: { id: true, name: true },
        }),
      ),
      this.planPrices([plan.id]).then((m) => m.get(plan.id) ?? []),
    ]);
    const standardBy = new Map(
      prices.filter((r) => r.kind === 'STANDARD').map((r) => [r.roomTypeId, r]),
    );
    const categories = roomTypes.map((rt) => {
      const std = standardBy.get(rt.id);
      const others = prices.filter((r) => r.kind !== 'STANDARD' && r.roomTypeId === rt.id);
      const amounts = others.map((r) => Number(r.price));
      return {
        categoryId: rt.id,
        categoryName: rt.name,
        /** Рубли — как всё наружу из PMS; в копейки переводит адаптер Авии. */
        price: std ? Number(std.price) : null,
        currency: std?.currency ?? 'RUB',
        overrides: amounts.length
          ? { count: amounts.length, min: Math.min(...amounts), max: Math.max(...amounts) }
          : null,
      };
    });

    return { ...decorated, contractDocs: docs, categories };
  }

  /* Цены договора для экрана корпоративного тарифа (11.11.2026): периоды ДС и
     сетка по категориям и числу гостей. Считается тем же правилом, что и
     расчёт брони, — иначе экран и счёт разошлись бы молча. */
  async contractPrices(id: string, from?: string, to?: string) {
    const plan = await this.prisma.forTenant((tx) =>
      tx.ratePlan.findUnique({ where: { id } }),
    );
    if (!plan) throw new NotFoundException('Тариф не найден');
    if (!plan.forOperator) {
      throw new BadRequestException('Это не корпоративный тариф оператора');
    }

    const roomTypes = await this.prisma.forTenant((tx) =>
      tx.roomType.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, maxOccupancy: true },
      }),
    );
    const { slice, unknownCustomer } = await this.contracts.sliceOf(plan);

    const today = new Date().toISOString().slice(0, 10);
    const dayFrom = from ?? today;
    const dayTo = to ?? dayFrom;
    const days: string[] = [];
    for (
      let d = new Date(`${dayFrom}T00:00:00.000Z`);
      d <= new Date(`${dayTo}T00:00:00.000Z`) && days.length < 120;
      d = new Date(d.getTime() + 86_400_000)
    ) {
      days.push(d.toISOString().slice(0, 10));
    }

    const categories = roomTypes.map((rt) => ({
      categoryId: rt.id,
      name: rt.name,
      capacity: rt.maxOccupancy,
    }));
    /* hasSlice — экран отличает «нет среза» от «срез есть, сеток нет»: иначе оба печатают «Авиа не прислала приложение». */
    if (!slice) {
      return {
        contractNumber: plan.operatorContract,
        hasSlice: false,
        unknownCustomer,
        periods: [] as string[],
        categories,
        nights: [] as { day: string; prices: { categoryId: string; occupancy: number; price: string }[] }[],
        vatRate: null as number | null,
      };
    }

    const docs = await this.contracts.docsFor(slice.partnerId);
    /* Периоды — по тем же документам, что берёт правило цены (contract-price,
       ownDocs): юрлицо среза обязано совпасть. Иначе выбор периода предложил
       бы ДС другого юрлица, а цена по ней не считалась бы. */
    const periods = [
      ...new Set(
        docs
          .filter(
            (d) =>
              d.service === 'ACCOMMODATION' &&
              d.contractNumber === slice.contractNumber &&
              (!slice.accountCode || !d.accountCode || d.accountCode === slice.accountCode),
          )
          .flatMap((d) => (d.fill ?? []).map((g) => String(g.from).slice(0, 10))),
      ),
    ].sort();

    const nights = days
      .map((day) => ({
        day,
        prices: roomTypes.flatMap((rt) => {
          const rows: { categoryId: string; occupancy: number; price: string }[] = [];
          for (let g = 1; g <= Math.max(1, rt.maxOccupancy ?? 1); g++) {
            const rub = contractNightRub(docs, slice, rt.id, g, day);
            if (rub != null) rows.push({ categoryId: rt.id, occupancy: g, price: rub });
          }
          return rows;
        }),
      }))
      .filter((n) => n.prices.length > 0);

    return {
      contractNumber: plan.operatorContract,
      hasSlice: true,
      unknownCustomer: false,
      periods,
      categories,
      nights,
      /* НДС — документа ЗАПРОШЕННОГО окна (11.11.2026): при двух ДС с разными
         ставками «сегодняшняя» показывала бы отелю не ту ставку, а если
         документ периода сегодня не покрывает — ещё и «без НДС». */
      vatRate: contractVatRate(docs, slice, dayFrom),
    };
  }

  /* ЗАПИСЬ ВЕРДИКТА ЖИВЁТ ЗДЕСЬ, рядом с правилом.
   *
   * Подтверждают из Авии по партнёрскому API, но считать отпечаток обязана
   * сторона, которая его потом и сверяет, — иначе оператор пришлёт свой, и две
   * стороны начнут мерить разной линейкой. Своя копия правила в чужом модуле —
   * ровно тот дефект, который в соседнем проекте ловили пять раз подряд. */
  async applyOperatorReview(
    id: string,
    input: {
      verdict: 'CONFIRMED' | 'REJECTED';
      reviewedBy: string;
      /** Отпечаток, который оператор ВИДЕЛ, когда выносил решение. */
      seenFingerprint: string;
      notes?: unknown;
    },
  ) {
    const plan = await this.prisma.forTenant((tx) =>
      tx.ratePlan.findUnique({ where: { id } }),
    );
    if (!plan) throw new NotFoundException('Тариф не найден');
    if (!plan.forOperator) {
      throw new ConflictException('Это не корпоративный тариф оператора');
    }

    const mine = docsOfContract(await this.contractDocs(), plan.operatorContract, plan.partnerId);
    const fingerprint = tariffFingerprint({ docs: mine, plan, prices: [] });

    /* Решение относится к тем документам, которые человек видел на экране.
       Между открытием экрана и нажатием кнопки могла прийти новая ДС или
       смениться условия тарифа — никто не мешает. Подтвердить вслепую то,
       чего не видел, страшнее, чем сходить на экран второй раз.

       Отпечаток теперь договорный (11.11.2026): он стережёт ДС и условия, а не
       строки цен тарифа — своих цен у корпоративного тарифа больше нет. Текст
       ошибки остался прежним и говорит про «цены»: это вопрос формулировки к
       Мусе, а не правка на свой вкус. */
    if (input.seenFingerprint !== fingerprint) {
      throw new ConflictException(
        'Цены изменились, пока вы смотрели тариф. Откройте его заново и сверьте ещё раз.',
      );
    }

    await this.prisma.forTenant((tx) =>
      tx.ratePlan.update({
        where: { id },
        data: {
          reviewVerdict: input.verdict,
          reviewedAt: new Date(),
          reviewedBy: input.reviewedBy,
          reviewDocuments: documentsLabel(mine),
          // Отпечаток запоминается и при отказе: по нему видно, изменилось ли
          // хоть что-то с тех пор, как оператор сказал «нет».
          reviewFingerprint: fingerprint,
          reviewNotes: (input.notes ?? null) as never,
        },
      }),
    );
    return this.get(id);
  }

  /* УСЛОВИЯ КОРПОРАТИВНОГО ТАРИФА (29.09.2026).
   *
   * Тариф партнёра говорит, к чему применяется: юрлицо партнёра, заказчик
   * (авиакомпания), вид брони; пустое — «для любого». Проверяется здесь, а не
   * только в базе: юрлицо и заказчик должны быть из справочника ЭТОГО
   * партнёра и действующими, иначе тариф молча не применится никогда.
   *
   * Совместимость: старый признак «для оператора» без партнёра означает
   * Kars Avia — единственного партнёра до 29.09.2026. */
  private async partnerScope(
    dto: {
      forOperator?: boolean;
      partnerId?: string | null;
      partnerAccountId?: string | null;
      partnerCustomerId?: string | null;
      guestKind?: 'CREW' | 'DISRUPTION' | null;
      vatRate?: number | null;
    },
    before: {
      partnerId: string | null;
      partnerAccountId: string | null;
      partnerCustomerId: string | null;
      guestKind: 'CREW' | 'DISRUPTION' | null;
      vatRate: unknown;
    } | null,
  ): Promise<{
    partnerId: string | null;
    partnerAccountId: string | null;
    partnerCustomerId: string | null;
    guestKind: 'CREW' | 'DISRUPTION' | null;
    vatRate: number | null;
  }> {
    const pick = <K extends keyof NonNullable<typeof before>>(k: K, v: unknown) =>
      v === undefined ? (before ? before[k] : null) : v;

    let partnerId = pick('partnerId', dto.partnerId) as string | null;
    if (dto.forOperator === true && !partnerId) {
      const kars = await this.prisma.forTenant((tx) =>
        tx.partner.findUnique({ where: { code: 'kars-avia' }, select: { id: true } }),
      );
      partnerId = kars?.id ?? null;
    }
    if (dto.forOperator === false) partnerId = null;

    const scope = {
      partnerId,
      partnerAccountId: partnerId ? (pick('partnerAccountId', dto.partnerAccountId) as string | null) : null,
      partnerCustomerId: partnerId ? (pick('partnerCustomerId', dto.partnerCustomerId) as string | null) : null,
      guestKind: partnerId ? (pick('guestKind', dto.guestKind) as 'CREW' | 'DISRUPTION' | null) : null,
      vatRate: partnerId
        ? (() => {
            const v = pick('vatRate', dto.vatRate);
            return v == null ? null : Number(v);
          })()
        : null,
    };
    if (!partnerId) return scope;

    const [partner, account, customer] = await this.prisma.forTenant((tx) =>
      Promise.all([
        tx.partner.findUnique({ where: { id: partnerId! }, select: { isActive: true } }),
        scope.partnerAccountId
          ? tx.partnerAccount.findUnique({
              where: { id: scope.partnerAccountId },
              select: { partnerId: true, isActive: true },
            })
          : null,
        scope.partnerCustomerId
          ? tx.partnerCustomer.findUnique({
              where: { id: scope.partnerCustomerId },
              select: { partnerId: true, isActive: true },
            })
          : null,
      ]),
    );
    if (!partner?.isActive) throw new ConflictException('Партнёр не найден или выключен');
    if (scope.partnerAccountId && (!account?.isActive || account.partnerId !== partnerId)) {
      throw new ConflictException('Юрлицо не из справочника этого партнёра');
    }
    if (scope.partnerCustomerId && (!customer?.isActive || customer.partnerId !== partnerId)) {
      throw new ConflictException('Авиакомпания не из справочника этого партнёра');
    }
    return scope;
  }

  /* Два действующих тарифа на одни и те же условия и питание сделали бы цену
     случайной. Уникальность держит индекс, но его сообщение непригодно —
     правило проверяется здесь, словами; индекс — страховка от гонки. */
  private async assertUniquePartnerScope(
    scope: {
      partnerId: string | null;
      partnerAccountId: string | null;
      partnerCustomerId: string | null;
      guestKind: 'CREW' | 'DISRUPTION' | null;
    },
    mealPlan: string,
    isActive: boolean,
    exceptId?: string,
  ) {
    if (!scope.partnerId || !isActive) return;
    const rival = await this.prisma.forTenant((tx) =>
      tx.ratePlan.findFirst({
        where: {
          partnerId: scope.partnerId,
          partnerAccountId: scope.partnerAccountId,
          partnerCustomerId: scope.partnerCustomerId,
          guestKind: scope.guestKind,
          mealPlan: mealPlan as never,
          isActive: true,
          id: exceptId ? { not: exceptId } : undefined,
        },
        select: { code: true, name: true },
      }),
    );
    if (rival) {
      throw new ConflictException(
        `Корпоративный тариф на эти условия и питание уже есть — «${rival.name}» (${rival.code}). ` +
          'Правьте его или выключите прежний.',
      );
    }
  }

  /** Корпоративный тариф не наследуется — см. миграцию и правило статуса. */
  private assertOperatorPlanStandsAlone(forOperator: boolean, parentId?: string | null) {
    if (forOperator && parentId) {
      throw new ConflictException(
        'Корпоративный тариф не может наследовать цены: правка родителя меняла бы ' +
          'подтверждённые цифры молча. Скопируйте ставки и правьте их здесь.',
      );
    }
  }

  private async contractDocs(): Promise<ContractPriceDoc[]> {
    const rows = await this.prisma.forTenant((tx) =>
      tx.partnerContractPrice.findMany(),
    );
    return rows.map((r) => ({
      partnerId: r.partnerId,
      contractNumber: r.contractNumber,
      amendmentNumber: r.amendmentNumber,
      service: r.service,
      validFrom: r.validFrom,
      validTo: r.validTo,
      vatRate: r.vatRate == null ? null : Number(r.vatRate),
      rows: r.rows,
    }));
  }

  /* Все три источника цены разом: день, сезон, базовая цена категории.
   * PMS считает ночь именно в этом порядке, значит и сверять надо всё. */
  private async planPrices(ids: string[]) {
    const [days, seasons, standard] = await this.prisma.forTenant((tx) =>
      Promise.all([
        tx.rate.findMany({
          where: { ratePlanId: { in: ids } },
          select: {
            ratePlanId: true,
            date: true,
            roomTypeId: true,
            occupancy: true,
            price: true,
            currency: true,
          },
        }),
        tx.rateSeason.findMany({
          where: { ratePlanId: { in: ids } },
          select: {
            ratePlanId: true,
            roomTypeId: true,
            dateFrom: true,
            dateTo: true,
            price: true,
            currency: true,
            occupancy: true,
          },
        }),
        tx.standardRate.findMany({
          where: { ratePlanId: { in: ids } },
          select: { ratePlanId: true, roomTypeId: true, price: true, currency: true, occupancy: true },
        }),
      ]),
    );

    const byPlan = new Map<string, PlanPriceRow[]>();
    const push = (planId: string, row: PlanPriceRow) => {
      const list = byPlan.get(planId) ?? [];
      list.push(row);
      byPlan.set(planId, list);
    };
    for (const r of days) {
      push(r.ratePlanId, {
        kind: 'DAY',
        roomTypeId: r.roomTypeId,
        occupancy: r.occupancy,
        dateFrom: r.date,
        dateTo: r.date,
        price: r.price,
        currency: r.currency,
      });
    }
    for (const r of seasons) {
      push(r.ratePlanId, {
        kind: 'SEASON',
        roomTypeId: r.roomTypeId,
        /* 0 — «на любое число»: в отпечаток не идёт, чтобы подтверждения
           тарифов, заведённых до цен по гостям, не слетели сами (29.09.2026). */
        occupancy: r.occupancy || null,
        dateFrom: r.dateFrom,
        dateTo: r.dateTo,
        price: r.price,
        currency: r.currency,
      });
    }
    for (const r of standard) {
      push(r.ratePlanId, {
        kind: 'STANDARD',
        roomTypeId: r.roomTypeId,
        occupancy: r.occupancy || null,
        price: r.price,
        currency: r.currency,
      });
    }
    return byPlan;
  }

  /* Статус НЕ хранится: он вычисляется на каждом чтении — по наличию цены
   * договора на НУЖНЫЙ день (11.11.2026), а не по вердикту человека. День
   * выбирает вызывающий: предложение и бронь — день заезда, экран — сегодня,
   * кабинет день не передаёт вовсе. Цена этого — документы договора и срезы
   * тарифов; цена обратного — «применяется» у тарифа, которого в договоре нет. */
  private async withOperatorStatus<
    T extends { id: string; forOperator: boolean } & PlanSliceSource,
  >(
    plans: T[],
    /* День, за который спрашивается цена договора (11.11.2026): его передаёт
       вызывающий — предложение и бронь передают день заезда, экран и кабинет
       не передают ничего и получают сегодняшний. Иначе новый годовой договор
       с сеткой из будущего делал бы тариф невидимым ровно на те ночи, которые
       он уже умеет посчитать. */
    day = new Date().toISOString().slice(0, 10),
  ): Promise<(T & { operatorStatus: TariffStatus | null; fingerprint: string | null })[]> {
    const corporate = plans.filter((p) => p.forOperator);
    if (!corporate.length) {
      return plans.map((p) => ({ ...p, operatorStatus: null, fingerprint: null }));
    }
    const [docs, states] = await Promise.all([
      this.contractDocs(),
      this.contracts.priceStates(corporate, day),
    ]);
    return plans.map((p) => {
      if (!p.forOperator) return { ...p, operatorStatus: null, fingerprint: null };
      const plan = p as unknown as ReviewedPlan;
      /* Цен тарифа больше нет — отпечаток держится на договоре и условиях,
         поэтому новая ДС его меняет, а правка несуществующих строк — нет. */
      const mine = docsOfContract(docs, plan.operatorContract, plan.partnerId);
      const fingerprint = tariffFingerprint({ docs: mine, plan, prices: [] });
      const state = states.get(p.id);
      return {
        ...p,
        fingerprint,
        operatorStatus: operatorTariffStatus(plan, docs, state?.hasPrice === true),
      };
    });
  }

  private translatePrismaError(e: unknown, code?: string): Error {
    switch (prismaErrorCode(e)) {
      case PRISMA_UNIQUE_VIOLATION:
        /* Частичный индекс «один корпоративный тариф на гостиницу» сюда почти
           не доходит: он проверен явно выше, с внятным сообщением. Здесь он
           остаётся сторожем гонки — Prisma для частичного индекса отдаёт
           `meta.target: null`, назвать нарушенный ключ по ответу нельзя. */
        return new ConflictException(`Тариф с кодом "${code ?? '?'}" уже существует`);
      case PRISMA_RECORD_NOT_FOUND:
        return new NotFoundException('Тариф не найден');
      default:
        return asError(e);
    }
  }
}
