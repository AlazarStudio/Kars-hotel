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
function ownDocs(docs: ContractPriceDoc[], slice: TariffSlice): ContractPriceDoc[] {
  if (!slice.contractNumber) return [];
  return docs.filter(
    (d) =>
      d.service === 'ACCOMMODATION' &&
      d.partnerId === slice.partnerId &&
      d.contractNumber === slice.contractNumber &&
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
  for (const doc of ownDocs(docs, slice)) {
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

/** Цена ночи в копейках; null — цены нет. */
export function contractNightPrice(
  docs: ContractPriceDoc[],
  slice: TariffSlice,
  roomTypeId: string,
  guests: number,
  day: string,
): number | null {
  const at = gridAt(docs, slice, day);
  if (!at) return null;
  const own = pickSlice(at.grid, slice);
  if (!own) return null;
  const cell = own.cells.find((c) => c.categoryId === roomTypeId && c.occupancy === guests);
  return cell ? cell.price : null;
}

/** Есть ли на день хоть одна цена этого среза — для состояния тарифа. */
export function contractHasPriceOn(
  docs: ContractPriceDoc[],
  slice: TariffSlice,
  day: string,
): boolean {
  const at = gridAt(docs, slice, day);
  if (!at) return false;
  const own = pickSlice(at.grid, slice);
  return !!own && own.cells.length > 0;
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
