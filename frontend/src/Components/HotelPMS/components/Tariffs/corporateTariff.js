/* Корпоративный тариф для оператора — подсобные правила экрана.
 *
 * Заполнение «по договору» намеренно НЕ сохраняет цены само: оно раскладывает
 * их по полям, а нажимает «Сохранить» человек. Гостиница отвечает за свои
 * ставки, и подставить их молча значит расписаться за неё.
 */

/** Вид брони — условие тарифа партнёра (29.09.2026). */
export const GUEST_KIND_LABELS = {
  CREW: 'Экипаж — эстафета, командировка',
  DISRUPTION: 'Сбойный рейс',
};

export const VAT_RATES = [0, 5, 7, 10, 20, 22];

/** Ключ цены в формах: категория и число гостей (0 — на любое). */
export const priceKey = (roomTypeId, occupancy) => `${roomTypeId}|${occupancy}`;

export function occupancyLabel(n) {
  if (n === 0) return 'любое число гостей';
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word = mod10 === 1 && mod100 !== 11
    ? 'гостя'
    : 'гостей';
  return `${n} ${word}`;
}

/* Колонки цен тарифа. Свой тариф гостиницы — одна цена на категорию, как
   было. Тариф партнёра — по числу гостей до вместимости самой большой
   категории, плюс «на любое» для цены, от гостей не зависящей. */
export function occupancyColumns(plan, roomTypes) {
  if (!plan?.partnerId) return [0];
  const max = Math.min(6, Math.max(1, ...roomTypes.map((rt) => rt.maxOccupancy ?? 2)));
  return [0, ...Array.from({ length: max }, (_, i) => i + 1)];
}

/* Строки цен на выбранное число гостей — так, как их выбирает сервер:
   точное число, иначе «на любое». Без числа гостей — все строки как есть. */
export function pickOccupancy(rows, occupancy, groupKey) {
  if (!occupancy) return rows;
  const exact = new Set(rows.filter((r) => r.occupancy === occupancy).map(groupKey));
  return rows.filter((r) => r.occupancy === occupancy || ((r.occupancy ?? 0) === 0 && !exact.has(groupKey(r))));
}

/** Условия тарифа партнёра — подписями для шапки. */
export function partnerConditions(plan, partners) {
  const partner = (partners ?? []).find((p) => p.id === plan.partnerId);
  const account = partner?.accounts?.find((a) => a.id === plan.partnerAccountId);
  const customer = partner?.customers?.find((c) => c.id === plan.partnerCustomerId);
  return [
    { label: 'Партнёр', value: partner?.name ?? '—' },
    { label: 'Юрлицо', value: plan.partnerAccountId ? (account?.name ?? 'нет в справочнике') : 'любое' },
    { label: 'Авиакомпания', value: plan.partnerCustomerId ? (customer?.name ?? 'нет в справочнике') : 'любая' },
    { label: 'Бронь', value: plan.guestKind ? GUEST_KIND_LABELS[plan.guestKind] ?? plan.guestKind : 'любая' },
    { label: 'НДС', value: plan.vatRate != null ? `${Number(plan.vatRate)}%` : 'без НДС' },
  ];
}

export const STATE_LABEL = {
  DRAFT: 'Не проверен',
  CONFIRMED: 'Подтверждён оператором',
  REJECTED: 'Не подтверждён',
  STALE: 'Требует повторной проверки',
};

/** Строки приложений ОДНОГО договора по проживанию, свежие поверх старых.
 *
 * Приложений у договора несколько — исходное и ДС. По одной категории они
 * говорят разное, и правым считается позднейшее: ДС правит договор. */
export function accommodationRows(sheets, contractNumber) {
  if (!contractNumber) return [];
  const mine = (sheets ?? [])
    .filter((s) => s.contractNumber === contractNumber && s.service === 'ACCOMMODATION')
    .sort((a, b) => String(a.validFrom).localeCompare(String(b.validFrom)));

  const byKey = new Map();
  for (const sheet of mine) {
    for (const row of sheet.rows ?? []) {
      const key = row.categoryId ?? (row.categoryName ?? '').trim().toLowerCase();
      if (!key) continue;
      byKey.set(key, { ...row, sheet });
    }
  }
  return [...byKey.values()];
}

const norm = (s) => (s ?? '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');

/* Раскладка строк договора по категориям номеров.
 *
 * Сперва по идентификатору категории — оператор его присылает, когда строка
 * привязана к категории PMS, и это точное совпадение. Название — запасной
 * путь: у него нет ничего, кроме похожести, поэтому несопоставленное честно
 * возвращается списком, а не пропадает. Тихо потерянная строка договора здесь
 * означала бы категорию, которую посчитают не по договору. */
