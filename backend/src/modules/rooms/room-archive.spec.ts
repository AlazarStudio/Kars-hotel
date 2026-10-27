import { ConflictException, NotFoundException } from '@nestjs/common';
import { TenantContext } from '../../common/context/tenant-context';
import { RoomsService } from './rooms.service';

/* Удаление номера «в архив» (решение владельца 25.10.2026: удаление не стирает
 * данные из базы). Сформулировано отрицанием: строка номера НЕ удаляется,
 * номер с действующей бронью НЕ уходит в архив, архивный НЕ правится и НЕ
 * попадает в номерной фонд. */

type Room = {
  number: string;
  isActive: boolean;
  archivedAt: Date | null;
  archivedBy?: string | null;
  roomType?: { id: string; code: string; archivedAt: Date | null };
};

const LIVE_TYPE = { id: 'cat', code: 'STD', archivedAt: null };

function setup(opts: { room?: Room | null; live?: number; codeTaken?: boolean } = {}) {
  const room: Room | null =
    opts.room === undefined ? { number: '61 (2)', isActive: true, archivedAt: null } : opts.room;
  const tx = {
    room: {
      findUnique: jest.fn(async () => room),
      findMany: jest.fn(async () => []),
      update: jest.fn(async () => ({})),
      delete: jest.fn(),
    },
    reservation: { count: jest.fn(async () => opts.live ?? 0) },
    roomType: {
      findFirst: jest.fn(async () => (opts.codeTaken ? { id: 'cat-new' } : null)),
      update: jest.fn(async () => ({})),
    },
  };
  const prisma = {
    forTenant: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    writeAuditLog: jest.fn(async () => undefined),
  };
  const svc = Object.create(RoomsService.prototype) as RoomsService;
  Object.assign(svc, { prisma });
  return { svc, tx, prisma };
}

describe('Удаление номера «в архив»', () => {
  beforeEach(() => {
    jest.spyOn(TenantContext, 'getTenantIdOrThrow').mockReturnValue('t1');
    jest.spyOn(TenantContext, 'get').mockReturnValue({ tenantId: 't1', userId: 'u-disp' } as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it('строка номера НЕ стирается: пометка, кто и когда, и номер выключен', async () => {
    const { svc, tx, prisma } = setup();
    const r = await svc.archive('room-1');
    expect(tx.room.delete).not.toHaveBeenCalled();
    expect(tx.room.update).toHaveBeenCalledWith({
      where: { id: 'room-1' },
      data: { isActive: false, archivedAt: expect.any(Date), archivedBy: 'u-disp' },
    });
    expect(r.ok).toBe(true);
    expect(prisma.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ entity: 'room', entityId: 'room-1', action: 'archive' }),
    );
  });

  it('действующие брони считаются только новые, подтверждённые и с гостем — прошлые и отменённые не мешают', async () => {
    const { svc, tx } = setup();
    await svc.archive('room-1');
    expect(tx.reservation.count).toHaveBeenCalledWith({
      where: { roomId: 'room-1', status: { in: ['NEW', 'CONFIRMED', 'CHECKED_IN'] } },
    });
  });

  it.each([1, 2, 5])('с действующими бронями (%i) — 409, номер НЕ трогается, журнал не пишется', async (n) => {
    const { svc, tx, prisma } = setup({ live: n });
    const err = await svc.archive('room-1').catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toContain('№61 (2)');
    expect(err.message).toContain(`${n} действующ`);
    expect(tx.room.update).not.toHaveBeenCalled();
    expect(prisma.writeAuditLog).not.toHaveBeenCalled();
  });

  it('уже в архиве — тот же ответ, без второй правки и записи', async () => {
    const at = new Date('2026-10-25T20:00:00Z');
    const { svc, tx, prisma } = setup({ room: { number: '61', isActive: false, archivedAt: at } });
    await expect(svc.archive('room-1')).resolves.toEqual({ ok: true, archivedAt: at });
    expect(tx.room.update).not.toHaveBeenCalled();
    expect(prisma.writeAuditLog).not.toHaveBeenCalled();
  });

  it('чужой или несуществующий — 404', async () => {
    const { svc, tx } = setup({ room: null });
    await expect(svc.archive('room-x')).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.room.update).not.toHaveBeenCalled();
  });
});

