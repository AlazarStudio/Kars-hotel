/* СРЕЗ ДОГОВОРА И ТАРИФ ПО НЕМУ — проверки.
 *
 * Запуск: `npm test` (встроенный `node --test`, без зависимостей).
 *
 * С 11.11.2026 цену договора считает сервер, а клиентская раскладка строк
 * (`fillGrid`, `sliceCells`, `contractPeriods`, `contractSlices`) удалена.
 * Здесь остаётся то, что экран решает сам: как называется срез и какой тариф
 * его воплощает. Ошибка тут тихая: «похожий» тариф с другой ценой молча занял
 * бы место настоящего, и гостиница подписала бы чужую цифру. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { partnerConditions, periodOn, planForSlice, sliceName } from './corporateTariff.js';

const AZ = { code: 'org-az', name: 'Азимут' };
const RU = { code: 'org-ru', name: 'Россия' };
const ACC = { code: 'kc-1', name: 'Карс Авиа' };

test('название среза — как его прочтёт человек в списке тарифов', () => {
  const slices = [
    { account: ACC, customer: AZ, guestKind: 'CREW', mealPlan: 'BB' },
    { account: ACC, customer: null, guestKind: null, mealPlan: 'NONE' },
    { account: ACC, customer: RU, guestKind: 'CREW', mealPlan: 'NONE' },
  ];
  assert.deepEqual(slices.map(sliceName), [
    'Азимут · экипаж · завтрак',
    'Все авиакомпании · без питания',
    'Россия · экипаж · без питания',
  ]);
});

test('тариф среза — тот же партнёр, договор и условия; «похожий» не он', () => {
  const partner = {
    id: 'p1',
    accounts: [{ id: 'a1', code: 'kc-1' }],
    customers: [{ id: 'c-ru', code: 'org-ru' }],
  };
  const plan = {
    id: 'plan', isActive: true, partnerId: 'p1', operatorContract: '25/82',
    partnerAccountId: 'a1', partnerCustomerId: 'c-ru', guestKind: 'CREW', mealPlan: 'NONE',
  };
  const ru = { account: ACC, customer: RU, guestKind: 'CREW', mealPlan: 'NONE' };
  assert.equal(planForSlice([plan], ru, partner, '25/82')?.id, 'plan');
  // тот же тариф, но с завтраком — уже не он
  assert.equal(planForSlice([{ ...plan, mealPlan: 'BB' }], ru, partner, '25/82'), null);
});

test('период договора на день — последняя начавшаяся ДС, иначе первая', () => {
  /* Риск: экран открывается без выбранного периода, сервер отвечает
     сегодняшним днём, а подпись берётся у первой ДС — одна сетка цен
     показалась бы под подписью другой. */
  assert.equal(periodOn([], '2025-12-15'), null);

  // одна ДС — действует она
  assert.equal(periodOn(['2025-11-10'], '2025-12-15'), '2025-11-10');

  // день между ДС — последняя начавшаяся, а не первая в списке
  assert.equal(periodOn(['2025-11-10', '2026-01-01'], '2025-12-15'), '2025-11-10');
  assert.equal(periodOn(['2025-11-10', '2025-12-01', '2026-01-01'], '2025-12-15'), '2025-12-01');
  // день начала второй ДС — уже она
  assert.equal(periodOn(['2025-11-10', '2026-01-01'], '2026-01-01'), '2026-01-01');
  // день после всех ДС — последняя
  assert.equal(periodOn(['2025-11-10', '2026-01-01'], '2027-01-01'), '2026-01-01');
  // день до всех ДС — первая: до начала договора действовать нечему,
  // но пустой выбор снова показал бы чужую подпись
  assert.equal(periodOn(['2025-11-10', '2026-01-01'], '2025-01-01'), '2025-11-10');
});

test('periodOn не переставляет список ДС вызывающего', () => {
  /* Риск: сортировка на месте поменяла бы порядок в данных запроса — селектор
     и таблица читали бы разные списки, а подписи периодов поехали бы. */
  const periods = ['2026-01-01', '2025-11-10'];
  const before = [...periods];
  assert.equal(periodOn(periods, '2025-12-15'), '2025-11-10');
  assert.deepEqual(periods, before);
});

test('НДС на карточке: у корпоративного — из договора, у своего — свой', () => {
  /* Риск: чип «НДС 20%» из ставки тарифа читался бы как условие цены договора,
     а цена договора считает НДС по своей ставке — на экране две разные цифры
     выглядели бы одной. У своего тарифа ставка своя и остаётся на месте. */
  const partner = { id: 'p1', name: 'Отель', accounts: [], customers: [] };
  const conditions = (plan) => partnerConditions(plan, [partner]);

  const corp = conditions({ partnerId: 'p1', forOperator: true, vatRate: 20 });
  assert.ok(!corp.some((c) => c.label === 'НДС'));
  assert.deepEqual(corp.map((c) => c.value), ['Отель', 'любое', 'любая', 'любая']);

  // Свой тариф не изменился: ставка на карточке, «без НДС» при пустой.
  assert.deepEqual(conditions({ partnerId: 'p1', forOperator: false, vatRate: 20 }).at(-1), {
    label: 'НДС',
    value: '20%',
  });
  assert.deepEqual(conditions({ partnerId: 'p1', forOperator: false, vatRate: null }).at(-1), {
    label: 'НДС',
    value: 'без НДС',
  });
});
