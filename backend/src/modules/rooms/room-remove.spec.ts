import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TenantContext } from '../../common/context/tenant-context';
import { RoomsService } from './rooms.service';
import { roomDeleteSwitch } from './room-delete.switch';

/* Удаление номера (24.10.2026, чистка дублей переноса). Номер с любой бронью
 * не удаляется — ни проверкой, ни внешним ключом; удалённый номер оставляет в
 * журнале, каким был. Сформулировано отрицанием: «не удаляет, не пишет». */

const ROOM = {
  number: '61 (2)',
  roomTypeId: 'cat',
  floor: 1,
  capacity: 2,
  bedType: 'DOUBLE',
  view: 'NONE',
  status: 'CLEAN',
  isActive: true,
  partnerHold: 'NONE',
  notes: null,
};

function setup(opts: { room?: object | null; reservations?: number; deleteError?: unknown } = {}) {
  const tx = {
    room: {
      findUnique: jest.fn(async () => (opts.room === undefined ? ROOM : opts.room)),
      delete: jest.fn(async () => {
        if (opts.deleteError) throw opts.deleteError;
        return ROOM;
      }),
    },
    reservation: { count: jest.fn(async () => opts.reservations ?? 0) },
  };
  const prisma = {
    forTenant: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    writeAuditLog: jest.fn(async () => undefined),
  };
  const svc = Object.create(RoomsService.prototype) as RoomsService;
  Object.assign(svc, { prisma });
  return { svc, tx, prisma };
}

describe('Выключатель удаления номеров', () => {
  /* Выключено (решение владельца 25.10.2026, вечер): удаление не должно
     стирать данные из базы, а remove стирает строку. */
  it('выключено, пока удаление не станет «в архив»', () => {
    expect(roomDeleteSwitch.enabled).toBe(false);
  });

  it('выключенное — 403, база не тронута, журнал не пишется', async () => {
    const { svc, tx, prisma } = setup({ reservations: 0 });
    await expect(svc.remove('room-1')).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.forTenant).not.toHaveBeenCalled();
    expect(tx.room.delete).not.toHaveBeenCalled();
    expect(prisma.writeAuditLog).not.toHaveBeenCalled();
  });
});

describe('Удаление номера (если выключатель включить)', () => {
  beforeEach(() => {
    roomDeleteSwitch.enabled = true;
    jest.spyOn(TenantContext, 'getTenantIdOrThrow').mockReturnValue('t1');
  });
  afterEach(() => {
    roomDeleteSwitch.enabled = false;
    jest.restoreAllMocks();
  });

  it('номер без броней удаляется, в журнале — каким он был', async () => {
    const { svc, tx, prisma } = setup();
    await expect(svc.remove('room-1')).resolves.toEqual({ ok: true });
    expect(tx.reservation.count).toHaveBeenCalledWith({ where: { roomId: 'room-1' } });
    expect(tx.room.delete).toHaveBeenCalledWith({ where: { id: 'room-1' } });
    expect(prisma.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't1',
        entity: 'room',
        entityId: 'room-1',
        action: 'delete',
        diff: { before: { id: 'room-1', ...ROOM }, after: {} },
      }),
    );
  });

  it.each([1, 2, 5, 21])(
    'номер с бронями (%i) НЕ удаляется — 409 со словами, журнал не пишется',
    async (n) => {
      const { svc, tx, prisma } = setup({ reservations: n });
      const err = await svc.remove('room-1').catch((e) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.message).toContain('№61 (2)');
      expect(err.message).toContain(String(n));
      expect(tx.room.delete).not.toHaveBeenCalled();
      expect(prisma.writeAuditLog).not.toHaveBeenCalled();
    },
  );

  it('склонение: 1 бронь, 2 брони, 5 броней, 11 и 12 броней, 21 бронь', async () => {
    const msg = async (n: number) =>
      (
        await setup({ reservations: n })
          .svc.remove('r')
          .catch((e) => e)
      ).message;
    expect(await msg(1)).toContain('1 бронь,');
    expect(await msg(2)).toContain('2 брони,');
    expect(await msg(5)).toContain('5 броней,');
    expect(await msg(11)).toContain('11 броней,');
    expect(await msg(12)).toContain('12 броней,');
    expect(await msg(21)).toContain('21 бронь,');
  });

  it('бронь, заведённую между проверкой и удалением, ловит внешний ключ — тоже 409, а не 500', async () => {
    const { svc, prisma } = setup({ deleteError: { code: 'P2003', message: 'fk' } });
    const err = await svc.remove('room-1').catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toContain('есть брони');
    expect(prisma.writeAuditLog).not.toHaveBeenCalled();
  });

  it('чужой или несуществующий номер — 404, ничего не удаляется', async () => {
    const { svc, tx, prisma } = setup({ room: null });
    await expect(svc.remove('room-x')).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.room.delete).not.toHaveBeenCalled();
    expect(prisma.writeAuditLog).not.toHaveBeenCalled();
  });

  it('номер, удалённый параллельно (P2025), — 404', async () => {
    const { svc } = setup({ deleteError: { code: 'P2025', message: 'gone' } });
    await expect(svc.remove('room-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('прочая ошибка базы не превращается в 409', async () => {
    const { svc } = setup({ deleteError: new Error('connection lost') });
    const err = await svc.remove('room-1').catch((e) => e);
    expect(err).not.toBeInstanceOf(ConflictException);
    expect(err.message).toBe('connection lost');
  });
});
