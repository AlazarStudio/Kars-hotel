import { ConflictException, NotFoundException } from '@nestjs/common';
import { TenantContext } from '../../common/context/tenant-context';
import { RoomTypesService } from './room-types.service';

/* Удаление категории «в архив» (27.10.2026, жалоба гостиниц: «поудаляла номера,
 * а категорию не удалить — привязаны 16 номеров»). С 25.10 удалённый номер —
 * архивная строка, и считать его наравне с живыми нельзя. Сформулировано
 * отрицанием: удалённые номера НЕ мешают, строка категории НЕ стирается, живые
 * номера по-прежнему НЕ дают удалить. */

type RoomType = {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  archivedAt: Date | null;
  _count: { rooms: number };
};

function setup(rt: RoomType | null) {
  const tx = {
    roomType: {
      findUnique: jest.fn(async () => rt),
      findMany: jest.fn(async () => []),
      update: jest.fn(async () => ({})),
      delete: jest.fn(),
    },
  };
  const prisma = {
    forTenant: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    writeAuditLog: jest.fn(async () => undefined),
  };
  const svc = Object.create(RoomTypesService.prototype) as RoomTypesService;
  Object.assign(svc, { prisma });
  return { svc, tx, prisma };
}

const STD: RoomType = {
  id: 'cat',
  code: 'STD',
  name: 'Стандарт',
  isActive: true,
  archivedAt: null,
  _count: { rooms: 0 },
};

/* Счётчик номеров — только живые: архивные отфильтрованы в самом запросе. */
const LIVE_ONLY = { _count: { select: { rooms: { where: { archivedAt: null } } } } };

describe('Удаление категории номеров', () => {
  beforeEach(() => {
    jest.spyOn(TenantContext, 'getTenantIdOrThrow').mockReturnValue('t1');
    jest.spyOn(TenantContext, 'get').mockReturnValue({ tenantId: 't1', userId: 'u-hotel' } as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it('номера считаются без удалённых в архив', async () => {
    const { svc, tx } = setup(STD);
    await svc.remove('cat');
    expect(tx.roomType.findUnique).toHaveBeenCalledWith({ where: { id: 'cat' }, include: LIVE_ONLY });
  });

  it('без живых номеров — в архив: строка НЕ стирается, категория выключена, код освобождён', async () => {
    const { svc, tx, prisma } = setup(STD);
    await expect(svc.remove('cat')).resolves.toEqual({ ok: true });
    expect(tx.roomType.delete).not.toHaveBeenCalled();
    expect(tx.roomType.update).toHaveBeenCalledWith({
      where: { id: 'cat' },
      data: {
        isActive: false,
        archivedAt: expect.any(Date),
        archivedBy: 'u-hotel',
        code: expect.stringMatching(/^STD~[0-9a-z]+$/),
      },
    });
    expect(prisma.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'room_type',
        entityId: 'cat',
        action: 'archive',
        diff: expect.objectContaining({ before: expect.objectContaining({ code: 'STD' }) }),
      }),
    );
  });

  it.each([1, 16])('с живыми номерами (%i) — 409, категория НЕ трогается', async (n) => {
    const { svc, tx, prisma } = setup({ ...STD, _count: { rooms: n } });
    const err = await svc.remove('cat').catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toContain(`привязаны ${n} номеров`);
    expect(tx.roomType.update).not.toHaveBeenCalled();
    expect(prisma.writeAuditLog).not.toHaveBeenCalled();
  });

  it('уже в архиве — тот же ответ, без второй правки и записи', async () => {
    const { svc, tx, prisma } = setup({ ...STD, archivedAt: new Date() });
    await expect(svc.remove('cat')).resolves.toEqual({ ok: true });
    expect(tx.roomType.update).not.toHaveBeenCalled();
    expect(prisma.writeAuditLog).not.toHaveBeenCalled();
  });

  it('чужая или несуществующая — 404', async () => {
    const { svc, tx } = setup(null);
    await expect(svc.remove('cat-x')).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.roomType.update).not.toHaveBeenCalled();
  });
});

describe('Номерной фонд: список категорий', () => {
  it('без архивных категорий и с числом только живых номеров', async () => {
    const { svc, tx } = setup(STD);
    await svc.list();
    expect(tx.roomType.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { archivedAt: null }, include: LIVE_ONLY }),
    );
  });
});
