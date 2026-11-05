/* ПИТАНИЕ ТАРИФА (5.3, тестирование 04.11.2026).
 *
 * Питание было только ярлыком `mealPlan` (BB/HB/FB/AI): цену завести было
 * негде, «всё включено» не говорило, что включено. Теперь у тарифа с питанием
 * есть «включено в цену номера» или цена на гостя — по каждому приёму пищи
 * варианта или одной суммой за сутки, на выбор гостиницы.
 *
 * Чистое правило: читают форма (через ответ API), раскладка питания брони и
 * выдача тарифа партнёру (Kars Avia). Деньги — рубли, как везде в PMS.
 */

export type MealPlanCode = 'NONE' | 'BB' | 'HB' | 'FB' | 'AI';
export type Meal = 'breakfast' | 'lunch' | 'dinner';

/** Какие приёмы пищи входят в вариант. */
export function mealsOfPlan(plan: MealPlanCode | string): Meal[] {
  switch (plan) {
    case 'BB':
      return ['breakfast'];
    case 'HB':
      return ['breakfast', 'dinner'];
    case 'FB':
    case 'AI':
      return ['breakfast', 'lunch', 'dinner'];
    default:
      return [];
  }
}

export interface MealTermsInput {
  mealPlan: MealPlanCode | string;
  mealIncluded: boolean;
  mealPriceBreakfast: number | null;
  mealPriceLunch: number | null;
  mealPriceDinner: number | null;
  mealPricePerDay: number | null;
  allInclusiveNote: string | null;
}

/** Условия питания тарифа — словами для ответа API. */
export function mealTermsOf(p: MealTermsInput) {
  const meals = mealsOfPlan(p.mealPlan);
  const included = meals.length === 0 ? true : p.mealIncluded;
  return {
    plan: p.mealPlan,
    meals,
    /** true — питание в цене номера (или его нет вовсе). */
    included,
    /** Цена на гостя за приём пищи (рубли); только входящие в вариант. */
    perMeal: included || p.mealPricePerDay != null
      ? null
      : {
          ...(meals.includes('breakfast') ? { breakfast: p.mealPriceBreakfast } : {}),
          ...(meals.includes('lunch') ? { lunch: p.mealPriceLunch } : {}),
          ...(meals.includes('dinner') ? { dinner: p.mealPriceDinner } : {}),
        },
    /** Одной суммой за сутки на гостя (рубли). */
    perDay: included ? null : p.mealPricePerDay,
    allInclusiveNote: p.mealPlan === 'AI' ? p.allInclusiveNote : null,
  };
}

/**
 * Стоимость питания по раскладке брони: порции по приёмам и число гостей-суток.
 * null — питание в цене номера или цены не заведены (не «бесплатно»).
 */
export function mealCostOf(
  p: MealTermsInput,
  totals: { breakfast: number; lunch: number; dinner: number },
  guestDays: number,
): number | null {
  const t = mealTermsOf(p);
  if (t.included) return null;
  if (t.perDay != null) return t.perDay * guestDays;
  if (!t.perMeal) return null;
  let sum = 0;
  let priced = false;
  for (const m of t.meals) {
    const price = (t.perMeal as Partial<Record<Meal, number | null>>)[m];
    if (price == null) continue;
    sum += price * totals[m];
    priced = true;
  }
  return priced ? sum : null;
}
