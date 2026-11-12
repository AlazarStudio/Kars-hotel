import {
  ContractPriceDoc,
  TariffSlice,
  contractNightPrice,
  contractHasPriceOn,
  contractVatRate,
  contractNightPrices,
  contractNightRub,
} from './contract-price';

/* ПРАВИЛО ЦЕНЫ КОРПОРАТИВНОГО ТАРИФА (11.11.2026).
 *
 * Цена не считается в ПМС своим правилом: берутся готовые сетки Авии
 * (`fill` документа). Проверяется ровно то, на чём гостиницу посчитают:
 * срез, период ДС, число гостей и честное «нет цены». */

const slice = (over: Partial<TariffSlice> = {}): TariffSlice => ({
  partnerId: 'p1',
  contractNumber: '205',
  accountCode: 'ani',
  customerCode: null,
  guestKind: null,
  mealPlan: 'BB',
  ...over,
});

const doc = (over: Partial<ContractPriceDoc> = {}): ContractPriceDoc => ({
  partnerId: 'p1',
  contractNumber: '205',
  amendmentNumber: null,
  service: 'ACCOMMODATION',
  validFrom: '2025-11-10T00:00:00.000Z',
  validTo: null,
  vatRate: 20,
  accountCode: 'ani',
  fill: [
    {
      from: '2025-11-10',
      slices: [
        {
          customer: null,
          guestKind: null,
          mealPlan: 'BB',
          cells: [
            { categoryId: 'rt1', occupancy: 1, price: 300000 },
            { categoryId: 'rt1', occupancy: 2, price: 460000 },
          ],
        },
      ],
    },
  ],
  ...over,
});

/** Сетка с даты `from` одним срезом: любая авиакомпания, BB, категория rt1. */
const fillOf = (from: string, price: number) => [
  {
    from,
    slices: [
      {
        customer: null,
        guestKind: null,
        mealPlan: 'BB',
        cells: [{ categoryId: 'rt1', occupancy: 1, price }],
      },
    ],
  },
];

