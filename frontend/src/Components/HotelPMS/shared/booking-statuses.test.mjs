/* СТАТУСЫ В СЕТКЕ ФОРМЫ БРОНИ — проверки (25.10.2026: «Отменено» в сетке
 * отменяло бронь Kars Avia в обход запрета).
 *
 * Запуск: `npm test` (встроенный `node --test`, без зависимостей). */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOOKING_STATUS } from '../constants.js';
import { formStatuses } from './booking-statuses.js';

const ALL = Object.keys(BOOKING_STATUS);

test('бронь Kars Avia — «Отменено» НЕ предлагается, прочие статусы на месте', () => {
  const keys = formStatuses({ id: 'r1', channelManaged: true, status: 'confirmed' });
  assert.equal(keys.includes('cancelled'), false);
  assert.deepEqual(keys, ALL.filter((key) => key !== 'cancelled'));
});

test('своя бронь гостиницы и новая бронь — все статусы, как раньше', () => {
  assert.deepEqual(formStatuses({ id: 'r1', channelManaged: false, status: 'confirmed' }), ALL);
  assert.deepEqual(formStatuses({}), ALL);
});

test('уже отменённая бронь Kars Avia — свой статус виден', () => {
  assert.deepEqual(formStatuses({ id: 'r1', channelManaged: true, status: 'cancelled' }), ALL);
});
