/* ЧИСЛО В ПОЛЕ ВВОДА (5.4) — проверки. Запуск: `npm test`.
 * Главное — отрицанием: «0350» НЕ получается, очищенное поле НЕ становится 0. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanNumberText, numberToText, parseNumberText } from './number-text.js';

test('«350» в пустое поле — 350, без нуля впереди', () => {
  assert.equal(cleanNumberText('0350'), '350');
  assert.equal(parseNumberText(cleanNumberText('0350')), 350);
});

test('стёртое поле — пусто и null, а НЕ 0', () => {
  assert.equal(cleanNumberText(''), '');
  assert.equal(parseNumberText(''), null);
  assert.equal(numberToText(null), '');
});

test('«0,5» — 0.5: запятая как точка, ноль перед точкой остаётся', () => {
  assert.equal(cleanNumberText('0,5'), '0.5');
  assert.equal(parseNumberText('0.5'), 0.5);
  assert.equal(cleanNumberText(',5'), '0.5');
});

test('одна точка; целое поле точку не принимает', () => {
  assert.equal(cleanNumberText('1.2.3'), '1.23');
  assert.equal(cleanNumberText('12.5', { decimal: false }), '125');
});

test('минус — только где разрешён', () => {
  assert.equal(cleanNumberText('-15'), '15');
  assert.equal(cleanNumberText('-15', { allowNegative: true }), '-15');
  assert.equal(parseNumberText('-'), null);
});

test('буквы и пробелы отбрасываются, «0» остаётся нулём', () => {
  assert.equal(cleanNumberText('1 2a3'), '123');
  assert.equal(cleanNumberText('0'), '0');
  assert.equal(parseNumberText('0'), 0);
});
