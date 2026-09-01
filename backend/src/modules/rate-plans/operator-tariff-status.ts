import { createHash } from 'node:crypto';

/* СОСТОЯНИЕ КОРПОРАТИВНОГО ТАРИФА — правило, а не поле.
 *
 * Гостиница заводит тариф для оператора, оператор его подтверждает построчно
 * против ценового приложения договора. Дальше начинается интересное: обе
 * стороны продолжают жить. Оператор присылает новую ДС, гостиница правит
 * ставки — и подтверждение, выданное вчера, говорит уже не о тех цифрах.
 *
 * Хранить «подтверждён» флагом значит помнить сбрасывать его из каждого места,
 * где меняется любая из двух сторон. Таких мест уже сейчас несколько, а будет
 * больше — и однажды не сбросят. Тогда система молча посчитает деньги по
 * ставке, которую никто не проверял, и узнают об этом на акте.
 *
 * Поэтому хранится только РЕШЕНИЕ человека и ОТПЕЧАТОК того, что он смотрел, а
 * состояние вычисляется сравнением отпечатка с текущим. Слететь оно может
 * само; удержаться, не будучи правдой, — нет.
 */

export type OperatorTariffState = 'DRAFT' | 'CONFIRMED' | 'REJECTED' | 'STALE';

/** Приложение к договору — снимок, присланный оператором. */
export interface ContractPriceDoc {
  contractNumber: string;
  amendmentNumber: string | null;
  service: string;
  validFrom: Date | string;
  validTo: Date | string | null;
  vatRate: number | null;
  rows: unknown;
}

/* Цена тарифа приходит из ТРЁХ источников, и все три обязаны быть в отпечатке.
 *
 * PMS считает ночь так: цена на день, иначе сезон, иначе базовая цена
 * категории. Взять в отпечаток только календарь — оставить две открытые двери:
 * гостиница правит базовую цену, счёт меняется, а подтверждение висит. Это не
 * умозрительная дыра — ровно так и вышло при живой проверке 01.09.2026:
 * базовая цена 2 800 → 3 200, сервер продолжал говорить «подтверждён». */
export interface PlanPriceRow {
  kind: 'STANDARD' | 'SEASON' | 'DAY';
  roomTypeId: string;
  /** У базовой цены и сезона размещения нет — цена одна на категорию. */
  occupancy?: number | null;
  dateFrom?: Date | string | null;
  dateTo?: Date | string | null;
  price: unknown;
  /** Валюта — часть цены: 2800 ₽ и 2800 $ это разные деньги. */
  currency: string;
}

/** Свойства тарифа, влияющие на цену помимо ставок. */
export interface PlanPricingShape {
  mealPlan: string;
  occupancyPricing: boolean;
  priceModifierType: string;
  priceModifierValue: unknown;
}

export interface ReviewedPlan extends PlanPricingShape {
  operatorContract: string | null;
  reviewVerdict: 'CONFIRMED' | 'REJECTED' | null;
  reviewFingerprint: string | null;
}

/** Канонизация: порядок ключей в JSON не должен влиять на отпечаток.
 *
 * Строки приложений приезжают чужим JSON-ом по HTTP, и порядок полей в нём
 * никто не обещал. Без канонизации подтверждение слетало бы от пересылки того
 * же самого документа — «слетело само» превратилось бы в шум, а шум перестают
 * читать. */
function canonical(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(src).sort()) out[key] = canonical(src[key]);
  return out;
}

const iso = (v: Date | string): string =>
  v instanceof Date ? v.toISOString() : new Date(v).toISOString();

/* Отпечаток берётся с ОБЕИХ сторон сверки.
 *
 * Соблазн — считать его только по договору: «пришла новая ДС — пересверить».
 * Но подтверждают не документ, а СОВПАДЕНИЕ тарифа с документом, и ломается
 * оно с двух концов. Гостиница, поправившая ставку после подтверждения, — не
 * теоретический случай: тариф её, править его она вправе, и именно так
 * подтверждение превратилось бы в справку о прошлом. */
