/* ПРОДЛЕНИЕ ВХОДА — ТОЛЬКО СВОЕГО — проверки (25.10.2026: вкладка «Апартаментов»
 * после продления молча работала от имени «Европы», выезд гостя получал
 * «Reservation not found»).
 *
 * Запуск: `npm test` (встроенный `node --test`, без зависимостей).
 *
 * Главное сформулировано отрицанием: вход в гостиницу НЕ продлевается общей
 * кукой, токен ДРУГОГО входа вкладка НЕ принимает и запрос под ним НЕ
 * повторяет. И рядом — что свой вход продлевается как раньше: иначе защита
 * просто выбрасывала бы всех каждые 15 минут. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSessionRefresh,
  isSessionStopped,
  sessionCookiePath,
  sessionOf,
} from './session-refresh.js';

const DISPATCHER = 'u-dispatcher';
const APARTMENTS = 't-apartments';
const EUROPA = 't-europa';

let serial = 0;
/** Токен как от сервера: подпись не важна, важно тело. */
function jwt(payload) {
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  serial += 1;
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ ...payload, n: serial })}.sig${serial}`;
}
const hotelToken = (tid, sub = DISPATCHER, imp = DISPATCHER) => jwt({ tid, sub, imp, role: 'OWNER', email: 'd@karsavia.ru' });
const staffToken = (tid) => hotelToken(tid, 'u-staff', null);
const httpError = (status) => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status } });

/** Вкладка: её токен, ответы сервера на продление и что ушло в повтор. */
function tab({ token, refreshed, canRefresh = true }) {
  const state = { token, set: [], paths: [], retried: [], stopped: [] };
  const r = createSessionRefresh({
    post: async (path) => {
      state.paths.push(path);
      return typeof refreshed === 'function' ? refreshed() : refreshed;
    },
    retry: async (cfg) => {
      state.retried.push(cfg);
      return { status: 200, config: cfg };
    },
    getToken: () => state.token,
    setToken: (t) => {
      state.set.push(t);
      state.token = t;
    },
    canRefresh: () => canRefresh,
    onStopped: (err) => {
      state.stopped.push(err.reason);
    },
  });
  return { state, ...r };
}

const unauthorized = (url = '/reservations/r-0915') => ({
  config: { url, method: 'patch', headers: {} },
  response: { status: 401 },
});

test('вход в гостиницу продлевается кукой СВОЕЙ гостиницы — НЕ общей', async () => {
  const t = tab({ token: hotelToken(APARTMENTS), refreshed: hotelToken(APARTMENTS) });
  await t.refresh();
  assert.deepEqual(t.state.paths, [`/auth/hotel/${APARTMENTS}/refresh`]);
});

test('вход паролем и только что открытая вкладка — общей кукой, как раньше', async () => {
  for (const token of [staffToken(EUROPA), null]) {
    const t = tab({ token, refreshed: staffToken(EUROPA) });
    await t.refresh();
    assert.deepEqual(t.state.paths, ['/auth/refresh']);
  }
});

test('выход и продление — одни ручки куки: гостиница по ссылке — свои, прочие — общие', () => {
  assert.equal(sessionCookiePath(sessionOf(hotelToken(EUROPA))), `/auth/hotel/${EUROPA}`);
  assert.equal(sessionCookiePath(sessionOf(staffToken(EUROPA))), '/auth');
  assert.equal(sessionCookiePath(null), '/auth');
});

test('токен ДРУГОЙ гостиницы вкладка НЕ принимает', async () => {
  const own = hotelToken(APARTMENTS);
  const t = tab({ token: own, refreshed: hotelToken(EUROPA) });
  await assert.rejects(t.refresh(), (err) => isSessionStopped(err));
  assert.deepEqual(t.state.set, [], 'токен Европы не записан во вкладку');
  assert.equal(t.state.token, own, 'токен вкладки не сброшен — по нему и F5 поймёт, что вход чужой');
  assert.deepEqual(t.state.stopped, ['displaced']);
});

test('запрос НЕ повторяется под чужой гостиницей', async () => {
  const t = tab({ token: hotelToken(APARTMENTS), refreshed: hotelToken(EUROPA) });
  await assert.rejects(t.onAuthError(unauthorized()), (err) => isSessionStopped(err));
  assert.equal(t.state.retried.length, 0);
});

test('та же гостиница, но другой человек или без «от имени» — тоже НЕ принимается', async () => {
  for (const refreshed of [
    staffToken(APARTMENTS), // вошёл сотрудник гостиницы паролем
    hotelToken(APARTMENTS, 'u-other-dispatcher', 'u-other-dispatcher'),
    hotelToken(APARTMENTS, DISPATCHER, null),
  ]) {
    const t = tab({ token: hotelToken(APARTMENTS), refreshed });
    await assert.rejects(t.onAuthError(unauthorized()), (err) => isSessionStopped(err));
    assert.deepEqual(t.state.set, []);
    assert.equal(t.state.retried.length, 0);
  }
});

test('общая кука под входом паролем сменилась на чужой — НЕ принимается', async () => {
  const t = tab({ token: staffToken(APARTMENTS), refreshed: staffToken(EUROPA) });
  await assert.rejects(t.onAuthError(unauthorized()), (err) => isSessionStopped(err));
  assert.deepEqual(t.state.set, []);
  assert.equal(t.state.retried.length, 0);
});

test('нечитаемый токен в ответ на известный вход — НЕ принимается', async () => {
  const t = tab({ token: hotelToken(APARTMENTS), refreshed: 'not-a-jwt' });
  await assert.rejects(t.refresh(), (err) => isSessionStopped(err));
  assert.deepEqual(t.state.set, []);
});

test('остановленная вкладка больше НЕ ходит продлевать — чужая кука не крутится', async () => {
  const t = tab({ token: hotelToken(APARTMENTS), refreshed: hotelToken(EUROPA) });
  await assert.rejects(t.onAuthError(unauthorized()));
  await assert.rejects(t.onAuthError(unauthorized('/timeline')), (err) => isSessionStopped(err));
  assert.equal(t.state.paths.length, 1);
  assert.equal(t.state.retried.length, 0);
  assert.equal(t.state.stopped.length, 1);
});

test('кука гостиницы кончилась (401) — вкладка остановлена, токен НЕ сброшен, запрос НЕ повторён', async () => {
  const own = hotelToken(APARTMENTS);
  const t = tab({ token: own, refreshed: () => Promise.reject(httpError(401)) });
  await assert.rejects(t.onAuthError(unauthorized()), (err) => isSessionStopped(err) && err.reason === 'ended');
  assert.deepEqual(t.state.set, [], 'без токена F5 открыл бы вкладку на общей куке, без гостиницы');
  assert.equal(t.state.token, own);
  assert.equal(t.state.retried.length, 0);
  assert.deepEqual(t.state.stopped, ['ended']);
  await assert.rejects(t.onAuthError(unauthorized('/timeline')), (err) => isSessionStopped(err));
  assert.equal(t.state.paths.length, 1, 'остановленная вкладка больше не ходит продлевать');
});

test('сбой сети у входа в гостиницу — НЕ конец входа: токен остаётся, следующий 401 пробует снова', async () => {
  const own = hotelToken(APARTMENTS);
  let answer = () => Promise.reject(new Error('Network Error'));
  const t = tab({ token: own, refreshed: () => answer() });
  const original = unauthorized();
  await assert.rejects(t.onAuthError(original), (err) => err === original);
  assert.deepEqual(t.state.set, []);
  assert.deepEqual(t.state.stopped, []);
  const fresh = hotelToken(APARTMENTS);
  answer = () => fresh;
  await t.onAuthError(unauthorized());
  assert.equal(t.state.paths.length, 2);
  assert.deepEqual(t.state.set, [fresh]);
});

test('свой вход продлевается как раньше: новый токен принят, запрос повторён с ним', async () => {
  const fresh = hotelToken(APARTMENTS);
  const t = tab({ token: hotelToken(APARTMENTS), refreshed: fresh });
  const resp = await t.onAuthError(unauthorized());
  assert.equal(resp.status, 200);
  assert.deepEqual(t.state.set, [fresh]);
  assert.equal(t.state.retried.length, 1);
  assert.equal(t.state.retried[0].headers.Authorization, `Bearer ${fresh}`);
  assert.equal(t.state.retried[0]._retried, true);
  assert.deepEqual(t.state.stopped, []);
});

test('свой вход паролем (без «от имени») продлевается как раньше', async () => {
  const fresh = staffToken(EUROPA);
  const t = tab({ token: staffToken(EUROPA), refreshed: fresh });
  assert.equal(await t.refresh(), fresh);
  assert.deepEqual(t.state.set, [fresh]);
});

test('вкладка без входа (только что открытая) берёт вход браузера — как раньше', async () => {
  const cookie = staffToken(EUROPA);
  const t = tab({ token: null, refreshed: cookie });
  assert.equal(await t.refresh(), cookie);
  assert.deepEqual(t.state.set, [cookie]);
});

test('новый вход в этой же вкладке снимает остановку', async () => {
  let next = hotelToken(EUROPA);
  const t = tab({ token: hotelToken(APARTMENTS), refreshed: () => next });
  await assert.rejects(t.refresh());
  t.state.token = hotelToken(EUROPA); // вошли по ссылке в Европу прямо здесь
  next = hotelToken(EUROPA);
  assert.equal(await t.refresh(), next);
  assert.equal(t.state.paths.length, 2);
});

test('пока шло продление, во вкладке вошли по ссылке — ответ продления НЕ затирает новый вход', async () => {
  const cookieA = staffToken(APARTMENTS);
  const ssoB = hotelToken(EUROPA);
  let answer;
  const t = tab({ token: null, refreshed: () => new Promise((resolve) => { answer = resolve; }) });
  const pending = t.refresh();
  t.state.token = ssoB; // страница /sso обменяла код раньше, чем пришёл ответ продления
  answer(cookieA);
  assert.equal(await pending, ssoB);
  assert.deepEqual(t.state.set, [], 'токен из общей куки во вкладку не записан');
  assert.equal(t.state.token, ssoB);
});

test('продление не удалось, а во вкладке уже новый вход — он НЕ сбрасывается', async () => {
  const ssoB = hotelToken(EUROPA);
  let fail;
  const t = tab({ token: null, refreshed: () => new Promise((_, reject) => { fail = reject; }) });
  const pending = t.refresh();
  t.state.token = ssoB;
  fail(httpError(401));
  await assert.rejects(pending);
  assert.deepEqual(t.state.set, []);
  assert.equal(t.state.token, ssoB);
});

test('продление входа паролем не удалось — как раньше: токен сброшен, наверх уходит исходная 401', async () => {
  const t = tab({ token: staffToken(EUROPA), refreshed: () => Promise.reject(httpError(401)) });
  const original = unauthorized();
  await assert.rejects(t.onAuthError(original), (err) => err === original);
  assert.deepEqual(t.state.set, [null]);
  assert.equal(t.state.retried.length, 0);
  assert.deepEqual(t.state.stopped, []);
});

test('/auth/*, не 401, вход «от имени» из панели и повтор — не продлеваются, как раньше', async () => {
  const cases = [
    [{ token: hotelToken(APARTMENTS), refreshed: hotelToken(APARTMENTS) }, unauthorized('/auth/me')],
    [{ token: hotelToken(APARTMENTS), refreshed: hotelToken(APARTMENTS) }, { ...unauthorized(), response: { status: 404 } }],
    [{ token: hotelToken(APARTMENTS), refreshed: hotelToken(APARTMENTS), canRefresh: false }, unauthorized()],
    [{ token: hotelToken(APARTMENTS), refreshed: hotelToken(APARTMENTS) }, { ...unauthorized(), config: { url: '/x', _retried: true } }],
  ];
  for (const [opts, err] of cases) {
    const t = tab(opts);
    await assert.rejects(t.onAuthError(err), (e) => e === err);
    assert.equal(t.state.paths.length, 0);
  }
});

test('два 401 разом — одно продление на двоих', async () => {
  const fresh = hotelToken(APARTMENTS);
  const t = tab({ token: hotelToken(APARTMENTS), refreshed: fresh });
  await Promise.all([t.onAuthError(unauthorized()), t.onAuthError(unauthorized('/timeline'))]);
  assert.equal(t.state.paths.length, 1);
  assert.equal(t.state.retried.length, 2);
});

test('sessionOf читает гостиницу, человека и «от имени»; мусор — null', () => {
  assert.deepEqual(sessionOf(hotelToken(APARTMENTS)), { tid: APARTMENTS, sub: DISPATCHER, imp: DISPATCHER });
  assert.deepEqual(sessionOf(jwt({ tid: EUROPA, sub: 'u-staff' })), { tid: EUROPA, sub: 'u-staff', imp: null });
  for (const bad of [null, '', 'abc', 'a.b.c', jwt({ sub: 'x' })]) assert.equal(sessionOf(bad), null);
});
