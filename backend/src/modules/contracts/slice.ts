import { TariffSlice } from './contract-price';

/** Условия тарифа в объёме, который нужен срезу. */
export interface PlanSliceSource {
  partnerId: string | null;
  operatorContract: string | null;
  partnerAccountId: string | null;
  partnerCustomerId: string | null;
  guestKind: 'CREW' | 'DISRUPTION' | null;
  mealPlan: string;
}

export interface SliceResolution {
  slice: TariffSlice | null;
  /** Ссылка на авиакомпанию есть, а кода в справочнике нет — цены не будет. */
  unknownCustomer: boolean;
}

/** Срез тарифа — кодами справочника партнёра, как их называет договор. */
export function sliceFromPlan(
  plan: PlanSliceSource,
  accountCode: string | null,
  customerCode: string | null,
): SliceResolution {
  if (!plan.partnerId || !plan.operatorContract) {
    return { slice: null, unknownCustomer: false };
  }
  if (plan.partnerCustomerId && !customerCode) {
    return { slice: null, unknownCustomer: true };
  }
  return {
    slice: {
      partnerId: plan.partnerId,
      contractNumber: plan.operatorContract,
      accountCode,
      customerCode,
      guestKind: plan.guestKind,
      mealPlan: plan.mealPlan,
    },
    unknownCustomer: false,
  };
}
