/* Корпоративный тариф для оператора — подсобные правила экрана.
 *
 * Заполнение «по договору» намеренно НЕ сохраняет цены само: оно раскладывает
 * их по полям, а нажимает «Сохранить» человек. Гостиница отвечает за свои
 * ставки, и подставить их молча значит расписаться за неё.
 */

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
