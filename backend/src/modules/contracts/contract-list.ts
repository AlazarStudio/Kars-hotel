/* ДОГОВОРЫ ГОСТИНИЦЫ ДЛЯ КАБИНЕТА (11.11.2026).
 *
 * Два источника: реестр (пришёл списком от партнёра) и приложения с ценами
 * (приходили и раньше). Ни один не главнее: у старой Авии реестра нет вовсе,
 * а у нового договора может не быть приложения. Терять договор из-за того,
 * что о нём знает только один источник, гостиница не должна — по этой
 * строке она заводит тариф. Срезы для тарифа дают только сетки приложений:
 * реестр называет число приложений, но не их содержимое. */
export interface RegistryContractRow {
  partnerId: string;
  number: string;
  accountCode: string | null;
  accountName: string | null;
  validFrom: Date | null;
  validTo: Date | null;
  isPrimary: boolean;
  state: string;
  services: string[];
  sheetsCount: number;
  receivedAt: Date;
}

export interface ContractPriceDocRow {
  partnerId: string;
  contractNumber: string;
  accountCode: string | null;
  accountName: string | null;
  service: string;
  receivedAt: Date;
  /** Сетки цен: в них срез и его цена собраны вместе. */
  fill: unknown;
}

/** Срез договора: код авиакомпании, вид брони, питание. */
export interface SliceKey {
  customer: string | null;
  guestKind: 'CREW' | 'DISRUPTION' | null;
  mealPlan: string;
}

const sliceKey = (s: SliceKey) => [s.customer, s.guestKind, s.mealPlan].join('|');

const bySlice = (a: SliceKey, b: SliceKey) =>
  Number(!!a.customer) - Number(!!b.customer) ||
  a.mealPlan.localeCompare(b.mealPlan) ||
  (a.guestKind ?? '').localeCompare(b.guestKind ?? '') ||
  (a.customer ?? '').localeCompare(b.customer ?? '');

/** Срезы из сеток документа: то, подо что гостиница может завести тариф.
 *
 * `fill` — Json чужой системы, поэтому разбор терпеливый: битая сетка не
 * должна ронять весь список договоров гостиницы. Срез с незнакомым значением
 * (чужой `guestKind`, не-строковый код авиакомпании) отбрасываем, а не
 * подменяем «любым»: подменить — значит предложить тариф, который ни с одной
 * ценой не совпадёт. Отсутствующее поле — это «любой» (null), как и раньше. */
function slicesOf(fill: unknown): SliceKey[] {
  const grids: unknown[] = Array.isArray(fill) ? fill : [];
  const out = new Map<string, SliceKey>();
  for (const grid of grids) {
    if (!grid || typeof grid !== 'object') continue;
    const slices = (grid as { slices?: unknown }).slices;
    if (!Array.isArray(slices)) continue;
    for (const item of slices) {
      if (!item || typeof item !== 'object') continue;
      const s = item as { customer?: unknown; guestKind?: unknown; mealPlan?: unknown };
      if (typeof s.mealPlan !== 'string') continue;
      const customer = s.customer ?? null;
      const guestKind = s.guestKind ?? null;
      if (customer !== null && typeof customer !== 'string') continue;
      if (guestKind !== null && guestKind !== 'CREW' && guestKind !== 'DISRUPTION') continue;
      const key: SliceKey = { customer, guestKind, mealPlan: s.mealPlan };
      out.set(sliceKey(key), key);
    }
  }
  return [...out.values()].sort(bySlice);
}

