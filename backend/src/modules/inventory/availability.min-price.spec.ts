import { Prisma } from '@prisma/client';
import { TenantContext } from '../../common/context/tenant-context';
import { AvailabilityService } from './availability.service';

const tenantId = '00000000-0000-4000-8000-000000000001';
const roomTypeId = '00000000-0000-4000-8000-000000000002';
const own = '00000000-0000-4000-8000-000000000003';
const corporate = '00000000-0000-4000-8000-000000000004';
const arrival = '2026-12-01';
const departure = '2026-12-04';
const date = (day: number) => new Date(Date.UTC(2026, 11, day));
const planById = new Map([
  [own, { tenantId, partnerId: null }],
  [corporate, { tenantId, partnerId: 'partner' }],
]);

function check(
  rows: Array<{ source: 'daily' | 'season' | 'standard'; plan: string; amount: number }>,
  ratePlanId?: string,
) {
  // Simulate the filters at the database boundary so a missing filter exposes
  // historical prices rather than forcing the application to discard rows.
  const baselines = (
    source: 'season' | 'standard',
    where: { ratePlanId?: string; ratePlan?: { partnerId?: string | null } },
  ) =>
    rows
      .filter(
        ({ source: type, plan }) =>
          type === source &&
          (!where.ratePlanId || plan === where.ratePlanId) &&
          (where.ratePlan?.partnerId === undefined ||
            planById.get(plan)?.partnerId === where.ratePlan.partnerId),
      )
      .map(({ plan, amount }) => ({
        ratePlanId: plan,
        roomTypeId,
        occupancy: 0,
        price: new Prisma.Decimal(amount),
        dateFrom: date(1),
        dateTo: date(2),
        sortOrder: 0,
      }));
  const tx = {
    $queryRaw: async (parts: TemplateStringsArray, ...values: unknown[]) => {
      const sql = parts.join('?');
      if (!/\bFROM rate\b/.test(sql)) return [];
      const planFilter = values.find((value) => value === own || value === corporate);
      return rows
        .filter(
          ({ source, plan }) =>
            source === 'daily' &&
            (!planFilter || plan === planFilter) &&
            (!/partner_id\s+IS NULL/i.test(sql) || planById.get(plan)?.partnerId === null),
        )
        .map(({ plan, amount }) => ({ rate_plan_id: plan, date: date(1), price: String(amount) }));
    },
    room: { count: async () => 1 },
    rateSeason: { findMany: async ({ where }: { where: object }) => baselines('season', where) },
    standardRate: {
      findMany: async ({ where }: { where: object }) => baselines('standard', where),
    },
  };
  const service = new AvailabilityService(
    { forTenant: (fn: (t: typeof tx) => unknown) => fn(tx) } as never,
    { raw: { get: async () => null, set: async () => 'OK' } } as never,
    {} as never,
  );
  return TenantContext.run({ tenantId, userId: 'u', roleCode: 'ADMIN', permissions: [] }, () =>
    service.check(roomTypeId, arrival, departure, ratePlanId),
  );
}

describe('availability minPrice excludes historical corporate rates', () => {
  describe.each(['daily', 'season', 'standard'] as const)('%s source', (source) => {
    it.each([undefined, corporate])('ignores corporate rows with plan filter %s', async (id) => {
      const result = await check([{ source, plan: corporate, amount: 100 }], id);
      expect(result.bookable).toBe(true);
      expect(result.days.map(({ minPrice }) => minPrice)).toEqual([null, null, null]);
    });
  });

  it.each([undefined, own])(
    'preserves daily > season > standard for own rates (%s)',
    async (id) => {
      const result = await check(
        [
          { source: 'daily', plan: own, amount: 1300 },
          { source: 'season', plan: own, amount: 1200 },
          { source: 'standard', plan: own, amount: 1100 },
          { source: 'standard', plan: corporate, amount: 100 },
        ],
        id,
      );
      expect(result.days.map(({ minPrice }) => minPrice)).toEqual([
        '1300.00',
        '1200.00',
        '1100.00',
      ]);
    },
  );
});
