/* ПОИСК ПО ШАХМАТКЕ — сужает строки, а не только брони (30.10.2026).
 *
 * Запуск: `npm test` (встроенный `node --test`, без зависимостей). */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bookingMatches, matchRooms, roomsWithHits } from './timeline-search.js';

const categories = [{ id: 'c1', name: 'Без категории (перенос)' }, { id: 'c2', name: 'Студия' }];
const rooms = [
  { id: 'r1', number: 'Новоселов 3 кв 115', categoryId: 'c1' },
  { id: 'r2', number: 'Советская 12 кв 4', categoryId: 'c1' },
  { id: 'r3', number: 'Горская 12 кв 49', categoryId: 'c1' },
  { id: 'r4', number: '101', categoryId: 'c2' },
];
const bookings = [
  { roomId: 'r1', guestName: 'Иванов Иван' },
  { roomId: 'r3', guestName: 'Петрова Анна' },
  { roomId: 'r2', guestName: 'Сидоров Пётр' },
];

const rowsFor = (q) => {
  const matched = matchRooms(q, rooms, categories);
  const visible = bookings.filter((b) => bookingMatches(q, b, matched ?? new Set()));
  const rows = roomsWithHits(matched, visible);
  return rows ? [...rows].sort() : null;
};

test('адрес квартиры — остаётся только эта квартира (голосовое: «вбила Советская»)', () => {
  assert.deepEqual(rowsFor('советская'), ['r2']);
  assert.deepEqual(rowsFor('Новоселов'), ['r1']);
});

test('фамилия гостя — только номер, где он живёт', () => {
  assert.deepEqual(rowsFor('петрова'), ['r3']);
});

test('найденный номер — со всеми своими бронями, а не только совпавшими по имени', () => {
  const matched = matchRooms('новоселов', rooms, categories);
  assert.equal(bookingMatches('новоселов', bookings[0], matched), true);
});

test('по категории — все её номера', () => {
  assert.deepEqual(rowsFor('студия'), ['r4']);
});

test('ничего не совпало — пустая шахматка, а не все номера', () => {
  assert.deepEqual(rowsFor('несуществующее'), []);
});

test('пустой запрос — шахматка не сужается', () => {
  assert.equal(rowsFor('  '), null);
  assert.equal(bookingMatches('', bookings[0], new Set()), true);
});
