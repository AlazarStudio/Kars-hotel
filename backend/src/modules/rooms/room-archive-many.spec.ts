import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { TenantContext } from '../../common/context/tenant-context';
import { RoomsService } from './rooms.service';
import { ArchiveManyRoomsDto } from './dto/archive-many-rooms.dto';

/* Удаление «в архив» пачкой (28.10.2026). Правило то же, что у одного номера
 * (room-archive.spec.ts), и сформулировано отрицанием: номер с действующей
 * бронью НЕ удаляется, строка НЕ стирается, на пачку НЕ пишется по записи
 * журнала на номер, удалённый раньше НЕ правится повторно. */

type Room = { id: string; number: string; archivedAt: Date | null };

function setup(rooms: Room[], live: Record<string, number> = {}) {
  const tx = {
    room: {
      findMany: jest.fn(async () => rooms),
      updateMany: jest.fn(async () => ({ count: 0 })),
      delete: jest.fn(),
    },
    reservation: {
      groupBy: jest.fn(async () =>
        Object.entries(live).map(([roomId, n]) => ({ roomId, _count: { _all: n } })),
      ),
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

const room = (id: string, number: string, archivedAt: Date | null = null): Room => ({
  id,
  number,
  archivedAt,
});

describe('Удаление номеров «в архив» пачкой', () => {
  beforeEach(() => {
    jest.spyOn(TenantContext, 'getTenantIdOrThrow').mockReturnValue('t1');
    jest.spyOn(TenantContext, 'get').mockReturnValue({ tenantId: 't1', userId: 'u-disp' } as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it('номер с действующей бронью НЕ удаляется, остальные удаляются, строки НЕ стираются', async () => {
    const { svc, tx } = setup([room('r1', '101'), room('r2', '105'), room('r3', '106')], {
      r2: 2,
    });
    const r = await svc.archiveMany(['r1', 'r2', 'r3']);
    expect(tx.room.delete).not.toHaveBeenCalled();
    expect(tx.room.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['r1', 'r3'] }, archivedAt: null },
      data: { isActive: false, archivedAt: expect.any(Date), archivedBy: 'u-disp' },
    });
    expect(r.archived).toEqual([
      { id: 'r1', number: '101' },
      { id: 'r3', number: '106' },
    ]);
    expect(r.blocked).toEqual([{ id: 'r2', number: '105', liveReservations: 2 }]);
  });

  it('действующие брони — только новые, подтверждённые и с гостем', async () => {
    const { svc, tx } = setup([room('r1', '101')]);
    await svc.archiveMany(['r1']);
    expect(tx.reservation.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { roomId: { in: ['r1'] }, status: { in: ['NEW', 'CONFIRMED', 'CHECKED_IN'] } },
      }),
    );
  });

  it('на пачку НЕ пишется по записи на номер — одна archive_many со списком номеров', async () => {
    const { svc, prisma } = setup([room('r1', '101'), room('r2', '102'), room('r3', '103')]);
    await svc.archiveMany(['r1', 'r2', 'r3']);
    expect(prisma.writeAuditLog).toHaveBeenCalledTimes(1);
    expect(prisma.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'room',
        action: 'archive_many',
        diff: { before: {}, after: { archived: ['101', '102', '103'], blocked: [] } },
      }),
    );
  });

  it('удалённый раньше НЕ правится повторно и НЕ попадает в журнал, но в ответе он среди удалённых', async () => {
    const { svc, tx, prisma } = setup([room('r1', '101', new Date('2026-10-25'))]);
    const r = await svc.archiveMany(['r1']);
    expect(tx.room.updateMany).not.toHaveBeenCalled();
    expect(prisma.writeAuditLog).not.toHaveBeenCalled();
    expect(r.archived).toEqual([{ id: 'r1', number: '101' }]);
  });

  it('повторы id НЕ удваиваются; чужой или несуществующий — в notFound', async () => {
    const { svc, tx } = setup([room('r1', '101')]);
    const r = await svc.archiveMany(['r1', 'r1', 'x']);
    expect(tx.room.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['r1', 'x'] } } }),
    );
    expect(r.notFound).toEqual(['x']);
  });
});

describe('ArchiveManyRoomsDto', () => {
  const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
  const errs = (ids: unknown) => validateSync(plainToInstance(ArchiveManyRoomsDto, { ids }));

  it('от 1 до 200 UUID — можно', () => {
    expect(errs([uuid(1)])).toEqual([]);
    expect(errs(Array.from({ length: 200 }, (_, i) => uuid(i)))).toEqual([]);
  });

  it('пусто, больше 200 и не-UUID НЕ принимаются', () => {
    expect(errs([])).not.toEqual([]);
    expect(errs(Array.from({ length: 201 }, (_, i) => uuid(i)))).not.toEqual([]);
    expect(errs(['101'])).not.toEqual([]);
  });
});
