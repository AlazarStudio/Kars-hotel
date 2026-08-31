import {
  readFileSync,
  writeFileSync,
  existsSync,
  renameSync,
  readdirSync,
} from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Client as MinioClient } from 'minio';

/* Перенос ФОТОГРАФИЙ гостиниц из старой системы Kars Avia в PMS — парный
 * скрипт к prisma/legacy-import/hotels.ts (тот перенёс карточки и фонд,
 * этот — картинки; в Kars Avia той же цели служит wave9-media.ts).
 *
 *   Hotel.images[] + Hotel.gallery[] → Tenant.galleryPhotos (обложки первыми)
 *   RoomKind.images[]                → RoomType.photos
 *
 * Файлы читаются из выкачанного архива старой системы (media-old-system в
 * репозитории Kars Avia), заливаются в MinIO под теми же префиксами, что и
 * загрузка руками (tenant-gallery/…, room-type-photos/…), и попадают в
 * карточки публичными URL — ровно так их пишет StorageService.
 *
 * СООТВЕТСТВИЯ: гостиница — по hotel-slug-map.json, который написал
 * hotels.ts; категория — повтором его же правила кодов (категория старой
 * системы + суффикс при повторе, в порядке RoomKind.json) с сверкой по имени.
 *
 * ИДЕМПОТЕНТНОСТЬ: карта «путь в старой системе → залитый URL» копится в
 * hotel-media-map.json рядом с дампом; повторный прогон уже залитое
 * пропускает и не задваивает.
 *
 * ПОМЕТКА: обработанный исходник переименовывается с префиксом __DONE__
 * (как в wave9-media.ts); индекс исходников префикс игнорирует.
 *
 * Запуск (из backend/, нужен работающий MinIO):
 *   npx tsx prisma/legacy-import/hotel-media.ts \
 *     --data="<путь к airlines-export>" --media="<путь к media-old-system>" [--dry]
 */

