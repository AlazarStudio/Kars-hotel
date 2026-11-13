import { BadRequestException } from '@nestjs/common';
import { TenantContext } from '../../common/context/tenant-context';
import {
  ContractPriceDoc,
  FillGrid,
  TariffSlice,
  contractHasPriceOn,
  contractVatRate,
} from '../contracts/contract-price';
import { RatePlansService } from './rate-plans.service';

/* «ПРИМЕНЯЕТСЯ» ПО ЦЕНЕ ДОГОВОРА И ЦЕНЫ ДОГОВОРА НА ЭКРАНЕ (11.11.2026).
 *
 * Этим двум поверхностям верят снаружи: по applies фильтруются корпоративные
 * тарифы в предложениях партнёра (connectivity), а ручка цен кормит экран
 * тарифа. Ошибка здесь не видна глазами — экран покажет одну сетку, счёт
 * посчитает другую, и разойдутся они молча. Поэтому обе проверяются без базы:
 * Prisma, Redis и ContractsService — заглушки, а цена считается НАСТОЯЩИМ
 * правилом договора, а не подставленным числом.
 *
 * applies — про НУЖНЫЙ день, а не про сегодня: гейт спрашивает цену на ночи
 * запроса (предложение и бронь передают checkIn), иначе сетка из будущего
 * делала бы тариф невидимым на те ночи, которые уже посчитаны. Вердикт Авии
 * (applyOperatorReview) в гейте не участвует, а отпечаток, которым он
 * сверяется, теперь договорный: оба места сборки передают prices: [] — свои
 * строки цен тарифа больше не читаются, и это проверено отдельно ниже.
 *
 * Базы нет: prisma.forTenant выполняет переданную функцию над заглушкой tx. */

const TENANT = '00000000-0000-4000-8000-000000000001';
const CATEGORY = '00000000-0000-4000-8000-000000000002';
const DAY = '2026-12-01';

/* День «из будущего»: сетка нового договора начинается позже сегодняшнего дня.
   Считается от текущей даты, иначе тест сгнил бы в первый же новый год. */
const FUTURE_DAY = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10);

/* Срез тарифа: договор 205, без юрлица и авиакомпании, питание BB. */
const SLICE: TariffSlice = {
  partnerId: 'p1',
  contractNumber: '205',
  accountCode: null,
  customerCode: null,
  guestKind: null,
  mealPlan: 'BB',
};

const ROOM_TYPE = { id: CATEGORY, name: 'Двухместный', maxOccupancy: 2 };

/** Строка тарифа, как её отдаёт Prisma: полная, без select. */
function plan(over: Record<string, unknown> = {}) {
  return {
    id: 'corp',
    code: 'CORP',
    name: 'Корпоративный',
    mealPlan: 'BB',
    occupancyPricing: false,
    priceModifierType: 'PERCENT',
    priceModifierValue: 0,
    partnerId: 'p1',
    operatorContract: '205',
    partnerAccountId: null,
    partnerCustomerId: null,
    guestKind: null,
    vatRate: null,
    forOperator: true,
    isActive: true,
    ...over,
  };
}

const OWN_PLAN = plan({
  id: 'own',
  code: 'FLEX',
  name: 'Свой',
  forOperator: false,
  partnerId: null,
  operatorContract: null,
});

/* Сетка договора с дня `from`: срез «любая авиакомпания × BB», ячейка 5 000 ₽
 * (в копейках — 500 000) на двоих. Цена Авии — копейки, наружу PMS отдаёт
 * рубли. */
function grid(from: string): FillGrid {
  return {
    from,
    slices: [
      {
        customer: null,
        guestKind: null,
        mealPlan: 'BB',
        cells: [{ categoryId: CATEGORY, occupancy: 2, price: 500000 }],
      },
    ],
  };
}

/** Приложение договора в объёме правила цены: одна сетка с 2026-01-01. */
function fillDoc(over: Partial<ContractPriceDoc> = {}): ContractPriceDoc {
  return {
    partnerId: 'p1',
    contractNumber: '205',
    amendmentNumber: null,
    service: 'ACCOMMODATION',
    validFrom: '2026-01-01T00:00:00.000Z',
    validTo: null,
    vatRate: 20,
    accountCode: null,
    fill: [grid('2026-01-01')],
    ...over,
  };
}