export function matchContractRows(rows, roomTypes) {
  const byId = new Map(roomTypes.map((rt) => [rt.id, rt]));
  const byName = new Map(roomTypes.map((rt) => [norm(rt.name), rt]));

  const prices = {};
  const unmatched = [];
  for (const row of rows) {
    const rt = (row.categoryId && byId.get(row.categoryId)) || byName.get(norm(row.categoryName));
    if (!rt) {
      unmatched.push(row);
      continue;
    }
    // «По запросу» — не ноль: цена есть, но называется в переписке. Подставить
    // ноль значило бы пообещать бесплатное проживание.
    if (row.onRequest || row.priceNet == null) {
      unmatched.push(row);
      continue;
    }
    prices[rt.id] = String(row.priceNet / 100);
  }
  const uncovered = roomTypes.filter((rt) => prices[rt.id] === undefined);
  return { prices, unmatched, uncovered };
}

/* ─────────────────────────────────────────────────────────────────────────
 * СРЕЗ ДОГОВОРА ПОД ТАРИФ (29.09.2026, Э3).
 *
 * Договор партнёра — не «категория → цена»: строка это класс номера × число
 * гостей × питание × для кого × авиакомпания, а документов несколько (договор
 * и ДС с разными сроками). Тариф гостиницы — один срез этого договора: его
 * юрлицо, авиакомпания, вид брони и питание. Здесь решается, какие строки
 * ложатся в тариф и — главное — почему остальные НЕ легли: молча пропущенная
 * строка это категория, которую посчитают не по договору.
 * ───────────────────────────────────────────────────────────────────────── */

export const MEAL_PLAN_SHORT = {
  NONE: 'без питания',
  BB: 'завтрак',
  HB: 'полупансион',
  FB: 'полный пансион',
  AI: 'всё включено',
};

export const GUEST_KIND_SHORT = { CREW: 'экипаж', DISRUPTION: 'сбойный рейс' };

const day = (v) => String(v ?? '').slice(0, 10);
const MISSING = '\u0000нет в справочнике';

/** Документы проживания договора тарифа — его номера и его партнёра. */
export function planDocs(sheets, plan) {
  if (!plan?.operatorContract) return [];
  return (sheets ?? []).filter(
    (s) =>
      s.service === 'ACCOMMODATION' &&
      s.contractNumber === plan.operatorContract &&
      (!plan.partnerId || !s.partnerId || s.partnerId === plan.partnerId),
  );
}

/** Документы, действующие в день `d` (YYYY-MM-DD), старые раньше свежих. */
export function docsAt(docs, d) {
  return docs
    .filter((s) => day(s.validFrom) <= d && (!s.validTo || day(s.validTo) >= d))
    .sort((a, b) => day(a.validFrom).localeCompare(day(b.validFrom)));
}

/** Условия тарифа — кодами справочника партнёра (так их называет договор). */
export function planSlice(plan, partners) {
  const partner = (partners ?? []).find((p) => p.id === plan.partnerId);
  const code = (list, id) => (id ? list?.find((x) => x.id === id)?.code ?? MISSING : null);
  return {
    account: code(partner?.accounts, plan.partnerAccountId),
    customer: code(partner?.customers, plan.partnerCustomerId),
    guestKind: plan.guestKind ?? null,
    mealPlan: plan.mealPlan ?? 'NONE',
  };
}

/* Почему строка не ложится в тариф; null — ложится.
   Общая строка (без авиакомпании, без вида брони) подходит частному тарифу;
   частная строка общему — нет: цена «для Азимута» не цена «для всех». */
export function rowMismatch(row, doc, slice) {
  if (slice.account && doc.account?.code && doc.account.code !== slice.account) return 'другое юрлицо';
  const customer = row.customer?.code ?? null;
  if (customer && customer !== slice.customer) return 'для другой авиакомпании';
  const kind = row.guestKind ?? null;
  if (kind && kind !== slice.guestKind) return 'для другого вида брони';
  if ((row.mealPlan ?? 'NONE') !== slice.mealPlan) {
    return `с питанием «${MEAL_PLAN_SHORT[row.mealPlan] ?? row.mealPlan}»`;
  }
  if (row.onRequest || row.priceNet == null) return 'цена по запросу';
  return null;
}

/* Категории гостиницы строки: подобранные партнёром (по его классу номера),
   иначе — по названию. Партнёр назвал категории, а их у гостиницы нет —
   значит нет: угадывать по названию поверх его решения нельзя. */
export function rowRoomTypes(row, roomTypes) {
  const byId = new Map(roomTypes.map((rt) => [rt.id, rt]));
  const ids = row.categoryIds?.length ? row.categoryIds : row.categoryId ? [row.categoryId] : [];
  if (ids.length) return ids.map((id) => byId.get(id)).filter(Boolean);
  const rt = roomTypes.find((r) => norm(r.name) === norm(row.categoryName));
  return rt ? [rt] : [];
}

/** Как назвать строку договора человеку. */
export function rowLabel(row) {
  return row.docName || row.categoryName || row.className || row.mealKind || '—';
}

/* Цены среза на день `date`: ключ «категория|гости» → рубли строкой.
 *
 * Документов на день бывает несколько (договор и ДС): свежий бьёт старый.
 * Частная строка (для этой авиакомпании, для этого вида брони) бьёт общую
 * независимо от свежести — так же считает и партнёр. Цена за место
 * раскладывается по числу гостей: за двоих — вдвое. */
