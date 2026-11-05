import { TenantContext } from '../../common/context/tenant-context';
import { RoomsService } from './rooms.service';

/* 5.8 · Отметка «грязный» создаёт задачу уборки: одну, без исполнителя. */
function setup(open = 0) {
  const tx = {
    room: { update: jest.fn(async () => ({ id: 'r1' })) },
    housekeepingTask: { count: jest.fn(async () => open), create: jest.fn(async () => ({})) },
  };
  const prisma = {
    forTenant: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    writeAuditLog: jest.fn(async () => undefined),
  };
  const svc = Object.create(RoomsService.prototype) as RoomsService;
  Object.assign(svc, { prisma });
  jest.spyOn(TenantContext, 'getTenantIdOrThrow').mockReturnValue('t1');
  return { svc, tx };
}

describe('5.8 · задача при отметке «грязный»', () => {
  it('грязный номер — задача уборки без исполнителя', async () => {
    const { svc, tx } = setup();
    await svc.setStatus('r1', 'DIRTY');
    expect(tx.housekeepingTask.create).toHaveBeenCalledWith({
      data: { tenantId: 't1', roomId: 'r1', type: 'CLEANING', status: 'PENDING' },
    });
  });

  it('уборка по номеру уже открыта — вторую НЕ заводит', async () => {
    const { svc, tx } = setup(1);
    await svc.setStatus('r1', 'DIRTY');
    expect(tx.housekeepingTask.create).not.toHaveBeenCalled();
  });

  it('другой статус задачу НЕ создаёт', async () => {
    const { svc, tx } = setup();
    await svc.setStatus('r1', 'CLEAN');
    expect(tx.housekeepingTask.count).not.toHaveBeenCalled();
    expect(tx.housekeepingTask.create).not.toHaveBeenCalled();
  });
});
