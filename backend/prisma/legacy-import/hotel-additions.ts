import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

/* ДОБОР категорий и номеров к уже перенесённым гостиницам (21.10.2026).
 *
 * После августовского переноса диспетчеры продолжали работать в старой
 * системе: заводили категории и номера к гостиницам, которые уже живут в PMS.
 * hotels.ts для этого не годится — повторный прогон ПЕРЕПИСАЛ бы карточки
 * гостиниц и категорий, правленные в PMS, и искал бы категории правилом кодов
 * «категория + суффикс по порядку», которое на свежем дампе сдвигается.
 *
 * Здесь — только ДОБАВЛЕНИЕ, существующее не меняется:
 *
 *   Категория. Своя у категории старой системы — та, что завёл перенос этой
 *   гостиницы: её код считается тем же правилом по ТОМУ дампу, по которому
 *   гостиницу переносили (--base: августовская выгрузка и выгрузка «только
 *   новое» 20.10). Категории, которой в том дампе не было, — новая: заводится
 *   со свободным кодом в конце списка.
 *
 *   Номер. Новый — запись старой системы, которой не было в том дампе.
 *   Диспетчеры, бывало, пересобирали фонд целиком: удаляли прежние номера и
 *   заводили заново («Мираж»: 80 → 72). Поэтому номер прежнего переноса,
 *   которого в свежем дампе нет, сперва отдаётся новому номеру с тем же
 *   ярлыком (запись PMS остаётся, у неё обновляются категория и вместимость),
 *   а без замены — ВЫКЛЮЧАЕТСЯ (isActive = false), не удаляется. Номер
 *   прежнего переноса находится по тому же правилу суффиксов, что в
 *   hotels.ts; заведённые в PMS руками номера не трогаются. Ярлык занят
 *   живым номером — суффикс «(2)», как в hotels.ts (в старой системе один
 *   ярлык носят до трёх записей).
 *
 * Удалённые в старой системе категории из PMS не удаляются — только отчёт.
 *
 * Пишет room-type-map.json рядом с данными: «id категории старой системы →
 * id категории PMS». По ней hotel-media.ts ставит фото категорий без
 * угадывания по названию. Рядом — room-map.json («id номера → id номера
 * PMS»). Обе карты читаются при старте: повторный прогон уже заведённое
 * пропускает, а не заводит второй раз.
 *
 * Запуск (из backend/):
 *   npx tsx prisma/legacy-import/hotel-additions.ts \
 *     --data="<папка с ПОЛНЫМИ Hotel/RoomKind/Room.json и hotel-slug-map.json>" \
 *     --base="<airlines-export>;<delta pms>" [--dry]
 */

