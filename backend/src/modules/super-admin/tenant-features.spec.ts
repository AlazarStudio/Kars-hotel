import 'reflect-metadata';
import { NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { SuperAdminService } from './super-admin.service';
import { ApplyFeatureDto } from './dto/apply-feature.dto';

/* Функции гостиниц массово (22.10.2026): включаются ТОЛЬКО у выбранных
 * гостиниц, платформенная запись не трогается, произвольное поле гостиницы
 * этим путём не записать. */

type T = { id: string; slug: string; multiPlaceEnabled: boolean };
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const P = '44444444-4444-4444-8444-444444444444';

function make(tenants: T[]) {
  const svc = Object.create(SuperAdminService.prototype) as SuperAdminService;
  const updateMany = jest.fn((args: { where: { id: { in: string[] } }; data: Partial<T> }) => {
    for (const t of tenants) if (args.where.id.in.includes(t.id)) Object.assign(t, args.data);
    return 'update';
  });
  const createMany = jest.fn(() => 'audit');
  const prisma = {
    admin: {
      tenant: {
        findMany: jest.fn(async ({ where }: { where: Record<string, any> }) =>
          tenants.filter(
            (t) =>
              where.id.in.includes(t.id) &&
              t.slug !== where.slug.not &&
              t.multiPlaceEnabled !== where.multiPlaceEnabled.not,
          ),
        ),
        updateMany,
      },
      auditLog: { createMany },
      $transaction: jest.fn(async (ops: unknown[]) => ops),
    },
  };
  Object.assign(svc, { prisma });
  return { svc, updateMany, createMany, tenants };
}

const actor = { userId: 'u1', isDispatcher: true } as never;

describe('функции гостиниц — массово', () => {
  it('включает только выбранным и только тем, у кого выключено; платформу — НЕТ', async () => {
    const { svc, tenants, createMany } = make([
      { id: A, slug: 'a', multiPlaceEnabled: false },
      { id: B, slug: 'b', multiPlaceEnabled: true },
      { id: C, slug: 'c', multiPlaceEnabled: false },
      { id: P, slug: 'platform', multiPlaceEnabled: false },
    ]);
    const r = await svc.applyFeature({ feature: 'multiPlaceEnabled', enabled: true, tenantIds: [A, B, P] }, actor);
    expect(r).toMatchObject({ changed: 1, requested: 3 });
    expect(tenants.map((t) => t.multiPlaceEnabled)).toEqual([true, true, false, false]);
    expect(createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ tenantId: A, userId: 'u1', action: 'feature.apply' })],
    });
  });

  it('ничего не меняется — в журнал ничего не пишется', async () => {
    const { svc, updateMany, createMany } = make([{ id: A, slug: 'a', multiPlaceEnabled: true }]);
    expect(await svc.applyFeature({ feature: 'multiPlaceEnabled', enabled: true, tenantIds: [A] }, actor)).toMatchObject({ changed: 0 });
    expect(updateMany).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });

  it('поле вне каталога — НЕ пишется: ни проверкой запроса, ни сервисом', async () => {
    const bad = plainToInstance(ApplyFeatureDto, { feature: 'isActive', enabled: false, tenantIds: [A] });
    expect(validateSync(bad).map((e) => e.property)).toContain('feature');
    const { svc, updateMany } = make([{ id: A, slug: 'a', multiPlaceEnabled: true }]);
    await expect(svc.applyFeature({ feature: 'isActive', enabled: false, tenantIds: [A] }, actor)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(updateMany).not.toHaveBeenCalled();
  });
});
