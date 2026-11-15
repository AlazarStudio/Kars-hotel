import { TenantContext } from '../../common/context/tenant-context';
import { AvailabilityService } from './availability.service';

const arrival = '2026-12-01';
const departure = '2026-12-03';
const row = (date: string, values: object) => ({
  date: new Date(`${date}T00:00:00Z`),
  closed: false,
  cta: false,
  ctd: false,
  stop_sell: false,
  min_los: null,
  max_los: null,
  min_los_arrival: null,
  max_los_arrival: null,
  min_advance: null,
  max_advance: null,
  rate_plan_id: null,
  ...values,
});

function check(rows: object[]) {
  const tx = {
    $queryRaw: jest.fn(async (parts: TemplateStringsArray) =>
      parts.join('').includes('FROM restriction') ? rows : [],
    ),
    room: { count: async () => 3 },
    rateSeason: { findMany: async () => [] },
    standardRate: { findMany: async () => [] },
  };
  const service = new AvailabilityService(
    { forTenant: (cb: (t: typeof tx) => unknown) => cb(tx) } as never,
    { raw: { get: async () => null, set: async () => 'OK' } } as never,
    {} as never,
  );
  return TenantContext.run({ tenantId: 't', userId: 'u', roleCode: 'ADMIN', permissions: [] }, () =>
    service.check('room', arrival, departure, 'corp'),
  );
}

describe('availability: shared hotel and rate-plan restriction rules', () => {
  it('a specific rule overrides the general row independently of database order', async () => {
    const general = row(arrival, { closed: true });
    const specific = row(arrival, { rate_plan_id: 'corp', min_los: 1 });
    expect((await check([general, specific])).bookable).toBe(true);
    expect((await check([specific, general])).bookable).toBe(true);
  });
  it.each([{ min_advance: 10000 }, { max_advance: -10000 }])(
    'honours advance booking limits %j',
    async (limit) => {
      expect((await check([row(arrival, limit)])).bookable).toBe(false);
    },
  );
  it('honours stop sell from restrictions', async () => {
    expect((await check([row(arrival, { stop_sell: true })])).bookable).toBe(false);
  });
  it('honours closure on the departure date without charging that night', async () => {
    const result = await check([row(departure, { ctd: true })]);
    expect(result.nights).toBe(2);
    expect(result.bookable).toBe(false);
  });
  it('does not apply arrival-only maximum LOS on later nights', async () => {
    expect((await check([row('2026-12-02', { max_los_arrival: 1 })])).bookable).toBe(true);
  });
  it('uses the strictest maximum LOS at arrival', async () => {
    expect((await check([row(arrival, { max_los: 4, max_los_arrival: 1 })])).bookable).toBe(false);
  });
  it('still accepts an unrestricted stay and ignores departure-day stop sell', async () => {
    expect((await check([row(departure, { stop_sell: true, closed: true })])).bookable).toBe(true);
  });
});
