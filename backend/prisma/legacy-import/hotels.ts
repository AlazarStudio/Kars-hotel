import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { PrismaClient } from '@prisma/client';

/* Подключение берём из backend/.env сами: пакета dotenv в PMS нет, а тащить
 * зависимость ради разового скрипта незачем. Приоритет у миграционного
 * подключения (postgres): импорт пишет напрямую в таблицы, минуя RLS-контекст
 * приложения, который рассчитан на работу «внутри одного тенанта». */
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

/* Перенос гостиниц из старой системы Kars Avia в PMS.
 *
 * Гостиницы живут ЗДЕСЬ (в PMS каждая гостиница — тенант), а не в Kars Avia:
 * там от гостиницы остаётся только партнёрский профиль с договорами и ссылка
 * по slug. Поэтому импорт двусторонний, и эта половина — первая: пока в PMS
 * нет тенантов, договорам в Kars Avia не к чему привязываться.
 *
 *   Hotel     (392)   → Tenant    — карточка гостиницы, slug по правилам PMS
 *   RoomKind  (1376)  → RoomType  — категории номеров с ценой и вместимостью
 *   Room      (11565) → Room      — номерной фонд
 *
 * Запуск (из backend/):
 *   npx tsx prisma/legacy-import/hotels.ts --data="<путь к airlines-export>" [--dry]
 *
 * Данные берутся из JSON-выгрузки дампа старой системы (см. README переноса в
 * репозитории Kars Avia). По итогам пишется `hotel-slug-map.json` — карта
 * «id гостиницы в старой системе → slug в PMS»; по ней вторая половина
 * переноса привяжет партнёрские профили и договоры.
 *
 * Идемпотентность: гостиница ищется по имени и городу (в старой системе
 * идентификатора, который переживёт перенос, нет), тип номера — по паре
 * тенант+код, номер — по паре тенант+номер. Повторный прогон обновляет.
 */

interface LegacyHotel {
  _id: { $oid: string } | string;
  airportId?: { $oid: string } | string | null;
  name?: string | null;
  nameFull?: string | null;
  stars?: string | number | null;
  active?: boolean;
  show?: boolean;
  capacity?: number | null;
  airportDistance?: string | number | null;
  information?: { city?: string | null; address?: string | null } | null;
  breakfast?: { start?: string; end?: string } | null;
  lunch?: { start?: string; end?: string } | null;
  dinner?: { start?: string; end?: string } | null;
}

interface LegacyAirport {
  _id: { $oid: string } | string;
  code?: string | null;
}

interface LegacyRoomKind {
  _id: { $oid: string } | string;
  hotelId?: { $oid: string } | string | null;
  name?: string | null;
  description?: string | null;
  category?: string | null;
  price?: number | null;
  priceForAirline?: number | null;
  square?: string | null;
  roomsCount?: number | null;
}

interface LegacyRoom {
  _id: { $oid: string } | string;
  hotelId?: { $oid: string } | string | null;
  roomKindId?: { $oid: string } | string | null;
  name?: string | null;
  category?: string | null;
  places?: number | null;
  active?: boolean;
  reserve?: boolean;
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

/* Slug по тем же правилам, что в PMS (auth/slug.util.ts): гостиница,
 * заведённая импортом, и гостиница, заведённая партнёром, должны получать
 * одинаковый адрес. Таблица продублирована сознательно — скрипт разовый и не
 * должен тянуть за собой половину Nest-приложения. */
const RU: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};
function slugify(name: string): string {
  let out = '';
  for (const ch of name.toLowerCase()) {
    if (RU[ch] !== undefined) out += RU[ch];
    else if (/[a-z0-9]/.test(ch)) out += ch;
    else if (/\s|[-_.]/.test(ch)) out += '-';
  }
  out = out.replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  if (out.length > 32) out = out.slice(0, 32).replace(/-+$/g, '');
  if (!out || !/^[a-z0-9]/.test(out)) out = 'hotel';
  return out;
}

