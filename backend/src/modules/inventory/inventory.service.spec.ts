import { NotFoundException } from '@nestjs/common';
import { TenantContext } from '../../common/context/tenant-context';
import { InventoryService } from './inventory.service';

const TENANT = '00000000-0000-4000-8000-000000000001';
const CATEGORY = '00000000-0000-4000-8000-000000000002';
const DATE = '2026-11-01';

function fixture(categoryExists = true) {
  const tx = {
    roomType: { findUnique: jest.fn(async () => categoryExists ? { id: CATEGORY } : null) },
    room: { count: jest.fn(async () => 71) },
    inventory: { upsert: jest.fn(async () => ({})) },
    $executeRaw: jest.fn(async () => 1),
  };
  const prisma = { forTenant: jest.fn(async (fn: (value: typeof tx) => unknown) => fn(tx)) };
  const redis = { raw: { keys: jest.fn(async () => ['cached-availability']), del: jest.fn() } };
  const service = new InventoryService(prisma as never, redis as never);
  const run = (rows: Parameters<InventoryService['bulkUpdate']>[1]) => TenantContext.run({
    tenantId: TENANT, userId: 'u', roleCode: 'ADMIN', permissions: [],
  }, () => service.bulkUpdate(CATEGORY, rows));
  return { tx, redis, run };
}

describe('inventory partial updates', () => {
  it('initializes a new day from active rooms when Revenue sends only restrictions', async () => {
    const { tx, redis, run } = fixture();
    await expect(run([{ date: DATE, stopSell: false, blockedRooms: 0 }])).resolves.toEqual({ updated: 1 });
    expect(tx.room.count).toHaveBeenCalledWith({ where: { roomTypeId: CATEGORY, isActive: true } });
    expect(tx.inventory.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId_roomTypeId_date: { tenantId: TENANT, roomTypeId: CATEGORY, date: new Date(2026, 10, 1) } },
      create: expect.objectContaining({ tenantId: TENANT, roomTypeId: CATEGORY, totalRooms: 71, blockedRooms: 0, stopSell: false }),
    }));
    expect(redis.raw.del).toHaveBeenCalledWith('cached-availability');
  });

  it('preserves the existing sales limit and blocked rooms when only stop-sell changes', async () => {
    const { tx, run } = fixture();
    await run([{ date: DATE, stopSell: false }]);
    expect(tx.inventory.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { totalRooms: undefined, blockedRooms: undefined, stopSell: false },
    }));
  });

  it('preserves stop-sell when only blocked rooms change', async () => {
    const { tx, run } = fixture();
    await run([{ date: DATE, blockedRooms: 2 }]);
    expect(tx.inventory.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: { totalRooms: undefined, blockedRooms: 2, stopSell: undefined },
    }));
  });

  it('accepts an explicit zero sales limit and false stop-sell', async () => {
    const { tx, run } = fixture();
    await run([{ date: DATE, totalRooms: 0, blockedRooms: 0, stopSell: false }]);
    expect(tx.inventory.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ totalRooms: 0 }),
      update: { totalRooms: 0, blockedRooms: 0, stopSell: false },
    }));
  });

  it('never overwrites booked rooms during a restriction update', async () => {
    const { tx, run } = fixture();
    await run([{ date: DATE, blockedRooms: 0 }]);
    expect(tx.inventory.upsert).toHaveBeenCalled();
    const write = (tx.inventory.upsert.mock.calls as unknown as Array<[{ update: object }]>)[0][0];
    expect(write.update).not.toHaveProperty('bookedRooms');
  });

  it('defaults a new day to no blocks and open sales', async () => {
    const { tx, run } = fixture();
    await run([{ date: DATE, totalRooms: 12 }]);
    expect(tx.inventory.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ totalRooms: 12, blockedRooms: 0, stopSell: false }),
    }));
  });

  it('does not write inventory outside the tenant category scope', async () => {
    const { tx, redis, run } = fixture(false);
    await expect(run([{ date: DATE, stopSell: false }])).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.inventory.upsert).not.toHaveBeenCalled();
    expect(tx.$executeRaw).not.toHaveBeenCalled();
    expect(redis.raw.del).not.toHaveBeenCalled();
  });
});