describe('Восстановление номера из архива', () => {
  beforeEach(() => jest.spyOn(TenantContext, 'getTenantIdOrThrow').mockReturnValue('t1'));
  afterEach(() => jest.restoreAllMocks());

  it('снимает пометку и включает номер, в журнал — кто удалял', async () => {
    const at = new Date('2026-10-25T20:00:00Z');
    const { svc, tx, prisma } = setup({
      room: { number: '61', isActive: false, archivedAt: at, archivedBy: 'u-disp', roomType: LIVE_TYPE },
    });
    await svc.restore('room-1');
    expect(tx.roomType.update).not.toHaveBeenCalled();
    expect(tx.room.update).toHaveBeenCalledWith({
      where: { id: 'room-1' },
      data: { isActive: true, archivedAt: null, archivedBy: null },
    });
    expect(prisma.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'restore',
        diff: expect.objectContaining({ before: expect.objectContaining({ archivedBy: 'u-disp' }) }),
      }),
    );
  });

  it('не в архиве — ничего не меняет', async () => {
    const { svc, tx, prisma } = setup();
    await svc.restore('room-1');
    expect(tx.room.update).not.toHaveBeenCalled();
    expect(prisma.writeAuditLog).not.toHaveBeenCalled();
  });

  /* 27.10.2026: категория номера удалена. Без её возврата номер встал бы вне
     номерного фонда, а завести такой номер заново не даёт архивный тёзка. */
  const ARCHIVED_TYPE = { id: 'cat', code: 'STD~mh8x2k', archivedAt: new Date('2026-10-27T10:00:00Z') };

  it('категория удалена — возвращается вместе с номером, с прежним кодом', async () => {
    const { svc, tx, prisma } = setup({
      room: { number: '101', isActive: false, archivedAt: new Date(), roomType: ARCHIVED_TYPE },
    });
    await svc.restore('room-1');
    expect(tx.roomType.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { code: 'STD', archivedAt: null } }),
    );
    expect(tx.roomType.update).toHaveBeenCalledWith({
      where: { id: 'cat' },
      data: { isActive: true, archivedAt: null, archivedBy: null, code: 'STD' },
    });
    expect(tx.room.update).toHaveBeenCalled();
    expect(prisma.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        diff: expect.objectContaining({ after: expect.objectContaining({ roomTypeRestored: 'cat' }) }),
      }),
    );
  });

  it('прежний код занят новой категорией — возвращается с кодом из архива, НЕ отбирая чужой', async () => {
    const { svc, tx } = setup({
      room: { number: '101', isActive: false, archivedAt: new Date(), roomType: ARCHIVED_TYPE },
      codeTaken: true,
    });
    await svc.restore('room-1');
    expect(tx.roomType.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ code: 'STD~mh8x2k' }) }),
    );
  });
});

describe('Архивный номер в фонде и правке', () => {
  beforeEach(() => jest.spyOn(TenantContext, 'getTenantIdOrThrow').mockReturnValue('t1'));
  afterEach(() => jest.restoreAllMocks());

  it('номерной фонд без просьбы — без архивных; с просьбой — только архивные', async () => {
    const { svc, tx } = setup();
    await svc.list({});
    expect(tx.room.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ archivedAt: null }) }),
    );
    await svc.list({ archived: true });
    expect(tx.room.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ archivedAt: { not: null } }) }),
    );
  });

  it('архивный НЕ правится (иначе вернулся бы в продажу мимо «Восстановить»)', async () => {
    const { svc, tx } = setup({ room: { number: '61', isActive: false, archivedAt: new Date() } });
    await expect(svc.update('room-1', { isActive: true })).rejects.toBeInstanceOf(ConflictException);
    expect(tx.room.update).not.toHaveBeenCalled();
  });
});