describe('contractNightPrice', () => {
  it('берёт ячейку среза: категория и число гостей', () => {
    expect(contractNightPrice([doc()], slice(), 'rt1', 2, '2026-03-01')).toBe(460000);
  });

  it('дата раньше первой сетки — цены нет', () => {
    expect(contractNightPrice([doc()], slice(), 'rt1', 1, '2025-11-09')).toBeNull();
  });

  it('новая ДС перекрывает цену со своей даты', () => {
    const second = doc({
      amendmentNumber: '2',
      fill: [
        {
          from: '2026-01-01',
          slices: [
            {
              customer: null,
              guestKind: null,
              mealPlan: 'BB',
              cells: [{ categoryId: 'rt1', occupancy: 1, price: 320000 }],
            },
          ],
        },
      ],
    });
    expect(contractNightPrice([doc(), second], slice(), 'rt1', 1, '2025-12-31')).toBe(300000);
    expect(contractNightPrice([doc(), second], slice(), 'rt1', 1, '2026-01-01')).toBe(320000);
  });

  /* Цены живут только внутри срока документа: сетка переживает свою ДС, но не
     сам договор. Разрыв между ДС — это дни, на которые цены никто не называл. */
  it('разрыв между ДС — цены нет, по краям — цена своего документа', () => {
    const first = doc({ validFrom: '2025-11-10', validTo: '2026-01-31' });
    const second = doc({
      amendmentNumber: '2',
      validFrom: '2026-03-01',
      validTo: null,
      fill: fillOf('2026-03-01', 400000),
    });
    expect(contractNightPrice([first, second], slice(), 'rt1', 1, '2026-02-15')).toBeNull();
    expect(contractNightPrice([first, second], slice(), 'rt1', 1, '2026-01-31')).toBe(300000);
    expect(contractNightPrice([first, second], slice(), 'rt1', 1, '2026-03-01')).toBe(400000);
  });

  it('после окончания договора — цены нет', () => {
    expect(
      contractNightPrice([doc({ validTo: '2026-01-31' })], slice(), 'rt1', 1, '2026-04-01'),
    ).toBeNull();
  });

  it('документ без validTo действует бессрочно', () => {
    const openEnded = doc({ validTo: null });
    expect(contractNightPrice([openEnded], slice(), 'rt1', 1, '2035-12-31')).toBe(300000);
  });

  it('срез чужой авиакомпании не подставляется, а «для любой» — да', () => {
    const own = doc({
      fill: [
        {
          from: '2025-11-10',
          slices: [
            {
              customer: 's7',
              guestKind: null,
              mealPlan: 'BB',
              cells: [{ categoryId: 'rt1', occupancy: 1, price: 250000 }],
            },
            {
              customer: null,
              guestKind: null,
              mealPlan: 'BB',
              cells: [{ categoryId: 'rt1', occupancy: 1, price: 300000 }],
            },
          ],
        },
      ],
    });
    expect(
      contractNightPrice([own], slice({ customerCode: 'cosmos' }), 'rt1', 1, '2026-03-01'),
    ).toBe(300000);
  });

  it('точный срез авиакомпании главнее общего', () => {
    const own = doc({
      fill: [
        {
          from: '2025-11-10',
          slices: [
            {
              customer: 'cosmos',
              guestKind: null,
              mealPlan: 'BB',
              cells: [{ categoryId: 'rt1', occupancy: 1, price: 210000 }],
            },
            {
              customer: null,
              guestKind: null,
              mealPlan: 'BB',
              cells: [{ categoryId: 'rt1', occupancy: 1, price: 300000 }],
            },
          ],
        },
      ],
    });
    expect(
      contractNightPrice([own], slice({ customerCode: 'cosmos' }), 'rt1', 1, '2026-03-01'),
    ).toBe(210000);
  });

  it('питания нет в договоре — цены нет, общее питание не подставляется', () => {
    expect(
      contractNightPrice([doc()], slice({ mealPlan: 'HB' }), 'rt1', 1, '2026-03-01'),
    ).toBeNull();
  });

  it('вида брони нет в договоре — цены нет', () => {
    expect(
      contractNightPrice([doc()], slice({ guestKind: 'CREW' }), 'rt1', 1, '2026-03-01'),
    ).toBeNull();
  });

  it('чужое юрлицо не считает', () => {
    expect(
      contractNightPrice([doc({ accountCode: 'kars' })], slice(), 'rt1', 1, '2026-03-01'),
    ).toBeNull();
  });

  /* null у документа — не «чужое юрлицо», а «договор юрлицом не ограничен»:
     Авиа присылает null, когда цены названы для всех юрлиц Карс. Поэтому
     тарифу с юрлицом 'ani' такой документ подходит — иначе тариф остался бы
     без цены, хотя договор её называет. Ограничивает только явное чужое. */
  it('документ без юрлица подходит тарифу с юрлицом, документ чужого — нет', () => {
    const anyEntity = doc({ accountCode: null });
    expect(contractNightPrice([anyEntity], slice(), 'rt1', 1, '2026-03-01')).toBe(300000);
    expect(
      contractNightPrice([doc({ accountCode: 'kars' })], slice(), 'rt1', 1, '2026-03-01'),
    ).toBeNull();
  });

  it('чужой партнёр и услуга MEAL не считаются', () => {
    expect(
      contractNightPrice([doc({ partnerId: 'p2' })], slice(), 'rt1', 1, '2026-03-01'),
    ).toBeNull();
    expect(
      contractNightPrice([doc({ service: 'MEAL' })], slice(), 'rt1', 1, '2026-03-01'),
    ).toBeNull();
  });

  it('пустой номер договора в срезе — цены нет', () => {
    expect(
      contractNightPrice([doc()], slice({ contractNumber: null }), 'rt1', 1, '2026-03-01'),
    ).toBeNull();
    expect(
      contractNightPrice([doc()], slice({ contractNumber: '' }), 'rt1', 1, '2026-03-01'),
    ).toBeNull();
  });

  it('гостей больше, чем есть в сетке — цены нет', () => {
    expect(contractNightPrice([doc()], slice(), 'rt1', 3, '2026-03-01')).toBeNull();
  });

  it('документ без сетки — цены нет (Авиа не собрала)', () => {
    expect(contractNightPrice([doc({ fill: null })], slice(), 'rt1', 1, '2026-03-01')).toBeNull();
  });

  it('чужой договор не считается', () => {
    expect(
      contractNightPrice([doc({ contractNumber: '999' })], slice(), 'rt1', 1, '2026-03-01'),
    ).toBeNull();
  });
});

describe('contractHasPriceOn', () => {
  it('есть хотя бы одна цена на день', () => {
    expect(contractHasPriceOn([doc()], slice(), '2026-03-01')).toBe(true);
    expect(contractHasPriceOn([doc()], slice(), '2025-01-01')).toBe(false);
  });
});

describe('contractVatRate', () => {
  it('НДС — из действующего документа', () => {
    const second = doc({
      amendmentNumber: '2',
      vatRate: 10,
      fill: [{ from: '2026-01-01', slices: [] }],
    });
    expect(contractVatRate([doc(), second], slice(), '2025-12-01')).toBe(20);
    expect(contractVatRate([doc(), second], slice(), '2026-02-01')).toBe(10);
  });

  it('цены на день нет — НДС тоже нет (договор не покрывает день)', () => {
    expect(contractVatRate([doc({ validTo: '2026-01-31' })], slice(), '2026-04-01')).toBeNull();
  });
});

describe('contractNightPrices', () => {
  it('по ночам проживания: дни вне договора остаются пустыми', () => {
    const prices = contractNightPrices([doc()], slice(), 'rt1', 1, [
      '2025-11-09',
      '2025-11-10',
      '2025-11-11',
    ]);
    expect([...prices.entries()]).toEqual([
      ['2025-11-10', 300000],
      ['2025-11-11', 300000],
    ]);
  });
});

describe('contractNightRub', () => {
  it('копейки Авии → рубли ПМС', () => {
    expect(contractNightRub([doc()], slice(), 'rt1', 1, '2026-03-01')).toBe('3000.00');
    expect(contractNightRub([doc()], slice(), 'rt1', 2, '2026-03-01')).toBe('4600.00');
  });

  it('цены нет — null, а не ноль', () => {
    expect(contractNightRub([doc()], slice(), 'rt1', 3, '2026-03-01')).toBeNull();
  });
});
