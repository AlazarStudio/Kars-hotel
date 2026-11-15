import { TenantContext } from '../../common/context/tenant-context';
import { RestrictionsController } from './restrictions.controller';

describe('restriction writes invalidate availability', () => {
  it.each(['upsert', 'remove'] as const)(
    '%s clears cached availability after the write',
    async (action) => {
      const events: string[] = [];
      const saved = { id: 'r', roomTypeId: 'room' };
      const tx = {
        restriction: {
          findFirst: async () => null,
          create: async () => {
            events.push('write');
            return saved;
          },
          delete: async () => {
            events.push('write');
            return saved;
          },
        },
      };
      const redis = {
        raw: {
          keys: jest.fn(async () => ['avail:t:room:range']),
          del: jest.fn(async () => {
            events.push('invalidate');
            return 1;
          }),
        },
      };
      const controller = new RestrictionsController(
        {} as never,
        { forTenant: (cb: (t: typeof tx) => unknown) => cb(tx) } as never,
        redis as never,
      );
      await TenantContext.run(
        { tenantId: 't', userId: 'u', roleCode: 'ADMIN', permissions: [] },
        () =>
          action === 'remove'
            ? controller.remove('r')
            : controller.upsert({ roomTypeId: 'room', date: '2026-12-01', stopSell: true }),
      );
      expect(events).toEqual(['write', 'invalidate']);
      expect(redis.raw.keys).toHaveBeenCalledWith('avail:t:room:*');
    },
  );
});
