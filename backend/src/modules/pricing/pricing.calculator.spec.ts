import { Prisma } from '@prisma/client';
import { calculatePricing, makeMapLookup } from './pricing.calculator';
import { RatePlanLike } from './pricing.types';

const D = (v: string | number) => new Prisma.Decimal(v);
const date = (s: string) => new Date(`${s}T00:00:00.000Z`);

const ROOM_TYPE_ID = '00000000-0000-0000-0000-000000000001';
const STANDARD_PLAN_ID = '00000000-0000-0000-0000-000000000010';
const LAST_MINUTE_PLAN_ID = '00000000-0000-0000-0000-000000000011';
const VIP_PLAN_ID = '00000000-0000-0000-0000-000000000012';

const STANDARD_PLAN: RatePlanLike = {
  id: STANDARD_PLAN_ID,
  parentRatePlanId: null,
  priceModifierType: 'PERCENT',
  priceModifierValue: 0,
  occupancyPricing: false,
};

const LAST_MINUTE_PLAN: RatePlanLike = {
  id: LAST_MINUTE_PLAN_ID,
  parentRatePlanId: STANDARD_PLAN_ID,
  priceModifierType: 'PERCENT',
  priceModifierValue: -20,
  occupancyPricing: false,
};

const PLUS_500_PLAN: RatePlanLike = {
  id: 'plus-500',
  parentRatePlanId: STANDARD_PLAN_ID,
  priceModifierType: 'ABSOLUTE',
  priceModifierValue: 500,
  occupancyPricing: false,
};

const OCCUPANCY_PLAN: RatePlanLike = {
  id: 'occ-plan',
  parentRatePlanId: null,
  priceModifierType: 'PERCENT',
  priceModifierValue: 0,
  occupancyPricing: true,
};

