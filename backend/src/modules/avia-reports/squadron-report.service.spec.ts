import { BadRequestException, ConflictException } from '@nestjs/common';

const TENANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PARTNER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const RESERVATION = '11111111-1111-4111-8111-111111111111';
const SUBMISSION = '22222222-2222-4222-8222-222222222222';
const date = (day: string) => new Date(`${day}T00:00:00.000Z`);

function reservation(overrides: Record<string, unknown> = {}) {
  return {
    id: RESERVATION, checkIn: date('2026-10-01'), checkOut: date('2026-10-04'),
    checkedInAt: null, checkedOutAt: null,
    adults: 2, children: 0, status: 'CHECKED_OUT', totalPrice: '300.03',
    roomTypeId: 'category', ratePlanId: 'plan', room: { number: '101', roomType: { basePrice: '100.01' } },
    mealDays: [
      { date: date('2026-10-02'), breakfast: 2, lunch: 0, dinner: 0 },
      { date: date('2026-10-04'), breakfast: 1, lunch: 0, dinner: 0 },
    ],
    ...overrides,
  };
}

function setup(rows = [reservation()], charges = [{ total: '20.05' }]) {
  const tx = {
    reservation: { findMany: jest.fn(async () => rows) },
    folio: { findMany: jest.fn(async () => [{ reservationId: RESERVATION, charges }]) },
    roomType: { findMany: jest.fn(async () => [{ id: 'category', basePrice: '100.01' }]) },
    tenant: { findUnique: jest.fn(async () => ({ timezone: 'Europe/Moscow' })) },
    ratePlan: { findMany: jest.fn(async () => [] as any[]) },
  };
  const prisma = { forTenantExplicit: jest.fn(async (_tenant: string, fn: (v: typeof tx) => unknown) => fn(tx)) };
  const channel = {
    squadronPartnerId: jest.fn(async () => PARTNER),
    squadronMatch: jest.fn(async (_tenant: string, ids: string[]) => ids.map((reservationId) => ({ reservationId, requestNumber: 'Э-1' }))),
    squadronSubmit: jest.fn(async (_tenant: string, payload: unknown) => payload),
  };
  const availability = { priceByPlan: jest.fn(async () => [{ ratePlanId: 'plan', perNight: [
    { date: '2026-10-01', price: '100.01' },
    { date: '2026-10-02', price: '100.01' },
    { date: '2026-10-03', price: '100.01' },
  ] }]) };
  // The module is required here so the initial RED shows the missing feature.
  const { SquadronReportService } = require('./squadron-report.service');
  const service = new SquadronReportService(prisma, channel, availability);
  return { service, tx, prisma, channel, availability };
}