/** Вместимость категории старой системы: onePlace → 1 место и так далее. */
const CATEGORY_PLACES: Record<string, number> = {
  onePlace: 1, twoPlace: 2, threePlace: 3, fourPlace: 4, fivePlace: 5,
  sixPlace: 6, sevenPlace: 7, eightPlace: 8, ninePlace: 9, tenPlace: 10,
  apartment: 2, studio: 2, luxe: 2, comfort: 2, improvedComfort: 2,
};
/** Человеческое имя категории — на случай, если у типа номера нет названия. */
const CATEGORY_LABEL: Record<string, string> = {
  onePlace: 'Одноместный', twoPlace: 'Двухместный', threePlace: 'Трёхместный',
  fourPlace: 'Четырёхместный', fivePlace: 'Пятиместный', sixPlace: 'Шестиместный',
  sevenPlace: 'Семиместный', eightPlace: 'Восьмиместный', ninePlace: 'Девятиместный',
  tenPlace: 'Десятиместный', apartment: 'Апартаменты', studio: 'Студия',
  luxe: 'Люкс', comfort: 'Комфорт', improvedComfort: 'Улучшенный комфорт',
};

/* Адрес для сверки: «ул. Ленина 21» и «ул. Ленина, д. 21» — один дом, а
 * «Лядова 2А» и «Серпуховская 34в» — разные гостиницы одной сети. Убираем
 * формальные части («улица», «дом», «корпус»), знаки и пробелы, приводим к
 * нижнему регистру; сравнивается то, что осталось. */
function normalizeAddress(v: string | null | undefined): string {
  return String(v ?? '')
    .toLowerCase()
    .replace(/\b(г|город|ул|улица|д|дом|корп|корпус|стр|строение|пр|проспект|пер|переулок|бульвар|б-р|кв|квартира|литер[а]?)\b\.?/g, ' ')
    .replace(/[^a-zа-яё0-9]/gi, '');
}

/** «07:00»+«10:00» → «07:00–10:00»; PMS хранит окно питания строкой. */
const mealWindow = (w: { start?: string; end?: string } | null | undefined) => {
  const s = clean(w?.start);
  const e = clean(w?.end);
  if (!s && !e) return null;
  return s && e ? `${s}–${e}` : (s ?? e);
};

const prisma = new PrismaClient({
  datasources: { db: { url: loadDatabaseUrl() } },
});

function arg(name: string): string | null {
  const p = process.argv.find((a) => a.startsWith(`--${name}=`));
  return p ? p.slice(name.length + 3) : null;
}

