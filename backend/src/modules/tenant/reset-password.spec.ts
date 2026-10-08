import { ForbiddenException } from '@nestjs/common';
import { TenantService } from './tenant.service';

/* 152-ФЗ, Р-45; план 13.2: сброс пароля сотруднику — новые входы только с
 * новым паролем, прежние сессии гаснут, владельца так не сбросить. */

function service(role: string) {
  const updateMany = jest.fn();
  const update = jest.fn();
  const prisma = {
    admin: {
      user: { findFirst: jest.fn(async () => ({ id: 'u1', email: 's@h.ru', isActive: true, role: { code: role } })), update },
      refreshToken: { updateMany },
      $transaction: jest.fn(async (ops: unknown[]) => ops),
    },
    writeAuditLog: jest.fn(async () => undefined),
  };
  const svc = Object.create(TenantService.prototype) as TenantService;
  Object.assign(svc, { prisma });
  return { svc, prisma, updateMany };
}

describe('TenantService.resetPassword', () => {
  it('сотрудник: временный пароль, все его сессии отозваны, журнал без пароля', async () => {
    const { svc, prisma, updateMany } = service('FRONT_DESK');
    const res = await svc.resetPassword('t1', 'u1', 'owner1');
    expect(res.temporaryPassword).toMatch(/^[0-9a-f]{16}$/);
    expect(updateMany).toHaveBeenCalledWith({ where: { userId: 'u1', revokedAt: null }, data: { revokedAt: expect.any(Date) } });
    const audit = JSON.stringify((prisma.writeAuditLog as jest.Mock).mock.calls);
    expect(audit).toContain('password.reset');
    expect(audit).not.toContain(res.temporaryPassword);
  });

  it('владельца так не сбросить', async () => {
    const { svc, updateMany } = service('OWNER');
    await expect(svc.resetPassword('t1', 'u1', 'mgr')).rejects.toBeInstanceOf(ForbiddenException);
    expect(updateMany).not.toHaveBeenCalled();
  });
});
