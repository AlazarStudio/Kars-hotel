import { Prisma } from '@prisma/client';
import { TenantContext } from '../../common/context/tenant-context';
import { ContractPriceDoc, TariffSlice } from '../contracts/contract-price';
import { AvailabilityService } from './availability.service';

/* ЦЕНА КОРПОРАТИВНОГО ТАРИФА НА ВИТРИНЕ (11.11.2026).
 *
 * У тарифа партнёра своих строк цен нет: цена ночи берётся только из сетки
 * договора (contractNightRub). Своя строка rate/standard и базовая цена
 * категории для него больше не источник — подстановка любой из них и есть та
 * копия, от которой уходили. Ночь без цены договора убирает тариф из
 * предложения целиком: сумма за неполный срок — обещание цифры, которой в
 * договоре не было.
 *
 * Базы нет: Prisma, Redis и ContractsService — заглушки. Единственный источник
 * цены тарифа партнёра — сетка договора в заглушке slicesFor. */

const TENANT = '00000000-0000-4000-8000-000000000001';
const CATEGORY = '00000000-0000-4000-8000-000000000002';
const CHECK_IN = '2026-12-01';
const CHECK_OUT = '2026-12-04'; // три ночи

type PlanRow = {
  id: string;
  code: string;
  name: string;
  mealPlan: string;
  partnerId: string | null;
  operatorContract: string | null;
  partnerAccountId: string | null;
  partnerCustomerId: string | null;
  guestKind: 'CREW' | 'DISRUPTION' | null;
  vatRate: Prisma.Decimal | null;
};

type SliceEntry = {
  slice: TariffSlice | null;
  unknownCustomer: boolean;
  docs: ContractPriceDoc[];
};

type StandardRow = {
  ratePlanId: string;
  roomTypeId: string;
  price: Prisma.Decimal;
  occupancy: number;
};

type DailyRow = {
  rate_plan_id: string;
  date: Date;
  occupancy: number;
  price: string;
};

const PARTNER_PLAN: PlanRow = {
  id: 'corp',
  code: 'CORP',
  name: 'Корпоративный',
  mealPlan: 'BB',
  partnerId: 'p1',
  operatorContract: '205',
  partnerAccountId: null,
  partnerCustomerId: null,
  guestKind: null,
  vatRate: null,
};

