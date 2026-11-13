import { Prisma } from '@prisma/client';
import { TenantContext } from '../../common/context/tenant-context';
import { ContractPriceDoc, TariffSlice } from '../contracts/contract-price';
import { PricingService } from './pricing.service';

/* ЦЕНА КОРПОРАТИВНОГО ТАРИФА В РАСЧЁТЕ СТОИМОСТИ (11.11.2026).
 *
 * У корпоративного тарифа своих строк цен нет: цена каждой ночи — сетка
 * договора с оператором, и только она. Свои Rate, сезоны и базовые цены такого
 * тарифа расчёт не читает вовсе — они остались в базе историей; подстановка
 * любой из них — та самая копия, от которой уходили, и расхождение всплыло бы
 * в акте, а не в расчёте.
 *
 * Расчёт остаётся прежним калькулятором: ночь без цены договора — не особый
 * случай и не исключение, а ночь без ставки (0.00 + предупреждение). Этот
 * тест сторожит именно связку «тариф → срез и документы → цена ночи», а не
 * правило договора (contract-price.spec) и не арифметику (pricing.calculator.spec).
 *
 * Базы нет: Prisma и ContractsService — заглушки (forTenant заодно проверяет,
 * что контекст гостиницы выставлен), единственный источник цены корпоративного
 * тарифа — сетка договора в заглушке slicesFor. */

const TENANT = '00000000-0000-4000-8000-000000000001';
const ROOM_TYPE = '00000000-0000-4000-8000-000000000002';
const CORPORATE_PLAN = '00000000-0000-4000-8000-0000000000c1';
const OWN_PLAN = '00000000-0000-4000-8000-0000000000c2';
const ARRIVAL = '2026-12-01';
const DEPARTURE = '2026-12-03'; // две ночи

const D = (v: string | number) => new Prisma.Decimal(v);
const date = (s: string) => new Date(`${s}T00:00:00.000Z`);

type PlanRow = {
  id: string;
  parentRatePlanId: string | null;
  priceModifierType: 'ABSOLUTE' | 'PERCENT';
  priceModifierValue: Prisma.Decimal;
  occupancyPricing: boolean;
  forOperator: boolean;
  operatorContract: string | null;
  partnerId: string | null;
  partnerAccountId: string | null;
  partnerCustomerId: string | null;
  guestKind: 'CREW' | 'DISRUPTION' | null;
  mealPlan: string;
};

type SliceEntry = {
  slice: TariffSlice | null;
  docs: ContractPriceDoc[];
};

type RateRow = {
  ratePlanId: string;
  roomTypeId: string;
  date: Date;
  occupancy: number;
  price: Prisma.Decimal;
};

type StandardRow = {
  ratePlanId: string;
  roomTypeId: string;
  price: Prisma.Decimal;
  occupancy: number;
};

/* Корпоративный тариф: партнёр и договор заданы, своей ценой — ничего. */
const CORPORATE: PlanRow = {
  id: CORPORATE_PLAN,
  parentRatePlanId: null,
  priceModifierType: 'PERCENT',
  priceModifierValue: D(0),
  occupancyPricing: false,
  forOperator: true,
  operatorContract: '205',
  partnerId: 'p1',
  partnerAccountId: null,
  partnerCustomerId: null,
  guestKind: null,
  mealPlan: 'BB',
};

/* Свой тариф гостиницы: ни партнёра, ни договора — живёт по своим ценам. */
const OWN: PlanRow = {
  id: OWN_PLAN,
  parentRatePlanId: null,
  priceModifierType: 'PERCENT',
  priceModifierValue: D(0),
  occupancyPricing: false,
  forOperator: false,
  operatorContract: null,
  partnerId: null,
  partnerAccountId: null,
  partnerCustomerId: null,
  guestKind: null,
  mealPlan: 'BB',
};

const SLICE: TariffSlice = {
  partnerId: 'p1',
  contractNumber: '205',
  accountCode: null,
  customerCode: null,
  guestKind: null,
  mealPlan: 'BB',
};

/* Документ договора с сеткой 5 000 ₽ за ночь на двоих. Цена Авии — копейки,
 * поэтому в ячейке 500 000. validTo обрывает срок документа, чтобы оставить
 * ночь без цены договора. */
function doc(validTo: string | null = null): ContractPriceDoc {
  return {
    partnerId: 'p1',
    contractNumber: '205',
    amendmentNumber: null,
    service: 'ACCOMMODATION',
    validFrom: '2026-01-01T00:00:00.000Z',
    validTo,
    vatRate: null,
    accountCode: null,
    fill: [
      {
        from: '2026-01-01',
        slices: [
          {
            customer: null,
            guestKind: null,
            mealPlan: 'BB',
            cells: [{ categoryId: ROOM_TYPE, occupancy: 2, price: 500000 }],
          },
        ],
      },
    ],
  };
}

