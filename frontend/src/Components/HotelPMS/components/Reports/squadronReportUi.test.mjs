import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

const require = createRequire(import.meta.url);
const { build } = createRequire(import.meta.resolve('vite'))('esbuild');
const bundle = await build({
  stdin: { contents: `import React, {useState} from 'react';
    import Squadron from './SquadronReportsTab.jsx';
    export default function Page() {
      const [dateFrom,setDateFrom]=useState('2026-10-01');
      const [dateTo,setDateTo]=useState('2026-10-04');
      return <Squadron {...{dateFrom,dateTo,setDateFrom,setDateTo}} />;
    }`, resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'jsx' },
  bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', write: false,
  external: ['react', 'react-dom'], logLevel: 'silent',
  plugins: [{ name: 'boundaries', setup(builder) {
    builder.onResolve({ filter: /\/api\/aviaReports$/ }, () => ({ path: 'api', namespace: 'fixture-api' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture-api' }, () => ({ contents:
      ['listSquadronReports', 'getSquadronReport', 'previewSquadronReport', 'sendSquadronReport']
        .map((name) => `export const ${name} = (...args) => globalThis.fixture.${name}(...args);`).join('\n') }));
    builder.onLoad({ filter: /\.css$/ }, () => ({ contents: 'export default new Proxy({}, {get: (_, key) => key});', loader: 'js' }));
    builder.onResolve({ filter: /\/shared\/NumberInput(\.jsx)?$/ }, () => ({ path: 'number', namespace: 'fixture-control' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture-control' }, () => ({ contents:
      `import React from 'react'; export default function NumberInput(props) {
        return React.createElement('input', {...props, onChange: e => props.onChange(e.target.value === '' ? null : Number(e.target.value))});
      }` }));
  } }],
});

const textOf = (node) => typeof node === 'string' ? node : (node.children ?? []).map(textOf).join('');
const button = (renderer, label) => renderer.root.findAllByType('button').find((node) => textOf(node) === label);
const mealInput = (renderer) => renderer.root.findAllByType('input').find((node) => node.props['aria-label'] === 'Питание, ₽ — Э-1, номер 101');
const amountInput = (renderer, label, request, room) => renderer.root.findAllByType('input').find((node) => node.props['aria-label'] === `${label} — ${request}, номер ${room}`);
async function click(renderer, label) {
  const node = button(renderer, label); assert.ok(node, label); assert.equal(Boolean(node.props.disabled), false, label);
  await act(async () => node.props.onClick());
}
const row = { reservationId: '11111111-1111-4111-8111-111111111111', requestNumber: 'Э-1', roomNumber: '101',
  stayStart: '2026-10-01', stayEnd: '2026-10-04', nights: 3, guestCount: 2, breakfastCount: 2,
  lunchCount: 0, dinnerCount: 0, accommodationKopecks: 30003, mealKopecks: null, factToken: 'fact' };
function fixture(items = []) {
  const f = { items, calls: [], fail: true, counter: 0 };
  f.listSquadronReports = async () => f.items;
  f.getSquadronReport = async () => ({ ...f.items[0], rows: [{ ...row, mealKopecks: 0 }] });
  f.previewSquadronReport = async (startDate, endDate) => ({ startDate, endDate, rows: [row], previewToken: 'token', totalKopecks: null });
  f.sendSquadronReport = async (payload) => { f.calls.push(payload); if (f.fail) throw new Error('network'); return { id: 'report', status: 'SUBMITTED' }; };
  return f;
}
async function mount(f) {
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require, console, fixture: f,
    crypto: f.withoutRandomUUID ? { getRandomValues: (bytes) => { bytes.fill(++f.counter); return bytes; } }
      : { randomUUID: () => `id-${++f.counter}` } });
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(module.exports.default)); });
  return renderer;
}

test('missing meal price blocks sending; retry keeps submission id until the amount changes', async () => {
  const f = fixture(); const r = await mount(f);
  try {
    await click(r, 'Сформировать');
    assert.equal(button(r, 'Отправить в Авию').props.disabled, true);
    await act(async () => mealInput(r).props.onChange({ target: { value: '0' } }));
    await click(r, 'Отправить в Авию');
    await click(r, 'Отправить в Авию');
    assert.equal(f.calls[0].submissionId, f.calls[1].submissionId);
    assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].corrections)), [{ reservationId: row.reservationId, mealKopecks: 0 }]);
    await act(async () => mealInput(r).props.onChange({ target: { value: '5.05' } }));
    await click(r, 'Отправить в Авию');
    assert.notEqual(f.calls[1].submissionId, f.calls[2].submissionId);
    assert.equal(f.calls[2].corrections[0].mealKopecks, 505);
  } finally { await act(async () => r.unmount()); }
});

