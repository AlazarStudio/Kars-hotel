import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AvailabilityService } from '../inventory/availability.service';
import { ConnectivityService } from './connectivity.service';

const dates = { checkIn: '2026-12-01', checkOut: '2026-12-03' };

function fixture(stopSell = false) {
  const category = {
    id: 'category',
    name: 'Room',
    maxOccupancy: 2,
    isActive: true,
    basePrice: 1000,
  };
  const plan = {
    id: 'corp',
    name: 'Corporate',
    code: 'CORP',
    isActive: true,
    forOperator: true,
    partnerId: 'partner',
    partnerAccountId: null,
    partnerCustomerId: null,
    guestKind: null,
    mealPlan: 'NONE',
    operatorContract: 'C-1',
    operatorStatus: { applies: false, state: 'DRAFT' },
    vatRate: null,
  };
  const tx = {
    $queryRaw: async (parts: TemplateStringsArray) =>
      stopSell && parts.join('').includes('FROM restriction')
        ? [{ rate_plan_id: null, date: new Date(`${dates.checkIn}T00:00:00Z`), stop_sell: true }]
        : [],
    room: { count: async () => 1 },
    roomType: { findMany: async () => [category], findUnique: async () => category },
    ratePlan: { findMany: async () => [plan], findUnique: async () => plan },
    rateSeason: { findMany: async () => [] },
    standardRate: {
      findMany: async ({ where }: { where: { ratePlan?: { partnerId?: string | null } } }) =>
        where.ratePlan?.partnerId === null
          ? []
          : [
              {
                ratePlanId: plan.id,
                roomTypeId: category.id,
                occupancy: 0,
                price: new Prisma.Decimal(100),
              },
            ],
    },
  };
  const prisma = {
    forTenant: async (cb: (t: typeof tx) => unknown) => cb(tx),
    forTenantExplicit: async (_id: string, cb: (t: typeof tx) => unknown) => cb(tx),
  };
  const availability = new AvailabilityService(
    prisma as never,
    { raw: { get: async () => null, set: async () => 'OK' } } as never,
    {
      slicesFor: async () =>
        new Map([[plan.id, { slice: null, docs: [], unknownCustomer: false }]]),
    } as never,
  );
  const create = jest.fn(async () => ({ id: 'reservation' }));
  const service = Object.create(ConnectivityService.prototype) as ConnectivityService;
  Object.assign(service, {
    prisma,
    availability,
    resolveTenant: async () => ({ id: 'tenant', slug: 'hotel', currency: 'RUB' }),
    partnerQuery: async () => ({
      partnerId: 'partner',
      accountId: null,
      customerId: null,
      guestKind: null,
    }),
    ratePlans: { partnerPlans: async () => [plan] },
    listRoomsForCategory: async () => [],
    pickAvailableRoom: async () => 'room',
    reservations: { create },
    logger: { log: jest.fn() },
  });
  return {
    offers: () => service.availabilityFor('hotel', { ...dates, guests: 2 }, 'partner'),
    book: () =>
      service.createReservation(
        'hotel',
        { ...dates, categoryId: category.id, adults: 2, guestName: 'QA' },
        'partner',
      ),
    create,
  };
}

describe('partner offers with an unpriced corporate tariff', () => {
  it('uses the category base price when the only tariff has historical rates but no price grid', async () => {
    const { offers } = fixture();
    const result = await offers();
    expect(result.offers).toMatchObject([{ nightlyRate: 1000, ratePlans: [] }]);
    expect(result.corporateTariff).toMatchObject({ ratePlanId: 'corp', applies: false });
  });

  it('a general stop-sale prevents both a fallback offer and booking without a tariff', async () => {
    const { offers, book, create } = fixture(true);
    expect((await offers()).offers).toEqual([]);
    await expect(book()).rejects.toBeInstanceOf(ConflictException);
    expect(create).not.toHaveBeenCalled();
  });
});
