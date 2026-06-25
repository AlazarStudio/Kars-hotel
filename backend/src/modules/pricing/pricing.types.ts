import { Prisma } from '@prisma/client';

export type Decimal = Prisma.Decimal;

export type PriceModifierType = 'ABSOLUTE' | 'PERCENT';

/** Minimal RatePlan shape consumed by the pure calculator. */
export interface RatePlanLike {
  id: string;
  parentRatePlanId: string | null;
  priceModifierType: PriceModifierType;
  priceModifierValue: Decimal | number | string;
  occupancyPricing: boolean;
}

/**
 * Pluggable Rate lookup. The orchestrating service pre-fetches a window of
 * Rate rows from the database and wraps them in this interface so the
 * calculator can be unit-tested without DB.
 */
export interface RateLookup {
  /**
   * Returns the per-night price for the exact (ratePlanId, roomTypeId, date,
   * occupancy) tuple or null if absent.
   */
  find(
    args: {
      ratePlanId: string;
      roomTypeId: string;
      date: Date;
      occupancy: number;
    },
  ): Decimal | null;
}

export interface PricingNight {
  /** Calendar date of the night (the GUEST stays from this date to the next). */
  date: Date;
  /** Final price the guest is billed for that night, after the parent chain + modifiers. */
  price: Decimal;
  /** Was at least one Rate row found in the chain? If false the night is priced at 0. */
  hasRate: boolean;
  /** Did we fall back from requested occupancy to baseOccupancy? */
  occupancyFallback: boolean;
  /** Did the price come from a parent rate plan (then a modifier was applied)? */
  inheritedFromParent: boolean;
  /** Id of the rate plan whose Rate row was actually consulted (own or ancestor). */
  sourceRatePlanId: string | null;
}

export interface PricingBreakdown {
  ratePlanId: string;
  roomTypeId: string;
  arrival: Date;
  departure: Date;
  occupancy: number;
  baseOccupancy: number;
  nights: number;
  currency: string;
  subtotal: Decimal;
  totalPrice: Decimal;
  nightly: PricingNight[];
  warnings: string[];
}

export interface CalculateArgs {
  /** The leaf (target) rate plan. */
  ratePlan: RatePlanLike;
  /** Parent chain, ordered from immediate parent to root. May be empty. */
  parentChain: RatePlanLike[];
  /** Inclusive — the first night of the stay is `arrival`. */
  arrival: Date;
  /** Exclusive — guest checks out the morning of `departure`; not billed for it. */
  departure: Date;
  /** Number of guests requested for the room. */
  occupancy: number;
  /** Comes from the chosen RoomType. */
  baseOccupancy: number;
  roomTypeId: string;
  currency: string;
  rates: RateLookup;
  /**
   * Optional baseline-price fallback consulted per (ratePlan × date) when no
   * exact per-day Rate row exists in the chain. Returns a season or standard
   * price, or null. When omitted the calculator behaves exactly as before
   * (per-day Rate rows only).
   */
  fallback?: (ratePlanId: string, date: Date) => Decimal | null;
}
