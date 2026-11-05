import { mealCostOf, mealTermsOf, mealsOfPlan } from './meal-terms';

/* 5.3 · питание тарифа. Отрицанием: питание «в цене номера» НЕ даёт отдельной
 * стоимости; приём пищи, которого нет в варианте, НЕ считается. */
const base = {
  mealPlan: 'BB',
  mealIncluded: false,
  mealPriceBreakfast: 500,
  mealPriceLunch: 700,
  mealPriceDinner: 900,
  mealPricePerDay: null,
  allInclusiveNote: null,
};

describe('питание тарифа', () => {
  it('варианты: завтрак, полупансион — завтрак и ужин, полный пансион — три приёма', () => {
    expect(mealsOfPlan('BB')).toEqual(['breakfast']);
    expect(mealsOfPlan('HB')).toEqual(['breakfast', 'dinner']);
    expect(mealsOfPlan('FB')).toEqual(['breakfast', 'lunch', 'dinner']);
    expect(mealsOfPlan('NONE')).toEqual([]);
  });

  it('«с завтраком, 500 ₽ на гостя отдельно»: обеда в цене НЕТ', () => {
    expect(mealTermsOf(base).perMeal).toEqual({ breakfast: 500 });
    expect(mealCostOf(base, { breakfast: 4, lunch: 4, dinner: 0 }, 4)).toBe(2000);
  });

  it('питание в цене номера — отдельной стоимости НЕТ', () => {
    expect(mealCostOf({ ...base, mealIncluded: true }, { breakfast: 4, lunch: 0, dinner: 0 }, 4)).toBeNull();
  });

  it('одной суммой за сутки — по гостям-суткам', () => {
    const p = { ...base, mealPlan: 'FB', mealPricePerDay: 1500 };
    expect(mealTermsOf(p).perMeal).toBeNull();
    expect(mealCostOf(p, { breakfast: 2, lunch: 2, dinner: 2 }, 2)).toBe(3000);
  });

  it('цены не заведены — null, а НЕ ноль', () => {
    expect(mealCostOf({ ...base, mealPriceBreakfast: null }, { breakfast: 3, lunch: 0, dinner: 0 }, 3)).toBeNull();
  });

  it('«что входит» — только у «всё включено»', () => {
    expect(mealTermsOf({ ...base, mealPlan: 'AI', allInclusiveNote: 'бар до 23:00' }).allInclusiveNote).toBe('бар до 23:00');
    expect(mealTermsOf({ ...base, allInclusiveNote: 'бар' }).allInclusiveNote).toBeNull();
  });
});
