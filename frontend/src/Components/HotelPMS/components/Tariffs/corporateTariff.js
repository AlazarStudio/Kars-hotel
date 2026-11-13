/* Корпоративный тариф для оператора — подсобные правила экрана.
 *
 * Цену договора с 11.11.2026 считает сервер: клиентская раскладка строк
 * удалена — две копии правила расходятся тихо, и расходятся в деньгах. Здесь
 * остаётся то, что экран решает сам: как называются условия и срез, какие
 * числа гостей бывают в колонках, какой тариф воплощает срез договора и какой
 * период договора действует на выбранный день.
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
  const conditions = [
    { label: 'Партнёр', value: partner?.name ?? '—' },
    { label: 'Юрлицо', value: plan.partnerAccountId ? (account?.name ?? 'нет в справочнике') : 'любое' },
    { label: 'Авиакомпания', value: plan.partnerCustomerId ? (customer?.name ?? 'нет в справочнике') : 'любая' },
    { label: 'Бронь', value: plan.guestKind ? GUEST_KIND_LABELS[plan.guestKind] ?? plan.guestKind : 'любая' },
  ];
  /* У корпоративного тарифа НДС берётся из договора и показан на вкладке «Цены
     договора»: своя ставка тарифа к цене договора не относится, а на карточке
     читалась бы как условие цены. У своих тарифов остаётся как была. */
  if (!plan.forOperator) {
    conditions.push({
      label: 'НДС',
      value: plan.vatRate != null ? `${Number(plan.vatRate)}%` : 'без НДС',
    });
  }
  return conditions;
}

/* Как срез договора называется словами: авиакомпания, вид брони, питание.
   Договор называет условия кодами справочника партнёра, тариф — теми же
   кодами, а слова нужны только человеку. */
export const MEAL_PLAN_SHORT = {
  NONE: 'без питания',
  BB: 'завтрак',
  HB: 'полупансион',
  FB: 'полный пансион',
  AI: 'всё включено',
};

export const GUEST_KIND_SHORT = { CREW: 'экипаж', DISRUPTION: 'сбойный рейс' };

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

/** Период договора, который действует на день: последний начавшийся не позже, иначе первый. */
export function periodOn(periods, today) {
  /* Риск: экран открывается без выбранного периода, сервер по умолчанию
     отвечает сегодняшним днём, а подпись селектора берётся у первой ДС —
     одна сетка цен показалась бы под подписью другой. Поэтому день выбираем
     по ДС, которая на него действительно действует. */
  const key = (p) => String(p).slice(0, 10);
  /* Копия: список ДС пришёл с сервера и этот же порядок читает селектор,
     сортировать массив вызывающего нельзя. */
  const list = [...(periods ?? [])].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  if (!list.length) return null;
  const todayKey = key(today);
  /* Первая ДС — запасной вариант для дня до начала договора: до первой сетки
     действовать нечему, но пустой выбор снова показал бы чужую подпись. */
  let actual = list[0];
  for (const p of list) {
    if (key(p) <= todayKey) actual = p;
  }
  return actual;
}
