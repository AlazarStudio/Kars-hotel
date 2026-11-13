import { createHash } from 'node:crypto';

/* СОСТОЯНИЕ КОРПОРАТИВНОГО ТАРИФА — правило, а не поле.
 *
 * С 11.11.2026 цена тарифа оператора приходит ИЗ ДОГОВОРА, а не из ставок
 * гостиницы. Поэтому и состояние считается не вердиктом человека, а наличием
 * цены договора на нужные ночи: есть цена по срезу тарифа — тариф работает.
 *
 * Вердикт оператора остался в базе историей: он ничего не включает и не
 * выключает — но по нему видно, кто и когда смотрел тариф. Флаг «подтверждён»
 * жил бы отдельно от цен, и однажды выяснилось бы, что он подтверждает цифры,
 * которых в договоре уже нет.
 *
 * ОТПЕЧАТОК, который до 11.11.2026 сравнивался с текущим и ронял
 * подтверждение сам, теперь стережёт ДОГОВОР И УСЛОВИЯ тарифа: новая ДС или
 * изменённое условие его меняют, строки цен тарифа — нет (своих цен у
 * корпоративного тарифа больше не осталось). Живёт он у вердикта Авии
 * (applyOperatorReview), чтобы «я видел эти условия» не легло под другие
 * бумаги, и на состояние тарифа не влияет.
 */

export type OperatorTariffState = 'DRAFT' | 'CONFIRMED' | 'REJECTED' | 'STALE';

/** Приложение к договору — снимок, присланный оператором. */
export interface ContractPriceDoc {
  /** Чей договор; у сверки тарифа — договор ЕГО партнёра (29.09.2026). */
  partnerId?: string | null;
  contractNumber: string;
  amendmentNumber: string | null;
  service: string;
  validFrom: Date | string;
  validTo: Date | string | null;
  vatRate: number | null;
  rows: unknown;
}

/* Свои строки цен тарифа — ИСТОРИЯ (11.11.2026).
 *
 * У корпоративного тарифа цена берётся из договора, поэтому ни день, ни
 * сезон, ни базовая цена категории в отпечаток больше не входят: оба места
 * его сборки передают prices: []. Тип и параметр оставлены — вход
 * tariffFingerprint не выкинут, чтобы не менять формулу прежних отпечатков;
 * с пустым списком он ни на что не влияет. */
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
  /* Условия и НДС (29.09.2026): тариф «для России» и тот же тариф «для
     Смартавиа» — разные договорённости, и перенастройка тарифа обязана
     ронять подтверждение. Необязательны: у прежних тарифов их нет. */
  partnerAccountId?: string | null;
  partnerCustomerId?: string | null;
  guestKind?: string | null;
  vatRate?: unknown;
}

export interface ReviewedPlan extends PlanPricingShape {
  partnerId?: string | null;
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

/* ОТПЕЧАТОК ДОГОВОРА И УСЛОВИЙ (11.11.2026).
 *
 * Своих цен у корпоративного тарифа нет — все они в договоре. Поэтому в
 * отпечаток идут приложения договора (номер, ДС, сроки, НДС, строки) и условия
 * тарифа: новая ДС или изменённое условие его меняют, а правка строк цен
 * тарифа — нет, и оба вызывающих передают prices: []. Параметр prices оставлен
 * ради прежних отпечатков и тестов формулы. */
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

  const plan: Record<string, unknown> = {
    mealPlan: input.plan.mealPlan,
    occupancyPricing: input.plan.occupancyPricing,
    priceModifierType: input.plan.priceModifierType,
    priceModifierValue: String(input.plan.priceModifierValue),
  };
  /* В отпечаток — только заданные: у прежних тарифов условий нет, и их
     подтверждение не должно слететь от появления новых полей. */
  if (input.plan.partnerAccountId) plan.partnerAccountId = input.plan.partnerAccountId;
  if (input.plan.partnerCustomerId) plan.partnerCustomerId = input.plan.partnerCustomerId;
  if (input.plan.guestKind) plan.guestKind = input.plan.guestKind;
  if (input.plan.vatRate != null) plan.vatRate = String(input.plan.vatRate);

  return createHash('sha256')
    .update(JSON.stringify({ docs, plan, prices }))
    .digest('hex');
}

/** Приложения ИМЕННО того договора, который воплощает тариф. */
export function docsOfContract(
  docs: ContractPriceDoc[],
  contractNumber: string | null,
  partnerId?: string | null,
): ContractPriceDoc[] {
  if (!contractNumber) return [];
  // Номера договоров у разных партнёров могут совпасть — сверяем со своим.
  return docs.filter(
    (d) => d.contractNumber === contractNumber && (!partnerId || !d.partnerId || d.partnerId === partnerId),
  );
}

/** Как назвать сверенные документы человеку: «договор 18, ДС 2 и 3». */
export function documentsLabel(docs: ContractPriceDoc[]): string | null {
  if (!docs.length) return null;
  const contract = docs[0].contractNumber;
  const amendments = [
    ...new Set(docs.map((d) => d.amendmentNumber).filter((a): a is string => !!a)),
  ]
    /* Номер ДС партнёр присылает по-разному: «2» или уже «ДС 2». Приставку
       ставим один раз — иначе в кабинете «ДС ДС 1» (найдено 29.09.2026). */
    .map((a) => a.replace(/^\s*ДС\s*(№\s*)?/i, ''))
    .sort((x, y) => x.localeCompare(y, 'ru', { numeric: true }));
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
  /** Применяется ли тариф к заявкам оператора. */
  applies: boolean;
}

/* СТАТУС СЧИТАЕТСЯ ПО НАЛИЧИЮ ЦЕНЫ ДОГОВОРА (11.11.2026).
 *
 * Прежний статус был вердиктом человека: гостиница вводила свои ставки, а
 * оператор сверял их с договором. Цены теперь приходят из договора, сверять
 * нечего — значит и подтверждать нечего: тариф работает, когда по его срезу
 * есть цена договора на нужный день (его называет вызывающий). Вердикт
 * остаётся в базе как история и на ответ не влияет. */
export function operatorTariffStatus(
  plan: ReviewedPlan,
  docs: ContractPriceDoc[],
  /** Есть ли цена договора на нужный день по срезу тарифа. */
  hasPrice: boolean,
): TariffStatus {
  const mine = docsOfContract(docs, plan.operatorContract, plan.partnerId);

  if (!plan.operatorContract) {
    return { state: 'DRAFT', reason: 'Не указан договор — не с чем сверять', applies: false };
  }
  if (!mine.length) {
    return {
      state: 'DRAFT',
      reason: `Оператор ещё не прислал цены по договору ${plan.operatorContract}`,
      applies: false,
    };
  }
  if (!hasPrice) {
    return { state: 'DRAFT', reason: 'Цены договора на сегодня нет', applies: false };
  }
  return { state: 'CONFIRMED', reason: 'Цены из договора', applies: true };
}