describe('Hotel squadron reports', () => {
  it('uses the stored whole-stay price and actual meal charges with exact kopecks', async () => {
    const { service, availability } = setup();
    const result = await service.preview(TENANT, '2026-10-01', '2026-10-04');
    expect(result.rows[0]).toMatchObject({
      requestNumber: 'Э-1', stayStart: '2026-10-01', stayEnd: '2026-10-04', nights: 3,
      accommodationKopecks: 30003, mealKopecks: 2005, breakfastCount: 3,
    });
    expect(result.totalKopecks).toBe(32008);
    expect(availability.priceByPlan).not.toHaveBeenCalled();
  });

  it('clips nights inclusively and requires the full price breakdown to match the snapshot', async () => {
    const s = setup();
    const partial = await s.service.preview(TENANT, '2026-10-02', '2026-10-03');
    expect(partial.rows[0]).toMatchObject({ stayStart: '2026-10-02', stayEnd: '2026-10-03', nights: 2, accommodationKopecks: 20002, mealKopecks: null });
    s.availability.priceByPlan.mockResolvedValueOnce([{ ratePlanId: 'plan', perNight: [
      { date: '2026-10-01', price: '100.00' }, { date: '2026-10-02', price: '100.00' }, { date: '2026-10-03', price: '100.00' },
    ] }]);
    const mismatch = await s.service.preview(TENANT, '2026-10-02', '2026-10-03');
    expect(mismatch.rows[0].accommodationKopecks).toBeNull();
  });

  it('includes checkout breakfast without inventing an accommodation or meal price', async () => {
    const { service } = setup();
    const result = await service.preview(TENANT, '2026-10-04', '2026-10-04');
    expect(result.rows[0]).toMatchObject({ stayStart: '2026-10-04', stayEnd: '2026-10-04', nights: 0, accommodationKopecks: 0, mealKopecks: null, breakfastCount: 1 });
    expect(result.totalKopecks).toBeNull();
  });

  it('uses explicit tenant and partner filters and excludes unmatched reservations', async () => {
    const s = setup();
    s.channel.squadronMatch.mockResolvedValueOnce([]);
    const result = await s.service.preview(TENANT, '2026-10-01', '2026-10-04');
    expect(result.rows).toEqual([]);
    expect(s.prisma.forTenantExplicit).toHaveBeenCalledWith(TENANT, expect.any(Function));
    expect(s.tx.reservation.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      tenantId: TENANT, partnerId: PARTNER, channelManaged: true,
      status: { in: ['CHECKED_IN', 'CHECKED_OUT'] },
      AND: [
        { OR: [{ checkIn: { lte: date('2026-10-04') } }, { checkedInAt: { lt: date('2026-10-06') } }] },
        { OR: [{ checkOut: { gte: date('2026-10-01') } }, { checkedOutAt: { gte: date('2026-09-30') } }] },
      ],
    }) }));
  });

  it('clips an early checkout including checkout meals and does not price later days', async () => {
    const s = setup([reservation({ checkIn: date('2026-10-09'), checkOut: date('2026-10-12'),
      checkedInAt: new Date('2026-10-09T08:00:00Z'), checkedOutAt: new Date('2026-10-10T08:00:00Z'),
      mealDays: [{ date: date('2026-10-10'), breakfast: 1, lunch: 0, dinner: 0 },
        { date: date('2026-10-11'), breakfast: 5, lunch: 0, dinner: 0 }] })], []);
    s.availability.priceByPlan.mockResolvedValue([{ ratePlanId: 'plan', perNight: [
      { date: '2026-10-09', price: '100.01' }, { date: '2026-10-10', price: '100.01' }, { date: '2026-10-11', price: '100.01' },
    ] }]);
    const preview = await s.service.preview(TENANT, '2026-10-09', '2026-10-10');
    expect(preview.rows[0]).toMatchObject({ nights: 1, accommodationKopecks: 10001, breakfastCount: 1, stayEnd: '2026-10-10' });
    expect((await s.service.preview(TENANT, '2026-10-11', '2026-10-12')).rows).toEqual([]);
  });

  it('caps a checked-in stay at the current local day and never bills future nights or meals', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-02T12:00:00Z'));
    try {
      const s = setup([reservation({ status: 'CHECKED_IN', checkedInAt: new Date('2026-10-01T08:00:00Z') })], []);
      const preview = await s.service.preview(TENANT, '2026-10-01', '2026-10-04');
      expect(preview.rows[0]).toMatchObject({ nights: 1, accommodationKopecks: 10001, breakfastCount: 2, stayEnd: '2026-10-02' });
      expect((await s.service.preview(TENANT, '2026-10-03', '2026-10-04')).rows).toEqual([]);
    } finally { jest.useRealTimers(); }
  });

  it('maps actual timestamps to the hotel calendar across UTC midnight', async () => {
    const s = setup([reservation({ checkedInAt: new Date('2026-10-01T22:30:00Z'), checkedOutAt: new Date('2026-10-03T22:30:00Z') })], []);
    const preview = await s.service.preview(TENANT, '2026-10-01', '2026-10-04');
    expect(preview.rows[0]).toMatchObject({ nights: 2, accommodationKopecks: 20002, stayStart: '2026-10-02', stayEnd: '2026-10-04', breakfastCount: 3 });
    expect(s.tx.tenant.findUnique).toHaveBeenCalledWith({ where: { id: TENANT }, select: { timezone: true } });
  });

  it('leaves late nights outside the original snapshot unpriced but still prices covered nights', async () => {
    const s = setup([reservation({ checkedInAt: new Date('2026-10-01T08:00:00Z'), checkedOutAt: new Date('2026-10-06T08:00:00Z'), mealDays: [] })], []);
    const late = await s.service.preview(TENANT, '2026-10-05', '2026-10-05');
    expect(late.rows[0]).toMatchObject({ nights: 1, accommodationKopecks: null });
    const covered = await s.service.preview(TENANT, '2026-10-02', '2026-10-03');
    expect(covered.rows[0].accommodationKopecks).toBe(20002);
  });

  it('does not bill a future meal on an active stay even when no checkout fact exists', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-02T12:00:00Z'));
    try {
      const s = setup([reservation({ status: 'CHECKED_IN', checkedInAt: null, checkedOutAt: null })], []);
      expect((await s.service.preview(TENANT, '2026-10-04', '2026-10-04')).rows).toEqual([]);
    } finally { jest.useRealTimers(); }
  });

  it.each([['2026-02-30', '2026-03-01'], ['2026-11-31', '2026-12-01'], ['2026-03-02', '2026-03-01']])('rejects invalid dates %s %s', async (start, end) => {
    const { service, prisma } = setup();
    await expect(service.preview(TENANT, start, end)).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.forTenantExplicit).not.toHaveBeenCalled();
  });

  it('rebuilds before sending, retains explicit zero and reuses the submission id for retries', async () => {
    const s = setup();
    const preview = await s.service.preview(TENANT, '2026-10-02', '2026-10-03');
    const body = { startDate: '2026-10-02', endDate: '2026-10-03', previewToken: preview.previewToken,
      version: 1, submissionId: SUBMISSION, corrections: [{ reservationId: RESERVATION, mealKopecks: 0 }] };
    await s.service.submit(TENANT, body);
    await s.service.submit(TENANT, body);
    const first = s.channel.squadronSubmit.mock.calls[0][1] as any;
    expect(first).toEqual(s.channel.squadronSubmit.mock.calls[1][1]);
    expect(first.submissionId).toBe(SUBMISSION);
    expect(first.rows[0]).toMatchObject({ accommodationKopecks: 20002, mealKopecks: 0 });
    expect(Object.keys(first.rows[0])).toEqual(['reservationId', 'roomNumber', 'guestCount', 'stayStart', 'stayEnd', 'nights', 'accommodationKopecks', 'mealKopecks', 'breakfastCount', 'lunchCount', 'dinnerCount']);
  });

  it('rejects stale facts and corrections for unknown reservations', async () => {
    const s = setup();
    const preview = await s.service.preview(TENANT, '2026-10-01', '2026-10-04');
    const body = { startDate: '2026-10-01', endDate: '2026-10-04', previewToken: preview.previewToken,
      version: 0, submissionId: SUBMISSION, corrections: [{ reservationId: SUBMISSION, mealKopecks: 0 }] };
    await expect(s.service.submit(TENANT, body)).rejects.toBeInstanceOf(BadRequestException);
    s.tx.reservation.findMany.mockResolvedValueOnce([reservation({ adults: 1 })]);
    await expect(s.service.submit(TENANT, { ...body, corrections: [] })).rejects.toBeInstanceOf(ConflictException);
    expect(s.channel.squadronSubmit).not.toHaveBeenCalled();
  });

  it('prices only selected nights when no snapshot exists and does not invent missing tariffs', async () => {
    const s = setup([reservation({ totalPrice: null })], []);
    s.availability.priceByPlan.mockResolvedValueOnce([{ ratePlanId: 'plan', perNight: [
      { date: '2026-10-02', price: '0.00' }, { date: '2026-10-03', price: '12.34' },
    ] }]);
    const partial = await s.service.preview(TENANT, '2026-10-02', '2026-10-03');
    expect(partial.rows[0].accommodationKopecks).toBe(1234);
    expect(s.availability.priceByPlan).toHaveBeenCalledWith('category', '2026-10-02', '2026-10-04', '100.01', 2);
    s.availability.priceByPlan.mockResolvedValueOnce([]);
    expect((await s.service.preview(TENANT, '2026-10-02', '2026-10-03')).rows[0].accommodationKopecks).toBeNull();
  });

  it('uses the category fixed on the reservation when the room was recategorized', async () => {
    const s = setup([reservation({ totalPrice: null, room: { number: '101', roomType: { basePrice: '999.99' } } })], []);
    s.availability.priceByPlan.mockResolvedValueOnce([{ ratePlanId: 'plan', perNight: [
      { date: '2026-10-02', price: '100.01' }, { date: '2026-10-03', price: '100.01' },
    ] }]);
    await s.service.preview(TENANT, '2026-10-02', '2026-10-03');
    expect(s.availability.priceByPlan).toHaveBeenCalledWith('category', '2026-10-02', '2026-10-04', '100.01', 2);
  });

  it('treats stored zero as a valid whole-stay price', async () => {
    const s = setup([reservation({ totalPrice: '0.00', mealDays: [] })], []);
    const preview = await s.service.preview(TENANT, '2026-10-01', '2026-10-04');
    expect(preview.rows[0]).toMatchObject({ accommodationKopecks: 0, mealKopecks: 0 });
    expect(preview.totalKopecks).toBe(0);
  });

  it('requires an explicit meal amount for ordered meals without a charge, but not for meals outside the period', async () => {
    const s = setup([reservation({ mealDays: [{ date: date('2026-10-02'), breakfast: 1, lunch: 0, dinner: 0 }] })], []);
    expect((await s.service.preview(TENANT, '2026-10-01', '2026-10-04')).rows[0].mealKopecks).toBeNull();
    expect((await s.service.preview(TENANT, '2026-10-03', '2026-10-03')).rows[0].mealKopecks).toBe(0);
  });

  it('prices included meals only when all ordered types are part of the plan', async () => {
    const s = setup([reservation({ mealDays: [{ date: date('2026-10-02'), breakfast: 1, lunch: 0, dinner: 0 }] })], []);
    s.tx.ratePlan.findMany.mockResolvedValue([{ id: 'plan', mealPlan: 'BB', mealIncluded: true,
      mealPriceBreakfast: null, mealPriceLunch: null, mealPriceDinner: null, mealPricePerDay: null, allInclusiveNote: null }]);
    expect((await s.service.preview(TENANT, '2026-10-01', '2026-10-04')).rows[0].mealKopecks).toBe(0);
    s.tx.reservation.findMany.mockResolvedValueOnce([reservation({ mealDays: [{ date: date('2026-10-02'), breakfast: 1, lunch: 1, dinner: 0 }] })]);
    expect((await s.service.preview(TENANT, '2026-10-01', '2026-10-04')).rows[0].mealKopecks).toBeNull();
  });

  it('uses each ordered portion price, and leaves missing portion prices unfilled', async () => {
    const s = setup([reservation({ mealDays: [{ date: date('2026-10-02'), breakfast: 2, lunch: 1, dinner: 0 }] })], []);
    const plan = { id: 'plan', mealPlan: 'FB', mealIncluded: false, mealPriceBreakfast: 12,
      mealPriceLunch: 33, mealPriceDinner: null, mealPricePerDay: null, allInclusiveNote: null };
    s.tx.ratePlan.findMany.mockResolvedValue([plan]);
    expect((await s.service.preview(TENANT, '2026-10-01', '2026-10-04')).rows[0].mealKopecks).toBe(5700);
    s.tx.ratePlan.findMany.mockResolvedValue([{ ...plan, mealPriceLunch: null }]);
    expect((await s.service.preview(TENANT, '2026-10-01', '2026-10-04')).rows[0].mealKopecks).toBeNull();
  });

  it('uses the maximum servings per day for a daily meal price over the selected days', async () => {
    const s = setup([reservation({ mealDays: [
      { date: date('2026-10-01'), breakfast: 2, lunch: 1, dinner: 0 },
      { date: date('2026-10-02'), breakfast: 1, lunch: 3, dinner: 3 },
      { date: date('2026-10-04'), breakfast: 9, lunch: 0, dinner: 0 },
    ] })], []);
    s.tx.ratePlan.findMany.mockResolvedValue([{ id: 'plan', mealPlan: 'FB', mealIncluded: false,
      mealPriceBreakfast: null, mealPriceLunch: null, mealPriceDinner: null, mealPricePerDay: 100, allInclusiveNote: null }]);
    const preview = await s.service.preview(TENANT, '2026-10-01', '2026-10-02');
    expect(preview.rows[0].mealKopecks).toBe(50000);
    expect(s.tx.ratePlan.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: TENANT, id: { in: ['plan'] } } }));
  });

  it('prioritizes whole-stay meal charges and never allocates them to a partial period using the tariff', async () => {
    const s = setup();
    s.tx.ratePlan.findMany.mockResolvedValue([{ id: 'plan', mealPlan: 'BB', mealIncluded: true,
      mealPriceBreakfast: null, mealPriceLunch: null, mealPriceDinner: null, mealPricePerDay: null, allInclusiveNote: null }]);
    expect((await s.service.preview(TENANT, '2026-10-01', '2026-10-04')).rows[0].mealKopecks).toBe(2005);
    expect((await s.service.preview(TENANT, '2026-10-02', '2026-10-03')).rows[0].mealKopecks).toBeNull();
  });

  it('ignores obsolete meal days outside the stay but keeps checkout meals', async () => {
    const s = setup([reservation({ mealDays: [
      { date: date('2026-09-30'), breakfast: 8, lunch: 0, dinner: 0 },
      { date: date('2026-10-04'), breakfast: 1, lunch: 0, dinner: 0 },
      { date: date('2026-10-05'), breakfast: 9, lunch: 0, dinner: 0 },
    ] })]);
    const preview = await s.service.preview(TENANT, '2026-10-01', '2026-10-05');
    expect(preview.rows[0].breakfastCount).toBe(1);
    expect(preview.rows[0].stayEnd).toBe('2026-10-04');
    expect(preview.rows[0].mealKopecks).toBe(2005);
  });

  it('batches the hotel match requests at 500 reservations', async () => {
    const rows = Array.from({ length: 501 }, (_, i) => reservation({ id: `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111` }));
    const s = setup(rows, []);
    await s.service.preview(TENANT, '2026-10-01', '2026-10-04');
    expect(s.channel.squadronMatch.mock.calls.map((call) => call[1].length)).toEqual([500, 1]);
  });

  it('does not accept an Avia match for an id outside the scoped reservation query', async () => {
    const s = setup();
    s.channel.squadronMatch.mockResolvedValueOnce([{ reservationId: SUBMISSION, requestNumber: 'foreign' }]);
    expect((await s.service.preview(TENANT, '2026-10-01', '2026-10-04')).rows).toEqual([]);
  });

  it('rejects an aggregate over the safe integer limit even with individually valid prices', async () => {
    const rows = Array.from({ length: 4504 }, (_, i) => reservation({
      id: `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`, totalPrice: '9999999999.99', mealDays: [],
    }));
    const s = setup(rows, []);
    const preview = await s.service.preview(TENANT, '2026-10-01', '2026-10-04');
    const corrections = rows.map((r) => ({ reservationId: r.id, mealKopecks: 999999999999 }));
    await expect(s.service.submit(TENANT, { startDate: '2026-10-01', endDate: '2026-10-04',
      version: 0, submissionId: SUBMISSION, previewToken: preview.previewToken, corrections })).rejects.toBeInstanceOf(BadRequestException);
    expect(s.channel.squadronSubmit).not.toHaveBeenCalled();
  });

  it('rejects more than 5000 actual report rows', async () => {
    const rows = Array.from({ length: 5001 }, (_, i) => reservation({
      id: `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`, mealDays: [],
    }));
    const s = setup(rows, []);
    await expect(s.service.preview(TENANT, '2026-10-01', '2026-10-04')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects empty, unpriced, negative and oversized corrections', async () => {
    const s = setup();
    const preview = await s.service.preview(TENANT, '2026-10-02', '2026-10-03');
    const body = { startDate: '2026-10-02', endDate: '2026-10-03', previewToken: preview.previewToken,
      version: 0, submissionId: SUBMISSION, corrections: [] };
    await expect(s.service.submit(TENANT, body)).rejects.toBeInstanceOf(BadRequestException);
    for (const amount of [-1, 1.5, 1000000000000, null]) {
      await expect(s.service.submit(TENANT, { ...body, corrections: [{ reservationId: RESERVATION, mealKopecks: amount }] })).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(s.channel.squadronSubmit).not.toHaveBeenCalled();
  });
});
