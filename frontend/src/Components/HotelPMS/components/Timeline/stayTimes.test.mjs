/* ПРИЛЁТ И ОТЪЕЗД БРОНИ ИЗ KARS AVIA — проверки (24.10.2026, правка заказчика:
 * «в бронях видна дата, но не видно время прибытия»).
 *
 * Запуск: `npm test` (встроенный `node --test`, без зависимостей).
 *
 * Главное здесь — время НЕ сдвигается поясом браузера: партнёр присылает
 * местное время города текстом, и 02:00 обязано остаться 02:00 и в Москве, и
 * во Владивостоке. И непонятное НЕ показывается: лучше промолчать, чем назвать
 * гостинице неверный час. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byArrival, fmtStayTime, stayClock, stayLine, stayRows, stayFacts } from './stayTimes.js';

test('фактический заезд и выезд одним днём не берутся из периода брони или прилёта', () => {
  assert.deepEqual(stayFacts({
    checkIn: '2026-10-28', checkOut: '2026-10-29',
    arrivalAt: '2026-10-28T22:30', departureAt: '2026-10-29T09:00',
    checkedInAt: '2026-10-29T01:10', checkedOutAt: '2026-10-29T08:30',
  }), { checkIn: '29 окт, 01:10', checkOut: '29 окт, 08:30' });
});

test('плановое прибытие или отъезд не выдаются за отмеченный факт', () => {
  assert.deepEqual(stayFacts({ arrivalAt: '2026-10-28T22:30', departureAt: '2026-10-29T09:00' }), { checkIn: null, checkOut: null });
});

test('время — как прислал партнёр: «22 окт, 02:00»', () => {
  assert.equal(fmtStayTime('2026-10-22T02:00'), '22 окт, 02:00');
  assert.equal(fmtStayTime('2026-01-05T23:59'), '5 янв, 23:59');
});

test('пояс браузера время НЕ сдвигает', () => {
  const was = process.env.TZ;
  try {
    for (const tz of ['Asia/Vladivostok', 'America/New_York', 'UTC']) {
      process.env.TZ = tz;
      assert.equal(fmtStayTime('2026-10-22T02:00'), '22 окт, 02:00', tz);
      assert.equal(stayClock('2026-10-22T02:00', '2026-10-22'), '02:00', tz);
    }
  } finally {
    if (was === undefined) delete process.env.TZ;
    else process.env.TZ = was;
  }
});

test('непонятное — НЕ показываем', () => {
  for (const v of [null, undefined, '', '02:00', '2026-10-22 02:00', '2026-10-22T02:00:00Z', '2026-13-22T02:00']) {
    assert.equal(fmtStayTime(v), null, String(v));
  }
});

test('в день заезда — только часы, в другой день — с датой', () => {
  assert.equal(stayClock('2026-10-22T02:00', '2026-10-22'), '02:00');
  assert.equal(stayClock('2026-10-22T02:00', '2026-10-21'), '22 окт, 02:00');
  assert.equal(stayClock(null, '2026-10-22'), null);
});

test('строка карточки: прибытие, отъезд, рейс — что известно', () => {
  assert.equal(
    stayLine({ arrivalAt: '2026-10-22T02:00', departureAt: '2026-10-24T10:40', flight: 'S7 178' }),
    'прибытие 22 окт, 02:00 · отъезд 24 окт, 10:40 · рейс S7 178',
  );
  assert.equal(stayLine({ arrivalAt: null, departureAt: null, flight: 'S7 178' }), 'рейс S7 178');
  assert.equal(stayLine({}), '');
});

test('подсказка шахматки: строка на каждое известное, неизвестного — нет', () => {
  assert.deepEqual(stayRows({ arrivalAt: '2026-10-22T02:00', departureAt: null, flight: 'S7 178' }), [
    ['Прибытие:', '22 окт, 02:00'],
    ['Рейс:', 'S7 178'],
  ]);
  assert.deepEqual(stayRows({ arrivalAt: '2026-10-22T02:00:00Z' }), []);
  assert.deepEqual(stayRows(null), []);
});

test('заезды — по времени прибытия, неизвестное в конце', () => {
  const list = [
    { id: 'без времени', arrivalAt: null },
    { id: '09:00', arrivalAt: '2026-10-22T09:00' },
    { id: '02:00', arrivalAt: '2026-10-22T02:00' },
  ];
  assert.deepEqual(
    [...list].sort(byArrival).map((b) => b.id),
    ['02:00', '09:00', 'без времени'],
  );
});

/* 26.10.2026: «не пишет время заезда и время выезда в шахматке» — факт в
 * подсказке, когда он есть; нет — строки нет. */
test('подсказка: заселён и выселен — фактическое время, только известное', () => {
  const rows = stayRows({ checkedInAt: '2026-10-21T00:10', checkedOutAt: '2026-10-25T09:45' });
  assert.deepEqual(rows, [
    ['Заселён:', '21 окт, 00:10'],
    ['Выселен:', '25 окт, 09:45'],
  ]);
  assert.deepEqual(stayRows({ checkedInAt: null, checkedOutAt: null }), []);
});
