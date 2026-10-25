import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { SuperAdminService } from './super-admin.service';
import { EMPTY_HOTEL_MARK, TenantExitService } from './tenant-exit.service';

/* Гостиницы из панели платформы (решение владельца 25.10.2026): заведение без
 * владельца, предупреждение о дубле, правка с ограничением на валюту, удаление
 * пустой гостиницы сразу и отказ гостинице с бронями. Сформулировано
 * отрицанием: «не заводит, не меняет, не стирает». */

const ACTOR = { userId: 'actor-1', isDispatcher: true } as never;

function adminService(
  opts: {
    existing?: Array<{ id: string; name: string; city: string | null; isActive: boolean }>;
    tenant?: object | null;
    reservations?: number;
  } = {},
) {
  const tx = {
    tenant: { create: jest.fn(async ({ data }: { data: object }) => ({ id: 'new-t', ...data })) },
    permission: { findMany: jest.fn(async () => [{ id: 'p1', code: 'room.read' }]) },
    role: {
      create: jest.fn(async ({ data }: { data: { code: string } }) => ({
        id: `role-${data.code}`,
      })),
    },
    rolePermission: { createMany: jest.fn(async () => ({ count: 1 })) },
  };
  const admin = {
    tenant: {
      findMany: jest.fn(async () => opts.existing ?? []),
      findUnique: jest.fn(async () => (opts.tenant === undefined ? null : opts.tenant)),
      findUniqueOrThrow: jest.fn(async () => ({ id: 'new-t', slug: 'hotel', name: 'Отель' })),
      update: jest.fn(async ({ data }: { data: object }) => ({ ...(opts.tenant ?? {}), ...data })),
    },
    reservation: { count: jest.fn(async () => opts.reservations ?? 0) },
    auditLog: { create: jest.fn(async () => ({})) },
    user: { create: jest.fn() },
    $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };
  const auth = {
    resolveUniqueSlug: jest.fn(async () => 'hotel'),
    registerTenant: jest.fn(async () => ({
      tenantId: 'owned-t',
      userId: 'u1',
      tokens: { accessToken: 'SECRET' },
    })),
  };
  const svc = Object.create(SuperAdminService.prototype) as SuperAdminService;
  Object.assign(svc, { prisma: { admin }, auth });
  return { svc, admin, auth, tx };
}

