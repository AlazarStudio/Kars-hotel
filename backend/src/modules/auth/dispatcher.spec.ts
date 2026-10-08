import { ForbiddenException } from '@nestjs/common';
import { AuthService } from './auth.service';

/* 152-ФЗ, Р-33, Р-34; план 13.3–13.4. */

function service(over: Record<string, unknown>) {
  const audit = jest.fn(async () => undefined);
  const prisma = {
    admin: {
      tenant: { findUnique: jest.fn(async ({ where }: { where: { slug?: string } }) => (where.slug === 'platform' ? { id: 'plat' } : { id: 'hotel', isActive: true })) },
      role: {
        upsert: jest.fn(async () => ({ id: 'role-disp', tenantId: 'plat' })),
        findFirst: jest.fn(async () => ({ rolePermissions: [{ permission: { code: 'room.read' } }] })),
      },
      user: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn(async () => ({ id: 'new' })) },
      ...over,
    },
    writeAuditLog: audit,
  };
  const svc = Object.create(AuthService.prototype) as AuthService;
  Object.assign(svc, { prisma, logger: { log: jest.fn() } });
  return { svc, prisma, audit };
}

describe('Учётка диспетчера', () => {
  it('адрес сотрудника гостиницы или суперадмина входом диспетчера не занять', async () => {
    const { svc, prisma } = service({});
    (prisma.admin.user.findUnique as jest.Mock).mockResolvedValue({ id: 'owner', isDispatcher: false, isActive: true, roleId: 'r-owner' });
    await expect(svc.provisionDispatcher({ email: 'owner@hotel.ru', fullName: 'X' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.admin.user.update).not.toHaveBeenCalled();
  });

  it('новый диспетчер — с ролью DISPATCHER, не SUPER_ADMIN', async () => {
    const { svc, prisma } = service({});
    (prisma.admin.user.findUnique as jest.Mock).mockResolvedValue(null);
    await svc.provisionDispatcher({ email: 'd@karsavia.ru', fullName: 'Д' });
    expect(prisma.admin.user.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ roleId: 'role-disp', isDispatcher: true }) }));
  });

  it('вход «от имени» — всегда от своего имени, даже если у гостиницы есть сотрудник', async () => {
    const { svc, prisma } = service({});
    (prisma.admin.user.findUnique as jest.Mock).mockResolvedValue({ id: 'disp1', email: 'd@karsavia.ru', isActive: true });
    const who = await (svc as unknown as { resolveImpersonation: (t: string, a: string) => Promise<{ userId: string; roleCode: string }> }).resolveImpersonation('hotel', 'disp1');
    expect(who.userId).toBe('disp1');
    expect(who.roleCode).toBe('OWNER');
  });

  it('отключённый диспетчер «от имени» не входит', async () => {
    const { svc, prisma } = service({});
    (prisma.admin.user.findUnique as jest.Mock).mockResolvedValue({ id: 'disp1', email: 'd@karsavia.ru', isActive: false });
    await expect(
      (svc as unknown as { resolveImpersonation: (t: string, a: string) => Promise<unknown> }).resolveImpersonation('hotel', 'disp1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
