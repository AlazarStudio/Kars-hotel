/**
 * Rename a tenant (hotel) by slug. Used to repair a tenant whose `name` was
 * stored corrupt (e.g. mojibake / U+FFFD bytes from a bad-encoding signup).
 *
 *   pnpm ts-node scripts/rename-tenant.ts <slug> "<new name>"
 *
 * The name is a profile field read by partners over the connectivity API, so it
 * must be valid UTF-8. This source file is UTF-8, so passing the new name as an
 * argv avoids any shell-encoding mangling on Windows.
 *
 * Writes through the admin (BYPASSRLS) client — the tenant table is RLS-locked
 * to `id = app.tenant_id` for app_user, so tenant writes always go via admin.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';

async function main() {
  const slug = (process.argv[2] ?? '').trim();
  const newName = (process.argv[3] ?? '').trim();
  if (!slug || !newName) {
    console.error('Usage: ts-node scripts/rename-tenant.ts <slug> "<new name>"');
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const prisma = app.get(PrismaService);
    const before = await prisma.admin.tenant.findUnique({ where: { slug } });
    if (!before) {
      console.error(`No tenant with slug "${slug}"`);
      process.exit(1);
    }
    const after = await prisma.admin.tenant.update({
      where: { slug },
      data: { name: newName },
    });
    console.log('\n  Tenant renamed');
    console.log('  ─────────────────────────────────────────────');
    console.log(`  slug     : ${after.slug}`);
    console.log(`  tenantId : ${after.id}`);
    console.log(`  name     : ${JSON.stringify(before.name)} -> ${JSON.stringify(after.name)}\n`);
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
