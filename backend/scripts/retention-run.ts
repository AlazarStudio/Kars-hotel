/* Прогон сроков хранения ПДн против указанной базы (152-ФЗ, план 13.9).
 *
 *   DATABASE_URL_MIGRATIONS=postgresql://… npx ts-node scripts/retention-run.ts dry|on
 *
 * Для пробы на одноразовой копии и для ручного прогона ответственным.
 * Подключение — суперпользователем (как миграции): правила идут мимо RLS. */
import { PrismaClient } from '@prisma/client';
import { runRetention } from '../src/modules/retention/retention.rules';

async function main() {
  const mode = process.argv[2];
  if (mode !== 'dry' && mode !== 'on') throw new Error('Режим: dry или on');
  const db = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_MIGRATIONS } } });
  try {
    const res = await runRetention(db, mode);
    for (const r of res) {
      const total = r.byTenant.reduce((s, x) => s + x.count, 0);
      console.log(`${r.rule.padEnd(18)} ${r.skipped ? 'пропущено' : total}`);
    }
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
