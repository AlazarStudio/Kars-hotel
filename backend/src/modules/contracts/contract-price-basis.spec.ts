import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConnectFillCellDto } from '../connectivity/dto/connect-contract-prices.dto';
import { contractNightPrice, ContractPriceDoc, TariffSlice } from './contract-price';
import { contractPriceView } from './contract-price-view';

const categoryId = '00000000-0000-4000-8000-000000000002';
const slice: TariffSlice = {
  partnerId: 'p',
  contractNumber: 'QA',
  accountCode: null,
  customerCode: null,
  guestKind: null,
  mealPlan: 'NONE',
};
function doc(basis?: string): ContractPriceDoc {
  const cell = { categoryId, occupancy: 1, price: 560000, ...(basis ? { basis } : {}) };
  return {
    partnerId: 'p',
    contractNumber: 'QA',
    amendmentNumber: null,
    service: 'ACCOMMODATION',
    validFrom: '2026-11-15',
    validTo: null,
    vatRate: 0,
    accountCode: null,
    fill: [
      {
        from: '2026-11-15',
        slices: [{ customer: null, guestKind: null, mealPlan: 'NONE', cells: [cell] }],
      },
    ],
  } as ContractPriceDoc;
}
function view(docs: ContractPriceDoc[], days = ['2026-11-15']) {
  return contractPriceView({
    contractNumber: 'QA',
    slice,
    unknownCustomer: false,
    docs,
    categories: [{ categoryId, name: 'Супериор', capacity: 1 }],
    days,
    today: days[0],
    timezone: 'Europe/Moscow',
  });
}

describe('основание цены — метаданные, не правило расчёта', () => {
  it.each(['category', 'class', 'default-class', 'kind'])(
    'принимает %s без потери при whitelist',
    async (basis) => {
      const value = plainToInstance(ConnectFillCellDto, {
        categoryId,
        occupancy: 1,
        price: 560000,
        basis,
      });
      expect(await validate(value, { whitelist: true })).toEqual([]);
      expect(value).toHaveProperty('basis', basis);
    },
  );
  it('отклоняет неизвестное основание, старый payload остаётся допустимым', async () => {
    const value = plainToInstance(ConnectFillCellDto, {
      categoryId,
      occupancy: 1,
      price: 560000,
      basis: 'invented',
    });
    expect((await validate(value, { whitelist: true })).some((e) => e.property === 'basis')).toBe(
      true,
    );
    expect(
      await validate(
        plainToInstance(ConnectFillCellDto, { categoryId, occupancy: 1, price: 560000 }),
        { whitelist: true },
      ),
    ).toEqual([]);
  });
  it('передаёт основания по дням и ДС без изменения денег', () => {
    const base = doc('class');
    base.validTo = '2026-11-19';
    const amendment = doc('default-class');
    amendment.validFrom = '2026-11-20';
    amendment.amendmentNumber = '1';
    amendment.fill![0].from = '2026-11-20';
    const result = view([base, amendment], ['2026-11-19', '2026-11-20']);
    expect(result.nights.map((n) => n.prices[0])).toEqual([
      { categoryId, occupancy: 1, price: '5600.00', basis: 'class' },
      { categoryId, occupancy: 1, price: '5600.00', basis: 'default-class' },
    ]);
    expect(contractNightPrice([base], slice, categoryId, 1, '2026-11-19')).toEqual(
      contractNightPrice([doc()], slice, categoryId, 1, '2026-11-19'),
    );
    expect(contractNightPrice([base], slice, categoryId, 1, '2026-11-19')).toBe(560000);
    expect(view([base], ['2026-11-20']).nights[0].prices).toEqual([]);
  });
  it.each([undefined, 'invented'])(
    'не выдаёт старое/неизвестное основание за прямую цену: %s',
    (basis) => {
      expect(view([doc(basis)]).nights[0].prices[0]).toEqual({
        categoryId,
        occupancy: 1,
        price: '5600.00',
      });
    },
  );
});