export interface ContractView {
  partnerId: string;
  number: string;
  account: { code: string; name: string } | null;
  signedAt: string | null;
  expiresAt: string | null;
  isPrimary: boolean;
  state: string;
  services: string[];
  /**
   * Сколько приложений у договора: что говорит реестр ИЛИ что реально доехало
   * строками цен — берётся большее. Реестр даёт только число, приложения —
   * строки, поэтому ноль здесь означает «ни реестр, ни цены ничего не сказали».
   */
  documents: number;
  /**
   * Есть ли цены: только реальные строки ценового приложения. Реестр цифр не
   * даёт, и обещанное им приложение ценой не считается — тариф по такому
   * договору заводится, но не работает.
   */
  hasPrices: boolean;
  receivedAt: string | null;
  /**
   * Срезы, которые в договоре реально есть: по ним мастер заводит тариф.
   * Пусто — сеток нет, и предлагать нечего.
   */
  slices: SliceKey[];
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Внутренний аккумулятор: в ContractView «приложения» и «цены» — разные вещи. */
interface Acc {
  partnerId: string;
  number: string;
  account: { code: string; name: string } | null;
  signedAt: string | null;
  expiresAt: string | null;
  isPrimary: boolean;
  state: string;
  services: string[];
  /** Строки ценовых приложений — единственное доказательство, что цены есть. */
  priceDocs: number;
  /** Число приложений из реестра: цифра без строк, ценой не считается. */
  registrySheets: number;
  slices: SliceKey[];
  registryAt: Date | null;
  priceAt: Date | null;
}

/** Самая поздняя из дат: реестр и приложения приходят разными путями. */
function latestIso(registryAt: Date | null, priceAt: Date | null): string | null {
  if (!registryAt) return iso(priceAt);
  if (!priceAt) return iso(registryAt);
  return iso(registryAt.getTime() >= priceAt.getTime() ? registryAt : priceAt);
}

export function mergeContractList(
  registry: RegistryContractRow[],
  docs: ContractPriceDocRow[],
): ContractView[] {
  const map = new Map<string, Acc>();
  // Номер реестра уже trim()-нут на входе (connectivity/contract-registry.ts), а
  // номер из ценового документа — нет: без нормализации «205 » дал бы вторую карточку.
  const key = (partnerId: string, number: string) => `${partnerId}|${String(number).trim()}`;

  for (const r of registry) {
    map.set(key(r.partnerId, r.number), {
      partnerId: r.partnerId,
      number: r.number,
      account: r.accountCode ? { code: r.accountCode, name: r.accountName ?? r.accountCode } : null,
      signedAt: iso(r.validFrom),
      expiresAt: iso(r.validTo),
      isPrimary: r.isPrimary,
      state: r.state,
      services: [...r.services],
      priceDocs: 0,
      registrySheets: r.sheetsCount,
      slices: [],
      registryAt: r.receivedAt,
      priceAt: null,
    });
  }

  for (const d of docs) {
    const k = key(d.partnerId, d.contractNumber);
    const row: Acc = map.get(k) ?? {
      partnerId: d.partnerId,
      number: d.contractNumber,
      account: null,
      signedAt: null,
      expiresAt: null,
      isPrimary: false,
      state: 'ACTIVE',
      services: [],
      priceDocs: 0,
      registrySheets: 0,
      slices: [],
      registryAt: null,
      priceAt: null,
    };
    row.priceDocs += 1;
    if (!row.services.includes(d.service)) row.services.push(d.service);
    for (const s of slicesOf(d.fill)) {
      if (!row.slices.some((x) => sliceKey(x) === sliceKey(s))) row.slices.push(s);
    }
    if (!row.account && d.accountCode) {
      row.account = { code: d.accountCode, name: d.accountName ?? d.accountCode };
    }
    if (!row.priceAt || d.receivedAt.getTime() > row.priceAt.getTime()) {
      row.priceAt = d.receivedAt;
    }
    map.set(k, row);
  }

  return [...map.values()]
    .map((r) => ({
      partnerId: r.partnerId,
      number: r.number,
      account: r.account,
      signedAt: r.signedAt,
      expiresAt: r.expiresAt,
      isPrimary: r.isPrimary,
      state: r.state,
      services: [...r.services].sort(),
      slices: r.slices.sort(bySlice),
      documents: Math.max(r.priceDocs, r.registrySheets),
      hasPrices: r.priceDocs > 0,
      receivedAt: latestIso(r.registryAt, r.priceAt),
    }))
    .sort(
      (a, b) =>
        Number(b.isPrimary) - Number(a.isPrimary) ||
        a.number.localeCompare(b.number, 'ru', { numeric: true }),
    );
}
