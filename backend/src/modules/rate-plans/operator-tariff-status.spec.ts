import {
  ContractPriceDoc,
  documentsLabel,
  operatorTariffStatus,
  tariffFingerprint,
} from './operator-tariff-status';

/* Правило проверяется ОТРИЦАНИЕМ: тариф применяется только подтверждённый и
 * только пока подтверждение — про сегодняшние цифры. Всё остальное — «нет».
 *
 * Дырка, которую эти тесты сторожат, глазами не видна: состояние «подтверждён»
 * выглядит одинаково и когда оно правда, и когда цены с тех пор поменялись. */

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

const rate = (price: number, date = '2026-09-01') => ({
  date,
  roomTypeId: 'rt-1',
  occupancy: 2,
  price,
  currency: 'RUB',
});

const fp = (docs: ContractPriceDoc[], rates = [rate(2800)]) =>
  tariffFingerprint({ docs, plan: shape, rates });

describe('отпечаток сверки', () => {
  it('не зависит от порядка ключей и строк', () => {
    const a = tariffFingerprint({
      docs: [doc({ rows: [{ price: 280000, categoryName: 'Двухместный' }] })],
      plan: shape,
      rates: [rate(2800, '2026-09-02'), rate(2800, '2026-09-01')],
    });
    const b = tariffFingerprint({
      docs: [doc({ rows: [{ categoryName: 'Двухместный', price: 280000 }] })],
      plan: shape,
      rates: [rate(2800, '2026-09-01'), rate(2800, '2026-09-02')],
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

  it('меняется, когда меняется СТАВКА тарифа', () => {
    expect(fp([doc()])).not.toBe(fp([doc()], [rate(3200)]));
  });

  it('меняется при смене ВАЛЮТЫ той же ставки', () => {
    // 2800 ₽ и 2800 $ — разные деньги; подтверждение первого не годится второму.
    expect(fp([doc()])).not.toBe(
      fp([doc()], [{ ...rate(2800), currency: 'USD' }]),
    );
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
  const confirmed = (fingerprint: string) => ({
    ...shape,
    operatorContract: '18',
    reviewVerdict: 'CONFIRMED' as const,
    reviewFingerprint: fingerprint,
  });

  it('без вердикта не применяется, даже если цены совпадают', () => {
    const cur = fp([doc()]);
    const s = operatorTariffStatus(
      { ...shape, operatorContract: '18', reviewVerdict: null, reviewFingerprint: null },
      [doc()],
      cur,
    );
    expect(s.state).toBe('DRAFT');
    expect(s.applies).toBe(false);
  });

  it('без договора говорит, чего не хватает', () => {
    const s = operatorTariffStatus(
      { ...shape, operatorContract: null, reviewVerdict: null, reviewFingerprint: null },
      [doc()],
      'x',
    );
    expect(s.reason).toContain('Не указан договор');
  });

  it('договор есть, а цен от оператора нет — так и сказано', () => {
    const s = operatorTariffStatus(
      { ...shape, operatorContract: '18', reviewVerdict: null, reviewFingerprint: null },
      [],
      'x',
    );
    expect(s.reason).toContain('ещё не прислал цены');
  });

  it('подтверждён и цены не менялись — применяется', () => {
    const cur = fp([doc()]);
    const s = operatorTariffStatus(confirmed(cur), [doc()], cur);
    expect(s.state).toBe('CONFIRMED');
    expect(s.applies).toBe(true);
  });

  it('пришла ДС — подтверждение слетает САМО', () => {
    const wasConfirmedWith = fp([doc()]);
    const docsNow = [doc(), doc({ amendmentNumber: '2' })];
    const s = operatorTariffStatus(
      confirmed(wasConfirmedWith),
      docsNow,
      fp(docsNow),
    );
    expect(s.state).toBe('STALE');
    expect(s.applies).toBe(false);
  });

  it('гостиница подняла ставку после подтверждения — тариф больше не применяется', () => {
    const wasConfirmedWith = fp([doc()]);
    const s = operatorTariffStatus(
      confirmed(wasConfirmedWith),
      [doc()],
      fp([doc()], [rate(3200)]),
    );
    expect(s.state).toBe('STALE');
    expect(s.applies).toBe(false);
  });

  it('отказ держится, пока оператор не посмотрит снова', () => {
    const s = operatorTariffStatus(
      {
        ...shape,
        operatorContract: '18',
        reviewVerdict: 'REJECTED',
        reviewFingerprint: fp([doc()]),
      },
      [doc()],
      fp([doc()], [rate(2800)]),
    );
    expect(s.state).toBe('REJECTED');
    expect(s.applies).toBe(false);
  });
});

describe('название сверенных документов', () => {
  it('без ДС', () => {
    expect(documentsLabel([doc()])).toBe('договор 18, без ДС');
  });
  it('одна ДС', () => {
    expect(documentsLabel([doc({ amendmentNumber: '2' })])).toBe('договор 18, ДС 2');
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