export function sliceCells(docs, slice, roomTypes, date) {
  const effective = docsAt(docs, date);
  const cells = new Map();
  const skipped = [];
  effective.forEach((doc, docIdx) => {
    for (const row of doc.rows ?? []) {
      const reason = rowMismatch(row, doc, slice);
      if (reason) {
        skipped.push({ row, doc, reason });
        continue;
      }
      const rts = rowRoomTypes(row, roomTypes);
      if (!rts.length) {
        skipped.push({ row, doc, reason: 'такой категории у гостиницы нет' });
        continue;
      }
      const score = (row.customer ? 2 : 0) + (row.guestKind ? 1 : 0);
      for (const rt of rts) {
        const cap = rt.maxOccupancy ?? 1;
        const occs = row.perPerson ? Array.from({ length: cap }, (_, i) => i + 1) : [row.guests ?? 0];
        for (const o of occs) {
          if (o > cap) continue; // цена на двоих одноместному номеру не нужна
          const k = priceKey(rt.id, o);
          const prev = cells.get(k);
          if (!prev || score > prev.score || (score === prev.score && docIdx >= prev.docIdx)) {
            cells.set(k, { kopecks: row.perPerson ? row.priceNet * o : row.priceNet, score, docIdx });
          }
        }
      }
    }
  });
  const prices = Object.fromEntries([...cells].map(([k, v]) => [k, String(v.kopecks / 100)]));
  const covered = new Set([...cells.keys()].map((k) => k.split('|')[0]));
  return {
    prices,
    skipped,
    uncovered: roomTypes.filter((rt) => !covered.has(rt.id)),
    docs: effective,
  };
}

const dayBefore = (d) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
};

/* Периоды договора: день, на который заполняются базовые цены, и сезоны —
   будущие периоды (ДС с другой даты). Договор весь в прошлом — база по его
   последнему периоду: других цифр у гостиницы всё равно нет, и это надо
   сказать словами (`expired`). */
export function contractPeriods(docs, today) {
  const starts = [...new Set(docs.map((d) => day(d.validFrom)))].sort();
  if (!starts.length) return { base: today, expired: false, seasons: [] };
  const live = docsAt(docs, today).length > 0;
  const base = live ? today : (starts.filter((s) => s <= today).pop() ?? starts[0]);
  const future = starts.filter((s) => s > base);
  const seasons = future.map((from, i) => {
    const ends = docsAt(docs, from).map((d) => d.validTo && day(d.validTo)).filter(Boolean).sort();
    let to = future[i + 1] ? dayBefore(future[i + 1]) : (ends[0] ?? '2099-12-31');
    if (ends[0] && ends[0] < to) to = ends[0];
    return { from, to };
  });
  return { base, expired: !live && base < today && !future.length, seasons };
}

/* Срезы договора — какие тарифы он просит у гостиницы: юрлицо договора ×
   авиакомпания × вид брони × питание. По ним гостиница заводит тарифы. */
export function contractSlices(docs) {
  const map = new Map();
  for (const doc of docs) {
    for (const row of doc.rows ?? []) {
      if (row.onRequest || row.priceNet == null) continue;
      const s = {
        account: doc.account ?? null,
        customer: row.customer ?? null,
        guestKind: row.guestKind ?? null,
        mealPlan: row.mealPlan ?? 'NONE',
      };
      const k = `${s.account?.code ?? ''}|${s.customer?.code ?? ''}|${s.guestKind ?? ''}|${s.mealPlan}`;
      if (!map.has(k)) map.set(k, { ...s, key: k, rows: 0 });
      map.get(k).rows += 1;
    }
  }
  return [...map.values()].sort((a, b) => sliceName(a).localeCompare(sliceName(b), 'ru'));
}

/** Название тарифа среза — как его прочтёт человек в списке тарифов. */
export function sliceName(slice) {
  return [
    slice.customer?.name ?? 'Все авиакомпании',
    slice.guestKind ? GUEST_KIND_SHORT[slice.guestKind] : null,
    MEAL_PLAN_SHORT[slice.mealPlan] ?? slice.mealPlan,
  ].filter(Boolean).join(' · ');
}

/* Тариф гостиницы, воплощающий срез договора: тот же партнёр, договор и
   ровно те же условия. «Похожий» не считается — у него другая цена. */
export function planForSlice(plans, slice, partner, contractNumber) {
  const accId = slice.account ? partner?.accounts?.find((a) => a.code === slice.account.code)?.id ?? null : null;
  const custId = slice.customer ? partner?.customers?.find((c) => c.code === slice.customer.code)?.id ?? null : null;
  return (plans ?? []).find(
    (p) =>
      p.isActive &&
      p.partnerId === partner?.id &&
      p.operatorContract === contractNumber &&
      (p.partnerAccountId ?? null) === accId &&
      (p.partnerCustomerId ?? null) === custId &&
      (p.guestKind ?? null) === slice.guestKind &&
      p.mealPlan === slice.mealPlan,
  ) ?? null;
}