/** Приложение в том виде, в каком его читает отпечаток: строки, а не сетки. */
const rowDoc = (over: Record<string, unknown> = {}) => ({
  partnerId: 'p1',
  contractNumber: '205',
  amendmentNumber: null,
  service: 'ACCOMMODATION',
  validFrom: new Date('2026-01-01T00:00:00.000Z'),
  validTo: null,
  vatRate: 20,
  rows: [{ categoryName: 'Двухместный', price: 500000 }],
  ...over,
});

type PriceState = { hasPrice: boolean; unknownCustomer: boolean; vatRate: number | null };

function fixture(
  opts: {
    plans?: Array<Record<string, unknown>>;
    plan?: Record<string, unknown> | null;
    slice?: { slice: TariffSlice | null; unknownCustomer: boolean };
    docs?: ContractPriceDoc[];
    contractRows?: unknown[];
    states?: Map<string, PriceState>;
    /* Состояние цен по ДНЮ запроса: так проверяется, что день доехал до
       правила, а не подменился «сегодня». */
    statesFor?: (day: string) => Map<string, PriceState>;
    roomTypes?: Array<{ id: string; name: string; maxOccupancy: number | null }>;
  } = {},
) {
  const tx = {
    ratePlan: {
      findMany: jest.fn(async () => opts.plans ?? []),
      findUnique: jest.fn(async () => (opts.plan === undefined ? plan() : opts.plan)),
    },
    roomType: { findMany: jest.fn(async () => opts.roomTypes ?? [ROOM_TYPE]) },
    partnerContractPrice: { findMany: jest.fn(async () => opts.contractRows ?? []) },
    /* Эти три таблицы читал ПРЕЖНИЙ отпечаток. Теперь их не читают вовсе —
       тесты ниже это и стерегут. */
    rate: { findMany: jest.fn(async (): Promise<unknown[]> => []) },
    rateSeason: { findMany: jest.fn(async (): Promise<unknown[]> => []) },
    standardRate: { findMany: jest.fn(async (): Promise<unknown[]> => []) },
  };
  const prisma = { forTenant: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)) };
  const webhooks = {
    emitForRatePlan: jest.fn(),
    emitTariffChanged: jest.fn(),
    planMeta: jest.fn(),
  };
  const redis = { raw: { get: jest.fn(), set: jest.fn() } };
  const contracts = {
    sliceOf: jest.fn(async (_plan: unknown) => opts.slice ?? { slice: null, unknownCustomer: false }),
    docsFor: jest.fn(async (_partnerId: string) => opts.docs ?? []),
    priceStates: jest.fn(
      async (_plans: Array<{ id: string }>, day: string) =>
        opts.statesFor ? opts.statesFor(day) : (opts.states ?? new Map<string, PriceState>()),
    ),
  };
  const service = new RatePlansService(
    prisma as never,
    webhooks as never,
    redis as never,
    contracts as never,
  );
  const list = () =>
    TenantContext.run(
      { tenantId: TENANT, userId: 'u', roleCode: 'ADMIN', permissions: [] },
      () => service.list(),
    );
  const prices = (id = 'corp', from?: string, to?: string) =>
    TenantContext.run(
      { tenantId: TENANT, userId: 'u', roleCode: 'ADMIN', permissions: [] },
      () => service.contractPrices(id, from, to),
    );
  const partnerPlans = (partnerId = 'p1', day?: string) =>
    TenantContext.run(
      { tenantId: TENANT, userId: 'u', roleCode: 'ADMIN', permissions: [] },
      () => service.partnerPlans(partnerId, day),
    );
  return { service, tx, prisma, webhooks, redis, contracts, list, prices, partnerPlans };
}