test('returned report shows the reason and prepares the same period for a new version', async () => {
  const f = fixture([{ id: 'report', status: 'RETURNED', startDate: '2026-09-01', endDate: '2026-09-10',
    totalKopecks: 100, version: 3, returnReason: 'Уточните питание' }]);
  const r = await mount(f);
  try {
    assert.match(textOf(r.root), /Уточните питание/);
    await click(r, 'Доработать');
    assert.match(textOf(r.root), /Э-1/);
    await act(async () => mealInput(r).props.onChange({ target: { value: '0' } }));
    await click(r, 'Отправить в Авию');
    assert.equal(f.calls[0].version, 3);
    assert.equal(f.calls[0].startDate, '2026-09-01');
    assert.equal(f.calls[0].endDate, '2026-09-10');
  } finally { await act(async () => r.unmount()); }
});

test('conflict explains how to refresh even when the server gives a short message', async () => {
  const f = fixture();
  f.sendSquadronReport = async () => { throw { response: { status: 409, data: { message: 'Конфликт' } } }; };
  const r = await mount(f);
  try {
    await click(r, 'Сформировать');
    await act(async () => mealInput(r).props.onChange({ target: { value: '0' } }));
    await click(r, 'Отправить в Авию');
    assert.match(textOf(r.root), /Конфликт/);
    assert.match(textOf(r.root), /Обновите/);
    assert.ok(button(r, 'Обновить список'));
  } finally { await act(async () => r.unmount()); }
});

test('accepted report opens as a read-only snapshot', async () => {
  const f = fixture([{ id: 'report', status: 'ACCEPTED', startDate: '2026-10-01', endDate: '2026-10-04',
    totalKopecks: 30003, version: 1, returnReason: null }]);
  const r = await mount(f);
  try {
    assert.equal(button(r, 'Доработать'), undefined);
    await click(r, 'Открыть');
    assert.match(textOf(r.root), /Э-1/);
    assert.equal(r.root.findAllByType('input').length, 0);
  } finally { await act(async () => r.unmount()); }
});

test('empty preview is visible and cannot be submitted', async () => {
  const f = fixture();
  f.previewSquadronReport = async (startDate, endDate) => ({ startDate, endDate, rows: [], previewToken: 'token', totalKopecks: 0 });
  const r = await mount(f);
  try {
    await click(r, 'Сформировать');
    assert.match(textOf(r.root), /Нет записей за выбранный период/);
    assert.equal(button(r, 'Отправить в Авию'), undefined);
  } finally { await act(async () => r.unmount()); }
});

test('refresh shows the dispatcher decision without changing tabs', async () => {
  const f = fixture(); const r = await mount(f);
  try {
    f.items = [{ id: 'report', status: 'RETURNED', startDate: '2026-10-01', endDate: '2026-10-04',
      totalKopecks: 30003, version: 1, returnReason: 'Исправьте сумму' }];
    await click(r, 'Обновить');
    assert.match(textOf(r.root), /Исправьте сумму/);
    assert.ok(button(r, 'Доработать'));
  } finally { await act(async () => r.unmount()); }
});

test('locks amounts during sending and shows the status from the idempotent response', async () => {
  const f = fixture();
  let resolveSend;
  f.sendSquadronReport = () => new Promise((resolve) => { resolveSend = resolve; });
  const r = await mount(f);
  try {
    await click(r, 'Сформировать');
    await act(async () => mealInput(r).props.onChange({ target: { value: '0' } }));
    let sending;
    act(() => { sending = button(r, 'Отправить в Авию').props.onClick(); });
    assert.equal(mealInput(r).props.disabled, true);
    await act(async () => { resolveSend({ id: 'report', status: 'ACCEPTED' }); await sending; });
    assert.match(textOf(r.root), /Статус: Принят/);
  } finally { await act(async () => r.unmount()); }
});

