/* СРЕЗ ДОГОВОРА ПОД ТАРИФ — проверки (29.09.2026).
 *
 * Запуск: `npm test` (встроенный `node --test`, без зависимостей).
 *
 * Ошибка здесь не падает и не ругается: цена «для Азимута» тихо ляжет в
 * общий тариф, цена с завтраком — в тариф без питания, и гостиница подпишет
 * чужую цифру. Поэтому проверки сформулированы через то, чего в тарифе быть
 * НЕ должно. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  contractPeriods,
  contractSlices,
  planForSlice,
  sliceCells,
  sliceName,
} from './corporateTariff.js';

const RT = [
  { id: 'std1', name: 'Стандарт одноместный', maxOccupancy: 1 },
  { id: 'std2', name: 'Стандарт двухместный', maxOccupancy: 2 },
  { id: 'bed', name: 'Койко-место', maxOccupancy: 3 },
];
const AZ = { code: 'org-az', name: 'Азимут' };
const RU = { code: 'org-ru', name: 'Россия' };
const ACC = { code: 'kc-1', name: 'Карс Авиа' };

const r = (over) => ({ categoryIds: ['std1', 'std2'], priceNet: 400000, onRequest: false, mealPlan: 'NONE', ...over });

const DOC = {
  service: 'ACCOMMODATION',
  contractNumber: '25/82',
  account: ACC,
  validFrom: '2025-05-01T00:00:00.000Z',
  validTo: '2025-12-31T00:00:00.000Z',
  rows: [
    r({ guests: 1, priceNet: 420000, guestKind: 'CREW', customer: RU }),
    r({ guests: 2, priceNet: 560000, guestKind: 'CREW', customer: RU }),
    r({ guests: 1, priceNet: 590000, guestKind: 'CREW', customer: AZ, mealPlan: 'BB' }),
    r({ guests: 1, priceNet: 380000 }),
    r({ categoryIds: ['bed'], perPerson: true, priceNet: 90000 }),
  ],
};
const slice = (over) => ({ account: 'kc-1', customer: null, guestKind: null, mealPlan: 'NONE', ...over });

test('тариф «Россия · экипаж» берёт строки России и общие, но не Азимута', () => {
  const { prices, skipped } = sliceCells([DOC], slice({ customer: 'org-ru', guestKind: 'CREW' }), RT, '2025-06-01');
  assert.equal(prices['std1|1'], '4200'); // частная строка бьёт общую 3 800
  assert.equal(prices['std2|2'], '5600');
  assert.equal(prices['std2|1'], '4200');
  assert.ok(skipped.some((s) => s.row.customer === AZ && s.reason === 'для другой авиакомпании'));
});

test('общий тариф не берёт частных строк — ни авиакомпании, ни вида брони', () => {
  const { prices, skipped } = sliceCells([DOC], slice(), RT, '2025-06-01');
  assert.equal(prices['std1|1'], '3800');
  assert.equal(prices['std2|2'], undefined);
  assert.equal(skipped.filter((s) => s.reason === 'для другой авиакомпании').length, 3);
});

test('цена с завтраком не ложится в тариф без питания, и это названо', () => {
  const { prices, skipped } = sliceCells([DOC], slice({ customer: 'org-az', guestKind: 'CREW' }), RT, '2025-06-01');
  assert.equal(prices['std1|1'], '3800'); // только общая строка без питания
  assert.ok(skipped.some((s) => s.reason === 'с питанием «завтрак»'));
  const bb = sliceCells([DOC], slice({ customer: 'org-az', guestKind: 'CREW', mealPlan: 'BB' }), RT, '2025-06-01');
  assert.equal(bb.prices['std1|1'], '5900');
});

test('цена за место — по числу гостей, и только местам; двоих в одноместный не селим', () => {
  const { prices } = sliceCells([DOC], slice(), RT, '2025-06-01');
  assert.equal(prices['bed|1'], '900');
  assert.equal(prices['bed|3'], '2700');
  assert.equal(prices['std1|2'], undefined);
});

test('другое юрлицо договора — не этот тариф', () => {
  const { prices, skipped } = sliceCells([DOC], slice({ account: 'kc-2' }), RT, '2025-06-01');
  assert.deepEqual(prices, {});
  assert.ok(skipped.every((s) => s.reason === 'другое юрлицо'));
});

test('ДС бьёт договор на свой период; периоды становятся сезонами', () => {
  const ds = { ...DOC, validFrom: '2025-09-01T00:00:00.000Z', rows: [r({ guests: 1, priceNet: 410000 })] };
  const base = { ...DOC, validFrom: '2025-01-01T00:00:00.000Z' };
  assert.equal(sliceCells([base, ds], slice(), RT, '2025-06-01').prices['std1|1'], '3800');
  assert.equal(sliceCells([base, ds], slice(), RT, '2025-10-01').prices['std1|1'], '4100');
  const p = contractPeriods([base, ds], '2025-06-01');
  assert.equal(p.base, '2025-06-01');
  assert.deepEqual(p.seasons, [{ from: '2025-09-01', to: '2025-12-31' }]);
});

test('договор весь в прошлом — база по последнему периоду и это сказано', () => {
  const p = contractPeriods([DOC], '2026-09-29');
  assert.equal(p.base, '2025-05-01');
  assert.equal(p.expired, true);
});

test('срезы договора и тариф, который его воплощает', () => {
  const slices = contractSlices([DOC]);
  assert.deepEqual(slices.map(sliceName), [
    'Азимут · экипаж · завтрак',
    'Все авиакомпании · без питания',
    'Россия · экипаж · без питания',
  ]);
  const partner = {
    id: 'p1',
    accounts: [{ id: 'a1', code: 'kc-1' }],
    customers: [{ id: 'c-ru', code: 'org-ru' }],
  };
  const plan = {
    id: 'plan', isActive: true, partnerId: 'p1', operatorContract: '25/82',
    partnerAccountId: 'a1', partnerCustomerId: 'c-ru', guestKind: 'CREW', mealPlan: 'NONE',
  };
  const ru = slices.find((s) => s.customer?.code === 'org-ru');
  assert.equal(planForSlice([plan], ru, partner, '25/82')?.id, 'plan');
  // тот же тариф, но с завтраком — уже не он
  assert.equal(planForSlice([{ ...plan, mealPlan: 'BB' }], ru, partner, '25/82'), null);
});
