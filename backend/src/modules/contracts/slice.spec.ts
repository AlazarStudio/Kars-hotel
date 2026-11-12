import { sliceFromPlan } from './slice';

/* Срез тарифа: условия тарифа ПМС → коды договора.
 *
 * Авиакомпания хранится у нас ссылкой на справочник партнёра, а в договоре —
 * кодом. Справочник не знает код (запись выключили) — считать нечем, и это
 * не «любая авиакомпания»: иначе тариф молча считался бы по общим ценам. */

const plan = {
  partnerId: 'p1',
  operatorContract: '205',
  partnerAccountId: 'a1',
  partnerCustomerId: 'c1',
  guestKind: null,
  mealPlan: 'BB',
};

describe('sliceFromPlan', () => {
  it('собирает срез кодами договора', () => {
    expect(sliceFromPlan(plan, 'ani', 'cosmos')).toEqual({
      slice: {
        partnerId: 'p1',
        contractNumber: '205',
        accountCode: 'ani',
        customerCode: 'cosmos',
        guestKind: null,
        mealPlan: 'BB',
      },
      unknownCustomer: false,
    });
  });

  it('без договора тарифа не считаем', () => {
    expect(sliceFromPlan({ ...plan, operatorContract: null }, 'ani', 'cosmos')).toEqual({
      slice: null,
      unknownCustomer: false,
    });
  });

  it('авиакомпании нет в справочнике — цены нет, а не «любая»', () => {
    expect(sliceFromPlan(plan, 'ani', null)).toEqual({
      slice: null,
      unknownCustomer: true,
    });
  });

  it('тариф «для любой авиакомпании» — законный срез', () => {
    const r = sliceFromPlan({ ...plan, partnerCustomerId: null }, 'ani', null);
    expect(r.slice?.customerCode).toBeNull();
    expect(r.unknownCustomer).toBe(false);
  });
});
