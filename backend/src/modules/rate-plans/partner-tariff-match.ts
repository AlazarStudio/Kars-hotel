/* ВЫБОР КОРПОРАТИВНОГО ТАРИФА ПАРТНЁРА (29.09.2026).
 *
 * У гостиницы может быть несколько корпоративных тарифов для одного партнёра:
 * «Космос» (Мурманск) даёт свою цену «России» и «Смартавиа», эстафетному
 * экипажу и сбойному рейсу, и двум юрлицам партнёра. Каждый тариф говорит,
 * к чему он применяется; пустое условие — «к любому».
 *
 * Правило одно на наличие, бронь и проверку — в одном месте, как у
 * подбора цены в договоре партнёра: подходит тариф, чьи условия не
 * противоречат запросу; из подходящих берутся самые ТОЧНЫЕ (заказчик весит
 * больше юрлица, юрлицо — больше вида брони). Тарифы одной точности
 * различаются питанием — их выбирает человек.
 */

export type GuestKindCode = 'CREW' | 'DISRUPTION';

/** Условия применения тарифа. null — «для любого». */
export interface PartnerPlanScope {
  id: string;
  partnerId: string | null;
  partnerAccountId: string | null;
  partnerCustomerId: string | null;
  guestKind: GuestKindCode | null;
  isActive: boolean;
}

/** Кого селят: партнёр запроса и, если назвал, юрлицо, заказчик, вид брони. */
export interface PartnerPlanQuery {
  partnerId: string;
  accountId?: string | null;
  customerId?: string | null;
  guestKind?: GuestKindCode | null;
}

/** Точность тарифа: заказчик 4, юрлицо 2, вид брони 1. */
export function planSpecificity(p: PartnerPlanScope): number {
  return (p.partnerCustomerId ? 4 : 0) + (p.partnerAccountId ? 2 : 0) + (p.guestKind ? 1 : 0);
}

/** Подходит ли тариф запросу: каждое заданное условие совпадает. */
export function planMatches(p: PartnerPlanScope, q: PartnerPlanQuery): boolean {
  if (!p.isActive || !p.partnerId || p.partnerId !== q.partnerId) return false;
  if (p.partnerAccountId && p.partnerAccountId !== (q.accountId ?? null)) return false;
  if (p.partnerCustomerId && p.partnerCustomerId !== (q.customerId ?? null)) return false;
  if (p.guestKind && p.guestKind !== (q.guestKind ?? null)) return false;
  return true;
}

/**
 * Тарифы для запроса: подходящие и самые точные из них. Пусто — у гостиницы
 * для этого партнёра и этих условий тарифа нет.
 */
export function pickPartnerPlans<T extends PartnerPlanScope>(plans: T[], q: PartnerPlanQuery): T[] {
  const fit = plans.filter((p) => planMatches(p, q));
  if (!fit.length) return [];
  const best = Math.max(...fit.map(planSpecificity));
  return fit.filter((p) => planSpecificity(p) === best);
}
