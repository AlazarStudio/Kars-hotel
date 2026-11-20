/* РЕДИРЕКТ ПО ПРИОРИТЕТУ АДРЕСОВ PMS — проверки (20.11.2026).
 *
 * Запуск: `npm test` (встроенный `node --test`). Правила владельца:
 * основной жив — со всех адресов туда; лежит — на резервный; лежат оба —
 * зеркало остаётся. Отрицания: основной и адрес вне списка никого не
 * спрашивают, «жив» без ok:true — не жив. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { failoverTarget, higherPriority, redirectToPrimary } from './domainFailover.js';

const MAIN = 'https://hotel.karsavia.ru';
const RESERVE = 'https://hotel.karsavia-reserve.ru';
const MIRROR = 'https://hotel.karsavia-mirror.ru';
const ALL = [MAIN, RESERVE, MIRROR];

/** Сервер: свой список адресов на `/api/domains`, живы только `alive`. */
function server(alive, calls = []) {
  return async (url) => {
    calls.push(url);
    if (url === '/api/domains') return { ok: true, json: async () => ({ ok: true, origins: ALL }) };
    const origin = new URL(url).origin;
    if (!alive.includes(origin)) throw new TypeError('Failed to fetch');
    return { ok: true, json: async () => ({ ok: true, origins: ALL }) };
  };
}

test('основной жив — с резервного и с зеркала туда', async () => {
  assert.equal(await failoverTarget(RESERVE, server(ALL)), MAIN);
  assert.equal(await failoverTarget(MIRROR, server(ALL)), MAIN);
});

test('основной лежит — зеркало на резервный, резервный остаётся', async () => {
  assert.equal(await failoverTarget(MIRROR, server([RESERVE, MIRROR])), RESERVE);
  assert.equal(await failoverTarget(RESERVE, server([RESERVE, MIRROR])), null);
});

test('лежат оба главных — зеркало остаётся', async () => {
  assert.equal(await failoverTarget(MIRROR, server([MIRROR])), null);
});

test('основной и адрес вне списка НЕ спрашивают других', async () => {
  for (const current of [MAIN, 'http://localhost:5173']) {
    const calls = [];
    assert.equal(await failoverTarget(current, server(ALL, calls)), null);
    assert.deepEqual(calls, ['/api/domains']);
  }
  assert.deepEqual(higherPriority(ALL, 'http://213.219.213.66'), []);
});

test('ответ без ok:true (502 прокси, страница фронта) — НЕ жив', async () => {
  const fetchImpl = async (url) =>
    url === '/api/domains'
      ? { ok: true, json: async () => ({ ok: true, origins: ALL }) }
      : { ok: true, json: async () => ({ status: 'ok' }) };
  assert.equal(await failoverTarget(RESERVE, fetchImpl), null);
});

test('свой /api/domains не отвечает — остаёмся', async () => {
  const fetchImpl = async () => {
    throw new TypeError('Failed to fetch');
  };
  assert.equal(await failoverTarget(RESERVE, fetchImpl), null);
});

test('переход сохраняет путь, строку запроса и якорь', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = server(ALL);
  try {
    let went = null;
    const loc = { origin: RESERVE, pathname: '/bookings/5', search: '?tab=1', hash: '#x', replace: (u) => (went = u) };
    assert.equal(await redirectToPrimary(loc), true);
    assert.equal(went, `${MAIN}/bookings/5?tab=1#x`);
  } finally {
    globalThis.fetch = realFetch;
  }
});
