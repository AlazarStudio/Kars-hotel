import { DEFAULT_ROLE_PERMISSIONS } from '../auth/auth.constants';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/context/tenant-context';

/* 152-ФЗ, Р-44, решение 13; Р-12; план 13.5. */

describe('Отчёты Kars Avia — кому видны', () => {
  it('ровно владелец, менеджер и бухгалтер', () => {
    const roles = Object.entries(DEFAULT_ROLE_PERMISSIONS)
      .filter(([, perms]) => perms.includes('avia-report.access'))
      .map(([role]) => role)
      .sort();
    expect(roles).toEqual(['ACCOUNTANT', 'MANAGER', 'OWNER']);
  });
});

describe('Журнал — адрес и устройство из запроса', () => {
  it('вызывающий не передал — берутся из контекста запроса', async () => {
    const create = jest.fn(async () => ({}));
    const prisma = Object.create(PrismaService.prototype) as PrismaService;
    Object.assign(prisma, { admin: { auditLog: { create } }, logger: { error: jest.fn() } });
    await TenantContext.run(
      { tenantId: 't', userId: 'u', roleCode: 'OWNER', permissions: [], ip: '10.1.2.3', userAgent: 'Browser/1' },
      () => prisma.writeAuditLog({ tenantId: 't', entity: 'reservation', entityId: 'r', action: 'view' }),
    );
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ ip: '10.1.2.3', userAgent: 'Browser/1' }) });
  });
});
