import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { TenantContext } from '../../common/context/tenant-context';
import { RoomsService } from './rooms.service';
import { CreateManyRoomsDto } from './dto/create-many-rooms.dto';

/* Пачка номеров (Д2; интерфейс — 28.10.2026). Сформулировано отрицанием:
 * удалённый номер НЕ сливается в итоге с номерами фонда, договорный блок
 * пачки НЕ теряется. */

const ROOM_TYPE = '7d9f4c2e-1b3a-4c5d-8e6f-0a1b2c3d4e5f';

function setup(existing: { number: string; archivedAt: Date | null }[] = []) {
  const tx = {
    roomType: { findUnique: jest.fn(async () => ({ id: ROOM_TYPE })) },
    room: {
      findMany: jest.fn(async () => existing),
      create: jest.fn(async ({ data }: { data: { number: string } }) => ({
        id: `id-${data.number}`,
        ...data,
      })),
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

const dto = (extra: Partial<CreateManyRoomsDto> = {}) =>
  ({ roomTypeId: ROOM_TYPE, startNumber: 101, count: 5, ...extra }) as CreateManyRoomsDto;

describe('Пачка номеров', () => {
  beforeEach(() => jest.spyOn(TenantContext, 'getTenantIdOrThrow').mockReturnValue('t1'));
  afterEach(() => jest.restoreAllMocks());

  it('удалённый номер НЕ попадает в «уже есть в фонде» — он в отдельном списке', async () => {
    const { svc, tx } = setup([
      { number: '102', archivedAt: null },
      { number: '104', archivedAt: new Date('2026-10-25') },
    ]);
    const r = await svc.createMany(dto());
    expect(r.skipped).toEqual(['102']);
    expect(r.skippedArchived).toEqual(['104']);
    expect(r.created).toBe(3);
    expect(tx.room.create.mock.calls.map(([a]) => a.data.number)).toEqual(['101', '103', '105']);
  });

  it('журнал пачки — одна запись, в ней оба списка пропущенных', async () => {
    const { svc, prisma } = setup([{ number: '104', archivedAt: new Date() }]);
    await svc.createMany(dto());
    expect(prisma.writeAuditLog).toHaveBeenCalledTimes(1);
    expect(prisma.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'create_many',
        diff: {
          before: {},
          after: expect.objectContaining({ skipped: [], skippedArchived: ['104'] }),
        },
      }),
    );
  });

  it('договорный блок пачки НЕ теряется; не прислан — NONE', async () => {
    const quota = setup();
    await quota.svc.createMany(dto({ count: 1, partnerHold: 'QUOTA' }));
    expect(quota.tx.room.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ partnerHold: 'QUOTA' }) }),
    );
    const none = setup();
    await none.svc.createMany(dto({ count: 1 }));
    expect(none.tx.room.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ partnerHold: 'NONE' }) }),
    );
  });

  it('чужое значение договорного блока НЕ принимается', () => {
    const errs = validateSync(
      plainToInstance(CreateManyRoomsDto, { ...dto(), partnerHold: 'ALL' }),
    );
    expect(errs.map((e) => e.property)).toContain('partnerHold');
  });
});
