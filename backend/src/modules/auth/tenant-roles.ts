import { Prisma, RoleCode } from '@prisma/client';
import { DEFAULT_ROLE_NAMES, DEFAULT_ROLE_PERMISSIONS } from './auth.constants';

/**
 * Стандартный набор ролей гостиницы с правами — СТРУКТУРА тенанта, а не люди.
 *
 * Один на все пути заведения гостиницы: регистрация с владельцем
 * (`AuthService.registerTenant`) и заведение без владельца из панели
 * платформы. Без ролей у гостиницы некому назначить права, когда она заведёт
 * сотрудника, — так 391 перенесённая гостиница осталась без ролей
 * (`prisma/legacy-import/seed-tenant-roles.ts`).
 */
export async function seedDefaultRoles(
  tx: Prisma.TransactionClient,
  tenantId: string,
): Promise<Partial<Record<RoleCode, string>>> {
  const allPerms = await tx.permission.findMany();
  const permByCode = new Map(allPerms.map((p) => [p.code, p.id]));

  const roleByCode: Partial<Record<RoleCode, string>> = {};
  for (const code of Object.keys(DEFAULT_ROLE_PERMISSIONS) as RoleCode[]) {
    const role = await tx.role.create({
      data: {
        tenantId,
        code,
        name: DEFAULT_ROLE_NAMES[code] ?? code,
        isSystem: true,
      },
    });
    roleByCode[code] = role.id;

    const permCodes = DEFAULT_ROLE_PERMISSIONS[code] ?? [];
    if (permCodes.length > 0) {
      await tx.rolePermission.createMany({
        data: permCodes
          .map((c) => permByCode.get(c))
          .filter((id): id is string => !!id)
          .map((permissionId) => ({ roleId: role.id, permissionId })),
        skipDuplicates: true,
      });
    }
  }
  return roleByCode;
}