function fixture(opts: {
  plan: PlanRow;
  slices?: Map<string, SliceEntry>;
  rates?: RateRow[];
  standardRates?: StandardRow[];
  occupancy?: number;
}) {
  const tx = {
    roomType: { findUnique: jest.fn(async () => ({ id: ROOM_TYPE, baseOccupancy: 2 })) },
    /* Родительской цепочки в заглушке нет: договорный тариф живёт сам, и
       наследование цены сюда не подмешивается. */
    ratePlan: {
      findUnique: jest.fn(async (args: { where: { id: string } }) =>
        args.where.id === opts.plan.id ? opts.plan : null,
      ),
    },
    rate: { findMany: jest.fn(async () => opts.rates ?? []) },
    rateSeason: { findMany: jest.fn(async () => []) },
    standardRate: { findMany: jest.fn(async () => opts.standardRates ?? []) },
  };
  /* forTenant каждого запроса проверяет, что TenantContext выставлен: без
     этого заглушка молча работала бы и там, где настоящий сервис бросил бы
     «tenant_id is required». */
  const prisma = {
    forTenant: jest.fn(async (fn: (t: typeof tx) => unknown) => {
      expect(TenantContext.getTenantIdOrThrow()).toBe(TENANT);
      return fn(tx);
    }),
  };
  const contracts = {
    slicesFor: jest.fn(async () => opts.slices ?? new Map<string, SliceEntry>()),
  };
  const service = new PricingService(prisma as never, contracts as never);
  const quote = () =>
    TenantContext.run({ tenantId: TENANT, userId: '', roleCode: '', permissions: [] }, () =>
      service.quote({
        ratePlanId: opts.plan.id,
        roomTypeId: ROOM_TYPE,
        arrival: date(ARRIVAL),
        departure: date(DEPARTURE),
        occupancy: opts.occupancy ?? 2,
      }),
    );
  return { tx, contracts, quote };
}

