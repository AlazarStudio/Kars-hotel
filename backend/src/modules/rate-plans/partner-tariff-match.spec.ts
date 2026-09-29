import { PartnerPlanScope, pickPartnerPlans } from './partner-tariff-match';

/* «Космос» (Мурманск): общий тариф для партнёра, отдельный для «Смартавиа»,
   отдельный «Смартавиа — сбойный рейс», и тариф другого партнёра. */
const plan = (id: string, over: Partial<PartnerPlanScope> = {}): PartnerPlanScope => ({
  id,
  partnerId: 'kars',
  partnerAccountId: null,
  partnerCustomerId: null,
  guestKind: null,
  isActive: true,
  ...over,
});

const plans = [
  plan('general'),
  plan('smart', { partnerCustomerId: 'smartavia' }),
  plan('smart-disruption', { partnerCustomerId: 'smartavia', guestKind: 'DISRUPTION' }),
  plan('ani', { partnerAccountId: 'ani-group' }),
  plan('other-partner', { partnerId: 'other' }),
  plan('off', { partnerCustomerId: 'rossiya', isActive: false }),
];
const ids = (xs: PartnerPlanScope[]) => xs.map((p) => p.id);

describe('pickPartnerPlans — какой корпоративный тариф применяется', () => {
  it('самый точный подходящий: «Смартавиа — сбойный рейс» для сбоя Смартавиа', () => {
    expect(
      ids(pickPartnerPlans(plans, { partnerId: 'kars', customerId: 'smartavia', guestKind: 'DISRUPTION' })),
    ).toEqual(['smart-disruption']);
  });

  it('экипаж Смартавиа — тариф Смартавиа, а не сбойный и не общий', () => {
    expect(ids(pickPartnerPlans(plans, { partnerId: 'kars', customerId: 'smartavia', guestKind: 'CREW' }))).toEqual([
      'smart',
    ]);
  });

  it('другая авиакомпания — общий тариф; выключенный тариф «России» не применяется', () => {
    expect(ids(pickPartnerPlans(plans, { partnerId: 'kars', customerId: 'rossiya' }))).toEqual(['general']);
  });

  it('заказчик весит больше юрлица', () => {
    expect(
      ids(pickPartnerPlans(plans, { partnerId: 'kars', accountId: 'ani-group', customerId: 'smartavia' })),
    ).toEqual(['smart']);
    expect(ids(pickPartnerPlans(plans, { partnerId: 'kars', accountId: 'ani-group' }))).toEqual(['ani']);
  });

  it('тариф с условием НЕ применяется, если в запросе условие не названо', () => {
    const only = [plan('smart', { partnerCustomerId: 'smartavia' })];
    expect(pickPartnerPlans(only, { partnerId: 'kars' })).toEqual([]);
  });

  it('чужой партнёр — не наш тариф', () => {
    expect(ids(pickPartnerPlans(plans, { partnerId: 'other' }))).toEqual(['other-partner']);
    expect(pickPartnerPlans(plans, { partnerId: 'nobody' })).toEqual([]);
  });

  it('тарифы одной точности различаются питанием — возвращаются оба', () => {
    const both = [plan('ro', {}), plan('bb', {})];
    expect(ids(pickPartnerPlans(both, { partnerId: 'kars' }))).toEqual(['ro', 'bb']);
  });
});
