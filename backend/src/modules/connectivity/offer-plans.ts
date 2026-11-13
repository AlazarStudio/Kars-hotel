/** Тарифы партнёра, которые можно предложить: подходят по договору И посчитаны
 *  на эти ночи. Применимость отвечает про день, цена — про весь срок, и
 *  показывать «по договору» цену, посчитанную по своим строкам, нельзя. */
export function offerPlanIds(
  applying: Set<string>,
  prices: Array<{ ratePlanId: string; total: string | null }>,
): Set<string> {
  const priced = new Set(prices.filter((p) => p.total != null).map((p) => p.ratePlanId));
  return new Set([...applying].filter((id) => priced.has(id)));
}