describe('PricingService.quote — цена корпоративного тарифа из договора', () => {
  it('prices a corporate plan only from the contract, despite its own rows', async () => {
    /* Риск: у корпоративного тарифа с прошлой жизни остались свои строки цен
       (rate 9 999 и standard 7 000). Если расчёт возьмёт любую из них, оператору
       выставят не договорную цену. Договор решает; строки цен такого тарифа не
       читаются вовсе — запросов за ними нет, а не «прочитали и выбросили»,
       иначе цена оставалась бы в базе соблазном. */
    const { quote, contracts, tx } = fixture({
      plan: CORPORATE,
      slices: new Map([[CORPORATE_PLAN, { slice: SLICE, docs: [doc()] }]]),
      rates: [
        {
          ratePlanId: CORPORATE_PLAN,
          roomTypeId: ROOM_TYPE,
          date: date('2026-12-01'),
          occupancy: 2,
          price: D(9999),
        },
        {
          ratePlanId: CORPORATE_PLAN,
          roomTypeId: ROOM_TYPE,
          date: date('2026-12-02'),
          occupancy: 2,
          price: D(9999),
        },
      ],
      standardRates: [
        { ratePlanId: CORPORATE_PLAN, roomTypeId: ROOM_TYPE, price: D(7000), occupancy: 2 },
      ],
    });

    const out = await quote();

    expect(out.nightly.map((n) => n.price.toFixed(2))).toEqual(['5000.00', '5000.00']);
    expect(out.totalPrice.toFixed(2)).toBe('10000.00');
    expect(out.nightly.every((n) => n.hasRate)).toBe(true);
    expect(out.nightly.map((n) => n.sourceRatePlanId)).toEqual([CORPORATE_PLAN, CORPORATE_PLAN]);
    expect(out.nightly.every((n) => !n.inheritedFromParent)).toBe(true);
    expect(out.warnings).toEqual([]);
    /* Тариф со своими строками — и ни одного запроса за ними: иначе это была
       бы «прочитали и выбросили», то есть комментарий врал бы. */
    expect(tx.rate.findMany).not.toHaveBeenCalled();
    expect(tx.rateSeason.findMany).not.toHaveBeenCalled();
    expect(tx.standardRate.findMany).not.toHaveBeenCalled();
    /* Срез и документы — один раз на тариф, а не на ночь: иначе на трёхночную
       бронь пришлась бы тройка обходов справочника и сеток. */
    expect(contracts.slicesFor).toHaveBeenCalledTimes(1);
    expect(contracts.slicesFor).toHaveBeenCalledWith(
      [expect.objectContaining({ id: CORPORATE_PLAN })],
      tx,
    );
  });

  it('keeps the first night priced and leaves the second unpriced when the contract ends', async () => {
    /* Риск: договор кончился посреди срока. Ночь вне срока — не «старая цена
       навсегда» и не исключение из расчёта: она без ставки (0.00 и
       предупреждение), а итог — сумма размеченных ночей. Подставить сюда
       standardRate тарифа значило бы обещать цену, которой в договоре нет. */
    const { quote } = fixture({
      plan: CORPORATE,
      slices: new Map([
        [CORPORATE_PLAN, { slice: SLICE, docs: [doc('2026-12-01T00:00:00.000Z')] }],
      ]),
      standardRates: [
        { ratePlanId: CORPORATE_PLAN, roomTypeId: ROOM_TYPE, price: D(7000), occupancy: 2 },
      ],
    });

    const out = await quote();

    expect(out.nightly).toHaveLength(2);
    expect(out.nightly[0].price.toFixed(2)).toBe('5000.00');
    expect(out.nightly[0].hasRate).toBe(true);
    expect(out.nightly[1].hasRate).toBe(false);
    expect(out.nightly[1].price.toFixed(2)).toBe('0.00');
    expect(out.nightly[1].sourceRatePlanId).toBeNull();
    expect(out.warnings).toHaveLength(1);
    expect(out.warnings[0]).toContain('2026-12-02');
    expect(out.totalPrice.toFixed(2)).toBe('5000.00');
  });

  it('quotes a wholly unpriced corporate plan as zero instead of throwing', async () => {
    /* Риск: среза нет (нет договора либо выключено юрлицо партнёра) — весь
       срок без цены. Расчёт обязан ответить нулём с предупреждениями, а не
       бросить: вызывающий отличает «нет цены» от сбоя по hasRate. */
    const { quote, contracts } = fixture({ plan: CORPORATE });

    const out = await quote();

    expect(out.nightly.map((n) => n.hasRate)).toEqual([false, false]);
    expect(out.nightly.map((n) => n.price.toFixed(2))).toEqual(['0.00', '0.00']);
    expect(out.warnings).toHaveLength(2);
    expect(out.totalPrice.toFixed(2)).toBe('0.00');
    expect(contracts.slicesFor).toHaveBeenCalledTimes(1);
  });

  it('takes the guest count strictly from the request, not from the contract grid', async () => {
    /* Риск: в сетке договора ячейка заведена только на двоих, а бронь на
       одного. Подставить «двоих» значило бы выставить не ту цену; правило
       договора ищет ровно запрошенное число гостей, поэтому весь срок остаётся
       без цены — и это видно по hasRate, а не молчаливой подстановкой. */
    const { quote } = fixture({
      plan: CORPORATE,
      slices: new Map([[CORPORATE_PLAN, { slice: SLICE, docs: [doc()] }]]),
      occupancy: 1,
    });

    const out = await quote();

    expect(out.occupancy).toBe(1);
    expect(out.nightly.map((n) => n.hasRate)).toEqual([false, false]);
    expect(out.nightly.map((n) => n.price.toFixed(2))).toEqual(['0.00', '0.00']);
    expect(out.warnings).toHaveLength(2);
    expect(out.totalPrice.toFixed(2)).toBe('0.00');
  });

  it('keeps an ordinary plan on its own rate and standard price and never asks the contract', async () => {
    /* Риск: правка корпоративного тарифа задела обычные — в том числе опустошила
       им набор дневных строк. Свой тариф обязан считаться как раньше: дневная
       строка 3 500 бьёт базовую 3 000, вторая ночь остаётся на базовой, а
       договоры для такого тарифа не запрашиваются даже одним вызовом. */
    const { quote, contracts } = fixture({
      plan: OWN,
      slices: new Map([[CORPORATE_PLAN, { slice: SLICE, docs: [doc()] }]]),
      rates: [
        {
          ratePlanId: OWN_PLAN,
          roomTypeId: ROOM_TYPE,
          date: date('2026-12-01'),
          occupancy: 2,
          price: D(3500),
        },
      ],
      standardRates: [
        { ratePlanId: OWN_PLAN, roomTypeId: ROOM_TYPE, price: D(3000), occupancy: 2 },
      ],
    });

    const out = await quote();

    expect(out.nightly.map((n) => n.price.toFixed(2))).toEqual(['3500.00', '3000.00']);
    expect(out.totalPrice.toFixed(2)).toBe('6500.00');
    expect(out.nightly.map((n) => n.sourceRatePlanId)).toEqual([OWN_PLAN, OWN_PLAN]);
    expect(out.nightly.every((n) => n.hasRate)).toBe(true);
    expect(out.nightly.every((n) => !n.inheritedFromParent)).toBe(true);
    expect(out.warnings).toEqual([]);
    expect(contracts.slicesFor).not.toHaveBeenCalled();
  });
});