describe('Заведение гостиницы', () => {
  it('без владельца — гостиница и роли, учётка не заводится', async () => {
    const { svc, tx, auth, admin } = adminService();
    const r = await svc.createTenant({ hotelName: '  Отель  ', city: 'Сочи' }, ACTOR);
    expect(r.withOwner).toBe(false);
    expect(tx.tenant.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ name: 'Отель', city: 'Сочи', slug: 'hotel' }),
    });
    expect(tx.role.create).toHaveBeenCalled();
    expect(auth.registerTenant).not.toHaveBeenCalled();
    expect(admin.user.create).not.toHaveBeenCalled();
    expect(admin.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'actor-1', action: 'admin.create' }),
    });
  });

  it('с владельцем — через registerTenant, токены владельца наружу не отдаются', async () => {
    const { svc, auth, tx } = adminService();
    const r = await svc.createTenant(
      {
        hotelName: 'Отель',
        ownerFullName: 'Иван',
        ownerEmail: 'i@h.ru',
        ownerPassword: '12345678',
      },
      ACTOR,
    );
    expect(auth.registerTenant).toHaveBeenCalledWith(
      expect.objectContaining({ hotelName: 'Отель', email: 'i@h.ru' }),
    );
    expect(tx.tenant.create).not.toHaveBeenCalled();
    expect(JSON.stringify(r)).not.toContain('SECRET');
    expect(r.withOwner).toBe(true);
  });

  it('владелец заполнен частично — 400, ничего не заводится', async () => {
    const { svc, tx, auth } = adminService();
    await expect(
      svc.createTenant({ hotelName: 'Отель', ownerEmail: 'i@h.ru' }, ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.tenant.create).not.toHaveBeenCalled();
    expect(auth.registerTenant).not.toHaveBeenCalled();
  });

  /* Сравнение — в коде: база отдаёт все гостиницы (C-локаль Postgres не
     сворачивает регистр кириллицы, поймано на стенде 25.10.2026). */
  it('дубль (то же название в том же городе, регистр, ё и пробелы не важны) — 409 DUPLICATE_HOTEL, ничего не заводится', async () => {
    const { svc, tx } = adminService({
      existing: [
        { id: 'old', name: 'НОВЫЙ  ОТЁЛЬ', city: 'сочи ', isActive: true },
        { id: 'other', name: 'Другая', city: 'Сочи', isActive: true },
      ],
    });
    const err = await svc
      .createTenant({ hotelName: 'Новый отель', city: 'Сочи' }, ACTOR)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toEqual(
      expect.objectContaining({
        code: 'DUPLICATE_HOTEL',
        duplicates: [expect.objectContaining({ id: 'old' })],
      }),
    );
    expect(tx.tenant.create).not.toHaveBeenCalled();
  });

  it('другое название в том же городе — не дубль', async () => {
    const { svc, tx } = adminService({
      existing: [{ id: 'other', name: 'Другая', city: 'Сочи', isActive: true }],
    });
    await svc.createTenant({ hotelName: 'Отель', city: 'Сочи' }, ACTOR);
    expect(tx.tenant.create).toHaveBeenCalled();
  });

  it('то же название в другом городе — не дубль', async () => {
    const { svc, tx } = adminService({
      existing: [{ id: 'old', name: 'Отель', city: 'Анапа', isActive: true }],
    });
    await svc.createTenant({ hotelName: 'Отель', city: 'Сочи' }, ACTOR);
    expect(tx.tenant.create).toHaveBeenCalled();
  });

  it('«всё равно создать» — заводит, даже если дубль', async () => {
    const { svc, tx } = adminService({
      existing: [{ id: 'old', name: 'Отель', city: null, isActive: true }],
    });
    await svc.createTenant({ hotelName: 'Отель', allowDuplicate: true }, ACTOR);
    expect(tx.tenant.create).toHaveBeenCalled();
  });

  it('неизвестный часовой пояс — 400', async () => {
    const { svc, tx } = adminService();
    await expect(
      svc.createTenant({ hotelName: 'Отель', timezone: 'Europe/Mosсow' }, ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.tenant.create).not.toHaveBeenCalled();
  });
});

