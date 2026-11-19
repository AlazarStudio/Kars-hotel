import 'reflect-metadata';
import { TenantContext } from '../../common/context/tenant-context';
import { RoomsService } from './rooms.service';
import { RoomTypesService } from '../room-types/room-types.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { CreateManyRoomsDto } from './dto/create-many-rooms.dto';

/* Мест в номере не больше, чем вмещает категория (19.11.2026). Сформулировано
 * отрицанием: номер на 2 места НЕ сохраняется в категории до 1 чел. — ни
 * созданием, ни пачкой, ни правкой, ни переносом в категорию, ни
 * восстановлением; и максимум категории НЕ опускается ниже мест её номеров. */

const RT = '7d9f4c2e-1b3a-4c5d-8e6f-0a1b2c3d4e5f';
const RT_BIG = '8e0a5d3f-2c4b-4d6e-9f70-1b2c3d4e5f60';
const SINGLE = { id: RT, name: 'Одноместный', maxOccupancy: 1 };
const DOUBLE = { id: RT_BIG, name: 'Двухместный', maxOccupancy: 2 };

function rooms(current: Record<string, unknown> | null = null) {
  const tx = {
    roomType: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        where.id === RT ? SINGLE : where.id === RT_BIG ? DOUBLE : null,
      ),
    },
    room: {
      findUnique: jest.fn(async () => current),
      findMany: jest.fn(async () => []),
      create: jest.fn(async ({ data }: { data: object }) => ({ id: 'r1', ...data })),
      update: jest.fn(async ({ data }: { data: object }) => ({ id: 'r1', ...data })),
    },
  };
  const prisma = {
    forTenant: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    writeAuditLog: jest.fn(async () => undefined),
  };
  const svc = Object.create(RoomsService.prototype) as RoomsService;
  Object.assign(svc, { prisma });
  return { svc, tx };
}

describe('Места номера и вместимость категории', () => {
  beforeEach(() => jest.spyOn(TenantContext, 'getTenantIdOrThrow').mockReturnValue('t1'));
  afterEach(() => jest.restoreAllMocks());

  it('номер на 2 места НЕ создаётся в категории до 1 чел.', async () => {
    const { svc, tx } = rooms();
    await expect(
      svc.create({ roomTypeId: RT, number: '101', capacity: 2 } as CreateRoomDto),
    ).rejects.toThrow(/вмещает до 1/);
    expect(tx.room.create).not.toHaveBeenCalled();
  });

  it('номер в пределах категории создаётся', async () => {
    const { svc, tx } = rooms();
    await svc.create({ roomTypeId: RT_BIG, number: '101', capacity: 2 } as CreateRoomDto);
    expect(tx.room.create).toHaveBeenCalledTimes(1);
  });

  it('пачка сверх категории НЕ создаётся', async () => {
    const { svc, tx } = rooms();
    await expect(
      svc.createMany({ roomTypeId: RT, startNumber: 101, count: 3, capacity: 2 } as CreateManyRoomsDto),
    ).rejects.toThrow(/вмещает до 1/);
    expect(tx.room.create).not.toHaveBeenCalled();
  });

  it('правка мест сверх категории НЕ сохраняется', async () => {
    const { svc, tx } = rooms({ archivedAt: null, capacity: 1, roomTypeId: RT });
    await expect(svc.update('r1', { capacity: 2 })).rejects.toThrow(/вмещает до 1/);
    expect(tx.room.update).not.toHaveBeenCalled();
  });

  it('перенос двухместного номера в категорию до 1 чел. НЕ сохраняется', async () => {
    const { svc, tx } = rooms({ archivedAt: null, capacity: 2, roomTypeId: RT_BIG });
    await expect(svc.update('r1', { roomTypeId: RT })).rejects.toThrow(/вмещает до 1/);
    expect(tx.room.update).not.toHaveBeenCalled();
  });

  it('восстановление номера, которому категория стала мала, НЕ проходит', async () => {
    const { svc, tx } = rooms({
      number: '101',
      archivedAt: new Date('2026-11-01'),
      archivedBy: null,
      capacity: 2,
      roomType: { ...SINGLE, code: 'SGL', archivedAt: null },
    });
    await expect(svc.restore('r1')).rejects.toThrow(/вмещает до 1/);
    expect(tx.room.update).not.toHaveBeenCalled();
  });
});

describe('Максимум категории и места её номеров', () => {
  function types(over: { number: string; capacity: number }[]) {
    const tx = {
      room: { findMany: jest.fn(async () => over) },
      roomType: { update: jest.fn(async ({ data }: { data: object }) => ({ ...DOUBLE, ...data })) },
    };
    const prisma = { forTenant: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)) };
    const svc = Object.create(RoomTypesService.prototype) as RoomTypesService;
    Object.assign(svc, { prisma });
    jest.spyOn(svc, 'get').mockResolvedValue({ ...DOUBLE, baseOccupancy: 1 } as never);
    jest.spyOn(svc as never, 'present').mockImplementation(((x: unknown) => x) as never);
    return { svc, tx };
  }

  it('максимум НЕ опускается ниже мест номера — в ответе номер', async () => {
    const { svc, tx } = types([{ number: '107', capacity: 2 }]);
    await expect(svc.update(RT_BIG, { maxOccupancy: 1 })).rejects.toThrow(/№107 \(2\)/);
    expect(tx.roomType.update).not.toHaveBeenCalled();
  });

  it('максимум опускается, если номера помещаются', async () => {
    const { svc, tx } = types([]);
    await svc.update(RT_BIG, { maxOccupancy: 1 });
    expect(tx.roomType.update).toHaveBeenCalledTimes(1);
  });
});
