import { NotFoundException } from '@nestjs/common';
import { ConnectivityService } from './connectivity.service';

/* 152-ФЗ, Р-35, Р-41; план 13.10. Партнёрский API видит только брони, которые
 * завёл этот партнёр: бронь гостиницы и бронь другого партнёра неотличимы от
 * несуществующей. Факты — фактическое время заезда, не время правки. */

const TENANT = { id: 't1', slug: 'h1', currency: 'RUB', isActive: true, partnerVisible: true, provisional: false };
const ROW = {
  id: 'r1', tenantId: 't1', guestName: 'Гость', phone: null, roomId: 'room', roomTypeId: 'cat', status: 'CHECKED_IN',
  checkIn: new Date('2026-10-01'), checkOut: new Date('2026-10-03'), adults: 1, children: 0, totalPrice: null,
  placeNumber: 1, version: 3, notes: null, createdAt: new Date(), updatedAt: new Date('2026-10-02T15:00:00Z'),
  checkedInAt: new Date('2026-10-01T09:30:00Z'), checkedOutAt: null, room: { number: '101' },
};

function service(row: object | null) {
  const svc = Object.create(ConnectivityService.prototype) as ConnectivityService;
  const prisma = {
    admin: { tenant: { findUnique: jest.fn(async () => TENANT) } },
    forTenantExplicit: jest.fn(async (_t: string, cb: (tx: object) => unknown) =>
      cb({ reservation: { findUnique: jest.fn(async () => row) } }),
    ),
  };
  Object.assign(svc, { prisma });
  return svc;
}

describe('Партнёрский API — только свои брони', () => {
  it('своя бронь — читается', async () => {
    const r = await service({ ...ROW, channelManaged: true, partnerId: 'p-avia' }).getReservation('h1', 'r1', 'p-avia');
    expect(r.id).toBe('r1');
  });

  it('бронь другого партнёра — как несуществующая', async () => {
    await expect(service({ ...ROW, channelManaged: true, partnerId: 'p-other' }).getReservation('h1', 'r1', 'p-avia')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('бронь, заведённая гостиницей, — как несуществующая (и не отменить)', async () => {
    const svc = service({ ...ROW, channelManaged: false, partnerId: null });
    await expect(svc.getReservation('h1', 'r1', 'p-avia')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.cancelReservation('h1', 'r1', 'p-avia')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('факты — фактическое время заезда, а не время последней правки', async () => {
    const f = await service({ ...ROW, channelManaged: true, partnerId: 'p-avia' }).getFacts('h1', 'r1', 'p-avia');
    expect(f.checkedInAt).toEqual(new Date('2026-10-01T09:30:00Z'));
    expect(f.checkedOutAt).toBeNull();
  });
});
