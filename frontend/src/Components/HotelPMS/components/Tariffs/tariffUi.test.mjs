import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

// React runs without a browser. Only IO hooks and DOM-specific shared inputs are
// replaced; the tariff components, events, effects and state are production code.
const require = createRequire(import.meta.url);
const { build } = createRequire(import.meta.resolve('vite'))('esbuild');
const hooks = ['useRatePlans', 'useCreateRatePlan', 'useUpdateRatePlan', 'useDeleteRatePlan',
  'useRoomTypes', 'useTariffRoomTypes', 'useRates', 'useBulkUpsertRates', 'useFillRates', 'useStandardRates',
  'useSetStandardRates', 'useSeasons', 'useReplaceSeasons', 'useContracts', 'usePartners',
  'useContractPrices', 'useContractPreview'];
const bundle = await build({
  stdin: { contents: `import React from 'react';
    import Tariffs from './Tariffs.jsx';
    import { AuthContext } from '../../../../auth/AuthContext.js';
    export default function TestPage() {
      const auth = { hasPermission: code => globalThis.fixture.permissions.includes(code) };
      return <AuthContext.Provider value={auth}><Tariffs /></AuthContext.Provider>;
    }`, resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'jsx' }, bundle: true,
  platform: 'node', format: 'cjs', jsx: 'automatic', write: false, external: ['react', 'react-dom'], logLevel: 'silent',
  plugins: [{ name: 'test-boundaries', setup(builder) {
    // DOM mechanics are tested with real portals in shared/modal.test.mjs.
    builder.onResolve({ filter: /\/DialogLayer(\.jsx)?$/ }, (args) => ({ path: args.path, namespace: 'dialog-layer' }));
    builder.onLoad({ filter: /.*/, namespace: 'dialog-layer' }, () => ({ contents: "import React from 'react'; export default function Layer({open=true,role='dialog',title,children,...rest}) { return open ? React.createElement('div',{role,'aria-label':title,...rest},children) : null; }" }));
    builder.onResolve({ filter: /\/hooks\/api\// }, (args) => ({ path: args.path, namespace: 'hooks' }));
    builder.onLoad({ filter: /.*/, namespace: 'hooks' }, () => ({ contents: hooks.map((name) => 'export const ' + name + ' = (...args) => globalThis.fixture.hooks.' + name + '(...args);').join('\n') }));
    builder.onLoad({ filter: /\.css$/ }, () => ({ contents: 'export default new Proxy({}, {get: (_, key) => key});', loader: 'js' }));
    builder.onResolve({ filter: /\/shared\/(Select|DateInput|NumberInput)(\.jsx)?$/ }, (args) => ({ path: args.path, namespace: 'control' }));
    builder.onLoad({ filter: /.*/, namespace: 'control' }, (args) => ({ contents:
      "import React from 'react'; export default function Control(props) { return React.createElement(" +
      (args.path.includes('Select') ? "'select', props" : args.path.includes('NumberInput')
        ? "'input', {...props, 'data-number': true, onChange: e => props.onChange(e.target.value === '' ? null : Number(e.target.value))}" : "'input', props") + '); }', loader: 'js' }));
  } }],
});

const noPrices = { contractNumber: '205', today: '2026-11-15', timezone: 'Europe/Moscow',
  hasSlice: true, unknownCustomer: false, periods: [], periodDetails: [], categories: [],
  nights: [{ day: '2026-11-15', prices: [], reason: 'NO_DOCUMENTS', missing: [] }], vatRate: null };

function fixture(overrides = {}) {
  const f = { plans: [], contracts: [], partners: [], standard: [], seasons: [], calls: [],
    permissions: ['rate.read', 'rate.update'],
    rooms: [{ id: 'r1', name: 'Стандарт', maxOccupancy: 2 }], failPrices: false, preview: noPrices,
    ...overrides };
  const query = (data) => ({ data, isLoading: false, isError: false, refetch: async () => {} });
  const mutation = (fn) => ({ isPending: false, mutateAsync: fn });
  f.hooks = {
    useRatePlans: () => query(f.plans),
    useRoomTypes: () => f.generalRoomTypesForbidden ? { ...query(undefined), isError: true, error: { status: 403 } } : query(f.rooms),
    useTariffRoomTypes: () => query(f.rooms),
    useContracts: () => query(f.contracts), usePartners: () => query(f.partners),
    useCreateRatePlan: () => mutation(async (payload) => {
      f.calls.push(['create', payload]);
      if (f.failCreate) throw Error('Ошибка создания тарифа');
      const p = { ...payload, id: 'new-plan' };
      f.plans = [...f.plans, p];
      return p;
    }),
    useUpdateRatePlan: () => mutation(async (args) => { f.calls.push(['update', args]); return { ...args.payload, id: args.id }; }),
    useDeleteRatePlan: () => mutation(async (id) => { f.calls.push(['delete', id]); if (f.failDelete) throw Error('Есть бронирования'); }),
    useStandardRates: () => query(f.standard),
    useSetStandardRates: () => mutation(async (args) => { f.calls.push(['prices', args]); if (f.failPrices) throw Error('Ошибка записи цен'); f.standard = args.items; }),
    useSeasons: () => query(f.seasons),
    useReplaceSeasons: () => mutation(async (args) => { f.calls.push(['seasons', args]); if (f.failSeasons) throw Error('Ошибка записи сезонов'); }),
    useRates: () => query([]), useBulkUpsertRates: () => mutation(async (items) => { f.calls.push(['calendar', items]); }),
    useFillRates: () => mutation(async (args) => { f.calls.push(['fill', args]); }),
    useContractPrices: () => query(f.preview), useContractPreview: () => query(f.preview),
  };
  return f;
}

async function mount(f, options) {
  const module = { exports: {} };
  vm.runInNewContext(bundle.outputFiles[0].text, { module, exports: module.exports, require, console, fixture: f });
  let renderer;
  await act(async () => { renderer = TestRenderer.create(React.createElement(module.exports.default), options); });
  return renderer;
}
const textOf = (node) => typeof node === 'string' ? node : (node.children ?? []).map(textOf).join('');
const alerts = (r) => r.root.findAll((n) => typeof n.type === 'string' && n.props.role === 'alertdialog');
const within = (node, predicate) => {
  for (let current = node; current; current = current.parent) if (predicate(current)) return true;
  return false;
};
const panel = (r) => r.root.findAllByProps({ role: 'tabpanel' }).find((n) => !n.props.hidden);
const button = (r, label) => (alerts(r).at(-1) ?? r.root.findAllByProps({ role: 'dialog' })[0] ?? r.root)
  .findAllByType('button').find((b) => textOf(b) === label && !within(b, (n) =>
    n.props.hidden || n.props.style?.display === 'none' || (n.type === 'details' && !n.props.open)));
const click = async (r, label) => { const b = button(r, label); assert.ok(b, 'button: ' + label); assert.ok(!b.props.disabled, 'enabled: ' + label); await act(async () => { await b.props.onClick(); }); };
const change = async (node, value) => act(async () => { node.props.onChange({ target: { value } }); });
const dialog = (r) => r.root.findByProps({ role: 'dialog' });
const topTab = (r, label) => {
  const tab = r.root.findAllByProps({ role: 'tab' }).find((item) => textOf(item).startsWith(label));
  assert.ok(tab, `верхняя вкладка «${label}»`);
  return tab;
};
const switchTab = async (r, label) => {
  const tab = topTab(r, label);
  assert.ok(tab, `top tab: ${label}`);
  await act(async () => tab.props.onClick());
  assert.equal(tab.props['aria-selected'], true);
};
const byLabel = (r, label) => panel(r).findByProps({ 'aria-label': label });
const ownPlan = { id: 'own', name: 'Собственный', code: 'OWN', isActive: true, mealPlan: 'NONE' };
const partner = (id) => ({ id, name: id, accounts: [], customers: [] });
const contract = (partnerId, number, extra = {}) => ({ partnerId, number, hasPrices: true, documents: 1,
  slices: [{ customer: null, guestKind: null, mealPlan: 'BB' }], ...extra });
const corporatePlan = (id, partnerId, operatorContract, extra = {}) => ({ id, partnerId, operatorContract,
  name: id, code: id.toUpperCase(), isActive: true, forOperator: true, mealPlan: 'BB', ...extra });
const toggleContract = async (details) => act(async () => details.findByType('summary').props.onClick({ preventDefault() {} }));

test('верхние вкладки показывают счётчики и отдельные пустые состояния', async () => {
  const r = await mount(fixture());
  try {
    assert.equal(textOf(topTab(r, 'Тарифы')), 'Тарифы0');
    assert.equal(textOf(topTab(r, 'Договоры партнёра')), 'Договоры партнёра0');
    assert.match(textOf(panel(r)), /Создайте первый тариф/);
    assert.ok(button(r, 'Новый тариф'));
    await switchTab(r, 'Договоры партнёра');
    assert.match(textOf(panel(r)), /Договоров пока нет/);
    assert.equal(r.root.findAllByType('button').some((b) => textOf(b) === 'Новый тариф'), false);
    assert.equal(r.root.findAllByProps({ role: 'tabpanel' }).length, 2);
  } finally { await act(async () => r.unmount()); }
});

test('с пустого списка тарифов можно открыть договоры в режиме просмотра', async () => {
  const r = await mount(fixture({ permissions: ['rate.read'], contracts: [contract('p1', '205')], partners: [partner('p1')] }));
  try {
    assert.equal(textOf(topTab(r, 'Договоры партнёра')), 'Договоры партнёра1');
    assert.equal(r.root.findAllByType('button').some((b) => textOf(b) === 'Новый тариф'), false);
    await click(r, 'Перейти к договорам');
    assert.equal(topTab(r, 'Договоры партнёра').props['aria-selected'], true);
    assert.match(textOf(panel(r)), /Договор 205/);
  } finally { await act(async () => r.unmount()); }
});

test('переключение сохраняет активный тариф, даты календаря, число гостей, поиск и предпросмотр', async () => {
  const contracts = [contract('p1', '205', { isPrimary: true }), ...['206', '207', '208'].map((n) => contract('p1', n))];
  const f = fixture({ plans: [ownPlan, corporatePlan('corporate', 'p1', '205')], contracts, partners: [partner('p1')], preview: priced });
  const r = await mount(f);
  try {
    assert.equal(textOf(topTab(r, 'Тарифы')), 'Тарифы2');
    const selected = panel(r).findAllByType('button').find((b) => textOf(b).startsWith('corporate'));
    await act(async () => selected.props.onClick());
    await click(r, 'Календарь');
    await change(byLabel(r, 'Число гостей'), '2');
    await click(r, '30 дней');
    await act(async () => byLabel(r, 'На неделю вперёд').props.onClick());
    const dates = textOf(panel(r).findAllByType('strong')[0]);
    await switchTab(r, 'Договоры партнёра');
    await change(byLabel(r, 'Поиск договора по номеру или юрлицу'), '205');
    await click(r, 'Посмотреть цены');
    assert.ok(button(r, 'Скрыть цены'));
    await switchTab(r, 'Тарифы');
    assert.equal(selected.props['aria-pressed'], true);
    assert.equal(byLabel(r, 'Число гостей').props.value, 2);
    assert.equal(button(r, '30 дней').props['aria-pressed'], true);
    assert.equal(textOf(panel(r).findAllByType('strong')[0]), dates);
    await switchTab(r, 'Договоры партнёра');
    assert.equal(byLabel(r, 'Поиск договора по номеру или юрлицу').props.value, '205');
    assert.ok(button(r, 'Скрыть цены'));
    await toggleContract(panel(r).findByType('details'));
    f.contracts = f.contracts.map((c) => ({ ...c, documents: 2 }));
    await act(async () => r.update(React.createElement(r.root.type)));
    assert.equal(panel(r).findByType('details').props.open, false);
    await switchTab(r, 'Тарифы'); await switchTab(r, 'Договоры партнёра');
    assert.equal(panel(r).findByType('details').props.open, false);
    await toggleContract(panel(r).findByType('details'));
    assert.ok(button(r, 'Скрыть цены'));
  } finally { await act(async () => r.unmount()); }
});

test('новый договор из фонового обновления не закрывает открытый договор с предпросмотром', async () => {
  const f = fixture({ contracts: [contract('p1', '205')], partners: [partner('p1')], preview: priced });
  const r = await mount(f);
  const refetch = async (contracts) => {
    f.contracts = contracts;
    await act(async () => r.update(React.createElement(r.root.type)));
  };
  try {
    await switchTab(r, 'Договоры партнёра');
    await click(r, 'Посмотреть цены');
    const next = contract('p1', '206', { isPrimary: true });
    await refetch([contract('p1', '205'), next]);
    const [first, second] = panel(r).findAllByType('details');
    assert.equal(first.props.open, true);
    assert.equal(second.props.open, true);
    assert.ok(button(r, 'Скрыть цены'));

    await toggleContract(first);
    await refetch([contract('p1', ' 205 ', { isPrimary: true }), { ...next, isPrimary: false }]);
    assert.equal(first.props.open, false);
    assert.equal(second.props.open, true);
  } finally { await act(async () => r.unmount()); }
});

test('прямые переходы находят нужного партнёра и срез при равных номерах, сохраняя поиск', async () => {
  const firstAccount = { id: 'a1', code: 'first', name: 'Первый' };
  const secondAccount = { id: 'a2', code: 'second', name: 'Второй' };
  const match = corporatePlan('Верный', 'p2', ' 205 ', { partnerAccountId: 'a2' });
  const wrongPartner = corporatePlan('Другой партнёр', 'p1', '205', { partnerAccountId: 'a1' });
  const wrongSlice = corporatePlan('Другое питание', 'p2', '205', { mealPlan: 'NONE', partnerAccountId: 'a2' });
  const f = fixture({ permissions: ['rate.read'], plans: [match, wrongPartner, wrongSlice],
    contracts: [contract('p1', '205', { account: firstAccount }), contract('p2', '205', { account: secondAccount }),
      contract('p1', '206'), contract('p2', '207')],
    partners: [{ ...partner('p1'), accounts: [firstAccount] }, { ...partner('p2'), accounts: [secondAccount] }] });
  const r = await mount(f);
  try {
    await switchTab(r, 'Договоры партнёра');
    await change(byLabel(r, 'Поиск договора по номеру или юрлицу'), 'Первый');
    await switchTab(r, 'Тарифы');
    await click(r, 'Открыть договор');
    assert.equal(topTab(r, 'Договоры партнёра').props['aria-selected'], true);
    const groups = panel(r).findAllByType('details');
    assert.equal(groups.length, 2);
    assert.equal(groups.find((group) => textOf(group).includes('Первый')).props.open, false);
    assert.equal(groups.find((group) => textOf(group).includes('Второй')).props.open, true);
    assert.equal(byLabel(r, 'Поиск договора по номеру или юрлицу').props.value, 'Первый');
    assert.match(textOf(panel(r)), /поисковый запрос сохранён/i);
    await switchTab(r, 'Тарифы');
    const other = panel(r).findAllByType('button').find((b) => textOf(b).startsWith('Другое питание'));
    await act(async () => other.props.onClick());
    assert.equal(other.props['aria-pressed'], true);
    await switchTab(r, 'Договоры партнёра');
    const link = button(r, 'Открыть тариф');
    assert.ok(link);
    await act(async () => link.props.onClick());
    assert.equal(topTab(r, 'Тарифы').props['aria-selected'], true);
    const active = panel(r).findAllByType('button').find((b) => b.props['aria-pressed'] === true);
    assert.match(textOf(active), /^Верный/);
    await switchTab(r, 'Договоры партнёра');
    await change(byLabel(r, 'Поиск договора по номеру или юрлицу'), 'Перв');
    assert.equal(panel(r).findAllByType('details').length, 1);
    assert.doesNotMatch(textOf(panel(r)), /поисковый запрос сохранён/i);
  } finally { await act(async () => r.unmount()); }
});

test('выбранный корпоративный тариф без соответствующего договора не даёт ложной ссылки', async () => {
  const r = await mount(fixture({ plans: [corporatePlan('Корпоративный', 'p2', '205')],
    contracts: [contract('p1', '205')], partners: [partner('p1'), partner('p2')] }));
  try { assert.equal(button(r, 'Открыть договор'), undefined); }
  finally { await act(async () => r.unmount()); }
});

test('верхние вкладки и кнопка нового тарифа находятся над блоком прокрутки', async () => {
  const f = fixture();
  f.hooks.useContracts = () => ({ data: f.contracts, isError: true, refetch: async () => {} });
  const r = await mount(f);
  try {
    const content = r.root.findByProps({ className: 'contentScroll' });
    const tabList = r.root.findByProps({ role: 'tablist' });
    const newButtons = r.root.findAllByType('button').filter((b) => textOf(b) === 'Новый тариф');
    assert.equal(newButtons.length, 1);
    assert.ok(newButtons[0].parent === tabList.parent, 'кнопка находится рядом со списком вкладок');
    assert.ok(tabList.parent.parent === content.parent, 'навигация находится над областью прокрутки');
    assert.equal(content.findAllByProps({ role: 'tabpanel' }).length, 2);
    assert.match(textOf(content), /Не удалось обновить данные/);
    await click(r, 'Новый тариф');
    assert.equal(within(dialog(r), (node) => node === content), false);
    assert.equal(dialog(r).findByProps({ id: 'tariff-name' }).props.value, '');
  } finally { await act(async () => r.unmount()); }
});

test('стрелки, Home и End сохраняют прокрутку, а прямой переход фокусирует цель в 12 px от верхней границы', async () => {
  const scroll = { scrollTop: 0, getBoundingClientRect: () => ({ top: 160 }) };
  const focused = [];
  const createNodeMock = ({ type, props }) => {
    if (props.className === 'contentScroll') return scroll;
    if (props.role === 'tab') return { focus: (options) => focused.push([props.id, options.preventScroll]) };
    if (type === 'summary') return {
      focus: (options) => focused.push(['contract', options.preventScroll]),
      getBoundingClientRect: () => ({ top: 420 - scroll.scrollTop }),
    };
    if (type === 'h2') return {
      focus: (options) => focused.push(['plan', options.preventScroll]),
      getBoundingClientRect: () => ({ top: 350 - scroll.scrollTop }),
    };
    return null;
  };
  const f = fixture({ plans: [corporatePlan('corp', 'p1', '205')], contracts: [contract('p1', '205')], partners: [partner('p1')] });
  const r = await mount(f, { createNodeMock });
  try {
    const plans = topTab(r, 'Тарифы');
    const contracts = topTab(r, 'Договоры партнёра');
    const press = async (tab, key) => {
      let handled = false;
      await act(async () => tab.props.onKeyDown({ key, preventDefault() { handled = true; } }));
      assert.equal(handled, true);
    };
    assert.equal(plans.props.tabIndex, 0);
    assert.equal(contracts.props.tabIndex, -1);
    assert.equal(panel(r).props['aria-labelledby'], plans.props.id);
    scroll.scrollTop = 110;
    await press(plans, 'ArrowRight');
    assert.deepEqual(focused.at(-1), [contracts.props.id, true]);
    assert.equal(contracts.props.tabIndex, 0);
    assert.equal(panel(r).props.id, contracts.props['aria-controls']);
    assert.equal(scroll.scrollTop, 0);
    scroll.scrollTop = 245;
    await press(contracts, 'Home');
    assert.deepEqual(focused.at(-1), [plans.props.id, true]);
    assert.equal(scroll.scrollTop, 110);
    await press(plans, 'End');
    assert.equal(scroll.scrollTop, 245);
    await press(contracts, 'ArrowLeft');
    assert.equal(scroll.scrollTop, 110);
    await click(r, 'Открыть договор');
    assert.deepEqual(focused.at(-1), ['contract', true]);
    assert.equal(420 - scroll.scrollTop - 160, 12);
    await click(r, 'Открыть тариф');
    assert.deepEqual(focused.at(-1), ['plan', true]);
    assert.equal(350 - scroll.scrollTop - 160, 12);
  } finally { await act(async () => r.unmount()); }
});

async function startOwn(r) {
  await click(r, 'Новый тариф');
  await change(r.root.findByProps({ id: 'tariff-name' }), 'Demo');
  await click(r, 'Далее');
  await click(r, 'Далее');
}

test('менеджер каналов без room.read открывает цены и мастер тарифов', async () => {
  const f = fixture({ generalRoomTypesForbidden: true,
    plans: [{ id: 'own', name: 'Свой', code: 'OWN', isActive: true, mealPlan: 'NONE' }],
    standard: [{ roomTypeId: 'r1', occupancy: 0, price: 3200 }],
  });
  const r = await mount(f);
  try {
    assert.equal(f.permissions.includes('room.read'), false);
    assert.equal(Boolean(button(r, 'Базовые цены')), true);
    assert.equal(r.root.findAllByType('input').find((node) => node.props['data-number']).props.value, '3200');
    await startOwn(r);
    assert.equal(textOf(dialog(r).findByProps({ 'aria-current': 'step' })), '3Цены');
  } finally { await act(async () => r.unmount()); }
});

test('базовым тарифом можно выбрать только другой собственный тариф', async () => {
  const f = fixture({ plans: [
    { id: 'own', name: 'Свой', code: 'OWN', mealPlan: 'NONE' },
    { id: 'base', name: 'Базовый', code: 'BASE', mealPlan: 'NONE' },
    { id: 'corp', name: 'Договорный', code: 'CORP', forOperator: true, mealPlan: 'NONE' },
  ] });
  const r = await mount(f);
  try {
    await act(async () => r.root.findByProps({ title: 'Редактировать план' }).props.onClick());
    const parent = dialog(r).findAllByType('select').find((node) => node.findAllByType('option').some((option) => option.props.value === 'base'));
    assert.deepEqual(parent.findAllByType('option').map((option) => option.props.value), ['', 'base']);
  } finally { await act(async () => r.unmount()); }
});

test('очистка описания и базового тарифа отправляет null при сохранении правки', async () => {
  const f = fixture({ plans: [
    { id: 'own', name: 'Свой', code: 'OWN', mealPlan: 'NONE', description: 'Старое описание', parentRatePlanId: 'base' },
    { id: 'base', name: 'Базовый', code: 'BASE', mealPlan: 'NONE' },
  ] });
  const r = await mount(f);
  try {
    await act(async () => r.root.findByProps({ title: 'Редактировать план' }).props.onClick());
    await change(dialog(r).findByType('textarea'), '');
    await change(dialog(r).findAllByType('select').find((node) => node.props.value === 'base'), '');
    await click(r, 'Сохранить');
    const update = f.calls.find(([kind]) => kind === 'update')[1];
    assert.equal(update.id, 'own');
    assert.equal(update.payload.description, null);
    assert.equal(update.payload.parentRatePlanId, null);
    assert.equal(r.root.findAllByProps({ role: 'dialog' }).length, 0);
  } finally { await act(async () => r.unmount()); }
});

test('rate.read оставляет собственные цены, сезоны и календарь только для просмотра', async () => {
  const f = fixture({ permissions: ['rate.read'],
    plans: [{ id: 'own', name: 'Свой', code: 'OWN', isActive: true, mealPlan: 'NONE' }],
    standard: [{ roomTypeId: 'r1', occupancy: 0, price: 3200 }],
    seasons: [{ roomTypeId: 'r1', occupancy: 0, name: 'Зима', dateFrom: '2026-11-01', dateTo: '2026-11-30', sortOrder: 0, price: 4500 }],
  });
  const r = await mount(f);
  try {
    assert.equal(Boolean(button(r, 'Новый тариф')), false);
    assert.equal(Boolean(button(r, '+ Добавить')), false);
    assert.equal(r.root.findAllByProps({ title: 'Редактировать план' }).length, 0);
    assert.equal(Boolean(button(r, 'Сохранить базовые цены')), false);
    const price = r.root.findAllByType('input').find((node) => node.props['data-number']);
    assert.equal(price.props.value, '3200');
    assert.equal(price.props.disabled, true);
    const seasonsTab = r.root.findAllByType('button').find((node) => textOf(node).startsWith('Сезоны'));
    await act(async () => seasonsTab.props.onClick());
    assert.equal(r.root.findByProps({ placeholder: 'Название сезона' }).props.value, 'Зима');
    assert.ok(r.root.findAllByType('input').every((node) => node.props.disabled));
    for (const label of ['Удалить', '+ Добавить сезон', 'Сохранить сезоны']) assert.equal(Boolean(button(r, label)), false);
    await click(r, 'Календарь');
    assert.equal(Boolean(button(r, 'Заполнить диапазон')), false);
    assert.ok(r.root.findAllByType('div').filter((node) => String(node.props.className).split(' ').includes('calCell')).every((node) => !node.props.onClick));
    await click(r, '30 дн'); await click(r, '›'); await click(r, 'Сегодня');
    assert.equal(r.root.findAllByProps({ className: 'calDayNum' }).length, 30);
    assert.equal(f.calls.length, 0);
  } finally { await act(async () => r.unmount()); }
});

test('rate.read оставляет договорные цены и календарь, скрывая создание по договору', async () => {
  const f = fixture({ permissions: ['rate.read'],
    plans: [{ id: 'corp', name: 'Договорный', code: 'CORP', forOperator: true, partnerId: 'p1', operatorContract: '205', mealPlan: 'BB' }],
    contracts: [
      { partnerId: 'p1', number: '205', hasPrices: true, documents: 1, slices: [{ customer: null, guestKind: null, mealPlan: 'BB' }, { customer: null, guestKind: null, mealPlan: 'NONE' }] },
      { partnerId: 'p1', number: '206', hasPrices: false, documents: 0, slices: [] },
    ], partners: [{ id: 'p1', name: 'Kars', accounts: [], customers: [] }], preview: priced,
  });
  const r = await mount(f);
  try {
    assert.equal(Boolean(button(r, 'Новый тариф')), false);
    assert.equal(panel(r).findAllByProps({ title: 'Редактировать план' }).length, 0);
    await click(r, 'Календарь');
    assert.match(textOf(r.root.findByProps({ 'aria-label': 'Календарь договорных цен' })), /3\s*000/);
    await change(r.root.findByProps({ 'aria-label': 'Число гостей' }), '2');
    assert.match(textOf(r.root.findByProps({ 'aria-label': 'Календарь договорных цен' })), /4\s*600/);
    await switchTab(r, 'Договоры партнёра');
    await toggleContract(panel(r).findAllByType('details')[0]);
    await toggleContract(panel(r).findAllByType('details')[1]);
    for (const label of ['Новый тариф', 'Завести тариф', 'Создать тариф по договору']) assert.equal(Boolean(button(r, label)), false);
    await click(r, 'Посмотреть цены'); assert.ok(button(r, 'Скрыть цены'));
    assert.equal(f.calls.length, 0);
  } finally { await act(async () => r.unmount()); }
});

test('реальный мастер сохраняет введённую цену при Далее и завершает тот же тариф', async () => {
  const f = fixture({ plans: [ownPlan] }); const r = await mount(f);
  try {
    await startOwn(r);
    const selectedName = () => textOf(panel(r).findAllByType('button').find((b) => b.props['aria-pressed'] === true));
    assert.match(selectedName(), /^Собственный/);
    await change(dialog(r).findAllByType('input').find((n) => n.props['data-number']), '3000');
    await click(r, 'Сохранить и далее');
    assert.equal(f.calls.find(([kind]) => kind === 'prices')[1].items[0].price, 3000);
    await click(r, 'Сохранить и далее');
    await click(r, 'Готово');
    assert.equal(f.calls.filter(([kind]) => kind === 'create').length, 1);
    assert.equal(f.calls.filter(([kind]) => kind === 'update').length, 1);
    assert.equal(r.root.findAllByProps({ role: 'dialog' }).length, 0);
    assert.match(selectedName(), /^Demo/);
  } finally { await act(async () => r.unmount()); }
});

test('ошибка сохранения цены оставляет реальный мастер на текущем шаге', async () => {
  const f = fixture({ failPrices: true }); const r = await mount(f);
  try {
    await startOwn(r);
    await change(dialog(r).findAllByType('input').find((n) => n.props['data-number']), '3000');
    await click(r, 'Сохранить и далее');
    assert.ok(dialog(r));
    assert.match(textOf(dialog(r)), /Ошибка записи цен/);
    assert.equal(textOf(dialog(r).findByProps({ 'aria-current': 'step' })), '3Цены');
    assert.equal(f.calls.some(([kind]) => kind === 'update'), false);
  } finally { await act(async () => r.unmount()); }
});

for (const failSeasons of [false, true]) {
  test(failSeasons ? 'ошибка сохранения сезона оставляет мастер на шаге сезонов' : 'Далее сохраняет введённый сезон с его ценой', async () => {
    const f = fixture({ failSeasons }); const r = await mount(f);
    try {
      await startOwn(r); await click(r, 'Сохранить и далее');
      await click(r, '+ Добавить сезон');
      await change(dialog(r).findByProps({ placeholder: 'Название сезона' }), 'Зима');
      await change(dialog(r).findByProps({ className: 'seasonCard' }).findAllByType('input').find((n) => n.props['data-number']), '4500');
      await click(r, 'Сохранить и далее');
      const saved = f.calls.find(([kind]) => kind === 'seasons')[1].seasons[0];
      assert.equal(saved.name, 'Зима');
      assert.equal(saved.items[0].price, 4500);
      assert.equal(textOf(dialog(r).findByProps({ 'aria-current': 'step' })), failSeasons ? '4Сезоны' : '5Проверка');
      if (failSeasons) assert.match(textOf(dialog(r)), /Ошибка записи сезонов/);
      assert.equal(f.calls.some(([kind]) => kind === 'update'), false);
    } finally { await act(async () => r.unmount()); }
  });
}

test('договор без приложения открывает единый мастер и создаёт ожидающий тариф', async () => {
  const f = fixture({ plans: [ownPlan], contracts: [{ partnerId: 'p1', number: '205', hasPrices: false, hasDocuments: false, slices: [], documents: 0 }], partners: [{ id: 'p1', name: 'Kars', accounts: [], customers: [] }] });
  const r = await mount(f);
  try {
    await switchTab(r, 'Договоры партнёра');
    await click(r, 'Создать тариф по договору');
    await change(r.root.findByProps({ id: 'tariff-name' }), 'Corporate');
    await click(r, 'Далее'); await click(r, 'Далее'); await click(r, 'Далее');
    assert.match(textOf(dialog(r)), /Ждёт цен по договору/);
    await click(r, 'Создать тариф');
    assert.equal(f.calls[0][1].operatorContract, '205');
    assert.equal(f.calls[0][1].forOperator, true);
    assert.equal('vatRate' in f.calls[0][1], false);
    assert.equal(topTab(r, 'Тарифы').props['aria-selected'], true);
    assert.match(textOf(panel(r).findAllByType('button').find((b) => b.props['aria-pressed'] === true)), /^Corporate/);
  } finally { await act(async () => r.unmount()); }
});

test('неизвестная авиакомпания договора не разрешает создать общий тариф', async () => {
  const f = fixture({ contracts: [{ partnerId: 'p1', number: '205', hasPrices: true, documents: 1, slices: [
    { customer: 'unknown', guestKind: null, mealPlan: 'BB' }, { customer: null, guestKind: null, mealPlan: 'BB' },
  ] }], partners: [{ id: 'p1', name: 'Kars', accounts: [], customers: [] }] });
  const r = await mount(f);
  try {
    await switchTab(r, 'Договоры партнёра');
    const row = panel(r).findAllByType('li').find((li) => textOf(li).includes('unknown'));
    assert.equal(row.findAllByType('button').find((b) => textOf(b) === 'Завести тариф').props.disabled, true);
    assert.equal(f.calls.length, 0);
  } finally { await act(async () => r.unmount()); }
});

test('после обновления справочника доступны просмотр цен и создание тарифа с нужными IDs', async () => {
  const f = fixture({
    contracts: [{ partnerId: 'p1', number: '205', hasPrices: true, documents: 1,
      account: { code: 'new-account', name: 'Новое юрлицо' },
      slices: [{ customer: 'new-airline', guestKind: 'CREW', mealPlan: 'BB' }] }],
    partners: [{ id: 'p1', name: 'Kars', accounts: [], customers: [] }],
  });
  const r = await mount(f);
  try {
    await switchTab(r, 'Договоры партнёра');
    for (const label of ['Посмотреть цены', 'Завести тариф']) assert.equal(button(r, label).props.disabled, true);
    f.partners = [{ ...f.partners[0], accounts: [{ id: 'account-id', code: 'new-account', name: 'Новое юрлицо' }],
      customers: [{ id: 'airline-id', code: 'new-airline', name: 'Новая АК' }] }];
    await act(async () => r.update(React.createElement(r.root.type)));
    await click(r, 'Посмотреть цены'); assert.ok(button(r, 'Скрыть цены'));
    await click(r, 'Завести тариф');
    await change(dialog(r).findByProps({ id: 'tariff-name' }), 'Договорный');
    await click(r, 'Далее'); await click(r, 'Далее'); await click(r, 'Далее');
    await click(r, 'Создать тариф');
    const [, created] = f.calls.find(([kind]) => kind === 'create');
    assert.equal(created.operatorContract, '205');
    assert.equal(created.partnerAccountId, 'account-id');
    assert.equal(created.partnerCustomerId, 'airline-id');
    assert.equal(topTab(r, 'Тарифы').props['aria-selected'], true);
  } finally { await act(async () => r.unmount()); }
});

test('обновление договоров и справочника сохраняет шаг и черновик своего тарифа', async () => {
  const f = fixture();
  const r = await mount(f);
  try {
    await click(r, 'Новый тариф');
    await change(dialog(r).findByProps({ id: 'tariff-name' }), 'Мой черновик');
    await change(dialog(r).findByProps({ id: 'tariff-code' }), 'MANUAL_QA');
    await change(dialog(r).findByType('textarea'), 'Моё описание');
    await click(r, 'Далее');
    await click(r, 'Далее');
    const price = () => dialog(r).findAllByType('input').find((n) => n.props['data-number']);
    await change(price(), '4800');
    const activeStep = () => textOf(dialog(r).findByProps({ 'aria-current': 'step' }));
    assert.equal(activeStep(), '3Цены');

    f.contracts = [{ partnerId: 'p1', number: '206', hasPrices: false, documents: 0, slices: [] }];
    f.partners = [{ id: 'p1', name: 'Kars', accounts: [], customers: [] }];
    await act(async () => r.update(React.createElement(r.root.type)));
    assert.equal(activeStep(), '3Цены');
    assert.equal(price().props.value, '4800');
    const [, created] = f.calls.find(([kind]) => kind === 'create');
    assert.equal(created.name, 'Мой черновик');
    assert.equal(created.code, 'MANUAL_QA');
    assert.equal(created.description, 'Моё описание');
    await click(r, 'Назад');
    await click(r, 'Назад');
    assert.equal(dialog(r).findByType('textarea').props.value, 'Моё описание');
    assert.equal(dialog(r).findByProps({ id: 'tariff-name' }).props.value, 'Мой черновик');
    assert.equal(dialog(r).findByProps({ id: 'tariff-code' }).props.value, 'MANUAL_QA');
  } finally { await act(async () => r.unmount()); }
});

const priced = { ...noPrices, periods: ['2026-11-01'], vatRate: 10,
  periodDetails: [{ from: '2026-11-01', to: '2026-11-30', amendmentNumber: '7', vatRate: 10 }],
  categories: [{ categoryId: 'r1', name: 'Стандарт', capacity: 2 }, { categoryId: 'r2', name: 'Семейный', capacity: 3 }],
  nights: [{ day: '2026-11-15', reason: null, periodFrom: '2026-11-01', amendmentNumber: '7', missing: [], prices: [
    { categoryId: 'r1', occupancy: 1, price: '3000.00' }, { categoryId: 'r1', occupancy: 2, price: '4600.00' },
  ] }],
};

test('таблица и календарь показывают основание каждой цены без изменения сумм', async () => {
  const preview = { ...priced, nights: [{ ...priced.nights[0], prices: [
    { categoryId: 'r1', occupancy: 1, price: '3000.00', basis: 'class' },
    { categoryId: 'r1', occupancy: 2, price: '4600.00', basis: 'category' },
    { categoryId: 'r2', occupancy: 1, price: '3000.00', basis: 'default-class' },
  ] }] };
  const f = fixture({ plans: [{ id: 'p1', name: 'Договорный', forOperator: true, partnerId: 'partner', operatorContract: '205', mealPlan: 'BB' }], preview });
  const r = await mount(f);
  try {
    const rows = r.root.findAllByType('tr');
    assert.match(textOf(rows.find((row) => textOf(row).includes('Стандарт'))), /3\s*000.*По классу/);
    assert.match(textOf(rows.find((row) => textOf(row).includes('Семейный'))), /3\s*000.*Из «Стандарта»/);
    assert.match(textOf(r.root), /не отдельная цена этой категории/);
    await click(r, 'Календарь');
    const region = r.root.findByProps({ 'aria-label': 'Календарь договорных цен' });
    assert.match(textOf(region), /По классу/);
    assert.match(textOf(region), /Из «Стандарта»/);
    await change(r.root.findByProps({ 'aria-label': 'Число гостей' }), '2');
    assert.doesNotMatch(textOf(region), /По классу|Из «Стандарта»/);
    assert.match(textOf(region), /4\s*600/);
  } finally { await act(async () => r.unmount()); }
});

test('старые цены без основания показывают пояснение, а не выдуманную пометку', async () => {
  const f = fixture({ plans: [{ id: 'p1', name: 'Договорный', forOperator: true, partnerId: 'partner', operatorContract: '205', mealPlan: 'BB' }], preview: priced });
  const r = await mount(f);
  try {
    assert.match(textOf(r.root), /основание ещё не передано/);
    assert.doesNotMatch(textOf(r.root.findByType('table')), /По классу|Из «Стандарта»/);
    await click(r, 'Календарь');
    assert.match(textOf(r.root), /основание ещё не передано/);
    assert.doesNotMatch(textOf(r.root.findByProps({ 'aria-label': 'Календарь договорных цен' })), /По классу|Из «Стандарта»/);
  } finally { await act(async () => r.unmount()); }
});

test('календарь переключает число гостей и берёт сегодняшний день гостиницы', async () => {
  const f = fixture({ plans: [{ id: 'p1', name: 'Договорный', forOperator: true, partnerId: 'partner', operatorContract: '205', mealPlan: 'BB' }], preview: priced });
  const r = await mount(f);
  try {
    await click(r, 'Календарь');
    assert.match(textOf(r.root), /08\.11\.2026 — 21\.11\.2026/);
    const amounts = () => r.root.findAllByType('span').filter((n) => n.props.className === 'money').map(textOf);
    assert.deepEqual(amounts(), [Number(3000).toLocaleString('ru-RU')]);
    await change(r.root.findByProps({ 'aria-label': 'Число гостей' }), '2');
    assert.deepEqual(amounts(), [Number(4600).toLocaleString('ru-RU')]);
    assert.match(textOf(r.root), /ДС № 7/);
  } finally { await act(async () => r.unmount()); }
});

test('проверка нового корпоративного тарифа показывает цены, ДС и отсутствующие категории', async () => {
  const f = fixture({ preview: priced,
    contracts: [{ partnerId: 'partner', number: '205', hasPrices: true, documents: 1, slices: [{ customer: null, guestKind: null, mealPlan: 'BB' }] }],
    partners: [{ id: 'partner', name: 'Kars', accounts: [], customers: [] }],
  });
  const r = await mount(f);
  try {
    await switchTab(r, 'Договоры партнёра');
    await click(r, 'Завести тариф'); await change(r.root.findByProps({ id: 'tariff-name' }), 'Corporate');
    await click(r, 'Далее'); await click(r, 'Далее'); await click(r, 'Далее');
    const content = textOf(dialog(r));
    assert.match(content, /ДС № 7/);
    assert.ok(content.includes(Number(3000).toLocaleString('ru-RU')));
    assert.match(content, /Нет цены для категорий: Семейный/);
    assert.match(content, /НДС 10%/);
    assert.equal(f.calls.length, 0);
  } finally { await act(async () => r.unmount()); }
});

test('ошибка условий из серверного предпросмотра блокирует создание тарифа', async () => {
  const f = fixture({ preview: { ...noPrices, hasSlice: false, unknownCustomer: true },
    contracts: [{ partnerId: 'p1', number: '205', hasPrices: false, slices: [], documents: 0 }],
    partners: [{ id: 'p1', name: 'Kars', accounts: [], customers: [] }],
  });
  const r = await mount(f);
  try {
    await switchTab(r, 'Договоры партнёра');
    await click(r, 'Создать тариф по договору'); await change(r.root.findByProps({ id: 'tariff-name' }), 'Corporate');
    await click(r, 'Далее'); await click(r, 'Далее'); await click(r, 'Далее');
    assert.match(textOf(dialog(r)), /Условия требуют проверки/);
    assert.equal(button(r, 'Создать тариф').props.disabled, true);
    assert.equal(f.calls.length, 0);
  } finally { await act(async () => r.unmount()); }
});

test('сбой сохранения и отмена мастера сохраняют открытый договор и его предпросмотр', async () => {
  const f = fixture({ failCreate: true, contracts: [contract('p1', '205')], partners: [partner('p1')], preview: priced });
  const r = await mount(f);
  try {
    await switchTab(r, 'Договоры партнёра'); await click(r, 'Посмотреть цены');
    await click(r, 'Завести тариф'); await change(dialog(r).findByProps({ id: 'tariff-name' }), 'Черновик');
    await click(r, 'Далее'); await click(r, 'Далее'); await click(r, 'Далее');
    await click(r, 'Создать тариф');
    assert.match(textOf(dialog(r)), /Ошибка создания тарифа/);
    assert.equal(topTab(r, 'Договоры партнёра').props['aria-selected'], true);
    await click(r, 'Отмена'); await click(r, 'Закрыть без сохранения');
    assert.equal(topTab(r, 'Договоры партнёра').props['aria-selected'], true);
    assert.ok(button(r, 'Скрыть цены'));
  } finally { await act(async () => r.unmount()); }
});

test('сбой фонового обновления договоров сохраняет открытый мастер и введённые данные', async () => {
  const f = fixture(); const r = await mount(f);
  try {
    await click(r, 'Новый тариф'); await change(r.root.findByProps({ id: 'tariff-name' }), 'Мой черновик');
    const Page = r.root.type;
    f.hooks.useContracts = () => ({ data: f.contracts, isLoading: false, isError: true, refetch: async () => {} });
    await act(async () => r.update(React.createElement(Page)));
    assert.equal(dialog(r).findByProps({ id: 'tariff-name' }).props.value, 'Мой черновик');
    assert.match(textOf(r.root), /Не удалось обновить данные/);
  } finally { await act(async () => r.unmount()); }
});

test('выход из заполненного мастера требует подтверждения и даёт вернуться к вводу', async () => {
  const f = fixture(); const r = await mount(f);
  try {
    await click(r, 'Новый тариф'); await change(r.root.findByProps({ id: 'tariff-name' }), 'Стандарт');
    await click(r, 'Отмена');
    assert.equal(alerts(r).length, 1);
    await click(r, 'Вернуться к вводу');
    assert.equal(r.root.findByProps({ id: 'tariff-name' }).props.value, 'Стандарт');
    await click(r, 'Отмена'); await click(r, 'Закрыть без сохранения');
    assert.equal(r.root.findAllByProps({ role: 'dialog' }).length, 0);
    assert.equal(f.calls.length, 0);
  } finally { await act(async () => r.unmount()); }
});

test('пустой мастер закрывается без подтверждения', async () => {
  const r = await mount(fixture());
  try { await click(r, 'Новый тариф'); await click(r, 'Отмена'); assert.equal(r.root.findAllByProps({ role: 'dialog' }).length, 0); assert.equal(alerts(r).length, 0); }
  finally { await act(async () => r.unmount()); }
});

test('если введённое название стёрли, пустой мастер снова закрывается без вопроса', async () => {
  const r = await mount(fixture());
  try {
    await click(r, 'Новый тариф'); await change(r.root.findByProps({ id: 'tariff-name' }), 'Тест');
    await change(r.root.findByProps({ id: 'tariff-name' }), ''); await click(r, 'Отмена');
    assert.equal(alerts(r).length, 0); assert.equal(r.root.findAllByProps({ role: 'dialog' }).length, 0);
  } finally { await act(async () => r.unmount()); }
});

test('окно заполнения диапазона сохраняет введённую цену при отмене выхода', async () => {
  const r = await mount(fixture({ plans: [{ id: 'p1', name: 'Стандарт', code: 'STANDARD', mealPlan: 'NONE' }] }));
  try {
    await click(r, 'Календарь'); await click(r, 'Заполнить диапазон');
    await change(dialog(r).findAllByType('input').find((n) => n.props.placeholder === '3800'), '4800');
    await click(r, 'Отмена'); assert.equal(alerts(r).length, 1); await click(r, 'Вернуться к вводу');
    assert.equal(dialog(r).findByProps({ placeholder: '3800' }).props.value, '4800');
  } finally { await act(async () => r.unmount()); }
});

test('после перехода на следующий шаг закрытие мастера требует подтверждения', async () => {
  const r = await mount(fixture());
  try {
    await click(r, 'Новый тариф'); await change(r.root.findByProps({ id: 'tariff-name' }), 'Новый'); await click(r, 'Далее');
    await click(r, 'Отмена'); assert.equal(alerts(r).length, 1);
    await click(r, 'Вернуться к вводу'); await click(r, 'Назад');
    assert.equal(r.root.findByProps({ id: 'tariff-name' }).props.value, 'Новый');
  } finally { await act(async () => r.unmount()); }
});

test('удаление сезона подтверждается до удаления введённой цены', async () => {
  const r = await mount(fixture());
  try {
    await startOwn(r); await click(r, 'Сохранить и далее'); await click(r, '+ Добавить сезон');
    await change(dialog(r).findByProps({ placeholder: 'Название сезона' }), 'Лето');
    await click(r, 'Удалить'); assert.equal(alerts(r).length, 1);
    await click(r, 'Отмена'); assert.equal(dialog(r).findByProps({ placeholder: 'Название сезона' }).props.value, 'Лето');
    await click(r, 'Удалить'); await click(r, 'Удалить сезон');
    assert.equal(dialog(r).findAllByProps({ placeholder: 'Название сезона' }).length, 0);
  } finally { await act(async () => r.unmount()); }
});

for (const failDelete of [false, true]) {
  test(failDelete ? 'ошибка удаления остаётся в подтверждении с возможностью повтора' : 'тариф удаляется только после подтверждения', async () => {
    const f = fixture({ failDelete, plans: [{ id: 'p1', name: 'Стандарт', code: 'STANDARD', isActive: true, mealPlan: 'NONE' }] });
    const r = await mount(f);
    try {
      await act(async () => r.root.findByProps({ title: 'Редактировать план' }).props.onClick());
      await click(r, 'Удалить'); assert.equal(f.calls.length, 0);
      await click(r, 'Удалить тариф');
      assert.equal(f.calls.filter(([kind]) => kind === 'delete').length, 1);
      if (failDelete) { assert.match(textOf(alerts(r)[0]), /Есть бронирования/); assert.ok(dialog(r)); }
      else assert.equal(r.root.findAllByProps({ role: 'dialog' }).length, 0);
    } finally { await act(async () => r.unmount()); }
  });
}
