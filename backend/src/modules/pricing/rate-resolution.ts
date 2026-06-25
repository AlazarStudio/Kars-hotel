import { Prisma } from '@prisma/client';

type Decimal = Prisma.Decimal;

/** A seasonal price window for one (ratePlan × roomType). Dates are 'YYYY-MM-DD'. */
export interface SeasonWindow {
  ratePlanId: string;
  roomTypeId: string;
  dateFrom: string; // inclusive
  dateTo: string; // inclusive
  price: Decimal;
  sortOrder: number;
}

/** A standard (baseline) price for one (ratePlan × roomType). */
export interface StandardWindow {
  ratePlanId: string;
  roomTypeId: string;
  price: Decimal;
}

const key = (planId: string, roomTypeId: string) => `${planId}|${roomTypeId}`;

/** Format a Date as a UTC 'YYYY-MM-DD' string (date-only comparison). */
export function isoDay(d: Date): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

/**
 * Builds a fast lookup that resolves the "baseline" price for a
 * (ratePlan × roomType × date) by consulting seasons first (the covering season
 * with the latest dateFrom, then highest sortOrder, wins) and falling back to
 * the standard price. Per-day Rate overrides are handled separately by callers
 * — they always take precedence over what this resolver returns.
 */
export class BaselineResolver {
  private readonly seasonsByKey = new Map<string, SeasonWindow[]>();
  private readonly standardByKey = new Map<string, Decimal>();

  constructor(seasons: SeasonWindow[], standards: StandardWindow[]) {
    for (const s of seasons) {
      const k = key(s.ratePlanId, s.roomTypeId);
      const list = this.seasonsByKey.get(k);
      if (list) list.push(s);
      else this.seasonsByKey.set(k, [s]);
    }
    // Most-specific season first: latest dateFrom, then highest sortOrder.
    for (const list of this.seasonsByKey.values()) {
      list.sort((a, b) =>
        a.dateFrom === b.dateFrom ? b.sortOrder - a.sortOrder : (a.dateFrom < b.dateFrom ? 1 : -1),
      );
    }
    for (const s of standards) {
      this.standardByKey.set(key(s.ratePlanId, s.roomTypeId), s.price);
    }
  }

  /** Season → standard. Returns null when neither covers the (plan, roomType, date). */
  resolve(ratePlanId: string, roomTypeId: string, day: string): Decimal | null {
    const list = this.seasonsByKey.get(key(ratePlanId, roomTypeId));
    if (list) {
      for (const s of list) {
        if (day >= s.dateFrom && day <= s.dateTo) return s.price;
      }
    }
    return this.standardByKey.get(key(ratePlanId, roomTypeId)) ?? null;
  }
}
