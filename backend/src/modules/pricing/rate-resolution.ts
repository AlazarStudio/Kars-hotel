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
  /** На сколько гостей (29.09.2026); 0 или пусто — на любое число. */
  occupancy?: number;
}

/** A standard (baseline) price for one (ratePlan × roomType). */
export interface StandardWindow {
  ratePlanId: string;
  roomTypeId: string;
  price: Decimal;
  /** На сколько гостей (29.09.2026); 0 или пусто — на любое число. */
  occupancy?: number;
}

const key = (planId: string, roomTypeId: string) => `${planId}|${roomTypeId}`;

/** Format a Date as a UTC 'YYYY-MM-DD' string (date-only comparison). */
export function isoDay(d: Date): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    .toISOString()
    .slice(0, 10);
}

/* Цена по числу гостей (29.09.2026). Корпоративный тариф партнёра задаёт
 * цену номера на одного и на двоих отдельно («Стандарт двухместный: 4 400 на
 * одного, 5 700 на двоих»). Порядок выбора:
 *   - число гостей известно: цена ровно на это число → цена «на любое число»;
 *     цены на ДРУГОЕ число гостей не берутся — «за двоих» за одного значит
 *     выставить не ту сумму;
 *   - число не известно (старые вызовы): «на любое число», иначе на самое
 *     малое заполненное — как было, пока цена была одна. */
function pickByOccupancy<T extends { occupancy?: number }>(rows: T[], occupancy?: number): T | null {
  const occ = (r: T) => r.occupancy ?? 0;
  if (occupancy != null && occupancy > 0) {
    return rows.find((r) => occ(r) === occupancy) ?? rows.find((r) => occ(r) === 0) ?? null;
  }
  return rows.find((r) => occ(r) === 0) ?? [...rows].sort((a, b) => occ(a) - occ(b))[0] ?? null;
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
  private readonly standardByKey = new Map<string, StandardWindow[]>();

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
        a.dateFrom === b.dateFrom ? b.sortOrder - a.sortOrder : a.dateFrom < b.dateFrom ? 1 : -1,
      );
    }
    for (const s of standards) {
      const k = key(s.ratePlanId, s.roomTypeId);
      const list = this.standardByKey.get(k);
      if (list) list.push(s);
      else this.standardByKey.set(k, [s]);
    }
  }

  /**
   * Season → standard. Returns null when neither covers the (plan, roomType,
   * date) for this number of guests.
   */
  resolve(ratePlanId: string, roomTypeId: string, day: string, occupancy?: number): Decimal | null {
    const list = this.seasonsByKey.get(key(ratePlanId, roomTypeId));
    if (list) {
      /* Самый точный по датам сезон выбирается ДО числа гостей: сезон с
         ценой «на любое число» перекрывает прошлый сезон с ценой на двоих. */
      const covering = list.filter((s) => day >= s.dateFrom && day <= s.dateTo);
      if (covering.length) {
        const top = covering[0];
        const sameWindow = covering.filter(
          (s) => s.dateFrom === top.dateFrom && s.dateTo === top.dateTo && s.sortOrder === top.sortOrder,
        );
        const hit = pickByOccupancy(sameWindow, occupancy);
        if (hit) return hit.price;
      }
    }
    return pickByOccupancy(this.standardByKey.get(key(ratePlanId, roomTypeId)) ?? [], occupancy)?.price ?? null;
  }
}
