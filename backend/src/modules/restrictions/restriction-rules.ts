export interface RestrictionRule {
  date: Date;
  ratePlanId: string | null;
  closed: boolean;
  stopSell: boolean;
  cta: boolean;
  ctd: boolean;
  minLos: number | null;
  maxLos: number | null;
  minLosArrival: number | null;
  maxLosArrival: number | null;
  minAdvance: number | null;
  maxAdvance: number | null;
}
export type ViolationCode =
  | 'CLOSED'
  | 'STOP_SELL'
  | 'CTA'
  | 'CTD'
  | 'MIN_LOS'
  | 'MAX_LOS'
  | 'MIN_LOS_ARRIVAL'
  | 'MAX_LOS_ARRIVAL'
  | 'MIN_ADVANCE'
  | 'MAX_ADVANCE';
export interface Violation {
  code: ViolationCode;
  date?: string;
  detail: string;
}
const day = (d: Date) => d.toISOString().slice(0, 10);
const midnight = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/** A specific plan overrides the general row, independently of DB row order. */
export function effectiveRestrictions(rows: RestrictionRule[]) {
  const byDate = new Map<string, RestrictionRule>();
  for (const row of rows) {
    const key = day(row.date);
    if (!byDate.has(key) || row.ratePlanId) byDate.set(key, row);
  }
  return byDate;
}

/** Shared by the restriction preview, availability and booking preflight. */
export function checkRestrictionRules(
  rows: RestrictionRule[],
  arrival: Date,
  departure: Date,
  now = new Date(),
) {
  const nights = Math.round((midnight(departure) - midnight(arrival)) / 86_400_000);
  const violations: Violation[] = [];
  const byDate = effectiveRestrictions(rows);
  if (nights <= 0) return { allowed: true, nights: 0, violations };
  const add = (code: ViolationCode, date: string, detail: string) =>
    violations.push({ code, date, detail });
  for (let i = 0; i < nights; i++) {
    const date = day(new Date(midnight(arrival) + i * 86_400_000));
    const r = byDate.get(date);
    if (!r) continue;
    if (r.closed) add('CLOSED', date, `Дата ${date} закрыта для бронирования`);
    if (r.stopSell) add('STOP_SELL', date, `Продажи на ${date} остановлены`);
    if (r.minLos != null && nights < r.minLos)
      add(
        'MIN_LOS',
        date,
        `Минимум проживания на ${date}: ${r.minLos} ночей (запрошено ${nights})`,
      );
    if (r.maxLos != null && nights > r.maxLos)
      add(
        'MAX_LOS',
        date,
        `Максимум проживания на ${date}: ${r.maxLos} ночей (запрошено ${nights})`,
      );
  }
  const date = day(arrival);
  const r = byDate.get(date);
  if (r) {
    if (r.cta) add('CTA', date, `Заезд на ${date} закрыт (CTA)`);
    if (r.minLosArrival != null && nights < r.minLosArrival)
      add('MIN_LOS_ARRIVAL', date, `Минимум при заезде ${date}: ${r.minLosArrival} ночей`);
    if (r.maxLosArrival != null && nights > r.maxLosArrival)
      add('MAX_LOS_ARRIVAL', date, `Максимум при заезде ${date}: ${r.maxLosArrival} ночей`);
    const advance = Math.round((midnight(arrival) - midnight(now)) / 86_400_000);
    if (r.minAdvance != null && advance < r.minAdvance)
      add('MIN_ADVANCE', date, `До заезда ${r.minAdvance} дней (осталось ${advance})`);
    if (r.maxAdvance != null && advance > r.maxAdvance)
      add('MAX_ADVANCE', date, `Можно бронировать максимум за ${r.maxAdvance} дней до заезда`);
  }
  const out = day(departure);
  if (byDate.get(out)?.ctd) add('CTD', out, `Выезд на ${out} закрыт (CTD)`);
  return { allowed: violations.length === 0, nights, violations };
}
