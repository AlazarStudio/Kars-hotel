import { contractNumberKey } from './contract-identity';

/** Partner metadata only: never used to select or calculate a price. */
export const CONTRACT_PRICE_BASES = ['category', 'class', 'kind', 'default-class'] as const;
export type ContractPriceBasis = (typeof CONTRACT_PRICE_BASES)[number];
export const isContractPriceBasis = (value: unknown): value is ContractPriceBasis =>
  CONTRACT_PRICE_BASES.some((basis) => basis === value);

/* ЦЕНА КОРПОРАТИВНОГО ТАРИФА — ИЗ ДОГОВОРА, А НЕ ИЗ ЕГО ПОЛЕЙ (11.11.2026).
 *
 * Реестр договоров Авии — мастер цен: там уже обговорённые с гостиницей
 * цифры, и спорить с ними в ПМС нечем. Поэтому у тарифа оператора своих строк
 * цен нет, а цена ночи берётся из сетки `fill`, которую Авиа посчитала СВОИМ
 * подбором. Своё правило здесь разошлось бы с её сверкой тихо — и разошлось бы
 * в деньгах.
 *
 * Правило ровно в объёме сетки: срез (авиакомпания × вид брони × питание),
 * период (последняя сетка, начавшаяся не позже дня) и ячейка (категория ×
 * гости). Всё остальное — честное «цены нет»: подставить общую цену вместо
 * отсутствующей значит пообещать цифру, которой в договоре не было. */
export interface FillCell {
  categoryId: string;
  occupancy: number;
  price: number;
  basis?: ContractPriceBasis | null;
}

export interface FillSlice {
  customer: string | null;
  guestKind: 'CREW' | 'DISRUPTION' | null;
  mealPlan: string;
  cells: FillCell[];
}

export interface FillGrid {
  /** День, с которого сетка действует (YYYY-MM-DD). */
  from: string;
  slices: FillSlice[];
}

/** Документ договора в объёме, который нужен правилу цены. */
export interface ContractPriceDoc {
  partnerId: string;
  contractNumber: string;
  amendmentNumber: string | null;
  service: string;
  validFrom: string;
  validTo: string | null;
  vatRate: number | null;
  accountCode: string | null;
  fill: FillGrid[] | null;
}

/** Срез, который воплощает тариф. */
export interface TariffSlice {
  partnerId: string;
  contractNumber: string | null;
  /** Код юрлица из справочника партнёра; null — любое. */
  accountCode: string | null;
  /** Код авиакомпании из справочника партнёра; null — любая. */
  customerCode: string | null;
  guestKind: 'CREW' | 'DISRUPTION' | null;
  mealPlan: string;
}

const day10 = (v: string) => String(v).slice(0, 10);

/** Документы этого договора: свой партнёр, услуга проживания, своё юрлицо. */
export function ownContractDocs(docs: ContractPriceDoc[], slice: TariffSlice): ContractPriceDoc[] {
  if (!contractNumberKey(slice.contractNumber)) return [];
  return docs.filter(
    (d) =>
      d.service === 'ACCOMMODATION' &&
      d.partnerId === slice.partnerId &&
      contractNumberKey(d.contractNumber) === contractNumberKey(slice.contractNumber) &&
      (!slice.accountCode || !d.accountCode || d.accountCode === slice.accountCode),
  );
}

/* Последняя сетка, начавшаяся не позже дня, и её документ. Сетка годится,
 * только если её ДОКУМЕНТ покрывает день: в разрыве между ДС и после окончания
 * договора цены нет (спека §3 п.2), а не «старая цена навсегда». Сетка Авии
 * привязана к документу, действовавшему в день её начала, поэтому отбор по
 * `from` среди покрывающих день документов даёт ту же цифру, что считает Авиа. */
function gridAt(
  docs: ContractPriceDoc[],
  slice: TariffSlice,
  day: string,
): { grid: FillGrid; doc: ContractPriceDoc } | null {
  const d = day10(day);
  let best: { grid: FillGrid; doc: ContractPriceDoc; from: string } | null = null;
  for (const doc of ownContractDocs(docs, slice)) {
    if (day10(doc.validFrom) > d) continue;
    if (doc.validTo && day10(doc.validTo) < d) continue;
    for (const grid of doc.fill ?? []) {
      const from = day10(grid.from);
      if (from <= d && (!best || from > best.from)) best = { grid, doc, from };
    }
  }
  return best ? { grid: best.grid, doc: best.doc } : null;
}

/* Срез сетки: авиакомпания — точная, иначе «для любой» (так её и посчитает
   Авиа); вид брони и питание — только точные. Нет среза — цены нет. */
