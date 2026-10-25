/* ОТКАЗЫ ПО БРОНИ ПО-РУССКИ — проверки (25.10.2026: диспетчеру в форме брони
 * прилетало «Reservation not found»).
 *
 * Запуск: `npm test` (встроенный `node --test`, без зависимостей).
 *
 * Главное — НЕ испортить прочие сообщения: незнакомый отказ, русский текст
 * бэкенда и знакомый текст с другим кодом ответа показываются как пришли. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reservationErrorText } from './reservation-errors.js';

const refusal = (status, message) => ({ message: `Request failed with status code ${status}`, response: { status, data: { statusCode: status, message } } });

test('404 «Reservation not found» — по-русски, с подсказкой про гостиницу', () => {
  const text = reservationErrorText(refusal(404, 'Reservation not found'), 'Ошибка');
  assert.match(text, /^Бронь не найдена в этой гостинице/);
  assert.match(text, /от имени какой гостиницы/);
});

test('выезд с долгом — сумма долга в рублях', () => {
  const text = reservationErrorText(
    refusal(409, 'Cannot check out: outstanding balance of 4500.00 must be settled first'),
    'Ошибка',
  );
  assert.match(text, /^Выезд не отмечен: по счёту брони долг 4\s500 ₽/);
});

test('неверный исходный статус — названия статусов как на экране', () => {
  assert.equal(
    reservationErrorText(refusal(409, 'Cannot check out: reservation must be in CHECKED_IN status')),
    'Выезд отмечается только у брони в статусе «Заселён».',
  );
  assert.equal(
    reservationErrorText(refusal(409, 'Cannot check in: current status must be NEW or CONFIRMED')),
    'Заселить можно только бронь в статусе «Новое» или «Подтверждено».',
  );
  assert.equal(
    reservationErrorText(refusal(409, 'Cannot mark as no-show: current status must be NEW or CONFIRMED')),
    '«Не явился» отмечается только у брони в статусе «Новое» или «Подтверждено».',
  );
});

test('бронь изменили параллельно — и правка, и обмен местами', () => {
  for (const msg of [
    'Reservation was modified by another user — please reload and try again.',
    'Reservation was modified by another user — please reload',
  ]) {
    assert.equal(reservationErrorText(refusal(409, msg)), 'Бронь уже изменили — обновите страницу и повторите.');
  }
});

test('незнакомый отказ НЕ подменяется — показывается как пришёл', () => {
  const msg = 'Cannot swap reservations from different rooms';
  assert.equal(reservationErrorText(refusal(409, msg), 'Ошибка'), msg);
});

test('русский текст бэкенда НЕ трогается', () => {
  const msg = 'Число гостей брони из Kars Avia меняется в заявке Kars Avia, а не в кабинете гостиницы';
  assert.equal(reservationErrorText(refusal(403, msg), 'Ошибка'), msg);
});

test('знакомый текст с другим кодом ответа НЕ переводится', () => {
  assert.equal(reservationErrorText(refusal(500, 'Reservation not found'), 'Ошибка'), 'Reservation not found');
});

test('без ответа сервера — текст ошибки, без текста — запасная фраза', () => {
  assert.equal(reservationErrorText(new Error('Network Error'), 'Ошибка сохранения'), 'Network Error');
  assert.equal(reservationErrorText({}, 'Ошибка сохранения'), 'Ошибка сохранения');
});

test('список ошибок проверки полей отдаётся как раньше', () => {
  const list = ['adults must not be less than 1'];
  assert.equal(reservationErrorText(refusal(400, list), 'Ошибка'), list);
});
