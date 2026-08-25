import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import {
  DEFAULT_ROLE_NAMES,
  DEFAULT_ROLE_PERMISSIONS,
} from '../../src/modules/auth/auth.constants';

/* Роли для перенесённых гостиниц.
 *
 * Тенант, заведённый обычным путём (`AuthService.registerTenant`), получает
 * три вещи разом: карточку, НАБОР РОЛЕЙ с правами и учётку владельца. Перенос
 * из старой системы (`legacy-import/hotels.ts`) заводил только карточку и
 * номера — ролей у 391 гостиницы не было вовсе.
 *
 * Видно это стало не там, где сломалось: диспетчер жал «Управлять в Hotel
 * PMS» и получал «No active user found in target tenant». Учётки — отдельный
 * разговор (в старой системе логин был лишь у десяти гостиниц из 392, и
 * выдумывать остальным пароли незачем), а вот роли — это СТРУКТУРА тенанта, а
 * не люди: без них некому назначить права, когда гостиница заведёт своего
 * сотрудника, и не от чего взять набор прав диспетчеру, работающему за неё.
 *
 * Запуск: npx ts-node prisma/legacy-import/seed-tenant-roles.ts [--dry]
 * Повтор безопасен: роли создаются только там, где их нет.
 */

function loadDatabaseUrl(): string {
  const fromEnv =
    process.env.DATABASE_URL_MIGRATIONS ?? process.env.DATABASE_URL;
  if (fromEnv) return fromEnv;
  const envPath = join(process.cwd(), '.env');
  if (!existsSync(envPath)) {
    throw new Error('Не нашёл backend/.env и переменных окружения с DATABASE_URL');
  }
  const text = readFileSync(envPath, 'utf8');
  const pick = (key: string) =>
    text
      .split(/\r?\n/)
      .find((l) => l.trim().startsWith(`${key}=`))
      ?.split('=')
      .slice(1)
      .join('=')
      .trim()
      .replace(/^["']|["']$/g, '');
  const url = pick('DATABASE_URL_MIGRATIONS') ?? pick('DATABASE_URL');
  if (!url) throw new Error('В backend/.env нет DATABASE_URL');
  return url;
}

const prisma = new PrismaClient({
  datasources: { db: { url: loadDatabaseUrl() } },
});

async function main() {
  const dry = process.argv.includes('--dry');

  const tenants = await prisma.tenant.findMany({
    where: { slug: { not: 'platform' } },
    select: { id: true, slug: true, name: true, _count: { select: { roles: true } } },
    orderBy: { name: 'asc' },
  });
  const empty = tenants.filter((t) => t._count.roles === 0);

  console.log(
    `Гостиниц: ${tenants.length}; без ролей: ${empty.length}` +
      (dry ? '  (ПРОБНЫЙ ПРОГОН)' : ''),
  );
  if (empty.length === 0) return;

  const permissions = await prisma.permission.findMany();
  const permByCode = new Map(permissions.map((p) => [p.code, p.id]));
  const codes = Object.keys(DEFAULT_ROLE_PERMISSIONS);

  let seeded = 0;
  for (const t of empty) {
    if (dry) {
      seeded++;
      continue;
    }
    /* Одна транзакция на гостиницу: половина набора ролей хуже, чем их
       отсутствие — часть прав окажется невыдаваемой, и понять, почему,
       будет неоткуда. */
    await prisma.$transaction(async (tx) => {
      for (const code of codes) {
        const role = await tx.role.create({
          data: {
            tenantId: t.id,
            code: code as never,
            name: DEFAULT_ROLE_NAMES[code] ?? code,
            isSystem: true,
          },
        });
        const permIds = (DEFAULT_ROLE_PERMISSIONS[code] ?? [])
          .map((c) => permByCode.get(c))
          .filter((id): id is string => !!id);
        if (permIds.length > 0) {
          await tx.rolePermission.createMany({
            data: permIds.map((permissionId) => ({
              roleId: role.id,
              permissionId,
            })),
            skipDuplicates: true,
          });
        }
      }
    });
    seeded++;
  }

  console.log(`Роли заведены для ${seeded} гостиниц (по ${codes.length} на каждую).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
