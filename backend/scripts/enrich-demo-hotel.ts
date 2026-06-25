/**
 * Apply the complete demo PROFILE + category PHOTOS to an ALREADY-seeded tenant.
 *
 *   pnpm ts-node scripts/enrich-demo-hotel.ts [slug=demo]
 *
 * seed() refuses to run on a non-empty tenant, so for a hotel that was seeded
 * before the profile/photos existed in the dataset, this back-fills:
 *   - tenant profile (stars / address / city / contacts / description / logo /
 *     check-in-out) — the fields partners (Kars Avia) read over the
 *     connectivity API.
 *   - room_type.photos for each demo category, matched by code.
 *
 * Idempotent — safe to re-run.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { DemoSeedService } from '../src/modules/demo-seed/demo-seed.service';

async function main() {
  const slug = (process.argv[2] ?? 'demo').trim();

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const seed = app.get(DemoSeedService);
    const res = await seed.enrichExisting(slug);

    console.log('\n  Demo hotel enriched');
    console.log('  ─────────────────────────────────────────────');
    console.log(`  slug          : ${slug}`);
    console.log(`  tenantId      : ${res.tenantId}`);
    console.log(`  profile       : ${res.profileUpdated ? 'updated' : 'skipped'}`);
    console.log(`  photos set on : ${res.photosUpdated} room type(s)\n`);
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