export function tariffFingerprint(input: {
  docs: ContractPriceDoc[];
  plan: PlanPricingShape;
  prices: PlanPriceRow[];
}): string {
  const docs = [...input.docs]
    .map((d) => ({
      contractNumber: d.contractNumber,
      amendmentNumber: d.amendmentNumber,
      service: d.service,
      validFrom: iso(d.validFrom),
      validTo: d.validTo == null ? null : iso(d.validTo),
      vatRate: d.vatRate,
      rows: canonical(d.rows),
    }))
    .sort((a, b) =>
      `${a.service}|${a.amendmentNumber ?? ''}|${a.validFrom}`.localeCompare(
        `${b.service}|${b.amendmentNumber ?? ''}|${b.validFrom}`,
      ),
    );

  const day = (v: Date | string | null | undefined) =>
    v == null ? '' : iso(v).slice(0, 10);

  const prices = [...input.prices]
    .map((r) => ({
      kind: r.kind,
      roomTypeId: r.roomTypeId,
      occupancy: r.occupancy ?? null,
      dateFrom: day(r.dateFrom),
      dateTo: day(r.dateTo),
      price: String(r.price),
      currency: r.currency,
    }))
    .sort((a, b) =>
      `${a.kind}|${a.roomTypeId}|${a.dateFrom}|${a.dateTo}|${a.occupancy ?? ''}`.localeCompare(
        `${b.kind}|${b.roomTypeId}|${b.dateFrom}|${b.dateTo}|${b.occupancy ?? ''}`,
      ),
    );

  const plan = {
    mealPlan: input.plan.mealPlan,
    occupancyPricing: input.plan.occupancyPricing,
    priceModifierType: input.plan.priceModifierType,
    priceModifierValue: String(input.plan.priceModifierValue),
  };

  return createHash('sha256')
    .update(JSON.stringify({ docs, plan, prices }))
    .digest('hex');
}

/** Приложения ИМЕННО того договора, который воплощает тариф. */
export function docsOfContract(
  docs: ContractPriceDoc[],
  contractNumber: string | null,
): ContractPriceDoc[] {
  if (!contractNumber) return [];
  return docs.filter((d) => d.contractNumber === contractNumber);
}

/** Как назвать сверенные документы человеку: «договор 18, ДС 2 и 3». */
export function documentsLabel(docs: ContractPriceDoc[]): string | null {
  if (!docs.length) return null;
  const contract = docs[0].contractNumber;
  const amendments = [
    ...new Set(docs.map((d) => d.amendmentNumber).filter((a): a is string => !!a)),
  ].sort();
  if (!amendments.length) return `договор ${contract}, без ДС`;
  const list =
    amendments.length === 1
      ? `ДС ${amendments[0]}`
      : `ДС ${amendments.slice(0, -1).join(', ')} и ${amendments[amendments.length - 1]}`;
  return `договор ${contract}, ${list}`;
}

export interface TariffStatus {
  state: OperatorTariffState;
  /** Одной фразой — что сейчас с тарифом и почему. */
  reason: string;
  /** Применяется ли тариф к заявкам оператора. Подтверждение — шлюз. */
  applies: boolean;
}

export function operatorTariffStatus(
  plan: ReviewedPlan,
  docs: ContractPriceDoc[],
  currentFingerprint: string,
): TariffStatus {
  const mine = docsOfContract(docs, plan.operatorContract);

  if (!plan.reviewVerdict) {
    if (!plan.operatorContract) {
      return {
        state: 'DRAFT',
        reason: 'Не указан договор — не с чем сверять',
        applies: false,
      };
    }
    if (!mine.length) {
      return {
        state: 'DRAFT',
        reason: `Оператор ещё не прислал цены по договору ${plan.operatorContract}`,
        applies: false,
      };
    }
    return { state: 'DRAFT', reason: 'Ждёт проверки оператором', applies: false };
  }

  /* Отказ живёт до следующей проверки человеком. Гостиница правит ставки — и
   * отпечаток, конечно, расходится, но «изменилось после отказа» это не
   * подтверждение: смотреть должен снова оператор. */
  if (plan.reviewVerdict === 'REJECTED') {
    return {
      state: 'REJECTED',
      reason: 'Оператор не подтвердил цены',
      applies: false,
    };
  }

  if (plan.reviewFingerprint !== currentFingerprint) {
    return {
      state: 'STALE',
      reason: 'Цены изменились после подтверждения — нужна повторная проверка',
      applies: false,
    };
  }

  return { state: 'CONFIRMED', reason: 'Подтверждён оператором', applies: true };
}