describe('contractPrices — сетка цен договора для экрана', () => {
  it('свой тариф — не корпоративный: отказ, а не пустая сетка', async () => {
    /* Риск: экран тарифа гостиницы запросит цены договора и получит пусто —
       как будто договор есть, а цен в нём нет. Пустой ответ здесь соврал бы. */
    const { prices, contracts } = fixture({ plan: plan({ id: 'own', forOperator: false }) });
    const call = prices('own');
    await expect(call).rejects.toBeInstanceOf(BadRequestException);
    await expect(call).rejects.toThrow('Это не корпоративный тариф оператора');
    expect(contracts.sliceOf).not.toHaveBeenCalled();
  });

  it('среза нет — пусто, но видно почему: unknownCustomer и категории', async () => {
    /* Риск: при неизвестной авиакомпании подставить «любую» — значит показать
       чужую цену. Ответ обязан быть пустым, но не безмолвным: экран должен
       объяснить, что кода авиакомпании нет, и всё равно показать категории. */
    const { prices, contracts } = fixture({
      plan: plan({ partnerCustomerId: 'cust-1' }),
      slice: { slice: null, unknownCustomer: true },
    });
    const res = await prices();
    expect(res.hasSlice).toBe(false);
    expect(res.unknownCustomer).toBe(true);
    expect(res.periods).toEqual([]);
    expect(res.nights).toEqual([]);
    expect(res.vatRate).toBeNull();
    expect(res.contractNumber).toBe('205');
    expect(res.categories).toEqual([
      { categoryId: CATEGORY, name: 'Двухместный', capacity: 2 },
    ]);
    // Чужие договоры не читаются: цены «для кого-то» не подставляются.
    expect(contracts.docsFor).not.toHaveBeenCalled();
  });

  it('срез есть — периоды ДС, цена по категории и гостям, НДС из документа', async () => {
    /* Риск: экран и счёт считаются разными правилами и расходятся молча.
       Цена здесь — результат настоящего contractNightRub по сетке документа:
       500 000 копеек = «5000.00» рублей, и только на двоих. Вторая ДС — ЧУЖОГО
       юрлица: правило цены её не берёт, значит и выбору периода она не годится. */
    const { prices, contracts } = fixture({
      plan: plan({ partnerAccountId: 'acc-1' }),
      slice: { slice: { ...SLICE, accountCode: 'acc-1' }, unknownCustomer: false },
      docs: [
        fillDoc({ accountCode: 'acc-1' }),
        fillDoc({ accountCode: 'acc-2', fill: [grid('2026-03-01')] }),
      ],
    });
    const res = await prices('corp', DAY, DAY);
    expect(contracts.docsFor).toHaveBeenCalledWith('p1');
    expect(res.hasSlice).toBe(true);
    expect(res.unknownCustomer).toBe(false);
    expect(res.periods).toEqual(['2026-01-01']);
    expect(res.nights).toEqual([
      { day: DAY, prices: [{ categoryId: CATEGORY, occupancy: 2, price: '5000.00' }] },
    ]);
    expect(res.vatRate).toBe(20);
  });

  it('НДС — документа ЗАПРОШЕННОГО окна, а не сегодняшнего', async () => {
    /* Риск: две ДС с разными ставками. «Сегодняшний» НДС показал бы отелю
       ставку старого документа на будущий период, а если документ периода
       сегодня не покрыт — ещё и соврал бы «без НДС». */
    const { prices } = fixture({
      plan: plan(),
      slice: { slice: SLICE, unknownCustomer: false },
      docs: [
        fillDoc(),
        fillDoc({
          amendmentNumber: '2',
          validFrom: '2027-01-01T00:00:00.000Z',
          vatRate: 0,
          fill: [grid('2027-01-01')],
        }),
      ],
    });
    const res = await prices('corp', '2027-02-01', '2027-02-01');
    expect(res.vatRate).toBe(0);
    expect(res.periods).toEqual(['2026-01-01', '2027-01-01']);
  });
});

