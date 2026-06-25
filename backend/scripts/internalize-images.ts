/**
 * Re-host every externally-referenced image in our own object storage (MinIO).
 *
 *   pnpm ts-node scripts/internalize-images.ts
 *
 * The demo dataset historically stored Unsplash URLs for room-type photos and
 * the hotel logo. Partners (Kars Avia) then render images straight from those
 * external CDNs — which we don't control. This script walks every tenant,
 * downloads each image that isn't already in our bucket, stores it with us, and
 * rewrites the DB to point at the new URL.
 *
 * Idempotent: URLs that already live in our bucket are skipped, so re-running
 * is a no-op.
 *
 * Writes go through the admin (BYPASSRLS) client because it spans all tenants.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { StorageService } from '../src/common/storage/storage.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const prisma = app.get(PrismaService);
    const storage = app.get(StorageService);

    const tenants = await prisma.admin.tenant.findMany({
      select: { id: true, slug: true, logoUrl: true },
    });

    let logosFixed = 0;
    let photosFixed = 0;
    let roomTypesTouched = 0;

    for (const t of tenants) {
      // 1. Logo.
      if (t.logoUrl && !storage.isOwnUrl(t.logoUrl)) {
        try {
          const url = await storage.ingestFromUrl(`tenant-logos/${t.id}`, t.logoUrl);
          await prisma.admin.tenant.update({ where: { id: t.id }, data: { logoUrl: url } });
          logosFixed++;
          console.log(`  [${t.slug}] logo  → ${url}`);
        } catch (e) {
          console.warn(`  [${t.slug}] logo FAILED (${t.logoUrl}): ${(e as Error).message}`);
        }
      }

      // 2. Room-type photos.
      const roomTypes = await prisma.admin.roomType.findMany({
        where: { tenantId: t.id },
        select: { id: true, code: true, photos: true },
      });
      for (const rt of roomTypes) {
        const current = Array.isArray(rt.photos)
          ? rt.photos.filter((p): p is string => typeof p === 'string')
          : [];
        if (!current.length) continue;

        let changed = false;
        const next: string[] = [];
        for (const src of current) {
          if (storage.isOwnUrl(src)) {
            next.push(src);
            continue;
          }
          try {
            const url = await storage.ingestFromUrl(
              `room-type-photos/${t.id}/${rt.code}`,
              src,
            );
            next.push(url);
            changed = true;
            photosFixed++;
            console.log(`  [${t.slug}] ${rt.code} photo → ${url}`);
          } catch (e) {
            // Keep the original on failure rather than dropping the photo.
            next.push(src);
            console.warn(`  [${t.slug}] ${rt.code} photo FAILED (${src}): ${(e as Error).message}`);
          }
        }
        if (changed) {
          await prisma.admin.roomType.update({ where: { id: rt.id }, data: { photos: next } });
          roomTypesTouched++;
        }
      }
    }

    console.log('\n  Image internalisation complete');
    console.log('  ─────────────────────────────────────────────');
    console.log(`  tenants scanned   : ${tenants.length}`);
    console.log(`  logos re-hosted   : ${logosFixed}`);
    console.log(`  photos re-hosted  : ${photosFixed} (across ${roomTypesTouched} room types)\n`);
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
