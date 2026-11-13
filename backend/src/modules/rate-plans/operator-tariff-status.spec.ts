import {
  ContractPriceDoc,
  PlanPriceRow,
  documentsLabel,
  operatorTariffStatus,
  tariffFingerprint,
} from './operator-tariff-status';

/* Правило проверяется ОТРИЦАНИЕМ: тариф применяется, только когда по его срезу
 * есть цена договора на нужный день. Всё остальное — «нет», в том числе
 * прежнее «подтверждено»: вердикт человека — история, а не шлюз.
 *
 * Дырка, которую эти тесты сторожат, глазами не видна: тариф с ценой договора
 * выглядит рабочим и тогда, когда цены на запрошенные ночи в договоре нет. */

const doc = (over: Partial<ContractPriceDoc> = {}): ContractPriceDoc => ({
  contractNumber: '18',
  amendmentNumber: null,
  service: 'ACCOMMODATION',
  validFrom: '2026-01-01T00:00:00.000Z',
  validTo: null,
  vatRate: 20,
  rows: [{ categoryName: 'Двухместный', price: 280000 }],
  ...over,
});

const shape = {
  mealPlan: 'BB',
  occupancyPricing: false,
  priceModifierType: 'PERCENT',
  priceModifierValue: 0,
};

/* Цена ночи в PMS берётся из трёх мест: день → сезон → базовая цена.
   Тесты работают со всеми тремя видами строк, потому что дыра нашлась именно
   там, где вид был один. */
const day = (price: number, date = '2026-09-01') => ({
  kind: 'DAY' as const,
  roomTypeId: 'rt-1',
  occupancy: 2,
  dateFrom: date,
  dateTo: date,
  price,
  currency: 'RUB',
});
const standard = (price: number) => ({
  kind: 'STANDARD' as const,
  roomTypeId: 'rt-1',
  price,
  currency: 'RUB',
});
const season = (price: number, from = '2026-12-25', to = '2027-01-10') => ({
  kind: 'SEASON' as const,
  roomTypeId: 'rt-1',
  dateFrom: from,
  dateTo: to,
  price,
  currency: 'RUB',
});

const fp = (docs: ContractPriceDoc[], prices: PlanPriceRow[] = [day(2800)]) =>
  tariffFingerprint({ docs, plan: shape, prices });

describe('отпечаток сверки', () => {
  it('не зависит от порядка ключей и строк', () => {
    const a = tariffFingerprint({
      docs: [doc({ rows: [{ price: 280000, categoryName: 'Двухместный' }] })],
      plan: shape,
      prices: [day(2800, '2026-09-02'), day(2800, '2026-09-01')],
    });
    const b = tariffFingerprint({
      docs: [doc({ rows: [{ categoryName: 'Двухместный', price: 280000 }] })],
      plan: shape,
      prices: [day(2800, '2026-09-01'), day(2800, '2026-09-02')],
    });
    // Тот же документ, пересланный заново, не должен ронять подтверждение:
    // иначе «устарел» загорается на пустом месте и его перестают читать.
    expect(a).toBe(b);
  });

  it('меняется, когда меняется цена ДОГОВОРА', () => {
    expect(fp([doc()])).not.toBe(
      fp([doc({ rows: [{ categoryName: 'Двухместный', price: 320000 }] })]),
    );
  });

  it('меняется, когда меняется цена на ДЕНЬ', () => {
    expect(fp([doc()])).not.toBe(fp([doc()], [day(3200)]));
  });

  /* Дыра, найденная живой проверкой: базовая цена лежит в другой таблице, и
     отпечаток её не видел. Гостиница правила 2 800 → 3 200, счёт менялся, а
     сервер продолжал отвечать «подтверждён». */
  it('меняется, когда меняется БАЗОВАЯ цена категории', () => {
    expect(fp([doc()], [standard(2800)])).not.toBe(fp([doc()], [standard(3200)]));
  });

  it('меняется, когда меняется цена СЕЗОНА', () => {
    expect(fp([doc()], [season(4000)])).not.toBe(fp([doc()], [season(4500)]));
  });

  it('различает источники: та же цифра базовой ценой и ценой на день — разное', () => {
    // Иначе перенос цены из базовой в календарь прошёл бы незамеченным, а это
    // разные правила применения: день бьёт сезон, сезон бьёт базовую.
    expect(fp([doc()], [standard(2800)])).not.toBe(fp([doc()], [day(2800)]));
  });

  it('меняется при смене ВАЛЮТЫ той же ставки', () => {
    // 2800 ₽ и 2800 $ — разные деньги; подтверждение первого не годится второму.
    expect(fp([doc()])).not.toBe(fp([doc()], [{ ...day(2800), currency: 'USD' }]));
  });

  it('меняется, когда выходит новая ДС', () => {
    expect(fp([doc()])).not.toBe(fp([doc(), doc({ amendmentNumber: '2' })]));
  });

  it('не смешивает договоры: чужие приложения в отпечаток не входят', () => {
    // Сверяли с договором 18 — приложение договора 9 к делу не относится.
    const mine = [doc()];
    const withStranger = [doc(), doc({ contractNumber: '9' })];
    expect(fp(mine)).not.toBe(fp(withStranger));
  });
});