describe('withOperatorStatus — «применяется» по цене договора, а не по вердикту', () => {
  it('цена на сегодня есть — корпоративный применяется, свой остаётся без статуса', async () => {
    /* applies — шлюз в предложения партнёра (connectivity). Ошибка здесь тихо
       убирает корпоративный тариф из выдачи или, наоборот, пускает в неё
       тариф без цены. Свой тариф статуса не имеет вовсе. */
    const { list, contracts } = fixture({
      plans: [plan(), OWN_PLAN],
      contractRows: [rowDoc()],
      states: new Map([['corp', { hasPrice: true, unknownCustomer: false, vatRate: 20 }]]),
    });
    const plans = await list();
    const corp = plans.find((p) => p.id === 'corp');
    const own = plans.find((p) => p.id === 'own');
    expect(corp?.operatorStatus).toEqual({
      state: 'CONFIRMED',
      reason: 'Цены из договора',
      applies: true,
    });
    expect(corp?.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(own?.operatorStatus).toBeNull();
    expect(own?.fingerprint).toBeNull();
    // Спрашивают только за корпоративные: у своих цена договора ни при чём.
    expect(contracts.priceStates.mock.calls[0][0].map((p: { id: string }) => p.id)).toEqual([
      'corp',
    ]);
    expect(contracts.priceStates.mock.calls[0][1]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('цены на сегодня нет — старое «подтверждено» тариф не применяет', async () => {
    /* Именно этот случай ломал 7 гостиниц: вердикт «подтверждено» лежит в
       базе, а цены договора на сегодня нет. Вердикт — история, не шлюз. */
    const { list } = fixture({
      plans: [plan({ reviewVerdict: 'CONFIRMED', reviewFingerprint: 'yesterday' })],
      contractRows: [rowDoc()],
      states: new Map([['corp', { hasPrice: false, unknownCustomer: false, vatRate: null }]]),
    });
    const [corp] = await list();
    expect(corp.operatorStatus).toEqual({
      state: 'DRAFT',
      reason: 'Цены договора на сегодня нет',
      applies: false,
    });
  });

  it('отпечаток договорный: новая ДС его меняет', async () => {
    /* Отпечаток остался у вердикта Авии (applyOperatorReview), но стережёт
       теперь ДС и условия. Если бы он считался по пустому набору документов,
       новая ДС не ломала бы «я видел эти цены» — вердикт лёг бы под другие
       бумаги. */
    const before = fixture({
      plans: [plan()],
      contractRows: [rowDoc()],
      states: new Map([['corp', { hasPrice: true, unknownCustomer: false, vatRate: 20 }]]),
    });
    const after = fixture({
      plans: [plan()],
      contractRows: [rowDoc(), rowDoc({ amendmentNumber: '2' })],
      states: new Map([['corp', { hasPrice: true, unknownCustomer: false, vatRate: 20 }]]),
    });
    const first = (await before.list())[0].fingerprint;
    const second = (await after.list())[0].fingerprint;
    expect(first).toBeTruthy();
    expect(second).not.toBe(first);
  });

  it('отпечаток не смотрит на строки цен тарифа — их больше не читают', async () => {
    /* Риск: отпечаток прежней формы строился по Rate, сезонам и базовым
       ценам. Теперь своих цен у корпоративного тарифа нет, и чтение этих
       таблиц означало бы, что отпечаток (а с ним и «изменились цены»)
       по-прежнему зависит от истории. Подмена строк не меняет отпечаток. */
    const { list, tx } = fixture({
      plans: [plan()],
      contractRows: [rowDoc()],
      states: new Map([['corp', { hasPrice: true, unknownCustomer: false, vatRate: 20 }]]),
    });
    const first = (await list())[0].fingerprint;

    tx.rate.findMany.mockImplementation(async () => [{ price: '9999.00' }]);
    tx.standardRate.findMany.mockImplementation(async () => [{ price: '9999.00' }]);

    const second = (await list())[0].fingerprint;
    expect(second).toBe(first);
    expect(tx.rate.findMany).not.toHaveBeenCalled();
    expect(tx.rateSeason.findMany).not.toHaveBeenCalled();
    expect(tx.standardRate.findMany).not.toHaveBeenCalled();
  });

  it('гейт спрашивает цену на НУЖНЫЕ ночи: сетка из будущего применяется в свой день', async () => {
    /* Риск: «применяется» жёстко по сегодняшнему дню. Новый годовой договор с
       сеткой из будущего тогда невидим и небронируем ровно на те ночи, которые
       priceByPlan уже считает. Экран (list) по-прежнему смотрит на сегодня, а
       предложение и бронь передают день заезда в partnerPlans. */
    const futureDoc = fillDoc({
      validFrom: '2020-01-01T00:00:00.000Z',
      fill: [grid(FUTURE_DAY)],
    });
    const { partnerPlans, contracts } = fixture({
      plans: [plan()],
      contractRows: [rowDoc()],
      // Заглушка спрашивает НАСТОЯЩЕЕ правило цены про переданный день.
      statesFor: (day) =>
        new Map([
          [
            'corp',
            {
              hasPrice: contractHasPriceOn([futureDoc], SLICE, day),
              unknownCustomer: false,
              vatRate: contractVatRate([futureDoc], SLICE, day),
            },
          ],
        ]),
    });

    // Сегодня сетка ещё не началась — и тариф честно не применяется.
    const [today] = await partnerPlans('p1');
    expect(today.operatorStatus?.applies).toBe(false);

    // Ночь запроса попадает в сетку — тариф применяется, вердикта человека нет.
    const [future] = await partnerPlans('p1', FUTURE_DAY);
    expect(future.operatorStatus?.applies).toBe(true);
    expect(future.operatorStatus?.state).toBe('CONFIRMED');

    // День доехал до правила, а не подменился «сегодня».
    expect(contracts.priceStates).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'corp' })],
      FUTURE_DAY,
    );
  });
});
