import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ConnectivityService } from './connectivity.service';
import { ConnectCreateReservationDto } from './dto/connect-create-reservation.dto';
import { ConnectUpdateReservationDto } from './dto/connect-update-reservation.dto';
import { UpdateReservationDto } from '../reservations/dto/update-reservation.dto';

/* ВРЕМЯ ПРИЛЁТА И ОТЪЕЗДА И РЕЙС БРОНИ ПАРТНЁРА (24.10.2026, правка заказчика
 * Kars Avia: «со стороны гостиницы в бронях видна дата, но не видно время
 * прибытия»). Время — местное, текстом «ГГГГ-ММ-ДДTЧЧ:ММ»: с поясом его
 * пересчитал бы браузер, и 02:00 стало бы 05:00. Ведёт его партнёр.
 *
 * Отрицанием: время с поясом, без даты или с секундами НЕ принимается; кабинет
 * гостиницы время брони НЕ меняет — поля у него нет вовсе. */

const PIPE = { whitelist: true, forbidNonWhitelisted: true };
const errorsOf = async (cls: new () => object, plain: object) =>
  (await validate(plainToInstance(cls, plain), PIPE)).map((e) => e.property);

const CREATE = {
  categoryId: '11111111-1111-4111-8111-111111111111',
  checkIn: '2026-10-21',
  checkOut: '2026-10-24',
  guestName: 'Гость',
  adults: 1,
};
const TIMES = { arrivalAt: '2026-10-22T02:00', departureAt: '2026-10-24T10:40', flight: 'S7 178' };

describe('Партнёр присылает время прилёта и отъезда и рейс', () => {
  it('новая бронь — принимается', async () => {
    expect(await errorsOf(ConnectCreateReservationDto, { ...CREATE, ...TIMES })).toEqual([]);
  });

  it.each([
    ['с пробелом вместо T', '2026-10-22 02:00'],
    ['только время', '02:00'],
    ['с поясом', '2026-10-22T02:00:00Z'],
    ['с секундами', '2026-10-22T02:00:00'],
    ['13-й месяц', '2026-13-22T02:00'],
    ['24 часа', '2026-10-22T24:00'],
  ])('время %s — НЕ принимается', async (_n, arrivalAt) => {
    expect(await errorsOf(ConnectCreateReservationDto, { ...CREATE, arrivalAt })).toContain('arrivalAt');
    expect(await errorsOf(ConnectUpdateReservationDto, { departureAt: arrivalAt })).toContain('departureAt');
  });

  it('рейс длиннее 64 знаков — НЕ принимается', async () => {
    expect(await errorsOf(ConnectCreateReservationDto, { ...CREATE, flight: 'S'.repeat(65) })).toContain('flight');
  });

  it('правка: null стирает время и рейс', async () => {
    expect(await errorsOf(ConnectUpdateReservationDto, { arrivalAt: null, departureAt: null, flight: null })).toEqual([]);
  });

  it('кабинет гостиницы время брони НЕ меняет — поля в его правке нет', async () => {
    expect(await errorsOf(UpdateReservationDto, { version: 1, arrivalAt: '2026-10-22T02:00' })).toContain('arrivalAt');
    expect(await errorsOf(UpdateReservationDto, { version: 1, flight: 'S7 178' })).toContain('flight');
  });
});

const TENANT = { id: 't1', slug: 'h1', currency: 'RUB', isActive: true, partnerVisible: true, provisional: false };
const logger = { log: jest.fn(), warn: jest.fn() };

describe('Партнёрский API передаёт время брони дальше', () => {
  it('создание — время и рейс уходят в бронь', async () => {
    const created: unknown[][] = [];
    const svc = Object.create(ConnectivityService.prototype) as ConnectivityService;
    Object.assign(svc, {
      logger,
      resolveTenant: async () => TENANT,
      partnerQuery: async () => ({}),
      runAsTenant: (_t: string, fn: () => unknown) => fn(),
      prisma: {
        forTenantExplicit: async (_t: string, cb: (tx: object) => unknown) =>
          cb({
            roomType: { findUnique: async () => ({ isActive: true, maxOccupancy: 2, basePrice: 1000 }) },
            reservation: { update: async () => ({}) },
          }),
      },
      ratePlans: { partnerPlans: async () => [] },
      availability: { priceByPlan: async () => [] },
      pickAvailableRoom: async () => 'room-1',
      reservations: {
        create: async (...args: unknown[]) => {
          created.push(args);
          return { id: 'r1', status: 'CONFIRMED', version: 1, placeNumber: 1 };
        },
      },
    });
    await svc.createReservation('h1', { ...CREATE, ...TIMES } as never, 'p-avia');
    expect(created[0][1]).toEqual(TIMES);
  });

  it('правка — время уходит как правка партнёра, null — стирает', async () => {
    const updates: unknown[][] = [];
    const svc = Object.create(ConnectivityService.prototype) as ConnectivityService;
    Object.assign(svc, {
      logger,
      resolveTenant: async () => TENANT,
      getReservation: async () => ({ checkIn: '2026-10-21', checkOut: '2026-10-24' }),
      runAsTenant: (_t: string, fn: () => unknown) => fn(),
      prisma: {
        forTenantExplicit: async (_t: string, cb: (tx: object) => unknown) =>
          cb({ reservation: { findUnique: async () => ({ channelManaged: true, version: 3 }) } }),
      },
      reservations: {
        update: async (...args: unknown[]) => {
          updates.push(args);
          return {};
        },
      },
    });
    await svc.updateReservation('h1', 'r1', { arrivalAt: null, flight: 'S7 178' } as never, 'p-avia');
    expect(updates[0][2]).toEqual({ fromChannel: true, stay: { arrivalAt: null, flight: 'S7 178' } });
  });

  it('чтение — партнёр видит то, что прислал', async () => {
    const row = {
      id: 'r1', tenantId: 't1', guestName: 'Гость', phone: null, roomId: 'room', roomTypeId: 'cat', status: 'CONFIRMED',
      checkIn: new Date('2026-10-21'), checkOut: new Date('2026-10-24'), adults: 1, children: 0, totalPrice: null,
      placeNumber: 1, version: 3, notes: null, createdAt: new Date(), updatedAt: new Date(), checkedInAt: null,
      checkedOutAt: null, room: { number: '101' }, channelManaged: true, partnerId: 'p-avia', ...TIMES,
    };
    const svc = Object.create(ConnectivityService.prototype) as ConnectivityService;
    Object.assign(svc, {
      prisma: {
        admin: { tenant: { findUnique: jest.fn(async () => TENANT) } },
        forTenantExplicit: async (_t: string, cb: (tx: object) => unknown) =>
          cb({ reservation: { findUnique: async () => row } }),
      },
    });
    expect(await svc.getReservation('h1', 'r1', 'p-avia')).toMatchObject(TIMES);
  });
});
