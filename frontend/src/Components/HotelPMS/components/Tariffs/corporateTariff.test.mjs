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
import * as tariff from './corporateTariff.js';

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

test('календарь хранит отдельную цену на каждое число гостей', () => {
  const prices = tariff.calendarPrices([{ day: '2026-11-14', prices: [
    { categoryId: 'r1', occupancy: 1, price: '3000.00' },
    { categoryId: 'r1', occupancy: 2, price: '4600.00' },
  ] }]);
  assert.equal(prices.get('2026-11-14').get('r1|1'), '3000.00');
  assert.equal(prices.get('2026-11-14').get('r1|2'), '4600.00');
  assert.equal(prices.get('2026-11-14').get('r1|3'), undefined);
});

const directory = {
  accounts: [{ id: 'a1', code: 'kc-1' }, { id: 'a2', code: 'kc-2' }],
  customers: [{ id: 'c1', code: 's7' }, { id: 'c2', code: 'az' }],
};
const contract = { account: { code: 'kc-1' }, hasPrices: true, slices: [
  { customer: 's7', guestKind: 'CREW', mealPlan: 'BB' },
  { customer: 'az', guestKind: 'DISRUPTION', mealPlan: 'FB' },
] };

test('срез ограничивает юрлица договором, а питание — выбранными авиакомпанией и видом брони', () => {
  const options = tariff.sliceOptions(contract, directory, { partnerCustomerId: 'c1', guestKind: 'CREW' });
  assert.deepEqual(options.accounts.map(a => a.id), ['a1']);
  assert.deepEqual(options.kinds, ['CREW']);
  assert.deepEqual(options.meals, ['BB']);
  assert.equal(options.anyCustomer, false);
});

test('смена авиакомпании выбирает совместимые вид брони и питание', () => {
  const next = tariff.reconcileSlice(contract, directory, { partnerAccountId: 'a2', partnerCustomerId: 'c2', guestKind: 'CREW', mealPlan: 'BB' });
  assert.equal(next.partnerAccountId, 'a1');
  assert.equal(next.partnerCustomerId, 'c2');
  assert.equal(next.guestKind, 'DISRUPTION');
  assert.equal(next.mealPlan, 'FB');
});

test('договор без приложений допускает подготовку тарифа без ложного обещания цен', () => {
  const empty = { hasPrices: false, hasDocuments: false, slices: [] };
  const options = tariff.sliceOptions(empty, directory, {});
  assert.equal(options.waiting, true);
  assert.ok(options.meals.includes('NONE'));
  assert.match(tariff.contractAvailabilityText(empty), /приложение/);
  assert.match(tariff.contractAvailabilityText({ ...empty, hasDocuments: true }), /сетки/);
});

test('отсутствующий в справочнике код не превращается в любую авиакомпанию', () => {
  const options = tariff.sliceOptions({ ...contract, slices: [{ customer: 'unknown', guestKind: 'CREW', mealPlan: 'BB' }] }, directory, {});
  assert.deepEqual(options.customers, []);
  assert.equal(options.anyCustomer, false);
  assert.equal(options.unresolvedCustomer, true);
});

test('смена условий тарифа меняет ключ представления, переименование — нет', () => {
  const plan = { id: 'p1', operatorContract: '205', partnerId: 'p', mealPlan: 'BB' };
  assert.notEqual(tariff.contractViewKey(plan), tariff.contractViewKey({ ...plan, operatorContract: '206' }));
  assert.notEqual(tariff.contractViewKey(plan), tariff.contractViewKey({ ...plan, mealPlan: 'FB' }));
  assert.equal(tariff.contractViewKey(plan), tariff.contractViewKey({ ...plan, name: 'Другое имя' }));
});

test('неизвестные коды не совпадают с общим тарифом, пробелы номера не создают дубликат', () => {
  const partner = { id: 'p1', accounts: [], customers: [] };
  const generic = { id: 'existing', isActive: true, partnerId: 'p1', operatorContract: ' 205 ', guestKind: null, mealPlan: 'BB' };
  const slice = { account: null, customer: null, guestKind: null, mealPlan: 'BB' };
  assert.equal(planForSlice([generic], slice, partner, '205')?.id, 'existing');
  assert.equal(planForSlice([generic], { ...slice, customer: { code: 'unknown' } }, partner, '205'), null);
  assert.equal(planForSlice([generic], { ...slice, account: { code: 'unknown' } }, partner, '205'), null);
});
