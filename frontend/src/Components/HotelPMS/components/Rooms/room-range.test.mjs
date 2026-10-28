/* ПАЧКА НОМЕРОВ — диапазон, предпросмотр, тексты итогов (28.10.2026).
 *
 * Запуск: `npm test` (встроенный `node --test`, без зависимостей). */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSummary,
  numberList,
  plural,
  rangeNumbers,
  rangePreview,
  validateRange,
} from './room-range.js';

test('склонение: 1 номер, 2 номера, 5 номеров, 11 номеров, 21 номер', () => {
  const f = (n) => plural(n, 'номер', 'номера', 'номеров');
  assert.deepEqual(
    [1, 2, 5, 11, 21, 112].map(f),
    ['номер', 'номера', 'номеров', 'номеров', 'номер', 'номеров'],
  );
});

test('диапазон собирается как на сервере: префикс + число + суффикс', () => {
  assert.deepEqual(rangeNumbers({ start: '101', count: '3', prefix: 'А-', suffix: 'б' }), [
    'А-101б',
    'А-102б',
    'А-103б',
  ]);
  assert.deepEqual(rangeNumbers({ start: 0, count: 2 }), ['0', '1']);
});

test('неверный диапазон НЕ проходит: пусто, дробь, минус, 0 и больше 200 штук', () => {
  assert.deepEqual(validateRange({ start: '101', count: '40' }), {});
  assert.deepEqual(validateRange({ start: '0', count: '200' }), {});
  for (const start of ['', '1.5', '-1', 'abc']) {
    assert.ok(validateRange({ start, count: '1' }).start, `start=${start}`);
  }
  for (const count of ['', '0', '201', '2.5']) {
    assert.ok(validateRange({ start: '1', count }).count, `count=${count}`);
  }
});

test('предпросмотр: до 6 номеров — все, больше — первые два, «…» и последний', () => {
  assert.equal(rangePreview(['101']), 'Будет создан: №101 (1 номер)');
  assert.equal(
    rangePreview(['1', '2', '3', '4', '5', '6']),
    'Будут созданы: №1, №2, №3, №4, №5, №6 (6 номеров)',
  );
  assert.equal(
    rangePreview(rangeNumbers({ start: 101, count: 40 })),
    'Будут созданы: №101, №102 … №140 (40 номеров)',
  );
});

test('перечень номеров: больше 10 — «и ещё K»', () => {
  assert.equal(numberList(['1', '2']), '№1, №2');
  assert.equal(
    numberList(rangeNumbers({ start: 1, count: 12 })),
    '№1, №2, №3, №4, №5, №6, №7, №8, №9, №10 и ещё 2',
  );
});

test('итог пачки: всё создано — null, окно можно закрыть', () => {
  assert.equal(createSummary({ created: 40, skipped: [], skippedArchived: [] }, 40), null);
});

test('итог пачки: удалённые названы отдельно, с подсказкой восстановить', () => {
  assert.equal(
    createSummary({ created: 37, skipped: ['101', '102'], skippedArchived: ['105'] }, 40),
    'Создано 37 из 40. Уже есть в фонде: №101, №102. В удалённых: №105 — восстановите его в блоке «Удалённые номера» внизу страницы.',
  );
  assert.equal(
    createSummary({ created: 0, skipped: [], skippedArchived: ['1', '2'] }, 2),
    'Ничего не создано. В удалённых: №1, №2 — восстановите их в блоке «Удалённые номера» внизу страницы.',
  );
});