describe('Правка гостиницы', () => {
  const T = {
    id: 't1',
    slug: 'h1',
    name: 'Отель',
    city: 'Сочи',
    address: null,
    phone: null,
    email: null,
    stars: null,
    timezone: 'Europe/Moscow',
    currency: 'RUB',
    plan: 'LITE',
  };

  it('валюту при бронях НЕ сменить — 409, карточка не меняется', async () => {
    const { svc, admin } = adminService({ tenant: T, reservations: 3 });
    const err = await svc.updateTenant('t1', { currency: 'USD' }, ACTOR).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toContain('3');
    expect(admin.tenant.update).not.toHaveBeenCalled();
  });

  it('валюту без броней — меняет, в журнале «было → стало» только изменённое', async () => {
    const { svc, admin } = adminService({ tenant: T, reservations: 0 });
    await svc.updateTenant('t1', { currency: 'USD', city: 'Сочи', name: ' Отель Плюс ' }, ACTOR);
    expect(admin.tenant.update).toHaveBeenCalledWith({
      where: { id: 't1' },
      data: { currency: 'USD', name: 'Отель Плюс' },
    });
    expect(admin.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'admin.update',
        diff: {
          before: { currency: 'RUB', name: 'Отель' },
          after: { currency: 'USD', name: 'Отель Плюс' },
        },
      }),
    });
  });

  it('пустая строка — очистить поле', async () => {
    const { svc, admin } = adminService({ tenant: T });
    await svc.updateTenant('t1', { city: '  ' }, ACTOR);
    expect(admin.tenant.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { city: null } });
  });

  it('название из пробелов — 400', async () => {
    const { svc, admin } = adminService({ tenant: T });
    await expect(svc.updateTenant('t1', { name: '   ' }, ACTOR)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(admin.tenant.update).not.toHaveBeenCalled();
  });

  it('ничего не изменилось — ни правки, ни строки в журнале', async () => {
    const { svc, admin } = adminService({ tenant: T });
    await svc.updateTenant('t1', { name: 'Отель', city: 'Сочи' }, ACTOR);
    expect(admin.tenant.update).not.toHaveBeenCalled();
    expect(admin.auditLog.create).not.toHaveBeenCalled();
  });

  it('платформенная запись и несуществующая — 404', async () => {
    await expect(
      adminService({ tenant: { ...T, slug: 'platform' } }).svc.updateTenant(
        't1',
        { name: 'X1' },
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      adminService({ tenant: null }).svc.updateTenant('t1', { name: 'X1' }, ACTOR),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('Удаление пустой гостиницы', () => {
  function exitService(opts: { reservations?: number; tenant?: object | null } = {}) {
    const tx = {
      reservation: { count: jest.fn(async () => opts.reservations ?? 0) },
      $executeRawUnsafe: jest.fn(async () => 1),
      $queryRaw: jest.fn(async () => []),
      tenantExitAct: {
        create: jest.fn(async ({ data }: { data: object }) => ({ id: 'act-1', ...data })),
      },
    };
    const admin = {
      tenant: {
        findUnique: jest.fn(async () =>
          opts.tenant === undefined ? { id: 't1', slug: 'h1', name: 'Отель' } : opts.tenant,
        ),
      },
      $queryRaw: jest.fn(async () => [{ table_name: 'room' }, { table_name: 'reservation' }]),
      $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    };
    const storage = { deleteTenantFiles: jest.fn(async () => 0) };
    const svc = Object.create(TenantExitService.prototype) as TenantExitService;
    Object.assign(svc, {
      prisma: { admin },
      storage,
      logger: { log: jest.fn(), error: jest.fn() },
    });
    return { svc, tx, storage };
  }

  it('с бронями — 409, ничего не стирается, файлы целы, акта нет', async () => {
    const { svc, tx, storage } = exitService({ reservations: 1 });
    const err = await svc.deleteEmpty('t1', 'actor-1').catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toContain('по акту');
    expect(tx.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(tx.tenantExitAct.create).not.toHaveBeenCalled();
    expect(storage.deleteTenantFiles).not.toHaveBeenCalled();
  });

  it('пустая — стирается целиком, акт с пометкой «без выгрузки» и тем, кто удалил', async () => {
    const { svc, tx, storage } = exitService();
    const r = await svc.deleteEmpty('t1', 'actor-1');
    expect(tx.reservation.count).toHaveBeenCalledWith({ where: { tenantId: 't1' } });
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      'DELETE FROM "tenant" WHERE id = $1::uuid',
      't1',
    );
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      'DELETE FROM "room" WHERE tenant_id = $1::uuid',
      't1',
    );
    expect(tx.tenantExitAct.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 't1',
        exportSha256: EMPTY_HOTEL_MARK,
        destroyedBy: 'actor-1',
      }),
    });
    expect(storage.deleteTenantFiles).toHaveBeenCalledWith('t1');
    expect(r.actId).toBe('act-1');
  });

  it('несуществующая или платформенная — 404', async () => {
    await expect(exitService({ tenant: null }).svc.deleteEmpty('t1', 'a')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      exitService({ tenant: { id: 't1', slug: 'platform', name: 'P' } }).svc.deleteEmpty('t1', 'a'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