const OWN_PLAN: PlanRow = {
  id: 'own',
  code: 'FLEX',
  name: 'Свой',
  mealPlan: 'BB',
  partnerId: null,
  operatorContract: null,
  partnerAccountId: null,
  partnerCustomerId: null,
  guestKind: null,
  vatRate: null,
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
 * поэтому в ячейке 500 000. validTo позволяет оборвать срок и оставить ночь
 * без цены; vatRate — ставка НДС документа. */
function doc(validTo: string | null = null, vatRate: number | null = null): ContractPriceDoc {
  return {
    partnerId: 'p1',
    contractNumber: '205',
    amendmentNumber: null,
    service: 'ACCOMMODATION',
    validFrom: '2026-01-01T00:00:00.000Z',
    validTo,
    vatRate,
    accountCode: null,
    fill: [
      {
        from: '2026-01-01',
        slices: [
          {
            customer: null,
            guestKind: null,
            mealPlan: 'BB',
            cells: [{ categoryId: CATEGORY, occupancy: 2, price: 500000 }],
          },
        ],
      },
    ],
  };
}

function fixture(
  opts: {
    plans?: PlanRow[];
    slices?: Map<string, SliceEntry>;
    standardRates?: StandardRow[];
    dailyRows?: DailyRow[];
  } = {},
) {
  const tx = {
    ratePlan: { findMany: jest.fn(async () => opts.plans ?? []) },
    $queryRaw: jest.fn(async () => opts.dailyRows ?? []),
    rateSeason: { findMany: jest.fn(async () => []) },
    standardRate: { findMany: jest.fn(async () => opts.standardRates ?? []) },
  };
  const prisma = { forTenant: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
  const redis = { raw: { get: jest.fn(async () => null), set: jest.fn(async () => 'OK') } };
  const contracts = { slicesFor: jest.fn(async () => opts.slices ?? new Map<string, SliceEntry>()) };
  const service = new AvailabilityService(prisma as never, redis as never, contracts as never);
  const run = (basePrice: number | undefined, guests: number | undefined) =>
    TenantContext.run(
      { tenantId: TENANT, userId: 'u', roleCode: 'ADMIN', permissions: [] },
      () => service.priceByPlan(CATEGORY, CHECK_IN, CHECK_OUT, basePrice, guests),
    );
  const price = (basePrice?: number) => run(basePrice, 2);
  const priceWithoutGuests = (basePrice?: number) => run(basePrice, undefined);
  return { service, tx, redis, contracts, price, priceWithoutGuests };
}

describe('priceByPlan — цена корпоративного тарифа из договора', () => {
  it('drops a partner plan when the contract has no price, despite its own rows', async () => {
    /* Риск: раньше тариф партнёра считался по своим строкам или базовой цене
       категории — то есть по копии, от которой уходили. Договор без цены
       обязан убрать тариф, а не подставить чужую цифру. */
    const { price } = fixture({
      plans: [PARTNER_PLAN],
      slices: new Map([['corp', { slice: SLICE, unknownCustomer: false, docs: [] }]]),
      standardRates: [
        {
          ratePlanId: 'corp',
          roomTypeId: CATEGORY,
          price: new Prisma.Decimal(3000),
          occupancy: 2,
        },
      ],
    });
    await expect(price(100)).resolves.toEqual([]);
  });

  it('prices every night from the contract and leaves the own plan on its own path', async () => {
    /* Риск: цена договора в копейках, витрина в рублях; общий обход не должен
       сломать свои тарифы. Свой тариф в том же вызове остаётся на
       standardRate, корпоративный — только на сетке договора; basePrice на
       корпоративный не влияет. Дневная строка Rate (7000) договор не
       подменяет, а срезы запрашиваются одним вызовом на весь набор. */
    const { price, contracts, tx } = fixture({
      plans: [PARTNER_PLAN, OWN_PLAN],
      slices: new Map([['corp', { slice: SLICE, unknownCustomer: false, docs: [doc()] }]]),
      standardRates: [
        {
          ratePlanId: 'own',
          roomTypeId: CATEGORY,
          price: new Prisma.Decimal(3000),
          occupancy: 2,
        },
      ],
      dailyRows: [
        {
          rate_plan_id: 'corp',
          date: new Date(2026, 11, 1),
          occupancy: 2,
          price: '7000.00',
        },
      ],
    });
    const offers = await price(100);
    const corp = offers.find((o) => o.ratePlanId === 'corp');
    const own = offers.find((o) => o.ratePlanId === 'own');
    expect(corp?.perNight.map((n) => n.price)).toEqual(['5000.00', '5000.00', '5000.00']);
    expect(corp?.total).toBe('15000.00');
    expect(own?.perNight.map((n) => n.price)).toEqual(['3000.00', '3000.00', '3000.00']);
    expect(own?.total).toBe('9000.00');
    expect(contracts.slicesFor).toHaveBeenCalledTimes(1);
    expect(contracts.slicesFor).toHaveBeenCalledWith([PARTNER_PLAN, OWN_PLAN], tx);
  });

  it('drops a partner plan when guests is not given', async () => {
    /* Риск: JSDoc обещает цену только при известном числе гостей. Без guests
       договорная цена не считается, и тариф молча не предлагается — иначе
       документация разошлась бы с поведением. */
    const { priceWithoutGuests } = fixture({
      plans: [PARTNER_PLAN],
      slices: new Map([['corp', { slice: SLICE, unknownCustomer: false, docs: [doc()] }]]),
    });
    await expect(priceWithoutGuests(100)).resolves.toEqual([]);
  });

  it('drops the plan when one night has no contract price', async () => {
    /* Риск: сумма за неполный срок — обещание цены, которой в договоре нет.
       Ночь вне срока документа убирает тариф целиком. */
    const { price } = fixture({
      plans: [PARTNER_PLAN],
      slices: new Map([
        ['corp', { slice: SLICE, unknownCustomer: false, docs: [doc('2026-12-02T00:00:00.000Z')] }],
      ]),
    });
    await expect(price(100)).resolves.toEqual([]);
  });

  it('НДС корпоративного тарифа — из договора, свои тарифы остаются на своих', async () => {
    /* Риск: поле vatRate у корпоративного тарифа больше не заполняется (форма
       его не шлёт), поэтому ответ «null» заставил бы Авию считать по своей
       ставке — занижение на десятки процентов в счёте и отчёте ФАП. Свои
       тарифы отеля не должны пострадать: у них ставка своя. */
    const ownVat: PlanRow = { ...OWN_PLAN, vatRate: new Prisma.Decimal(7) };
    const { price } = fixture({
      plans: [PARTNER_PLAN, ownVat, OWN_PLAN],
      slices: new Map([['corp', { slice: SLICE, unknownCustomer: false, docs: [doc(null, 20)] }]]),
      standardRates: [
        { ratePlanId: 'own', roomTypeId: CATEGORY, price: new Prisma.Decimal(3000), occupancy: 2 },
      ],
    });
    const offers = await price(100);
    expect(offers.find((o) => o.ratePlanId === 'corp')?.vatRate).toBe('20');
    expect(offers.find((o) => o.ratePlanId === 'own')?.vatRate).toBe('7');
  });

  it('без ставки в договоре — null, а не выдуманная ставка', async () => {
    /* Риск: подставить сюда ставку тарифа или «типовую» значило бы посчитать
       чужой НДС. Нет ставки в документе — нет и числа. */
    const { price } = fixture({
      plans: [PARTNER_PLAN],
      slices: new Map([['corp', { slice: SLICE, unknownCustomer: false, docs: [doc(null, null)] }]]),
    });
    const [corp] = await price(100);
    expect(corp.vatRate).toBeNull();
  });
});