function pickSlice(grid: FillGrid, slice: TariffSlice): FillSlice | null {
  const kind = slice.guestKind ?? null;
  const forCustomer = (customer: string | null) =>
    grid.slices.find(
      (s) =>
        (s.customer ?? null) === customer &&
        (s.guestKind ?? null) === kind &&
        s.mealPlan === slice.mealPlan,
    ) ?? null;
  return forCustomer(slice.customerCode ?? null) ?? (slice.customerCode ? forCustomer(null) : null);
}

/** Stored legacy JSON is not guaranteed to satisfy today's DTO validation. */
export function usableFillCell(value: unknown): value is FillCell {
  if (!value || typeof value !== 'object') return false;
  const cell = value as Partial<FillCell>;
  return (
    typeof cell.categoryId === 'string' &&
    cell.categoryId.length > 0 &&
    Number.isInteger(cell.occupancy) &&
    Number(cell.occupancy) > 0 &&
    Number.isSafeInteger(cell.price) &&
    Number(cell.price) >= 0
  );
}

export type ContractDayReason =
  | 'NO_DOCUMENTS'
  | 'NO_GRIDS'
  | 'OUTSIDE_CONTRACT'
  | 'NO_SLICE'
  | 'NO_PRICES';

/** Shared decision for calculation and read-only price/preview screens. */
export function contractDayContext(
  docs: ContractPriceDoc[],
  slice: TariffSlice,
  day: string,
): {
  doc: ContractPriceDoc | null;
  grid: FillGrid | null;
  slice: FillSlice | null;
  reason: ContractDayReason | null;
} {
  const mine = ownContractDocs(docs, slice);
  if (!mine.length) return { doc: null, grid: null, slice: null, reason: 'NO_DOCUMENTS' };
  const d = day10(day);
  const covering = mine.filter(
    (doc) => day10(doc.validFrom) <= d && (!doc.validTo || day10(doc.validTo) >= d),
  );
  if (!covering.length) return { doc: null, grid: null, slice: null, reason: 'OUTSIDE_CONTRACT' };
  const at = gridAt(mine, slice, day);
  if (!at) {
    const doc = [...covering].sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0];
    return { doc, grid: null, slice: null, reason: 'NO_GRIDS' };
  }
  const selected = pickSlice(at.grid, slice);
  return {
    ...at,
    slice: selected,
    reason: !selected ? 'NO_SLICE' : selected.cells.some(usableFillCell) ? null : 'NO_PRICES',
  };
}

/** Цена ночи в копейках; null — цены нет. */
export function contractNightPrice(
  docs: ContractPriceDoc[],
  slice: TariffSlice,
  roomTypeId: string,
  guests: number,
  day: string,
): number | null {
  const at = contractDayContext(docs, slice, day);
  if (!at.slice) return null;
  const cell = at.slice.cells.find(
    (c) => usableFillCell(c) && c.categoryId === roomTypeId && c.occupancy === guests,
  );
  return cell ? cell.price : null;
}

/** Есть ли на день хоть одна цена этого среза — для состояния тарифа. */
export function contractHasPriceOn(
  docs: ContractPriceDoc[],
  slice: TariffSlice,
  day: string,
): boolean {
  return contractDayContext(docs, slice, day).reason === null;
}

/** НДС договора на день: ставка документа, который дал цены. */
export function contractVatRate(
  docs: ContractPriceDoc[],
  slice: TariffSlice,
  day: string,
): number | null {
  return gridAt(docs, slice, day)?.doc.vatRate ?? null;
}

/** Цены по ночам проживания; дни без цены в набор не попадают. */
export function contractNightPrices(
  docs: ContractPriceDoc[],
  slice: TariffSlice,
  roomTypeId: string,
  guests: number,
  days: string[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const day of days) {
    const price = contractNightPrice(docs, slice, roomTypeId, guests, day);
    if (price != null) out.set(day10(day), price);
  }
  return out;
}

/* Цены Авии — КОПЕЙКИ, цены ПМС — РУБЛИ. Переводятся здесь, на границе и один
   раз: две конвертации в разных местах разошлись бы в сто раз. */
export function kopecksToRub(price: number): string {
  return (price / 100).toFixed(2);
}

/** Цена договора на ночь в рублях; null — цены нет. */
export function contractNightRub(
  docs: ContractPriceDoc[],
  slice: TariffSlice,
  roomTypeId: string,
  guests: number,
  day: string,
): string | null {
  const price = contractNightPrice(docs, slice, roomTypeId, guests, day);
  return price == null ? null : kopecksToRub(price);
}
