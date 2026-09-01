import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
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
  TariffStatus,
  docsOfContract,
  documentsLabel,
  operatorTariffStatus,
  tariffFingerprint,
} from './operator-tariff-status';

@Injectable()
export class RatePlansService {
  constructor(private readonly prisma: PrismaService) {}

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
    this.assertOperatorPlanStandsAlone(dto.forOperator ?? false, dto.parentRatePlanId);
    await this.assertSingleOperatorPlan(dto.forOperator ?? false, dto.isActive ?? true);
    try {
      return await this.prisma.forTenant((tx) =>
        tx.ratePlan.create({
          data: {
            tenantId: TenantContext.getTenantIdOrThrow(),
            code: dto.code,
            name: dto.name,
            description: dto.description ?? null,
            mealPlan: dto.mealPlan ?? 'NONE',
            occupancyPricing: dto.occupancyPricing ?? false,
            parentRatePlanId: dto.parentRatePlanId ?? null,
            priceModifierType: dto.priceModifierType ?? 'PERCENT',
            priceModifierValue: dto.priceModifierValue ?? 0,
            cancellationPolicyId: dto.cancellationPolicyId ?? null,
            paymentPolicyId: dto.paymentPolicyId ?? null,
            sortOrder: dto.sortOrder ?? 0,
            isActive: dto.isActive ?? true,
            forOperator: dto.forOperator ?? false,
            operatorContract: dto.operatorContract ?? null,
          },
          include: { parentRatePlan: { select: { id: true, code: true, name: true } } },
        }),
      );
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
        select: { forOperator: true, parentRatePlanId: true, isActive: true },
      }),
    );
    if (!before) throw new NotFoundException('Тариф не найден');
    this.assertOperatorPlanStandsAlone(
      dto.forOperator ?? before.forOperator,
      dto.parentRatePlanId === undefined ? before.parentRatePlanId : dto.parentRatePlanId,
    );
    await this.assertSingleOperatorPlan(
      dto.forOperator ?? before.forOperator,
      dto.isActive ?? before.isActive,
      id,
    );
    try {
      return await this.prisma.forTenant((tx) =>
        tx.ratePlan.update({
          where: { id },
          data: {
            code: dto.code ?? undefined,
            name: dto.name ?? undefined,
            description: dto.description === undefined ? undefined : dto.description,
            mealPlan: dto.mealPlan ?? undefined,
            occupancyPricing: dto.occupancyPricing ?? undefined,
            parentRatePlanId: dto.parentRatePlanId === undefined ? undefined : dto.parentRatePlanId,
            priceModifierType: dto.priceModifierType ?? undefined,
            priceModifierValue: dto.priceModifierValue ?? undefined,
            cancellationPolicyId:
              dto.cancellationPolicyId === undefined ? undefined : dto.cancellationPolicyId,
            paymentPolicyId: dto.paymentPolicyId === undefined ? undefined : dto.paymentPolicyId,
            sortOrder: dto.sortOrder ?? undefined,
            isActive: dto.isActive ?? undefined,
            forOperator: dto.forOperator ?? undefined,
            operatorContract:
              dto.operatorContract === undefined ? undefined : dto.operatorContract,
          },
        }),
      );
    } catch (e) {
      throw this.translatePrismaError(e, dto.code);
    }
  }

  async remove(id: string) {
    // Prisma cascades Rate rows; child rate plans get parentRatePlanId set to null (SetNull).
    try {
      await this.prisma.forTenant((tx) => tx.ratePlan.delete({ where: { id } }));
      return { ok: true };
    } catch (e) {
      throw this.translatePrismaError(e);
    }
  }

  /** Тариф оператора со статусом и приложениями договора — для кабинета и
   *  для самого оператора: обе стороны обязаны видеть ОДНУ картину. */
  async operatorTariff() {
    const plan = await this.prisma.forTenant((tx) =>
      tx.ratePlan.findFirst({ where: { forOperator: true, isActive: true } }),
    );
    if (!plan) return null;
    const [decorated] = await this.withOperatorStatus([plan]);
    const docs = docsOfContract(await this.contractDocs(), plan.operatorContract);
    return { ...decorated, contractDocs: docs };
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

    const mine = docsOfContract(await this.contractDocs(), plan.operatorContract);
    if (!mine.length) {
      // Подтверждать нечему: сверять не с чем, и «подтверждено» было бы
      // подписью под пустым листом.
      throw new ConflictException(
        'Нет ценового приложения договора — сверять не с чем',
      );
    }
    const prices = await this.planPrices([id]);
    const fingerprint = tariffFingerprint({
      docs: mine,
      plan,
      prices: prices.get(id) ?? [],
    });

    /* Решение относится к тем цифрам, которые человек видел на экране.
       Между открытием экрана и нажатием кнопки цены могли уехать — прислать
       новую ДС или поправить ставку никто не мешает. Подтвердить вслепую то,
       чего не видел, страшнее, чем сходить на экран второй раз. */
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

  /* Корпоративный тариф у гостиницы ОДИН, и сказать об этом надо словами.
   *
   * Уникальность держит частичный индекс, но его сообщение непригодно:
   * нарушенный ключ Prisma не называет, и человек читает «код занят»,
   * переименовывает тариф и упирается туда же. Правило проверяется там, где
   * исполняется; индекс остаётся страховкой от гонки. */
  private async assertSingleOperatorPlan(
    forOperator: boolean,
    isActive: boolean,
    exceptId?: string,
  ) {
    if (!forOperator || !isActive) return;
    const rival = await this.prisma.forTenant((tx) =>
      tx.ratePlan.findFirst({
        where: { forOperator: true, isActive: true, id: exceptId ? { not: exceptId } : undefined },
        select: { code: true, name: true },
      }),
    );
    if (rival) {
      throw new ConflictException(
        `Корпоративный тариф для оператора уже есть — «${rival.name}» (${rival.code}). ` +
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
          },
        }),
        tx.standardRate.findMany({
          where: { ratePlanId: { in: ids } },
          select: { ratePlanId: true, roomTypeId: true, price: true, currency: true },
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
        price: r.price,
        currency: r.currency,
      });
    }
    return byPlan;
  }

  /* Статус НЕ хранится: он вычисляется на каждом чтении сравнением отпечатка.
   * Цена этого — два запроса на список тарифов; цена обратного — «подтверждён»
   * под ценами, которых никто не подтверждал. */
  private async withOperatorStatus<T extends { id: string; forOperator: boolean }>(
    plans: T[],
  ): Promise<(T & { operatorStatus: TariffStatus | null; fingerprint: string | null })[]> {
    const corporate = plans.filter((p) => p.forOperator);
    if (!corporate.length) {
      return plans.map((p) => ({ ...p, operatorStatus: null, fingerprint: null }));
    }
    const [docs, prices] = await Promise.all([
      this.contractDocs(),
      this.planPrices(corporate.map((p) => p.id)),
    ]);
    return plans.map((p) => {
      if (!p.forOperator) return { ...p, operatorStatus: null, fingerprint: null };
      const plan = p as unknown as Parameters<typeof operatorTariffStatus>[0];
      const mine = docsOfContract(docs, plan.operatorContract);
      const fingerprint = tariffFingerprint({
        docs: mine,
        plan,
        prices: prices.get(p.id) ?? [],
      });
      return {
        ...p,
        fingerprint,
        operatorStatus: operatorTariffStatus(plan, docs, fingerprint),
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
