/**
 * Populate the hotel hero gallery for a tenant from the demo image set.
 *
 *   pnpm ts-node scripts/seed-tenant-gallery.ts [slug=demo]
 *
 * The gallery is the slider shown on the partner-facing hotel page (Kars Avia
 * «Общая информация»). Each source image is downloaded into our own object
 * storage (MinIO) so we never reference an external CDN, then the ordered list
 * of OUR urls is written to tenant.galleryPhotos (first = cover).
 *
 * Idempotent-ish: re-running re-ingests and overwrites the gallery (previous
 * objects are left in the bucket — harmless). Skips tenants that already have a
 * non-empty gallery unless --force is passed.
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { StorageService } from '../src/common/storage/storage.service';
import { DEMO_PROFILE } from '../src/modules/demo-seed/demo-data';

async function main() {
  const slug = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'demo';
  const force = process.argv.includes('--force');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const prisma = app.get(PrismaService);
    const storage = app.get(StorageService);

    const tenant = await prisma.admin.tenant.findUnique({
      where: { slug },
      select: { id: true, slug: true, galleryPhotos: true },
    });
    if (!tenant) throw new Error(`No tenant with slug="${slug}"`);

    const existing = Array.isArray(tenant.galleryPhotos) ? tenant.galleryPhotos : [];
    if (existing.length && !force) {
      console.log(`  [${slug}] already has ${existing.length} gallery photos — skipping (use --force).`);
      return;
    }

    const urls = await Promise.all(
      DEMO_PROFILE.galleryPhotos.map((src) =>
        storage.ingestFromUrl(`tenant-gallery/${tenant.id}`, src),
      ),
    );
    await prisma.admin.tenant.update({
      where: { id: tenant.id },
      data: { galleryPhotos: urls },
    });

    console.log(`  [${slug}] gallery set: ${urls.length} photos`);
    urls.forEach((u, i) => console.log(`    ${i === 0 ? '★ cover' : '  photo '} → ${u}`));
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