describe('состояние корпоративного тарифа', () => {
  const tariffPlan = (over: Record<string, unknown> = {}) => ({
    ...shape,
    partnerId: 'p1',
    operatorContract: '18',
    reviewVerdict: null,
    reviewFingerprint: null,
    ...over,
  });

  it('цена договора есть — применяется, вердикт человека не нужен', () => {
    const s = operatorTariffStatus(tariffPlan() as never, [doc()], true);
    expect(s.state).toBe('CONFIRMED');
    expect(s.applies).toBe(true);
    expect(s.reason).toBe('Цены из договора');
  });

  it('без договора говорит, чего не хватает', () => {
    const s = operatorTariffStatus(tariffPlan({ operatorContract: null }) as never, [doc()], true);
    expect(s.applies).toBe(false);
    expect(s.reason).toContain('Не указан договор');
  });

  it('договор есть, а цен от оператора нет — так и сказано', () => {
    const s = operatorTariffStatus(tariffPlan() as never, [], true);
    expect(s.applies).toBe(false);
    expect(s.reason).toContain('ещё не прислал цены');
  });

  it('приложение есть, а цены на сегодня нет — не применяется', () => {
    const s = operatorTariffStatus(tariffPlan() as never, [doc()], false);
    expect(s.applies).toBe(false);
    expect(s.reason).toContain('на сегодня');
  });

  it('чужой договор не считается', () => {
    const s = operatorTariffStatus(tariffPlan({ operatorContract: '9' }) as never, [doc()], true);
    expect(s.applies).toBe(false);
  });

  /* Вердикт остаётся в базе как история и на применение не влияет: именно
     этот случай ломал 7 гостиниц — «подтверждено», а цен нет. */
  it('старое «подтверждено» без цены договора не применяет тариф', () => {
    const s = operatorTariffStatus(
      tariffPlan({ reviewVerdict: 'CONFIRMED', reviewFingerprint: fp([doc()]) }) as never,
      [doc()],
      false,
    );
    expect(s.applies).toBe(false);
  });
});

describe('название сверенных документов', () => {
  it('без ДС', () => {
    expect(documentsLabel([doc()])).toBe('договор 18, без ДС');
  });
  it('одна ДС', () => {
    expect(documentsLabel([doc({ amendmentNumber: '2' })])).toBe('договор 18, ДС 2');
    // Партнёр присылает номер и с приставкой — «ДС ДС 1» быть не должно.
    expect(documentsLabel([doc({ amendmentNumber: 'ДС 1' }), doc({ amendmentNumber: 'ДС 10' }), doc({ amendmentNumber: 'ДС 2' })]))
      .toBe('договор 18, ДС 1, 2 и 10');
  });
  it('несколько ДС перечисляются по-русски', () => {
    expect(
      documentsLabel([
        doc({ amendmentNumber: '2' }),
        doc({ amendmentNumber: '3', service: 'MEAL' }),
      ]),
    ).toBe('договор 18, ДС 2 и 3');
  });
});