test('retains an entered amount only while the corresponding reservation facts stay the same', async () => {
  const f = fixture(); const r = await mount(f);
  try {
    await click(r, 'Сформировать');
    await act(async () => mealInput(r).props.onChange({ target: { value: '12.34' } }));
    await click(r, 'Сформировать');
    assert.equal(mealInput(r).props.value, 12.34);
    f.previewSquadronReport = async (startDate, endDate) => ({ startDate, endDate,
      rows: [{ ...row, factToken: 'changed' }], previewToken: 'new-token', totalKopecks: null });
    await click(r, 'Сформировать');
    assert.equal(mealInput(r).props.value, null);
  } finally { await act(async () => r.unmount()); }
});

test('generates a valid submission UUID when randomUUID is unavailable', async () => {
  const f = fixture(); f.withoutRandomUUID = true;
  const r = await mount(f);
  try {
    await click(r, 'Сформировать');
    await act(async () => mealInput(r).props.onChange({ target: { value: '0' } }));
    await click(r, 'Отправить в Авию');
    assert.match(f.calls[0].submissionId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  } finally { await act(async () => r.unmount()); }
});

test('revision carries amounts only for matching visible facts and can restore PMS amounts', async () => {
  const item = { id: 'report', status: 'RETURNED', startDate: '2026-10-01', endDate: '2026-10-04',
    totalKopecks: 123, version: 3, returnReason: 'Уточните питание' };
  const f = fixture([item]);
  const second = { ...row, reservationId: '33333333-3333-4333-8333-333333333333', requestNumber: 'Э-2', roomNumber: '202' };
  let detailCalls = 0;
  f.getSquadronReport = async () => { detailCalls++; return { ...item, rows: [
    { ...row, accommodationKopecks: 43210, mealKopecks: 0 },
    { ...second, guestCount: 1, accommodationKopecks: 99900, mealKopecks: 88800 },
  ] }; };
  f.previewSquadronReport = async (startDate, endDate) => ({ startDate, endDate, previewToken: 'token', totalKopecks: null,
    rows: [{ ...row, accommodationKopecks: 40000, mealKopecks: 5000 },
      { ...second, guestCount: 3, accommodationKopecks: 70000, mealKopecks: 100 }] });
  const r = await mount(f);
  try {
    await click(r, 'Доработать');
    assert.ok(detailCalls > 0);
    assert.match(textOf(r.root), /по неизменившимся строкам перенесены суммы/i);
    assert.equal(amountInput(r, 'Проживание, ₽', 'Э-1', '101').props.value, 432.1);
    assert.equal(amountInput(r, 'Питание, ₽', 'Э-1', '101').props.value, 0);
    assert.equal(amountInput(r, 'Проживание, ₽', 'Э-2', '202').props.value, 700);
    await act(async () => amountInput(r, 'Питание, ₽', 'Э-2', '202').props.onChange({ target: { value: '7.25' } }));
    await click(r, 'Отправить в Авию');
    assert.deepEqual(JSON.parse(JSON.stringify(f.calls[0].corrections)), [
      { reservationId: row.reservationId, accommodationKopecks: 43210, mealKopecks: 0 },
      { reservationId: second.reservationId, mealKopecks: 725 },
    ]);
    await click(r, 'Взять суммы из расчёта PMS');
    assert.equal(amountInput(r, 'Проживание, ₽', 'Э-1', '101').props.value, 400);
    assert.equal(amountInput(r, 'Питание, ₽', 'Э-1', '101').props.value, 50);
    assert.equal(amountInput(r, 'Питание, ₽', 'Э-2', '202').props.value, 1);
    assert.doesNotMatch(textOf(r.root), /перенесены суммы отправленной версии/i);
    assert.match(textOf(r.root), /Показаны суммы текущего расчёта PMS/i);
  } finally { await act(async () => r.unmount()); }
});

test('revision refreshes and reports an already changed status or version', async () => {
  const item = { id: 'report', status: 'RETURNED', startDate: '2026-10-01', endDate: '2026-10-04',
    totalKopecks: 123, version: 3, returnReason: 'Уточните питание' };
  const f = fixture([item]);
  let previewCalls = 0;
  f.getSquadronReport = async () => { f.items = [{ ...item, status: 'ACCEPTED', version: 4 }]; return { ...f.items[0], rows: [] }; };
  f.previewSquadronReport = async () => { previewCalls++; return {}; };
  const r = await mount(f);
  try {
    await click(r, 'Доработать');
    assert.match(textOf(r.root), /статус или версия отчёта изменил/i);
    assert.match(textOf(r.root), /Принят/);
    assert.equal(previewCalls, 0);
    assert.equal(button(r, 'Отправить в Авию'), undefined);
  } finally { await act(async () => r.unmount()); }
});
