import { BadRequestException, ConflictException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ConnectivityController } from './connectivity.controller';
import { ConnectivityService } from './connectivity.service';
import type { ConnectCreateReservationDto } from './dto/connect-create-reservation.dto';

const DTO: ConnectCreateReservationDto = {
  categoryId: 'cat',
  roomId: 'room',
  guestName: 'Гость',
  checkIn: '2026-11-01',
  checkOut: '2026-11-03',
  adults: 1,
};
const CREATED = { id: 'r1', status: 'CONFIRMED', version: 1, placeNumber: 1 };
const TENANT = { id: 't1', slug: 'h1', isActive: true };
const KEY = 'd68b3347-9df5-4980-8688-52ad3f42e65c';
const hash = (dto: ConnectCreateReservationDto) =>
  createHash('sha256')
    .update(
      JSON.stringify(
        Object.fromEntries(Object.entries(dto).sort(([a], [b]) => a.localeCompare(b))),
      ),
    )
    .digest('hex');

function make() {
  const svc = Object.create(ConnectivityService.prototype) as ConnectivityService;
  const replay = jest.fn(async (_channel: unknown): Promise<typeof CREATED | null> => null);
  const createReservation = jest.fn(async (..._args: unknown[]) => CREATED);
  const room = jest.fn(async () => 'room');
  const partnerQuery = jest.fn(async () => ({}));
  const plans = jest.fn(async () => []);
  const price = jest.fn(async () => []);
  const update = jest.fn(async () => ({}));
  Object.assign(svc, {
    logger: { log: jest.fn() },
    resolveTenant: async () => TENANT,
    partnerQuery,
    prisma: {
      forTenantExplicit: async (_tenantId: string, cb: (tx: object) => unknown) =>
        cb({
          roomType: {
            findUnique: async () => ({ isActive: true, maxOccupancy: 2, basePrice: 1000 }),
          },
          reservation: { update },
        }),
    },
    ratePlans: { partnerPlans: plans },
    availability: { priceByPlan: price },
    resolvePinnedRoom: room,
    pickAvailableRoom: room,
    reservations: { create: createReservation, findChannelReservation: replay },
  });
  return { svc, replay, createReservation, room, partnerQuery, plans, price, update };
}

const create = (svc: ConnectivityService, dto = DTO, key: string | string[] | undefined = KEY) =>
  svc.createReservation('h1', dto, 'p-avia', key);