describe('PricingCalculator.calculatePricing', () => {
  // ── Basic happy path ──────────────────────────────────────────────────────

  it('single night with exact rate', () => {
    const rates = makeMapLookup([
      { ratePlanId: STANDARD_PLAN_ID, roomTypeId: ROOM_TYPE_ID, date: date('2026-06-01'), occupancy: 2, price: 3800 },
    ]);
    const b = calculatePricing({
      ratePlan: STANDARD_PLAN,
      parentChain: [],
      arrival: date('2026-06-01'),
      departure: date('2026-06-02'),
      occupancy: 2,
      baseOccupancy: 2,
      roomTypeId: ROOM_TYPE_ID,
      currency: 'RUB',
      rates,
    });
    expect(b.nights).toBe(1);
    expect(b.totalPrice.toFixed(2)).toBe('3800.00');
    expect(b.nightly[0].hasRate).toBe(true);
    expect(b.warnings).toEqual([]);
  });

  it('three nights with same rate', () => {
    const rates = makeMapLookup([
      { ratePlanId: STANDARD_PLAN_ID, roomTypeId: ROOM_TYPE_ID, date: date('2026-06-01'), occupancy: 2, price: 3800 },
      { ratePlanId: STANDARD_PLAN_ID, roomTypeId: ROOM_TYPE_ID, date: date('2026-06-02'), occupancy: 2, price: 3800 },
      { ratePlanId: STANDARD_PLAN_ID, roomTypeId: ROOM_TYPE_ID, date: date('2026-06-03'), occupancy: 2, price: 3800 },
    ]);
    const b = calculatePricing({
      ratePlan: STANDARD_PLAN,
      parentChain: [],
      arrival: date('2026-06-01'),
      departure: date('2026-06-04'),
      occupancy: 2,
      baseOccupancy: 2,
      roomTypeId: ROOM_TYPE_ID,
      currency: 'RUB',
      rates,
    });
    expect(b.nights).toBe(3);
    expect(b.totalPrice.toFixed(2)).toBe('11400.00');
  });

  it('three nights with different rates each', () => {
    const rates = makeMapLookup([
      { ratePlanId: STANDARD_PLAN_ID, roomTypeId: ROOM_TYPE_ID, date: date('2026-06-01'), occupancy: 2, price: 3000 },
      { ratePlanId: STANDARD_PLAN_ID, roomTypeId: ROOM_TYPE_ID, date: date('2026-06-02'), occupancy: 2, price: 4500 },
      { ratePlanId: STANDARD_PLAN_ID, roomTypeId: ROOM_TYPE_ID, date: date('2026-06-03'), occupancy: 2, price: 5000 },
    ]);
    const b = calculatePricing({
      ratePlan: STANDARD_PLAN,
      parentChain: [],
      arrival: date('2026-06-01'),
      departure: date('2026-06-04'),
      occupancy: 2,
      baseOccupancy: 2,
      roomTypeId: ROOM_TYPE_ID,
      currency: 'RUB',
      rates,
    });
    expect(b.totalPrice.toFixed(2)).toBe('12500.00');
  });

  // ── Date edge cases ───────────────────────────────────────────────────────

  it('arrival == departure → 0 nights, total 0', () => {
    const rates = makeMapLookup([]);
    const b = calculatePricing({
      ratePlan: STANDARD_PLAN,
      parentChain: [],
      arrival: date('2026-06-01'),
      departure: date('2026-06-01'),
      occupancy: 2,
      baseOccupancy: 2,
      roomTypeId: ROOM_TYPE_ID,
      currency: 'RUB',
      rates,
    });
    expect(b.nights).toBe(0);
    expect(b.totalPrice.toFixed(2)).toBe('0.00');
    expect(b.nightly).toHaveLength(0);
  });

  it('departure < arrival → throws RangeError', () => {
    const rates = makeMapLookup([]);
    expect(() =>
      calculatePricing({
        ratePlan: STANDARD_PLAN,
        parentChain: [],
        arrival: date('2026-06-05'),
        departure: date('2026-06-01'),
        occupancy: 2,
        baseOccupancy: 2,
        roomTypeId: ROOM_TYPE_ID,
        currency: 'RUB',
        rates,
      }),
    ).toThrow(RangeError);
  });

  it('stay across month boundary (last day of June → first day of July)', () => {
    const rates = makeMapLookup([
      { ratePlanId: STANDARD_PLAN_ID, roomTypeId: ROOM_TYPE_ID, date: date('2026-06-30'), occupancy: 2, price: 4000 },
      { ratePlanId: STANDARD_PLAN_ID, roomTypeId: ROOM_TYPE_ID, date: date('2026-07-01'), occupancy: 2, price: 5000 },
    ]);
    const b = calculatePricing({
      ratePlan: STANDARD_PLAN,
      parentChain: [],
      arrival: date('2026-06-30'),
      departure: date('2026-07-02'),
      occupancy: 2,
      baseOccupancy: 2,
      roomTypeId: ROOM_TYPE_ID,
      currency: 'RUB',
      rates,
    });
    expect(b.nights).toBe(2);
    expect(b.totalPrice.toFixed(2)).toBe('9000.00');
  });

  it('stay across year boundary (Dec 31 → Jan 1)', () => {
    const rates = makeMapLookup([
      { ratePlanId: STANDARD_PLAN_ID, roomTypeId: ROOM_TYPE_ID, date: date('2026-12-31'), occupancy: 2, price: 9000 },
      { ratePlanId: STANDARD_PLAN_ID, roomTypeId: ROOM_TYPE_ID, date: date('2027-01-01'), occupancy: 2, price: 8000 },
    ]);
    const b = calculatePricing({
      ratePlan: STANDARD_PLAN,
      parentChain: [],
      arrival: date('2026-12-31'),
      departure: date('2027-01-02'),
      occupancy: 2,
      baseOccupancy: 2,
      roomTypeId: ROOM_TYPE_ID,
      currency: 'RUB',
      rates,
    });
    expect(b.nights).toBe(2);
    expect(b.totalPrice.toFixed(2)).toBe('17000.00');
  });

  // ── Missing rates ─────────────────────────────────────────────────────────

  it('no rate at all → price 0 + warning', () => {
    const rates = makeMapLookup([]);
    const b = calculatePricing({
      ratePlan: STANDARD_PLAN,
      parentChain: [],
      arrival: date('2026-06-01'),
      departure: date('2026-06-02'),
      occupancy: 2,
      baseOccupancy: 2,
      roomTypeId: ROOM_TYPE_ID,
      currency: 'RUB',
      rates,
    });
    expect(b.nightly[0].hasRate).toBe(false);
    expect(b.totalPrice.toFixed(2)).toBe('0.00');
    expect(b.warnings).toHaveLength(1);
  });

  it('rate present for some nights only → mixed', () => {
    const rates = makeMapLookup([
      { ratePlanId: STANDARD_PLAN_ID, roomTypeId: ROOM_TYPE_ID, date: date('2026-06-01'), occupancy: 2, price: 4000 },
      // 2026-06-02 missing
      { ratePlanId: STANDARD_PLAN_ID, roomTypeId: ROOM_TYPE_ID, date: date('2026-06-03'), occupancy: 2, price: 4000 },
    ]);
    const b = calculatePricing({
      ratePlan: STANDARD_PLAN,
      parentChain: [],
      arrival: date('2026-06-01'),
      departure: date('2026-06-04'),
      occupancy: 2,
      baseOccupancy: 2,
      roomTypeId: ROOM_TYPE_ID,
      currency: 'RUB',
      rates,
    });
    expect(b.nightly[0].hasRate).toBe(true);
    expect(b.nightly[1].hasRate).toBe(false);
    expect(b.nightly[2].hasRate).toBe(true);
    expect(b.totalPrice.toFixed(2)).toBe('8000.00');
    expect(b.warnings).toHaveLength(1);
  });

  // ── Occupancy variations ──────────────────────────────────────────────────

  it('occupancyPricing=false ignores requested occupancy and uses baseOccupancy', () => {
    const rates = makeMapLookup([
      // Only stored at base occupancy = 2.
      { ratePlanId: STANDARD_PLAN_ID, roomTypeId: ROOM_TYPE_ID, date: date('2026-06-01'), occupancy: 2, price: 3000 },
    ]);
    const b = calculatePricing({
      ratePlan: STANDARD_PLAN, // occupancyPricing=false
      parentChain: [],
      arrival: date('2026-06-01'),
      departure: date('2026-06-02'),
      occupancy: 3, // requested
      baseOccupancy: 2,
      roomTypeId: ROOM_TYPE_ID,
      currency: 'RUB',
      rates,
    });
    expect(b.nightly[0].hasRate).toBe(true);
    expect(b.totalPrice.toFixed(2)).toBe('3000.00');
    expect(b.nightly[0].occupancyFallback).toBe(false);
  });

  it('occupancyPricing=true: exact occupancy rate is used', () => {
    const rates = makeMapLookup([
      { ratePlanId: OCCUPANCY_PLAN.id, roomTypeId: ROOM_TYPE_ID, date: date('2026-06-01'), occupancy: 2, price: 3000 },
      { ratePlanId: OCCUPANCY_PLAN.id, roomTypeId: ROOM_TYPE_ID, date: date('2026-06-01'), occupancy: 3, price: 4200 },
    ]);
    const b = calculatePricing({
      ratePlan: OCCUPANCY_PLAN,
      parentChain: [],
      arrival: date('2026-06-01'),
      departure: date('2026-06-02'),
      occupancy: 3,
      baseOccupancy: 2,
      roomTypeId: ROOM_TYPE_ID,
      currency: 'RUB',
      rates,
    });
    expect(b.totalPrice.toFixed(2)).toBe('4200.00');
    expect(b.nightly[0].occupancyFallback).toBe(false);
  });

  it('occupancyPricing=true: falls back to baseOccupancy if requested bucket empty', () => {
    const rates = makeMapLookup([
      { ratePlanId: OCCUPANCY_PLAN.id, roomTypeId: ROOM_TYPE_ID, date: date('2026-06-01'), occupancy: 2, price: 3000 },
      // No row for occupancy=3
    ]);
    const b = calculatePricing({
      ratePlan: OCCUPANCY_PLAN,
      parentChain: [],
      arrival: date('2026-06-01'),
      departure: date('2026-06-02'),
      occupancy: 3,
      baseOccupancy: 2,
      roomTypeId: ROOM_TYPE_ID,
      currency: 'RUB',
      rates,
    });
    expect(b.totalPrice.toFixed(2)).toBe('3000.00');
    expect(b.nightly[0].occupancyFallback).toBe(true);
  });

  it('occupancyPricing=true: occupancy equal to baseOccupancy does NOT trigger fallback flag', () => {
    const rates = makeMapLookup([
      { ratePlanId: OCCUPANCY_PLAN.id, roomTypeId: ROOM_TYPE_ID, date: date('2026-06-01'), occupancy: 2, price: 3000 },
    ]);
    const b = calculatePricing({
      ratePlan: OCCUPANCY_PLAN,
      parentChain: [],
      arrival: date('2026-06-01'),
      departure: date('2026-06-02'),
      occupancy: 2,
      baseOccupancy: 2,
      roomTypeId: ROOM_TYPE_ID,
      currency: 'RUB',
      rates,
    });
    expect(b.nightly[0].occupancyFallback).toBe(false);
  });

  // ── Parent/child modifier ─────────────────────────────────────────────────

  it('child plan PERCENT -20% — parent rate × 0.80', () => {
    const rates = makeMapLookup([
      { ratePlanId: STANDARD_PLAN_ID, roomTypeId: ROOM_TYPE_ID, date: date('2026-06-01'), occupancy: 2, price: 5000 },
    ]);
    const b = calculatePricing({
      ratePlan: LAST_MINUTE_PLAN,
      parentChain: [STANDARD_PLAN],
      arrival: date('2026-06-01'),
      departure: date('2026-06-02'),
      occupancy: 2,
      baseOccupancy: 2,
      roomTypeId: ROOM_TYPE_ID,
      currency: 'RUB',
      rates,
    });
    expect(b.totalPrice.toFixed(2)).toBe('4000.00');
    expect(b.nightly[0].inheritedFromParent).toBe(true);
    expect(b.nightly[0].sourceRatePlanId).toBe(STANDARD_PLAN_ID);
  });

  it('child plan ABSOLUTE +500 — parent rate + 500', () => {
    const rates = makeMapLookup([
      { ratePlanId: STANDARD_PLAN_ID, roomTypeId: ROOM_TYPE_ID, date: date('2026-06-01'), occupancy: 2, price: 3800 },
    ]);
    const b = calculatePricing({
      ratePlan: PLUS_500_PLAN,
      parentChain: [STANDARD_PLAN],
      arrival: date('2026-06-01'),
      departure: date('2026-06-02'),
      occupancy: 2,
      baseOccupancy: 2,
      roomTypeId: ROOM_TYPE_ID,
      currency: 'RUB',
      rates,
    });
    expect(b.totalPrice.toFixed(2)).toBe('4300.00');
  });

  it('child plan PERCENT 0 — no change', () => {
    const child: RatePlanLike = {
      id: 'child-zero',
      parentRatePlanId: STANDARD_PLAN_ID,
      priceModifierType: 'PERCENT',
      priceModifierValue: 0,
      occupancyPricing: false,
    };
    const rates = makeMapLookup([
      { ratePlanId: STANDARD_PLAN_ID, roomTypeId: ROOM_TYPE_ID, date: date('2026-06-01'), occupancy: 2, price: 3800 },
    ]);
    const b = calculatePricing({
      ratePlan: child,
      parentChain: [STANDARD_PLAN],
      arrival: date('2026-06-01'),
      departure: date('2026-06-02'),
      occupancy: 2,
      baseOccupancy: 2,
      roomTypeId: ROOM_TYPE_ID,
      currency: 'RUB',
      rates,
    });
    expect(b.totalPrice.toFixed(2)).toBe('3800.00');
  });

  it('child plan with OWN rate — overrides parent', () => {
    const rates = makeMapLookup([
      { ratePlanId: STANDARD_PLAN_ID, roomTypeId: ROOM_TYPE_ID, date: date('2026-06-01'), occupancy: 2, price: 5000 },
      // Override on the leaf:
      { ratePlanId: LAST_MINUTE_PLAN_ID, roomTypeId: ROOM_TYPE_ID, date: date('2026-06-01'), occupancy: 2, price: 3500 },
    ]);
    const b = calculatePricing({
      ratePlan: LAST_MINUTE_PLAN, // would normally compute as 5000*0.8 = 4000, but own rate overrides
      parentChain: [STANDARD_PLAN],
      arrival: date('2026-06-01'),
      departure: date('2026-06-02'),
      occupancy: 2,
      baseOccupancy: 2,
      roomTypeId: ROOM_TYPE_ID,
      currency: 'RUB',
      rates,
    });
    expect(b.totalPrice.toFixed(2)).toBe('3500.00');
    expect(b.nightly[0].inheritedFromParent).toBe(false);
    expect(b.nightly[0].sourceRatePlanId).toBe(LAST_MINUTE_PLAN_ID);
  });

  it('mix: child has own rate for some nights, inherits for others', () => {
    const rates = makeMapLookup([
      // Standard plan has rates for both nights.
      { ratePlanId: STANDARD_PLAN_ID, roomTypeId: ROOM_TYPE_ID, date: date('2026-06-01'), occupancy: 2, price: 5000 },
      { ratePlanId: STANDARD_PLAN_ID, roomTypeId: ROOM_TYPE_ID, date: date('2026-06-02'), occupancy: 2, price: 5000 },
      // Last Minute overrides only night 1:
      { ratePlanId: LAST_MINUTE_PLAN_ID, roomTypeId: ROOM_TYPE_ID, date: date('2026-06-01'), occupancy: 2, price: 3500 },
    ]);
    const b = calculatePricing({
      ratePlan: LAST_MINUTE_PLAN,
      parentChain: [STANDARD_PLAN],
      arrival: date('2026-06-01'),
      departure: date('2026-06-03'),
      occupancy: 2,
      baseOccupancy: 2,
      roomTypeId: ROOM_TYPE_ID,
      currency: 'RUB',
      rates,
    });
    expect(b.nightly[0].price.toFixed(2)).toBe('3500.00'); // own
    expect(b.nightly[1].price.toFixed(2)).toBe('4000.00'); // 5000 × 0.8 inherited
    expect(b.totalPrice.toFixed(2)).toBe('7500.00');
  });

  it('two-level chain: VIP −10% inherits from Last Minute −20% inherits from Standard', () => {
    const VIP_PLAN: RatePlanLike = {
      id: VIP_PLAN_ID,
      parentRatePlanId: LAST_MINUTE_PLAN_ID,
      priceModifierType: 'PERCENT',
      priceModifierValue: -10,
      occupancyPricing: false,
    };
    const rates = makeMapLookup([
      { ratePlanId: STANDARD_PLAN_ID, roomTypeId: ROOM_TYPE_ID, date: date('2026-06-01'), occupancy: 2, price: 10000 },
    ]);
    const b = calculatePricing({
      ratePlan: VIP_PLAN,
      parentChain: [LAST_MINUTE_PLAN, STANDARD_PLAN],
      arrival: date('2026-06-01'),
      departure: date('2026-06-02'),
      occupancy: 2,
      baseOccupancy: 2,
      roomTypeId: ROOM_TYPE_ID,
      currency: 'RUB',
      rates,
    });
    // Standard 10000 → LastMinute applies -20% → 8000 → VIP applies -10% → 7200
    expect(b.totalPrice.toFixed(2)).toBe('7200.00');
  });

  it('modifier clamped at 0 when ABSOLUTE drives negative', () => {
    const minusBig: RatePlanLike = {
      id: 'minus-big',
      parentRatePlanId: STANDARD_PLAN_ID,
      priceModifierType: 'ABSOLUTE',
      priceModifierValue: -9999,
      occupancyPricing: false,
    };
    const rates = makeMapLookup([
      { ratePlanId: STANDARD_PLAN_ID, roomTypeId: ROOM_TYPE_ID, date: date('2026-06-01'), occupancy: 2, price: 1000 },
    ]);
    const b = calculatePricing({
      ratePlan: minusBig,
      parentChain: [STANDARD_PLAN],
      arrival: date('2026-06-01'),
      departure: date('2026-06-02'),
      occupancy: 2,
      baseOccupancy: 2,
      roomTypeId: ROOM_TYPE_ID,
      currency: 'RUB',
      rates,
    });
    expect(b.totalPrice.toFixed(2)).toBe('0.00');
  });

  // ── Rounding / precision ───────────────────────────────────────────────────

  it('PERCENT modifier produces half-up rounded result to 2 decimals', () => {
    // 3800 × (1 - 0.12345) = 3800 × 0.87655 = 3330.89 (half-up from 3330.890)
    const oddPercent: RatePlanLike = {
      id: 'odd-pct',
      parentRatePlanId: STANDARD_PLAN_ID,
      priceModifierType: 'PERCENT',
      priceModifierValue: -12.345,
      occupancyPricing: false,
    };
    const rates = makeMapLookup([
      { ratePlanId: STANDARD_PLAN_ID, roomTypeId: ROOM_TYPE_ID, date: date('2026-06-01'), occupancy: 2, price: 3800 },
    ]);
    const b = calculatePricing({
      ratePlan: oddPercent,
      parentChain: [STANDARD_PLAN],
      arrival: date('2026-06-01'),
      departure: date('2026-06-02'),
      occupancy: 2,
      baseOccupancy: 2,
      roomTypeId: ROOM_TYPE_ID,
      currency: 'RUB',
      rates,
    });
    expect(b.totalPrice.toFixed(2)).toBe('3330.89');
  });

  it('sum of three nights × 3333.33 = 9999.99 (no float drift)', () => {
    const rates = makeMapLookup([
      { ratePlanId: STANDARD_PLAN_ID, roomTypeId: ROOM_TYPE_ID, date: date('2026-06-01'), occupancy: 2, price: '3333.33' },
      { ratePlanId: STANDARD_PLAN_ID, roomTypeId: ROOM_TYPE_ID, date: date('2026-06-02'), occupancy: 2, price: '3333.33' },
      { ratePlanId: STANDARD_PLAN_ID, roomTypeId: ROOM_TYPE_ID, date: date('2026-06-03'), occupancy: 2, price: '3333.33' },
    ]);
    const b = calculatePricing({
      ratePlan: STANDARD_PLAN,
      parentChain: [],
      arrival: date('2026-06-01'),
      departure: date('2026-06-04'),
      occupancy: 2,
      baseOccupancy: 2,
      roomTypeId: ROOM_TYPE_ID,
      currency: 'RUB',
      rates,
    });
    expect(b.totalPrice.toFixed(2)).toBe('9999.99');
  });

  it('half-up rounding: 100 × (1 - 0.025) = 97.50', () => {
    const plan: RatePlanLike = {
      id: 'p',
      parentRatePlanId: STANDARD_PLAN_ID,
      priceModifierType: 'PERCENT',
      priceModifierValue: -2.5,
      occupancyPricing: false,
    };
    const rates = makeMapLookup([
      { ratePlanId: STANDARD_PLAN_ID, roomTypeId: ROOM_TYPE_ID, date: date('2026-06-01'), occupancy: 2, price: 100 },
    ]);
    const b = calculatePricing({
      ratePlan: plan,
      parentChain: [STANDARD_PLAN],
      arrival: date('2026-06-01'),
      departure: date('2026-06-02'),
      occupancy: 2,
      baseOccupancy: 2,
      roomTypeId: ROOM_TYPE_ID,
      currency: 'RUB',
      rates,
    });
    expect(b.totalPrice.toFixed(2)).toBe('97.50');
  });

  // ── Cross-roomType isolation ──────────────────────────────────────────────

  it('does not pick up rate for a different roomType', () => {
    const rates = makeMapLookup([
      // Rate exists for a DIFFERENT room type.
      { ratePlanId: STANDARD_PLAN_ID, roomTypeId: 'some-other-type', date: date('2026-06-01'), occupancy: 2, price: 9999 },
    ]);
    const b = calculatePricing({
      ratePlan: STANDARD_PLAN,
      parentChain: [],
      arrival: date('2026-06-01'),
      departure: date('2026-06-02'),
      occupancy: 2,
      baseOccupancy: 2,
      roomTypeId: ROOM_TYPE_ID,
      currency: 'RUB',
      rates,
    });
    expect(b.totalPrice.toFixed(2)).toBe('0.00');
    expect(b.nightly[0].hasRate).toBe(false);
  });

  // ── Currency passthrough ──────────────────────────────────────────────────

  it('currency from input is returned verbatim', () => {
    const rates = makeMapLookup([]);
    const b = calculatePricing({
      ratePlan: STANDARD_PLAN,
      parentChain: [],
      arrival: date('2026-06-01'),
      departure: date('2026-06-01'),
      occupancy: 2,
      baseOccupancy: 2,
      roomTypeId: ROOM_TYPE_ID,
      currency: 'USD',
      rates,
    });
    expect(b.currency).toBe('USD');
  });

  // ── Long stay sanity ──────────────────────────────────────────────────────

  it('30-night stay aggregates correctly when all nights are 2500', () => {
    const ratesList: Array<{
      ratePlanId: string; roomTypeId: string; date: Date; occupancy: number; price: number;
    }> = [];
    for (let i = 0; i < 30; i++) {
      const d = new Date(Date.UTC(2026, 5, 1 + i));
      ratesList.push({ ratePlanId: STANDARD_PLAN_ID, roomTypeId: ROOM_TYPE_ID, date: d, occupancy: 2, price: 2500 });
    }
    const rates = makeMapLookup(ratesList);
    const b = calculatePricing({
      ratePlan: STANDARD_PLAN,
      parentChain: [],
      arrival: date('2026-06-01'),
      departure: date('2026-07-01'),
      occupancy: 2,
      baseOccupancy: 2,
      roomTypeId: ROOM_TYPE_ID,
      currency: 'RUB',
      rates,
    });
    expect(b.nights).toBe(30);
    expect(b.totalPrice.toFixed(2)).toBe('75000.00');
    expect(b.warnings).toEqual([]);
  });

  // ── Subtotal == totalPrice in MVP (no taxes/extras yet) ───────────────────

  it('subtotal equals totalPrice in Phase E (no taxes or extras yet)', () => {
    const rates = makeMapLookup([
      { ratePlanId: STANDARD_PLAN_ID, roomTypeId: ROOM_TYPE_ID, date: date('2026-06-01'), occupancy: 2, price: 4000 },
    ]);
    const b = calculatePricing({
      ratePlan: STANDARD_PLAN,
      parentChain: [],
      arrival: date('2026-06-01'),
      departure: date('2026-06-02'),
      occupancy: 2,
      baseOccupancy: 2,
      roomTypeId: ROOM_TYPE_ID,
      currency: 'RUB',
      rates,
    });
    expect(b.subtotal.toFixed(2)).toBe(b.totalPrice.toFixed(2));
  });
});
