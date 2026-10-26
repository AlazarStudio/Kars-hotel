import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConnectivityService } from './connectivity.service';
import { ConnectStayFactDto } from './dto/connect-stay-fact.dto';

/* ЗАЕЗД И ВЫЕЗД ОТ ПАРТНЁРА (26.10.2026, правка заказчика Kars Avia: «отмечаем
 * выезд в Эскадрилье, потом ещё заходим в шахматку выселить»). Время —
 * партнёра; повтор — не ошибка. Отрицанием: будущее НЕ принимается, чужая
 * бронь — как несуществующая, уже сделанное НЕ делается второй раз. */

const TENANT = { id: 't1', slug: 'h1', currency: 'RUB', isActive: true, partnerVisible: true, provisional: false };
const ROW = {
  id: 'r1', tenantId: 't1', guestName: 'Гость', phone: null, roomId: 'room', roomTypeId: 'cat', status: 'CONFIRMED',
  checkIn: new Date('2026-10-21'), checkOut: new Date('2026-10-25'), adults: 1, children: 0, totalPrice: null,
  placeNumber: 1, version: 3, notes: null, createdAt: new Date(), updatedAt: new Date(),
  checkedInAt: null, checkedOutAt: null, room: { number: '62' }, channelManaged: true, partnerId: 'p-avia',
};

function service(row: object | null) {
  const svc = Object.create(ConnectivityService.prototype) as ConnectivityService;
  const calls: { fact: string; at: Date }[] = [];
  const prisma = {
    admin: { tenant: { findUnique: jest.fn(async () => TENANT) } },
    forTenantExplicit: jest.fn(async (_t: string, cb: (tx: object) => unknown) =>
      cb({ reservation: { findUnique: jest.fn(async () => row) } }),
    ),
  };
  const reservations = {
    recordPartnerFact: jest.fn(async (_id: string, fact: string, at: Date) => {
      calls.push({ fact, at });
      return {};
    }),
  };
  Object.assign(svc, { prisma, reservations, runAsTenant: (_t: string, fn: () => unknown) => fn() });
  return { svc, calls };
}

describe('Заезд и выезд от партнёра', () => {
  it('заезд — с временем партнёра, а не «сейчас»', async () => {
    const { svc, calls } = service(ROW);
    await svc.recordStayFact('h1', 'r1', 'p-avia', 'CHECKED_IN', '2026-10-20T21:10:00.000Z');
    expect(calls).toEqual([{ fact: 'CHECKED_IN', at: new Date('2026-10-20T21:10:00.000Z') }]);
  });

  it('выезд заселённого — выселяет', async () => {
    const { svc, calls } = service({ ...ROW, status: 'CHECKED_IN' });
    await svc.recordStayFact('h1', 'r1', 'p-avia', 'CHECKED_OUT', '2026-10-25T06:45:00.000Z');
    expect(calls.map((c) => c.fact)).toEqual(['CHECKED_OUT']);
  });

  it('повтор — НЕ делается второй раз: уже заселён, уже выселен', async () => {
    for (const [status, fact] of [['CHECKED_IN', 'CHECKED_IN'], ['CHECKED_OUT', 'CHECKED_IN'], ['CHECKED_OUT', 'CHECKED_OUT']] as const) {
      const { svc, calls } = service({ ...ROW, status });
      await svc.recordStayFact('h1', 'r1', 'p-avia', fact);
      expect(calls).toEqual([]);
    }
  });

  it('время в будущем — НЕ принимается', async () => {
    const { svc, calls } = service(ROW);
    const later = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await expect(svc.recordStayFact('h1', 'r1', 'p-avia', 'CHECKED_OUT', later)).rejects.toBeInstanceOf(BadRequestException);
    expect(calls).toEqual([]);
  });

  it('бронь другого партнёра — как несуществующая, факт НЕ пишется', async () => {
    const { svc, calls } = service({ ...ROW, partnerId: 'p-other' });
    await expect(svc.recordStayFact('h1', 'r1', 'p-avia', 'CHECKED_IN')).rejects.toBeInstanceOf(NotFoundException);
    expect(calls).toEqual([]);
  });

  it('время — только ISO; без пояса или словами НЕ принимается', async () => {
    const errors = async (at: string) => (await validate(plainToInstance(ConnectStayFactDto, { at }))).length;
    expect(await errors('2026-10-21T00:10:00.000Z')).toBe(0);
    expect(await errors('вчера')).toBeGreaterThan(0);
  });
});
