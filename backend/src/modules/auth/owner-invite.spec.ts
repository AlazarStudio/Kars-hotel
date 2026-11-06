import { OwnerInviteService } from './owner-invite.service';

/* 7.5 · Гостиницу по анкете партнёра заводят без ролей. Приглашение владельца
   обязано завести их само: иначе новый партнёр не может войти в свой кабинет. */
function build(existingRole: { id: string } | null) {
  const created: { roleId: string }[] = [];
  const tx = {
    ownerInvite: { updateMany: jest.fn(async () => ({ count: 1 })) },
    user: { findUnique: jest.fn(async () => null), create: jest.fn(async ({ data }: { data: { roleId: string } }) => { created.push(data); return { id: 'u1' }; }) },
    auditLog: { create: jest.fn(async () => ({})) },
    role: { findFirst: jest.fn(async () => existingRole), create: jest.fn(async ({ data }: { data: { code: string } }) => ({ id: `role-${data.code}` })) },
    permission: { findMany: jest.fn(async () => []) },
    rolePermission: { createMany: jest.fn(async () => ({ count: 0 })) },
  };
  const prisma = { admin: { $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } };
  const svc = new OwnerInviteService(prisma as never);
  Object.assign(svc, { valid: async () => ({ id: 'i1', tenantId: 't1', email: 'o@h.test', fullName: 'Владелец' }) });
  return { svc, created, tx };
}

describe('приглашение владельца', () => {
  it('у гостиницы нет ролей — роли заводятся, владелец получает свою', async () => {
    const { svc, created } = build(null);
    await svc.accept('tok', 'Password-123');
    expect(created[0].roleId).toBe('role-OWNER');
  });

  it('роль есть — вторая не заводится', async () => {
    const { svc, created, tx } = build({ id: 'r1' });
    await svc.accept('tok', 'Password-123');
    expect(created[0].roleId).toBe('r1');
    expect(tx.role.create).not.toHaveBeenCalled();
  });
});