async function main() {
  const dry = process.argv.includes('--dry');
  const dataDir =
    arg('data') ??
    'D:/GitHub/Kars avia v3/info-for-dev/Бэкап из старой системы/airlines-export';
  const read = <T,>(f: string): T[] =>
    JSON.parse(readFileSync(join(dataDir, f), 'utf8'));

  const hotels = read<LegacyHotel>('Hotel.json');
  const kinds = read<LegacyRoomKind>('RoomKind.json');
  const rooms = read<LegacyRoom>('Room.json');
  /* Аэропорт гостиницы: в старой системе ссылка на справочник, в PMS — код
     IATA. Без него операторский каталог не может отобрать гостиницы под
     аэропорт заявки, а это основной способ выбора при размещении экипажа. */
  const airports = read<LegacyAirport>('Airport.json');
  const airportCodeById = new Map(
    airports.map((a) => [oid(a._id) ?? '', clean(a.code)?.toUpperCase() ?? null]),
  );

  console.log(
    `Гостиниц ${hotels.length}, категорий ${kinds.length}, номеров ${rooms.length}` +
      (dry ? '  (ПРОБНЫЙ ПРОГОН)' : ''),
  );

  const kindsByHotel = new Map<string, LegacyRoomKind[]>();
  for (const k of kinds) {
    const h = oid(k.hotelId);
    if (!h) continue;
    (kindsByHotel.get(h) ?? kindsByHotel.set(h, []).get(h)!).push(k);
  }
  const roomsByHotel = new Map<string, LegacyRoom[]>();
  for (const r of rooms) {
    const h = oid(r.hotelId);
    if (!h) continue;
    (roomsByHotel.get(h) ?? roomsByHotel.set(h, []).get(h)!).push(r);
  }

  const slugMap: Record<string, { slug: string; name: string; city: string | null }> = {};
  const usedSlugs = new Set<string>(
    (await prisma.tenant.findMany({ select: { slug: true } })).map((t) => t.slug),
  );

  let created = 0;
  let updated = 0;
  let typesTotal = 0;
  let roomsTotal = 0;
  let roomsSkipped = 0;
  let renumbered = 0;
  let noName = 0;

  for (const h of hotels) {
    const legacyId = oid(h._id)!;
    const name = clean(h.name) ?? clean(h.nameFull);
    if (!name) {
      noName++;
      continue;
    }
    const city = clean(h.information?.city);

    /* Идентификатора старой системы в PMS нет, поэтому сверяем по имени,
       городу И АДРЕСУ. Адрес здесь не педантизм: «Авангард» в Пензе — это три
       разные гостиницы на трёх улицах, а «Жемчужина Кавказа» дважды заведена
       по одному адресу с разным написанием («ул. Ленина 21» / «ул. Ленина д.
       21»). Без адреса первые схлопнулись бы в одну, потеряв два фонда;
       со строгим сравнением адреса вторые задвоились бы. Поэтому адрес
       сравнивается нормализованным — без «ул.», «д.», пробелов и запятых. */
    const addr = clean(h.information?.address);
    const addrKey = normalizeAddress(addr);
    const sameNameCity = await prisma.tenant.findMany({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(city ? { city: { equals: city, mode: 'insensitive' } } : {}),
      },
    });
    const existing =
      sameNameCity.find((t) => normalizeAddress(t.address) === addrKey) ??
      // Адреса нет ни там, ни там — считаем совпадением по имени и городу.
      (addrKey === '' ? sameNameCity[0] : undefined) ??
      undefined;

    let slug = existing?.slug ?? slugify(name);
    if (!existing) {
      const base = slug;
      for (let n = 2; usedSlugs.has(slug); n++) slug = `${base}-${n}`;
      usedSlugs.add(slug);
    }
    slugMap[legacyId] = { slug, name, city };

    const data = {
      name,
      city,
      address: clean(h.information?.address),
      /* Звёзды: в PMS колонка ограничена 1..5, а в старой системе встречаются
         «0» и мусор — это «не указано», а не «ноль звёзд». Иначе импорт падает
         на CHECK посреди прогона. */
      stars: (() => {
        const n = intOf(h.stars);
        return n != null && n >= 1 && n <= 5 ? n : null;
      })(),
      capacity: (() => {
        const n = intOf(h.capacity);
        return n != null && n > 0 ? n : null;
      })(),
      // «Сколько ехать до аэропорта» в старой системе — свободное число без
      // единицы. Кладём в минуты: PMS считает время подачи, а не километраж.
      airportMinutes: intOf(h.airportDistance),
      airportCode: airportCodeById.get(oid(h.airportId) ?? '') ?? null,
      mealBreakfast: mealWindow(h.breakfast),
      mealLunch: mealWindow(h.lunch),
      mealDinner: mealWindow(h.dinner),
      isActive: h.active ?? true,
      // `show` старой системы = «предлагать в каталоге» = partnerVisible.
      partnerVisible: h.show ?? true,
      // Перенесённые гостиницы не разовые: они пришли из каталога, а не из
      // ночного сбоя. Разовость — признак записи, заведённой на один случай.
      provisional: false,
    };

    if (dry) {
      existing ? updated++ : created++;
      typesTotal += (kindsByHotel.get(legacyId) ?? []).length;
      roomsTotal += (roomsByHotel.get(legacyId) ?? []).length;
      continue;
    }

    const tenant = existing
      ? await prisma.tenant.update({ where: { id: existing.id }, data })
      : await prisma.tenant.create({ data: { slug, ...data } });
    existing ? updated++ : created++;

    // ── Категории номеров ──
    const typeIdByLegacy = new Map<string, string>();
    const usedCodes = new Set<string>();
    let order = 0;
    for (const k of kindsByHotel.get(legacyId) ?? []) {
      const kindLegacyId = oid(k._id)!;
      const category = clean(k.category) ?? 'other';
      const typeName =
        clean(k.name) ?? CATEGORY_LABEL[category] ?? 'Номер';
      /* Код типа уникален в пределах гостиницы. Берём категорию старой
         системы, а при повторе — с суффиксом: у отеля бывает несколько
         «двухместных» с разной ценой и оснащением, и затирать их друг другом
         нельзя — номера потеряют свой тип. */
      const base = category.toUpperCase().slice(0, 20);
      let code = base;
      for (let n = 2; usedCodes.has(code); n++) code = `${base}-${n}`;
      usedCodes.add(code);

      const places = CATEGORY_PLACES[category] ?? 2;
      const typeData = {
        name: typeName,
        description: clean(k.description),
        baseOccupancy: places,
        maxOccupancy: places,
        // Цена для авиакомпании — то, по чему гостиницу и выбирают; обычная
        // цена остаётся запасным вариантом.
        basePrice: k.priceForAirline ?? k.price ?? 0,
        sortOrder: order++,
      };
      const existingType = await prisma.roomType.findUnique({
        where: { tenantId_code: { tenantId: tenant.id, code } },
      });
      const type = existingType
        ? await prisma.roomType.update({
            where: { id: existingType.id },
            data: typeData,
          })
        : await prisma.roomType.create({
            data: { tenantId: tenant.id, code, ...typeData },
          });
      typeIdByLegacy.set(kindLegacyId, type.id);
      typesTotal++;
    }

    // Запасной тип: у части номеров категории нет вовсе, а Room без типа в
    // PMS не существует.
    let fallbackTypeId: string | null = null;
    const ensureFallback = async () => {
      if (fallbackTypeId) return fallbackTypeId;
      const code = 'IMPORTED';
      const found = await prisma.roomType.findUnique({
        where: { tenantId_code: { tenantId: tenant.id, code } },
      });
      const t =
        found ??
        (await prisma.roomType.create({
          data: {
            tenantId: tenant.id,
            code,
            name: 'Без категории (перенос)',
            baseOccupancy: 2,
            maxOccupancy: 2,
            basePrice: 0,
            sortOrder: 999,
          },
        }));
      fallbackTypeId = t.id;
      return t.id;
    };

    // ── Номерной фонд ──
    const seenNumbers = new Set<string>();
    for (const r of roomsByHotel.get(legacyId) ?? []) {
      const number = clean(r.name);
      if (!number) {
        roomsSkipped++;
        continue;
      }
      /* Номер уникален в пределах гостиницы, а в старой системе один ярлык
         носят до трёх записей — и это НЕ всегда дубль: у одной «1 (резерв)»
         одно место, у другой три, то есть комнаты разные. Поэтому не
         пропускаем (потеряли бы фонд), а разводим суффиксом: номер остаётся
         узнаваемым, а расхождение видно глазами и правится в PMS.
         Порядок обхода стабилен (порядок в выгрузке), поэтому повторный
         прогон даст те же суффиксы и не наплодит новых комнат. */
      let number2 = number;
      for (let n = 2; seenNumbers.has(number2.toLowerCase()); n++) {
        number2 = `${number} (${n})`;
        renumbered++;
      }
      seenNumbers.add(number2.toLowerCase());
      const finalNumber = number2;

      const roomTypeId =
        typeIdByLegacy.get(oid(r.roomKindId) ?? '') ?? (await ensureFallback());
      const roomData = {
        roomTypeId,
        capacity: intOf(r.places) ?? 1,
        isActive: r.active ?? true,
        notes: clean(r.description),
      };
      const existingRoom = await prisma.room.findUnique({
        where: { tenantId_number: { tenantId: tenant.id, number: finalNumber } },
      });
      if (existingRoom) {
        await prisma.room.update({ where: { id: existingRoom.id }, data: roomData });
      } else {
        await prisma.room.create({
          data: { tenantId: tenant.id, number: finalNumber, ...roomData },
        });
      }
      roomsTotal++;
    }
  }

  const mapPath = join(dataDir, 'hotel-slug-map.json');
  if (!dry) {
    mkdirSync(dirname(mapPath), { recursive: true });
    writeFileSync(mapPath, JSON.stringify(slugMap, null, 1), 'utf8');
  }

  console.log(
    `\nГостиницы: создано ${created}, обновлено ${updated}` +
      (noName ? `, пропущено без названия ${noName}` : ''),
  );
  console.log(`Категорий номеров: ${typesTotal}`);
  console.log(
    `Номеров: ${roomsTotal}` +
      (roomsSkipped ? `, пропущено без номера ${roomsSkipped}` : '') +
      (renumbered
        ? `; с суффиксом «(2)» из-за одинакового ярлыка в старой системе: ${renumbered}`
        : ''),
  );
  if (!dry) console.log(`Карта «legacy id → slug»: ${mapPath}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
