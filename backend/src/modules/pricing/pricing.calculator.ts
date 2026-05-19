import { Prisma } from '@prisma/client';
import {
  CalculateArgs,
  Decimal,
  PricingBreakdown,
  PricingNight,
  RatePlanLike,
  RateLookup,
} from './pricing.types';

const D = Prisma.Decimal;
const ZERO = new D(0);
const HUNDRED = new D(100);

/**
 * Pure pricing calculator — no DB, no IO.
 *
 * Algorithm:
 *   1. Enumerate nights in [arrival, departure)
 *   2. For each night, walk the rate-plan inheritance chain (leaf → root)
 *      until a Rate row is found; remember which plan it came from.
 *   3. Walk back DOWN the chain, applying each plan's modifier to the price.
 *   4. Sum, return breakdown.
 *
 * Edge cases:
 *   - departure == arrival          → 0 nights, totalPrice = 0
 *   - departure  <  arrival          → throw RangeError
 *   - occupancy not in DB and plan.occupancyPricing → fall back to baseOccupancy
 *   - occupancyPricing == false       → always look up by baseOccupancy
 *   - No rate row anywhere in chain   → price = 0 for that night + warning
 *   - Modifier would drop below 0     → clamp to 0
 */
export function calculatePricing(args: CalculateArgs): PricingBreakdown {
  const {
    ratePlan,
    parentChain,
    arrival,
    departure,
    occupancy,
    baseOccupancy,
    roomTypeId,
    currency,
    rates,
  } = args;

  // ── Validate dates ──────────────────────────────────────────────────────────
  if (Number.isNaN(arrival.getTime())) throw new RangeError('Invalid arrival date');
  if (Number.isNaN(departure.getTime())) throw new RangeError('Invalid departure date');
  if (departure.getTime() < arrival.getTime()) {
    throw new RangeError('departure must be ≥ arrival');
  }

  // Normalize times to date-only (we look up dates as DATE columns, time is irrelevant).
  const start = startOfDayUTC(arrival);
  const end = startOfDayUTC(departure);

  const nights = daysBetween(start, end);
  const warnings: string[] = [];
  const nightly: PricingNight[] = [];

  // The chain we consult, in order: leaf first, then parents.
  const chain: RatePlanLike[] = [ratePlan, ...parentChain];

  // ── Per-night pricing ──────────────────────────────────────────────────────
  for (let i = 0; i < nights; i++) {
    const date = addDays(start, i);
    const night = priceNight({
      chain,
      date,
      roomTypeId,
      occupancy,
      baseOccupancy,
      rates,
    });
    if (!night.hasRate) {
      warnings.push(
        `No rate found for ${formatDateISO(date)} (roomType=${roomTypeId.slice(0, 8)}…)`,
      );
    }
    nightly.push(night);
  }

  // ── Aggregate ──────────────────────────────────────────────────────────────
  const subtotal = nightly.reduce<Decimal>((acc, n) => acc.add(n.price), new D(0));

  return {
    ratePlanId: ratePlan.id,
    roomTypeId,
    arrival: start,
    departure: end,
    occupancy,
    baseOccupancy,
    nights,
    currency,
    subtotal: subtotal,
    totalPrice: subtotal, // Taxes / extras / discounts come in later phases.
    nightly,
    warnings,
  };
}

// ─── internals ───────────────────────────────────────────────────────────────

function priceNight(args: {
  chain: RatePlanLike[];
  date: Date;
  roomTypeId: string;
  occupancy: number;
  baseOccupancy: number;
  rates: RateLookup;
}): PricingNight {
  const { chain, date, roomTypeId, occupancy, baseOccupancy, rates } = args;

  // Find the first plan in the chain (closest to leaf) that has a Rate for this night.
  let foundIndex = -1;
  let basePrice: Decimal | null = null;
  let occupancyFallback = false;

  for (let i = 0; i < chain.length; i++) {
    const plan = chain[i];
    const lookupOccupancy = plan.occupancyPricing ? occupancy : baseOccupancy;

    let found = rates.find({
      ratePlanId: plan.id,
      roomTypeId,
      date,
      occupancy: lookupOccupancy,
    });

    if (!found && plan.occupancyPricing && occupancy !== baseOccupancy) {
      // Fall back: when occupancy-pricing is on but the specific occupancy bucket is empty,
      // re-query with baseOccupancy.
      found = rates.find({
        ratePlanId: plan.id,
        roomTypeId,
        date,
        occupancy: baseOccupancy,
      });
      if (found) occupancyFallback = true;
    }

    if (found) {
      foundIndex = i;
      basePrice = found;
      break;
    }
  }

  if (!basePrice || foundIndex < 0) {
    return {
      date,
      price: new D(0),
      hasRate: false,
      occupancyFallback: false,
      inheritedFromParent: false,
      sourceRatePlanId: null,
    };
  }

  // Walk DOWN from the plan we found to the leaf, applying each step's modifier.
  // Example: leaf "Last Minute −20%" inherits from "Standard". If we found a rate
  // in Standard (index 1), we apply Last Minute's modifier (index 0) on the way down.
  let price = basePrice;
  for (let i = foundIndex - 1; i >= 0; i--) {
    price = applyModifier(price, chain[i]);
  }

  return {
    date,
    price,
    hasRate: true,
    occupancyFallback,
    inheritedFromParent: foundIndex > 0,
    sourceRatePlanId: chain[foundIndex].id,
  };
}

function applyModifier(base: Decimal, plan: RatePlanLike): Decimal {
  const v = new (Prisma.Decimal)(plan.priceModifierValue);
  if (v.isZero()) return base;

  let result: Decimal;
  if (plan.priceModifierType === 'PERCENT') {
    // price × (1 + percent/100)
    const factor = new (Prisma.Decimal)(1).add(v.div(HUNDRED));
    result = base.mul(factor);
  } else {
    // ABSOLUTE: add (or subtract if negative).
    result = base.add(v);
  }

  // Round half-up to 2 decimal places for money. Decimal.toDecimalPlaces is half-up by default
  // with ROUND_HALF_UP rounding mode 4.
  result = result.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

  // Clamp at 0 — we never charge a negative price.
  if (result.lessThan(ZERO)) result = new (Prisma.Decimal)(0);
  return result;
}

function startOfDayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addDays(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n));
}

function daysBetween(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  return Math.round(ms / 86_400_000);
}

function formatDateISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Helper to build a map-backed RateLookup for tests and services. */
export function makeMapLookup(
  rows: Array<{
    ratePlanId: string;
    roomTypeId: string;
    date: Date;
    occupancy: number;
    price: Decimal | number | string;
  }>,
): RateLookup {
  const key = (p: string, rt: string, d: Date, occ: number) =>
    `${p}|${rt}|${formatDateISO(startOfDayUTC(d))}|${occ}`;
  const map = new Map<string, Decimal>();
  for (const r of rows) {
    map.set(key(r.ratePlanId, r.roomTypeId, r.date, r.occupancy), new Prisma.Decimal(r.price));
  }
  return {
    find({ ratePlanId, roomTypeId, date, occupancy }) {
      return map.get(key(ratePlanId, roomTypeId, date, occupancy)) ?? null;
    },
  };
}