const arg = (name: string): string | null => {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`));
  return raw ? raw.slice(name.length + 3).replace(/^["']|["']$/g, '') : null;
};

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

const DATA = arg('data') ?? '';
const BASE = (arg('base') ?? '').split(';').filter(Boolean);
if (!DATA || !BASE.length) {
  console.error('Нужны --data=<полная выгрузка> и --base=<папки, по которым переносили>');
  process.exit(1);
}
const dry = process.argv.includes('--dry');

const prisma = new PrismaClient({
  datasources: { db: { url: pickEnv('DATABASE_URL_MIGRATIONS') ?? pickEnv('DATABASE_URL') } },
});

interface LegacyKind {
  _id: unknown;
  hotelId?: unknown;
  name?: string | null;
  description?: string | null;
  category?: string | null;
  price?: number | null;
  priceForAirline?: number | null;
}
interface LegacyRoom {
  _id: unknown;
  hotelId?: unknown;
  roomKindId?: unknown;
  name?: string | null;
  places?: number | null;
  active?: boolean;
  description?: string | null;
}

const oid = (v: unknown): string | null => {
  if (!v) return null;
  if (typeof v === 'string') return v;
  return (v as { $oid?: string }).$oid ?? null;
};
const clean = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return s.length > 0 ? s : null;
};
const intOf = (v: unknown): number | null => {
  const n = Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n) : null;
};
const read = <T,>(dir: string, f: string): T[] =>
  existsSync(join(dir, f)) ? JSON.parse(readFileSync(join(dir, f), 'utf8')) : [];
const groupBy = <T,>(rows: T[], key: (r: T) => string | null) => {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    if (k) (m.get(k) ?? m.set(k, []).get(k)!).push(r);
  }
  return m;
};

// Те же справочники, что в hotels.ts: новая категория заводится как прежние.
const CATEGORY_PLACES: Record<string, number> = {
  onePlace: 1, twoPlace: 2, threePlace: 3, fourPlace: 4, fivePlace: 5,
  sixPlace: 6, sevenPlace: 7, eightPlace: 8, ninePlace: 9, tenPlace: 10,
  apartment: 2, studio: 2, luxe: 2, comfort: 2, improvedComfort: 2,
};
const CATEGORY_LABEL: Record<string, string> = {
  onePlace: 'Одноместный', twoPlace: 'Двухместный', threePlace: 'Трёхместный',
  fourPlace: 'Четырёхместный', fivePlace: 'Пятиместный', sixPlace: 'Шестиместный',
  sevenPlace: 'Семиместный', eightPlace: 'Восьмиместный', ninePlace: 'Девятиместный',
  tenPlace: 'Десятиместный', apartment: 'Апартаменты', studio: 'Студия',
  luxe: 'Люкс', comfort: 'Комфорт', improvedComfort: 'Улучшенный комфорт',
};
const baseCode = (k: LegacyKind) => (clean(k.category) ?? 'other').toUpperCase().slice(0, 20);

async function main() {
  const slugMap: Record<string, { slug: string }> = JSON.parse(
    readFileSync(join(DATA, 'hotel-slug-map.json'), 'utf8'),
  );
  const kinds = read<LegacyKind>(DATA, 'RoomKind.json');
  const rooms = read<LegacyRoom>(DATA, 'Room.json');
  // Дамп, по которому гостиницу переносили: августовский или «только новое».
  const baseKinds = groupBy(
    BASE.flatMap((d) => read<LegacyKind>(d, 'RoomKind.json')),
    (k) => oid(k.hotelId),
  );
  const baseRooms = BASE.flatMap((d) => read<LegacyRoom>(d, 'Room.json'));
  const baseRoomIds = new Set(baseRooms.map((r) => oid(r._id)));
  const baseRoomsByHotel = groupBy(baseRooms, (r) => oid(r.hotelId));
  const freshRoomIds = new Set(rooms.map((r) => oid(r._id)));
  const kindsByHotel = groupBy(kinds, (k) => oid(k.hotelId));
  const roomsByHotel = groupBy(rooms, (r) => oid(r.hotelId));

  const loadMap = (f: string): Record<string, string> =>
    existsSync(join(DATA, f)) ? JSON.parse(readFileSync(join(DATA, f), 'utf8')) : {};
  const typeMap = loadMap('room-type-map.json');
  const roomMap = loadMap('room-map.json');
  const report: string[] = [];
  let typesCreated = 0;
  let roomsCreated = 0;
  let roomsRenumbered = 0;
  let roomsReused = 0;
  let roomsOff = 0;
  let kindsGone = 0;

  for (const [legacyHotelId, slugEntry] of Object.entries(slugMap)) {
    const tenant = await prisma.tenant.findUnique({ where: { slug: slugEntry.slug } });
    if (!tenant) {
      report.push(`гостиница ${legacyHotelId} (${slugEntry.slug}): тенанта нет в PMS`);
      continue;
    }
    const types = await prisma.roomType.findMany({ where: { tenantId: tenant.id } });
    const byCode = new Map(types.map((t) => [t.code, t]));
    const usedCodes = new Set(types.map((t) => t.code));

    // ── Свои категории: код по тому дампу, по которому переносили ──
    const seen = new Set<string>();
    const fresh = new Set((kindsByHotel.get(legacyHotelId) ?? []).map((k) => oid(k._id)!));
    for (const k of baseKinds.get(legacyHotelId) ?? []) {
      const base = baseCode(k);
      let code = base;
      for (let n = 2; seen.has(code); n++) code = `${base}-${n}`;
      seen.add(code);
      const t = byCode.get(code);
      if (t) typeMap[oid(k._id)!] = t.id;
      else report.push(`${tenant.name}: категория ${k.name ?? code} (${code}) удалена в PMS — номера к ней не добавляются`);
      if (!fresh.has(oid(k._id)!)) kindsGone++;
    }

    // ── Новые категории ──
    let order = types.reduce((m, t) => Math.max(m, t.sortOrder ?? 0), 0);
    for (const k of kindsByHotel.get(legacyHotelId) ?? []) {
      const kindId = oid(k._id)!;
      if (typeMap[kindId] || (baseKinds.get(legacyHotelId) ?? []).some((b) => oid(b._id) === kindId)) continue;
      const category = clean(k.category) ?? 'other';
      const base = baseCode(k);
      let code = base;
      for (let n = 2; usedCodes.has(code); n++) code = `${base}-${n}`;
      usedCodes.add(code);
      const places = CATEGORY_PLACES[category] ?? 2;
      const data = {
        tenantId: tenant.id,
        code,
        name: clean(k.name) ?? CATEGORY_LABEL[category] ?? 'Номер',
        description: clean(k.description),
        baseOccupancy: places,
        maxOccupancy: places,
        basePrice: k.priceForAirline ?? k.price ?? 0,
        sortOrder: ++order,
      };
      typesCreated++;
      report.push(`${tenant.name}: + категория «${data.name}» (${code})`);
      if (dry) {
        typeMap[kindId] = `dry:${code}`;
        continue;
      }
      const t = await prisma.roomType.create({ data });
      typeMap[kindId] = t.id;
    }

    // ── Номера ──
    const pmsRooms = await prisma.room.findMany({ where: { tenantId: tenant.id } });
    const pmsByNumber = new Map(pmsRooms.map((r) => [r.number.toLowerCase(), r]));
    const taken = new Set(pmsByNumber.keys());
    /* Номера прежнего переноса, которых в свежем дампе нет: номер в PMS — по
       правилу суффиксов hotels.ts в порядке того дампа. Ключ — ярлык. */
    const goneByLabel = new Map<string, { id: string; number: string }[]>();
    const seenBase = new Set<string>();
    for (const r of baseRoomsByHotel.get(legacyHotelId) ?? []) {
      const label = clean(r.name);
      if (!label) continue;
      let number = label;
      for (let n = 2; seenBase.has(number.toLowerCase()); n++) number = `${label} (${n})`;
      seenBase.add(number.toLowerCase());
      if (freshRoomIds.has(oid(r._id))) continue;
      const pms = pmsByNumber.get(number.toLowerCase());
      if (!pms) continue; // переименован или удалён в PMS — не наш
      if (Object.values(roomMap).includes(pms.id)) continue; // уже занят новым номером
      const key = label.toLowerCase();
      (goneByLabel.get(key) ?? goneByLabel.set(key, []).get(key)!).push({ id: pms.id, number: pms.number });
    }
    let fallbackId: string | null = null;
    const fallback = async () => {
      if (fallbackId) return fallbackId;
      const found = byCode.get('IMPORTED');
      fallbackId =
        found?.id ??
        (dry
          ? 'dry:IMPORTED'
          : (
              await prisma.roomType.create({
                data: {
                  tenantId: tenant.id,
                  code: 'IMPORTED',
                  name: 'Без категории (перенос)',
                  baseOccupancy: 2,
                  maxOccupancy: 2,
                  basePrice: 0,
                  sortOrder: 999,
                },
              })
            ).id);
      return fallbackId;
    };
    let added = 0;
    let reused = 0;
    for (const r of roomsByHotel.get(legacyHotelId) ?? []) {
      if (baseRoomIds.has(oid(r._id)) || roomMap[oid(r._id)!]) continue;
      const label = clean(r.name);
      if (!label) {
        report.push(`${tenant.name}: номер без ярлыка пропущен (${oid(r._id)})`);
        continue;
      }
      const roomTypeId = typeMap[oid(r.roomKindId) ?? ''] ?? (await fallback());
      const roomData = {
        roomTypeId,
        capacity: intOf(r.places) ?? 1,
        isActive: r.active ?? true,
        notes: clean(r.description),
      };
      // Пересобранный фонд: новый номер занимает запись удалённого с тем же ярлыком.
      const replaced = goneByLabel.get(label.toLowerCase())?.shift();
      if (replaced) {
        reused++;
        roomsReused++;
        if (!dry) await prisma.room.update({ where: { id: replaced.id }, data: roomData });
        roomMap[oid(r._id)!] = replaced.id;
        continue;
      }
      let number = label;
      for (let n = 2; taken.has(number.toLowerCase()); n++) number = `${label} (${n})`;
      if (number !== label) roomsRenumbered++;
      taken.add(number.toLowerCase());
      roomsCreated++;
      added++;
      if (dry) continue;
      const created = await prisma.room.create({ data: { tenantId: tenant.id, number, ...roomData } });
      roomMap[oid(r._id)!] = created.id;
    }
    // Удалённые в старой системе без замены — выключить, не удалять.
    let off = 0;
    for (const list of goneByLabel.values()) {
      for (const g of list) {
        const pms = pmsRooms.find((x) => x.id === g.id);
        if (!pms?.isActive) continue;
        off++;
        roomsOff++;
        if (!dry) await prisma.room.update({ where: { id: g.id }, data: { isActive: false } });
      }
    }
    if (added || reused || off) {
      report.push(`${tenant.name}: + номеров ${added}, заняли места удалённых ${reused}, выключено удалённых ${off}`);
    }
  }

  if (!dry) {
    writeFileSync(join(DATA, 'room-type-map.json'), JSON.stringify(typeMap, null, 1), 'utf8');
    writeFileSync(join(DATA, 'room-map.json'), JSON.stringify(roomMap, null, 1), 'utf8');
  }
  const summary = [
    `Категорий заведено: ${typesCreated}`,
    `Номеров заведено: ${roomsCreated}${roomsRenumbered ? ` (с суффиксом из-за занятого ярлыка: ${roomsRenumbered})` : ''}`,
    `Номеров заняли запись удалённого с тем же ярлыком: ${roomsReused}`,
    `Номеров выключено (удалены в старой системе, замены нет): ${roomsOff}`,
    `Категорий старой системы сопоставлено: ${Object.keys(typeMap).length}`,
    `Удалено в старой системе (в PMS оставлено): категорий ${kindsGone}`,
  ];
  writeFileSync(
    join(DATA, '..', 'hotel-additions-report.md'),
    ['# Добор категорий и номеров' + (dry ? ' (пробный прогон)' : ''), '', ...summary, '', ...report.map((l) => `- ${l}`)].join('\n'),
    'utf8',
  );
  console.log((dry ? '── ПРОБНЫЙ ПРОГОН ──\n' : '── ГОТОВО ──\n') + summary.join('\n'));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
