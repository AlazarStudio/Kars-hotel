import { ExecutionContext, ForbiddenException, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { TenantContext } from '../../common/context/tenant-context';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DEFAULT_ROLE_PERMISSIONS } from '../auth/auth.constants';
import { RatePlansController } from './rate-plans.controller';
import { RatePlansService } from './rate-plans.service';

const TENANT = '00000000-0000-4000-8000-000000000001';
const OTHER = '00000000-0000-4000-8000-000000000002';
const SELECT = { id: true, name: true, maxOccupancy: true, basePrice: true };

function guarded(permissions: readonly string[]) {
  const handler = RatePlansController.prototype.roomTypes;
  const context = {
    getHandler: () => handler,
    getClass: () => RatePlansController,
    switchToHttp: () => ({ getRequest: () => ({ user: { permissions } }) }),
  } as unknown as ExecutionContext;
  return new PermissionsGuard(new Reflector()).canActivate(context);
}

function fixture() {
  const rows = [
    {
      id: 'own',
      tenantId: TENANT,
      archivedAt: null,
      name: 'Стандарт',
      maxOccupancy: 2,
      basePrice: '3000.00',
      photos: ['private'],
      description: 'Private',
    },
    {
      id: 'other',
      tenantId: OTHER,
      archivedAt: null,
      name: 'Другой',
      maxOccupancy: 3,
      basePrice: '4000.00',
    },
    {
      id: 'archived',
      tenantId: TENANT,
      archivedAt: new Date(),
      name: 'Архив',
      maxOccupancy: 2,
      basePrice: '2000.00',
    },
  ];
  const queries: unknown[] = [];
  const scopes: string[] = [];
  const transaction = jest.fn(async (callback) => {
    let tenant: string | undefined;
    return callback({
      $executeRawUnsafe: jest.fn(async (sql: string) => {
        scopes.push(sql);
        tenant = /^SET LOCAL app\.tenant_id = '([^']+)'$/.exec(sql)?.[1];
      }),
      roomType: {
        findMany: jest.fn(async (query) => {
          queries.push(query);
          expect(tenant).toBe(TenantContext.getTenantIdOrThrow());
          return rows
            .filter((row) => row.tenantId === tenant && row.archivedAt === query.where.archivedAt)
            .map((row) =>
              Object.fromEntries(
                Object.keys(query.select).map((key) => [key, row[key as keyof typeof row]]),
              ),
            );
        }),
      },
    });
  });
  // Real tenant scoping and SET LOCAL code; only the database transaction is replaced.
  const prisma = {
    forTenant: PrismaService.prototype.forTenant,
    forTenantExplicit: PrismaService.prototype.forTenantExplicit,
    $transaction: transaction,
  };
  const service = new RatePlansService(prisma as never, {} as never, {} as never, {} as never);
  const read = () => new RatePlansController(service).roomTypes();
  const run = (tenantId: string) =>
    TenantContext.run(
      { tenantId, userId: 'user', roleCode: 'CHANNEL_MANAGER', permissions: ['rate.read'] },
      read,
    );
  return { read, run, transaction, queries, scopes };
}

describe('tariff room type lookup', () => {
  it('uses a static GET route and accepts channel managers without room.read', () => {
    expect(DEFAULT_ROLE_PERMISSIONS.CHANNEL_MANAGER).not.toContain('room.read');
    expect(guarded(DEFAULT_ROLE_PERMISSIONS.CHANNEL_MANAGER)).toBe(true);
    expect(guarded(['rate.read'])).toBe(true);
    const handler = RatePlansController.prototype.roomTypes;
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe('room-types');
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(RequestMethod.GET);
  });

  it.each([[], ['room.read'], ['rate.update']])(
    'rejects access without rate.read: %j',
    (...permissions: string[]) => {
      expect(() => guarded(permissions)).toThrow(ForbiddenException);
    },
  );

  it('queries through real tenant scope, excludes archived categories and projects only tariff fields', async () => {
    const f = fixture();
    await expect(f.run(TENANT)).resolves.toEqual([
      { id: 'own', name: 'Стандарт', maxOccupancy: 2, basePrice: '3000.00' },
    ]);
    await expect(f.run(OTHER)).resolves.toEqual([
      { id: 'other', name: 'Другой', maxOccupancy: 3, basePrice: '4000.00' },
    ]);
    expect(f.scopes).toEqual([
      `SET LOCAL app.tenant_id = '${TENANT}'`,
      `SET LOCAL app.tenant_id = '${OTHER}'`,
    ]);
    expect(f.queries).toEqual(
      [TENANT, OTHER].map(() => ({
        where: { archivedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: SELECT,
      })),
    );
  });

  it('fails before querying when tenant context is missing', async () => {
    const f = fixture();
    await expect(f.read()).rejects.toThrow('tenant_id is required');
    expect(f.transaction).not.toHaveBeenCalled();
  });
});
