import { TenantContext } from '../../common/context/tenant-context';
import { RatePlansService } from './rate-plans.service';

const own = {
  id: 'own',
  code: 'OWN',
  name: 'Own',
  forOperator: false,
  partnerId: null,
  partnerAccountId: null,
  partnerCustomerId: null,
  guestKind: null,
  vatRate: null,
  parentRatePlanId: null,
  isActive: true,
  mealPlan: 'NONE',
  operatorContract: null,
};
const corp = {
  ...own,
  id: 'corp',
  code: 'CORP',
  name: 'Corp',
  forOperator: true,
  partnerId: 'partner',
  operatorContract: 'A',
};
function fixture(rows: Array<Record<string, unknown>> = [own, corp]) {
  const matches = (r: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(
      ([k, v]) =>
        v === undefined || (v && typeof v === 'object' && 'not' in v ? r[k] !== v.not : r[k] === v),
    );
  const tx = {
    ratePlan: {
      findUnique: jest.fn(
        async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id) ?? null,
      ),
      findFirst: jest.fn(
        async ({ where }: { where: Record<string, unknown> }) =>
          rows.find((r) => matches(r, where)) ?? null,
      ),
      create: jest.fn(async ({ data }: { data: object }) => ({ id: 'new', ...data })),
      update: jest.fn(async ({ data }: { data: object }) => data),
    },
    partner: { findUnique: async () => ({ isActive: true }) },
  };
  const svc = new RatePlansService(
    { forTenant: (cb: (t: typeof tx) => unknown) => cb(tx) } as never,
    { emitForRatePlan: async () => undefined } as never,
    {} as never,
    {} as never,
  );
  Object.assign(svc, { dropPriceCache: async () => undefined });
  const run = <T>(fn: () => T) =>
    TenantContext.run({ tenantId: 't', userId: 'u', roleCode: 'ADMIN', permissions: [] }, fn);
  return { svc, tx, run };
}
describe('rate-plan parent and contract scope validation', () => {
  it('rejects a corporate parent on create and update', async () => {
    const { svc, run, tx } = fixture();
    await expect(
      run(() => svc.create({ name: 'Child', code: 'CHILD', parentRatePlanId: 'corp' })),
    ).rejects.toThrow();
    await expect(run(() => svc.update('own', { parentRatePlanId: 'corp' }))).rejects.toThrow();
    expect(tx.ratePlan.create).not.toHaveBeenCalled();
    expect(tx.ratePlan.update).not.toHaveBeenCalled();
  });
  it('rejects a missing or foreign parent before relying on a foreign key', async () => {
    const { svc, run } = fixture();
    await expect(
      run(() => svc.create({ name: 'Child', code: 'CHILD', parentRatePlanId: 'foreign' })),
    ).rejects.toThrow();
  });
  it('prevents turning a parent into a corporate plan while it has children', async () => {
    const { svc, run } = fixture([own, { ...own, id: 'child', parentRatePlanId: 'own' }]);
    await expect(
      run(() =>
        svc.update('own', { partnerId: 'partner', forOperator: true, operatorContract: 'A' }),
      ),
    ).rejects.toThrow();
  });
  it('accepts the same conditions on a different contract', async () => {
    const { svc, run } = fixture();
    await expect(
      run(() =>
        svc.create({
          name: 'Future',
          code: 'FUTURE',
          partnerId: 'partner',
          forOperator: true,
          operatorContract: ' B ',
        }),
      ),
    ).resolves.toMatchObject({ operatorContract: 'B' });
  });
  it('rejects duplicate conditions on the same normalized contract', async () => {
    const { svc, run } = fixture();
    await expect(
      run(() =>
        svc.create({
          name: 'Duplicate',
          code: 'DUP',
          partnerId: 'partner',
          forOperator: true,
          operatorContract: ' A ',
        }),
      ),
    ).rejects.toThrow(/уже есть/);
  });
  it('uses the existing contract when update omits it', async () => {
    const { svc, run } = fixture([corp, { ...corp, id: 'other', operatorContract: 'B' }]);
    await expect(run(() => svc.update('corp', { name: 'Renamed' }))).resolves.toMatchObject({
      name: 'Renamed',
    });
  });
});
