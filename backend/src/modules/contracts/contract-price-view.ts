import { contractNumberKey } from './contract-identity';
import {
  ContractDayReason,
  ContractPriceDoc,
  ContractPriceBasis,
  TariffSlice,
  contractDayContext,
  kopecksToRub,
  ownContractDocs,
  usableFillCell,
  isContractPriceBasis,
} from './contract-price';

export interface ContractCategory {
  categoryId: string;
  name: string;
  capacity: number | null;
}

export interface ContractPeriod {
  from: string;
  to: string | null;
  contractNumber: string;
  amendmentNumber: string | null;
  validFrom: string;
  validTo: string | null;
  vatRate: number | null;
}

const day10 = (value: string) => value.slice(0, 10);
const shiftDay = (day: string, offset: number) =>
  new Date(new Date(`${day}T00:00:00.000Z`).getTime() + offset * 86_400_000)
    .toISOString()
    .slice(0, 10);

/** Boundaries include expiry and grid starts: a gap must not look like an active DS. */
export function contractPeriods(docs: ContractPriceDoc[], slice: TariffSlice): ContractPeriod[] {
  const mine = ownContractDocs(docs, slice);
  const boundaries = new Set<string>();
  for (const doc of mine) {
    boundaries.add(day10(doc.validFrom));
    if (doc.validTo) boundaries.add(shiftDay(day10(doc.validTo), 1));
    for (const grid of doc.fill ?? []) {
      const from = day10(grid.from);
      if (from >= day10(doc.validFrom) && (!doc.validTo || from <= day10(doc.validTo)))
        boundaries.add(from);
    }
  }
  const days = [...boundaries].sort();
  const periods: ContractPeriod[] = [];
  let previous: ReturnType<typeof contractDayContext> | null = null;
  for (let i = 0; i < days.length; i++) {
    const context = contractDayContext(mine, slice, days[i]);
    const doc = context.doc;
    if (!doc) {
      previous = null;
      continue;
    }
    const to = days[i + 1] ? shiftDay(days[i + 1], -1) : null;
    if (previous?.doc === doc && previous.grid === context.grid) {
      periods[periods.length - 1].to = to;
    } else {
      periods.push({
        from: days[i],
        to,
        contractNumber: contractNumberKey(doc.contractNumber),
        amendmentNumber: doc.amendmentNumber,
        validFrom: day10(doc.validFrom),
        validTo: doc.validTo ? day10(doc.validTo) : null,
        vatRate: doc.vatRate,
      });
    }
    previous = context;
  }
  return periods;
}

/** One response builder for saved tariffs and drafts; no second pricing rule. */
export function contractPriceView(input: {
  contractNumber: string | null;
  slice: TariffSlice | null;
  unknownCustomer: boolean;
  docs: ContractPriceDoc[];
  categories: ContractCategory[];
  days: string[];
  today: string;
  timezone: string;
}) {
  const { slice, docs, categories, days } = input;
  const periodDetails = slice ? contractPeriods(docs, slice) : [];
  const nights = days.map((day) => {
    const context = slice ? contractDayContext(docs, slice, day) : null;
    const reason: ContractDayReason | 'UNKNOWN_CUSTOMER' | null =
      context?.reason ?? (context ? null : input.unknownCustomer ? 'UNKNOWN_CUSTOMER' : 'NO_SLICE');
    const cells = context?.slice?.cells.filter(usableFillCell) ?? [];
    const prices: {
      categoryId: string;
      occupancy: number;
      price: string;
      basis?: ContractPriceBasis;
    }[] = [];
    const missing: {
      categoryId: string;
      occupancy: number;
      reason: 'NO_CATEGORY_PRICE' | 'NO_OCCUPANCY_PRICE';
    }[] = [];
    for (const category of categories) {
      const ownCells = cells.filter((cell) => cell.categoryId === category.categoryId);
      for (let occupancy = 1; occupancy <= Math.max(1, category.capacity ?? 1); occupancy++) {
        const cell = ownCells.find((value) => value.occupancy === occupancy);
        if (cell)
          prices.push({
            categoryId: category.categoryId,
            occupancy,
            price: kopecksToRub(cell.price),
            ...(isContractPriceBasis(cell.basis) ? { basis: cell.basis } : {}),
          });
        else if (!reason)
          missing.push({
            categoryId: category.categoryId,
            occupancy,
            reason: ownCells.length ? 'NO_OCCUPANCY_PRICE' : 'NO_CATEGORY_PRICE',
          });
      }
    }
    const period = periodDetails.find((p) => p.from <= day && (!p.to || p.to >= day));
    return {
      day,
      prices,
      reason: reason ?? (prices.length ? null : 'NO_PRICES'),
      periodFrom: period?.from ?? null,
      amendmentNumber: context?.doc?.amendmentNumber ?? null,
      vatRate: context?.grid ? (context.doc?.vatRate ?? null) : null,
      missing,
    };
  });
  return {
    contractNumber: contractNumberKey(input.contractNumber) || null,
    hasSlice: slice != null,
    unknownCustomer: input.unknownCustomer,
    periods: periodDetails.map((p) => p.from),
    periodDetails,
    categories,
    nights,
    vatRate: nights[0]?.vatRate ?? null,
    today: input.today,
    timezone: input.timezone,
  };
}
