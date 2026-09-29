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