describe('partner creation HTTP boundary', () => {
  it('forwards X-Idempotency-Key with the authenticated partner', async () => {
    const call = jest.fn();
    const controller = new ConnectivityController(
      { createReservation: call } as never,
      {} as never,
    );
    controller.createReservation('h1', DTO, {
      partner: { partnerId: 'p-avia' },
      headers: { 'x-idempotency-key': KEY },
    } as never);
    expect(call).toHaveBeenCalledWith('h1', DTO, 'p-avia', KEY);
  });

  it.each(['', ' ', 'key with spaces', 'ключ', 'key,duplicate', 'x'.repeat(201), ['one', 'two']])(
    'rejects a malformed or oversized key: %j',
    async (key) => {
      const { svc, createReservation } = make();
      await expect(create(svc, DTO, key)).rejects.toBeInstanceOf(BadRequestException);
      expect(createReservation).not.toHaveBeenCalled();
    },
  );

  it('accepts a 200-character ASCII token', async () => {
    const { svc } = make();
    expect(await create(svc, DTO, 'a'.repeat(200))).toMatchObject(CREATED);
  });

  it('replays before price, partner conditions and occupied-room availability', async () => {
    const { svc, replay, room, plans, price, createReservation, partnerQuery } = make();
    replay.mockResolvedValue(CREATED);
    room.mockRejectedValue(new ConflictException('Room is occupied by the first attempt'));
    expect(await create(svc)).toEqual({ hotelId: TENANT.id, slug: TENANT.slug, ...CREATED });
    expect(replay).toHaveBeenCalledWith({
      partnerId: 'p-avia',
      idempotency: { key: KEY, payloadHash: hash(DTO) },
    });
    expect(partnerQuery).not.toHaveBeenCalled();
    expect(plans).not.toHaveBeenCalled();
    expect(price).not.toHaveBeenCalled();
    expect(room).not.toHaveBeenCalled();
    expect(createReservation).not.toHaveBeenCalled();
  });

  it('propagates a payload conflict before availability', async () => {
    const { svc, replay, room, createReservation } = make();
    replay.mockRejectedValue(new ConflictException('Key already used with another payload'));
    await expect(create(svc)).rejects.toBeInstanceOf(ConflictException);
    expect(room).not.toHaveBeenCalled();
    expect(createReservation).not.toHaveBeenCalled();
  });

  it('passes the original payload fingerprint and records ownership without a later update', async () => {
    const { svc, createReservation, update } = make();
    await create(svc);
    expect(createReservation.mock.calls[0][2]).toEqual({
      partnerId: 'p-avia',
      idempotency: { key: KEY, payloadHash: hash(DTO) },
    });
    expect(update).not.toHaveBeenCalled();
  });

  it.each([
    { guestName: 'Другой гость' },
    { roomId: 'room-2' },
    { categoryId: 'cat-2' },
    { ratePlanId: 'rate-2' },
    { checkIn: '2026-11-02' },
    { checkOut: '2026-11-04' },
    { adults: 2 },
    { children: 1 },
    { phone: '+79001112233' },
    { email: 'guest@example.org' },
    { guestKind: 'CREW' as const },
    { account: 'account' },
    { customer: 'customer' },
    { comment: 'Комментарий' },
    { operatorRef: 'request' },
    { arrivalAt: '2026-11-01T13:00' },
    { departureAt: '2026-11-03T08:00' },
    { flight: 'SU 1' },
  ])('includes original request field changes in the fingerprint: %j', async (change) => {
    const { svc, replay } = make();
    replay.mockResolvedValue(CREATED);
    await create(svc, { ...DTO, ...change });
    expect(replay).toHaveBeenCalledWith({
      partnerId: 'p-avia',
      idempotency: { key: KEY, payloadHash: hash({ ...DTO, ...change }) },
    });
    expect(hash({ ...DTO, ...change })).not.toBe(hash(DTO));
  });

  it('does not depend on JSON object key ordering', async () => {
    const { svc, replay } = make();
    const reordered = Object.fromEntries(
      Object.entries(DTO).reverse(),
    ) as unknown as ConnectCreateReservationDto;
    await create(svc, reordered);
    expect(replay).toHaveBeenCalledWith({
      partnerId: 'p-avia',
      idempotency: { key: KEY, payloadHash: hash(DTO) },
    });
  });

  it('rechecks a concurrent commit when preflight now sees the room occupied', async () => {
    const { svc, replay, room, createReservation } = make();
    replay.mockResolvedValueOnce(null).mockResolvedValueOnce(CREATED);
    room.mockRejectedValue(new ConflictException('Room was booked while validating'));
    expect(await create(svc)).toEqual({ hotelId: TENANT.id, slug: TENANT.slug, ...CREATED });
    expect(createReservation).not.toHaveBeenCalled();
  });

  it('preserves the original availability error if no matching attempt committed', async () => {
    const { svc, room } = make();
    const unavailable = new ConflictException('Room booked by somebody else');
    room.mockRejectedValue(unavailable);
    await expect(create(svc)).rejects.toBe(unavailable);
  });

  it('keeps requests without a key compatible and still persists the owner atomically', async () => {
    const { svc, replay, createReservation, update } = make();
    expect(await svc.createReservation('h1', DTO, 'p-avia')).toMatchObject(CREATED);
    expect(replay).not.toHaveBeenCalled();
    expect(createReservation.mock.calls[0][2]).toEqual({ partnerId: 'p-avia' });
    expect(update).not.toHaveBeenCalled();
  });
});
