import { ForbiddenException } from '@nestjs/common';
import { TenantContext } from '../../common/context/tenant-context';
import { ReservationsService } from './reservations.service';

/* Число гостей брони партнёра ведёт партнёр (23.10.2026). Бронь Kars Avia на
 * одного гостя пересохранили в кабинете с «Взрослых: 2» — она заняла оба
 * места номера. Отрицанием: кабинет НЕ меняет число гостей брони из Авии;
 * партнёрский API — меняет; та же цифра в форме — не изменение. */

const CUR = {
  id: 'r1', room_id: 'room', room_type_id: 'rt', check_in: new Date('2026-10-21'), check_out: new Date('2026-10-25'),
  version: 1, guest_name: 'Морозова И.В.', phone: null, email: null, adults: 1, children: 0, status: 'CONFIRMED',
  source: 'CORPORATE', notes: null, total_price: null, rate_plan_id: null, place_number: 1, channel_managed: true,
};

/* Дальше проверки гостей сервис идёт к местам и записи — в тесте это
   «следующий шаг», и до него дошли — значит правка пропущена. */
const NEXT = new Error('next-step');

function make(row = CUR) {
  const svc = Object.create(ReservationsService.prototype) as ReservationsService;
  let first = true;
  const tx = {
    $queryRaw: jest.fn(async () => {
      if (first) {
        first = false;
        return [row];
      }
      throw NEXT;
    }),
  };
  Object.assign(svc, { prisma: { forTenant: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)) } });
  return svc;
}

const run = (svc: ReservationsService, dto: object, opts?: { fromChannel?: boolean }) =>
  TenantContext.run(
    { tenantId: 't1', userId: 'u1', roleCode: 'OWNER', permissions: [], isSuperAdmin: false } as never,
    () => svc.update('r1', { version: 1, ...dto } as never, opts),
  );

describe('число гостей брони из Kars Avia', () => {
  it.each([
    ['взрослых 1 → 2', { adults: 2 }],
    ['детей 0 → 1', { children: 1 }],
  ])('кабинет — НЕ меняет (%s)', async (_n, dto) => {
    await expect(run(make(), dto)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('кабинет — та же цифра проходит (форма шлёт число всегда)', async () => {
    await expect(run(make(), { adults: 1, children: 0, status: 'confirmed' })).rejects.toBe(NEXT);
  });

  it('партнёрский API — меняет', async () => {
    await expect(run(make(), { adults: 2 }, { fromChannel: true })).rejects.toBe(NEXT);
  });

  it('бронь самой гостиницы — кабинет меняет как раньше', async () => {
    await expect(run(make({ ...CUR, channel_managed: false }), { adults: 2 })).rejects.toBe(NEXT);
  });
});