function pickEnv(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  const envPath = join(process.cwd(), '.env');
  if (!existsSync(envPath)) return undefined;
  return readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith(`${key}=`))
    ?.split('=')
    .slice(1)
    .join('=')
    .trim()
    .replace(/^["']|["']$/g, '');
}

const arg = (name: string): string | null => {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  return raw ? raw.slice(name.length + 3).replace(/^["']|["']$/g, '') : null;
};

/* Пустая строка вместо null НЕ ради краткости: `process.exit` обрывает
 * выполнение, но сужение типа модульной константы внутрь тела функции
 * TypeScript не переносит — и `join(DATA, …)` ниже видит `string | null`.
 * Скрипт запускается через `tsx`, который типы не проверяет, поэтому ошибка
 * лежала молча и всплыла только на сборке всего бэкенда: `npm run start:dev`
 * переставал подниматься вовсе. Проверка ниже остаётся: она про запуск без
 * ключей, а не про типы. */
const DATA = arg('data') ?? '';
const MEDIA = arg('media') ?? '';
if (!DATA || !MEDIA) {
  console.error('Нужны --data=<airlines-export> и --media=<media-old-system>');
  process.exit(1);
}

const prisma = new PrismaClient({
  datasources: {
    db: { url: pickEnv('DATABASE_URL_MIGRATIONS') ?? pickEnv('DATABASE_URL') },
  },
});

const DONE = '__DONE__';
const read = <T,>(name: string): T[] =>
  JSON.parse(readFileSync(join(DATA, name), 'utf8'));
const oid = (v: unknown): string | null => {
  if (!v) return null;
  if (typeof v === 'string') return v;
  return (v as { $oid?: string }).$oid ?? null;
};
const clean = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length ? t : null;
};

const MIME: Record<string, string> = {
  webp: 'image/webp',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
};

/* ── Индекс исходников (префикс __DONE__ прозрачен) ── */
function buildIndex(root: string) {
  const byRel = new Map<string, string>();
  const byName = new Map<string, string>();
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
        continue;
      }
      const cleanName = e.name.startsWith(DONE) ? e.name.slice(DONE.length) : e.name;
      const relDir = dirname(full).slice(root.length + 1).replace(/\\/g, '/');
      const rel = `${relDir ? relDir + '/' : ''}${cleanName}`.toLowerCase();
      byRel.set(rel, full);
      if (!byName.has(cleanName.toLowerCase())) byName.set(cleanName.toLowerCase(), full);
    }
  };
  walk(root);
  return { byRel, byName };
}
type Index = ReturnType<typeof buildIndex>;
const findLocal = (idx: Index, url: string): string | null => {
  const rel = url.replace(/^\/?(files\/)?uploads\//, '').toLowerCase();
  return idx.byRel.get(rel) ?? idx.byName.get(basename(rel)) ?? null;
};

interface LegacyHotel {
  _id: unknown;
  name?: string | null;
  images?: string[] | null;
  gallery?: string[] | null;
}
interface LegacyRoomKind {
  _id: unknown;
  hotelId?: unknown;
  name?: string | null;
  category?: string | null;
  images?: string[] | null;
}

async function main() {
  const dry = process.argv.includes('--dry');

  const endpoint = new URL(pickEnv('S3_ENDPOINT') ?? 'http://localhost:9000');
  const bucket = pickEnv('S3_BUCKET') ?? 'kars-hotel';
  const publicBase = (pickEnv('S3_PUBLIC_URL') ?? endpoint.toString()).replace(/\/+$/, '');
  const minio = new MinioClient({
    endPoint: endpoint.hostname,
    port: endpoint.port ? Number(endpoint.port) : endpoint.protocol === 'https:' ? 443 : 80,
    useSSL: endpoint.protocol === 'https:',
    accessKey: pickEnv('S3_ACCESS_KEY') ?? 'minioadmin',
    secretKey: pickEnv('S3_SECRET_KEY') ?? 'minioadmin',
  });

  const idx = buildIndex(MEDIA);
  const mapPath = join(DATA, 'hotel-media-map.json');
  const uploaded: Record<string, string> = existsSync(mapPath)
    ? JSON.parse(readFileSync(mapPath, 'utf8'))
    : {};
  const saveMap = () => writeFileSync(mapPath, JSON.stringify(uploaded, null, 1), 'utf8');

  const slugMap: Record<string, { slug: string }> = JSON.parse(
    readFileSync(join(DATA, 'hotel-slug-map.json'), 'utf8'),
  );

  const used = new Set<string>();
  const problems: string[] = [];
  let galleryDone = 0;
  let photosDone = 0;

  /** Залить исходник; вернуть публичный URL (или из карты, если уже залит). */
  const upload = async (keyPrefix: string, legacyUrl: string): Promise<string | null> => {
    const local = findLocal(idx, legacyUrl);
    if (!local) {
      problems.push(`не найден локально: ${legacyUrl}`);
      return null;
    }
    used.add(local);
    if (uploaded[legacyUrl]) return uploaded[legacyUrl];
    const ext = basename(local).split('.').pop()?.toLowerCase() ?? '';
    const mime = MIME[ext];
    if (!mime) {
      problems.push(`не картинка (${ext}): ${legacyUrl}`);
      return null;
    }
    if (dry) return `dry://${legacyUrl}`;
    const key = `${keyPrefix}/${randomUUID()}.${ext}`;
    const buf = readFileSync(local);
    await minio.putObject(bucket, key, buf, buf.length, {
      'Content-Type': mime,
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    const url = `${publicBase}/${bucket}/${key}`;
    uploaded[legacyUrl] = url;
    return url;
  };

  const hotels = read<LegacyHotel>('Hotel.json');
  const kinds = read<LegacyRoomKind>('RoomKind.json');
  const kindsByHotel = new Map<string, LegacyRoomKind[]>();
  for (const k of kinds) {
    const h = oid(k.hotelId);
    if (!h) continue;
    (kindsByHotel.get(h) ?? kindsByHotel.set(h, []).get(h)!).push(k);
  }

  for (const h of hotels) {
    const legacyId = oid(h._id)!;
    const slug = slugMap[legacyId]?.slug;
    const images = (h.images ?? []).filter(Boolean);
    const gallery = (h.gallery ?? []).filter(Boolean);
    const kindList = kindsByHotel.get(legacyId) ?? [];
    const kindImages = kindList.reduce((n, k) => n + (k.images?.filter(Boolean).length ?? 0), 0);
    if (!images.length && !gallery.length && !kindImages) continue;
    if (!slug) {
      problems.push(`гостиница ${h.name}: нет в hotel-slug-map.json — фото пропущены`);
      continue;
    }
    const tenant = await prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) {
      problems.push(`гостиница ${h.name}: тенант ${slug} не найден в PMS`);
      continue;
    }

    // ── Галерея тенанта: обложки (images) первыми, затем gallery ──
    const urls: string[] = [];
    for (const src of [...images, ...gallery]) {
      const url = await upload(`tenant-gallery/${tenant.id}`, src);
      if (url) urls.push(url);
    }
    if (urls.length && !dry) {
      const current = Array.isArray(tenant.galleryPhotos)
        ? (tenant.galleryPhotos as string[])
        : [];
      const next = [...current, ...urls.filter((u) => !current.includes(u))];
      if (next.length !== current.length) {
        await prisma.tenant.update({
          where: { id: tenant.id },
          data: { galleryPhotos: next },
        });
        galleryDone += next.length - current.length;
      }
    } else if (dry) {
      galleryDone += urls.length;
    }

    /* ── Фото категорий: код повторяет правило hotels.ts — категория старой
     * системы + суффикс при повторе, в порядке RoomKind.json. Сверяемся по
     * имени: разойдётся порядок — лучше пропустить, чем прикрепить чужие. */
    const usedCodes = new Set<string>();
    for (const k of kindList) {
      const category = clean(k.category) ?? 'other';
      const base = category.toUpperCase().slice(0, 20);
      let code = base;
      for (let n = 2; usedCodes.has(code); n++) code = `${base}-${n}`;
      usedCodes.add(code);
      const kImages = (k.images ?? []).filter(Boolean);
      if (!kImages.length) continue;
      const type = await prisma.roomType.findUnique({
        where: { tenantId_code: { tenantId: tenant.id, code } },
      });
      if (!type) {
        problems.push(`категория ${h.name} / ${k.name ?? category} (${code}): нет в PMS`);
        continue;
      }
      const typeUrls: string[] = [];
      for (const src of kImages) {
        const url = await upload(`room-type-photos/${tenant.id}/${type.id}`, src);
        if (url) typeUrls.push(url);
      }
      if (typeUrls.length && !dry) {
        const current = Array.isArray(type.photos) ? (type.photos as string[]) : [];
        const next = [...current, ...typeUrls.filter((u) => !current.includes(u))];
        if (next.length !== current.length) {
          await prisma.roomType.update({
            where: { id: type.id },
            data: { photos: next },
          });
          photosDone += next.length - current.length;
        }
      } else if (dry) {
        photosDone += typeUrls.length;
      }
    }
    if (!dry) saveMap();
  }

  // ── Пометка обработанных исходников ──
  let marked = 0;
  if (!dry) {
    for (const full of used) {
      const b = basename(full);
      if (b.startsWith(DONE)) continue;
      renameSync(full, join(dirname(full), DONE + b));
      marked++;
    }
    saveMap();
  }

  const report = [
    '# Волна 9-PMS · Фото гостиниц и категорий из старой системы',
    '',
    `- В галереи тенантов добавлено: ${galleryDone}`,
    `- В фото категорий добавлено: ${photosDone}`,
    `- Исходников помечено ${DONE}: ${marked}`,
    `- Проблем: ${problems.length}`,
    '',
    ...(problems.length ? ['## Проблемы', '', ...problems.map((p) => '- ' + p)] : []),
    '',
  ].join('\n');
  const out = join(MEDIA, '..', 'wave9-hotel-media-report.md');
  writeFileSync(out, report, 'utf8');
  console.log(dry ? '── ПРОБНЫЙ ПРОГОН ──' : '── ГОТОВО ──');
  console.log(`  галереи: ${galleryDone}; фото категорий: ${photosDone}; помечено: ${marked}`);
  console.log(`  проблем: ${problems.length}; отчёт: ${out}`);
  for (const p of problems.slice(0, 12)) console.log('  ! ' + p);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
