import { ConnectivityService } from './connectivity.service';

function fixture(blocked: string[]) {
  const svc = Object.create(ConnectivityService.prototype) as ConnectivityService;
  const category = {
    id: 'cat',
    isActive: true,
    name: 'Category',
    maxOccupancy: 3,
    basePrice: 1000,
  };
  const plans = ['corp', 'own'].map((id) => ({
    id,
    name: id,
    isActive: true,
    partnerId: id === 'corp' ? 'partner' : null,
    partnerAccountId: null,
    partnerCustomerId: null,
    guestKind: null,
    mealPlan: 'NONE',
    operatorStatus: { applies: true },
  }));
  const prices = plans.map((p) => ({
    ...p,
    ratePlanId: p.id,
    nights: 2,
    total: '2000.00',
    nightlyFrom: '1000.00',
    vatRate: null,
    vatMixed: true,
    perNight: [
      { date: '2026-12-01', price: '1000.00', vatRate: '0' },
      { date: '2026-12-02', price: '1000.00', vatRate: '22' },
    ],
  }));
  const check = jest.fn(async (_rt: string, _in: string, _out: string, plan?: string) => ({
    nights: 2,
    bookable: !blocked.includes(plan ?? '*'),
    restrictionsAllowed: !blocked.includes(plan ?? '*'),
    days: [{ available: 2, minPrice: null }],
  }));
  const create = jest.fn(async () => ({ id: 'reservation' }));
  Object.assign(svc, {
    resolveTenant: async () => ({ id: 'tenant', slug: 'hotel' }),
    partnerQuery: async () => ({
      partnerId: 'partner',
      accountId: null,
      customerId: null,
      guestKind: null,
    }),
    prisma: {
      forTenantExplicit: async (_id: string, cb: (tx: object) => unknown) =>
        cb({
          roomType: { findMany: async () => [category], findUnique: async () => category },
          ratePlan: {
            findUnique: async ({ where }: { where: { id: string } }) =>
              plans.find((p) => p.id === where.id),
          },
        }),
    },
    ratePlans: { partnerPlans: async () => plans.filter((p) => p.partnerId) },
    availability: { check, priceByPlan: async () => prices },
    listRoomsForCategory: async () => [],
    resolvePinnedRoom: async () => 'room',
    pickAvailableRoom: async () => 'room',
    reservations: { create },
    logger: { log: jest.fn() },
  });
  return { svc, create, check };
}
const dates = { checkIn: '2026-12-01', checkOut: '2026-12-03' };

describe('partner offers and booking enforce rate-plan restrictions', () => {
  it('excludes a closed corporate plan while keeping an open ordinary plan', async () => {
    const { svc } = fixture(['corp']);
    const result = await svc.availabilityFor('hotel', { ...dates, guests: 2 }, 'partner');
    expect(result.offers[0].ratePlans.map((p) => p.ratePlanId)).toEqual(['own']);
  });
  it('does not advertise a category through fallback when every plan is closed', async () => {
    const { svc } = fixture(['corp', 'own']);
    expect((await svc.availabilityFor('hotel', { ...dates, guests: 2 }, 'partner')).offers).toEqual(
      [],
    );
  });
  it('preserves VAT per night at the HTTP boundary', async () => {
    const { svc } = fixture([]);
    const result = await svc.availabilityFor('hotel', { ...dates, guests: 2 }, 'partner');
    expect(result.offers[0].ratePlans[0]).toMatchObject({
      vatMixed: true,
      vatRate: null,
      perNight: [{ vatRate: 0 }, { vatRate: 22 }],
    });
  });
  it.each(['corp', 'own'])(
    'rejects explicit booking on closed plan %s before creating a reservation',
    async (ratePlanId) => {
      const { svc, create } = fixture([ratePlanId]);
      await expect(
        svc.createReservation(
          'hotel',
          { ...dates, categoryId: 'cat', adults: 2, guestName: 'QA', ratePlanId },
          'partner',
        ),
      ).rejects.toThrow(/restrictions|ограничен/i);
      expect(create).not.toHaveBeenCalled();
    },
  );
  it('rejects a booking with no selected plan when all plans are closed', async () => {
    const { svc, create } = fixture(['corp', 'own']);
    Object.assign(svc, { ratePlans: { partnerPlans: async () => [] } });
    await expect(
      svc.createReservation(
        'hotel',
        { ...dates, categoryId: 'cat', adults: 2, guestName: 'QA' },
        'partner',
      ),
    ).rejects.toThrow(/restrictions|ограничен/i);
    expect(create).not.toHaveBeenCalled();
  });
  it('bypasses cached availability before creating a booking', async () => {
    const { svc, check } = fixture([]);
    await svc.createReservation(
      'hotel',
      { ...dates, categoryId: 'cat', adults: 2, guestName: 'QA', ratePlanId: 'corp' },
      'partner',
    );
    expect(check).toHaveBeenCalledWith('cat', dates.checkIn, dates.checkOut, 'corp', {
      fresh: true,
    });
  });
});
