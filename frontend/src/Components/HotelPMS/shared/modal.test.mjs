import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';
import React, { act } from 'react';

const dom = new JSDOM('<!doctype html><html><body><div id="root"><button id="opener">Открыть</button><div id="mount"></div></div></body></html>', { url: 'http://localhost/' });
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent']) globalThis[key] = dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import('react-dom/client');
const require = createRequire(import.meta.url);
const { build } = createRequire(import.meta.resolve('vite'))('esbuild');
const built = await build({ stdin: { contents: "export {default as Modal} from './Modal.jsx'; export {default as ConfirmDialog} from './ConfirmDialog.jsx'; export {default as Select} from './Select.jsx'; export {default as DateInput} from './DateInput.jsx'; export {default as useModalCloseGuard} from './useModalCloseGuard.jsx';", resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'jsx' }, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', write: false, external: ['react', 'react-dom'], logLevel: 'silent',
  plugins: [{ name: 'styles', setup(b) { b.onLoad({ filter: /\.css$/ }, () => ({ contents: 'export default new Proxy({}, {get: (_, key) => key});', loader: 'js' })); } }],
});
const module = { exports: {} };
vm.runInNewContext(built.outputFiles[0].text, { module, exports: module.exports, require, console, window, document, HTMLElement, getComputedStyle: window.getComputedStyle.bind(window) });
const { Modal, ConfirmDialog, Select, DateInput, useModalCloseGuard } = module.exports;
const key = async (target, value, extra = {}) => act(async () => target.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...extra })));
const click = async (target) => act(async () => target.dispatchEvent(new MouseEvent('click', { bubbles: true })));
async function render(node) { const root = createRoot(document.getElementById('mount')); await act(async () => root.render(React.createElement(React.StrictMode, null, node))); return { close: () => act(async () => root.unmount()) }; }

test('окно выходит порталом из страницы, удерживает Tab и возвращает фокус', async () => {
  const opener = document.getElementById('opener'); opener.focus();
  const r = await render(React.createElement(Modal, { open: true, title: 'Тариф', onClose() {} }, React.createElement('input', { 'data-autofocus': true, id: 'name' }), React.createElement('button', { id: 'last' }, 'Сохранить')));
  try {
    const dialog = document.querySelector('[role="dialog"]');
    assert.equal(dialog.closest('#root'), null);
    assert.equal(document.activeElement.id, 'name');
    document.getElementById('last').focus(); await key(document.activeElement, 'Tab');
    assert.equal(document.activeElement.getAttribute('aria-label'), 'Закрыть');
    await key(document.activeElement, 'Tab', { shiftKey: true });
    assert.equal(document.activeElement.id, 'last');
    assert.equal(document.getElementById('root').hasAttribute('inert'), true);
  } finally { await r.close(); }
  assert.equal(document.activeElement, opener);
  assert.equal(document.getElementById('root').hasAttribute('inert'), false);
});

test('Escape закрывает только подтверждение, сохраняя родительское окно', async () => {
  let parentClosed = 0; let confirmClosed = 0;
  const r = await render(React.createElement(Modal, { open: true, title: 'Тариф', onClose: () => parentClosed++ },
    React.createElement(ConfirmDialog, { open: true, title: 'Удалить?', message: 'Подтвердите', onClose: () => confirmClosed++, onConfirm() {} })));
  try { await key(document.activeElement, 'Escape'); assert.equal(confirmClosed, 1); assert.equal(parentClosed, 0); }
  finally { await r.close(); }
});

test('занятое окно нельзя закрыть Escape или крестиком', async () => {
  let closed = 0;
  const r = await render(React.createElement(Modal, { open: true, busy: true, title: 'Сохранение', onClose: () => closed++ }));
  try { await key(document.activeElement, 'Escape'); await click(document.querySelector('[aria-label="Закрыть"]')); assert.equal(closed, 0); }
  finally { await r.close(); }
});

test('Escape в выпадающем списке закрывает список, а не окно', async () => {
  let closed = 0;
  const r = await render(React.createElement(Modal, { open: true, title: 'Условия', onClose: () => closed++ },
    React.createElement(Select, { value: 'a', onChange() {} }, React.createElement('option', { value: 'a' }, 'Первый'), React.createElement('option', { value: 'b' }, 'Второй'))));
  try {
    const select = document.querySelector('[role="combobox"]'); await click(select);
    const option = document.querySelector('[role="option"]'); option.focus(); await key(option, 'Escape');
    assert.equal(document.querySelector('[role="listbox"]'), null); assert.equal(closed, 0);
  } finally { await r.close(); }
});

test('Escape закрывает всплывающий календарь и возвращает фокус в поле', async () => {
  let closed = 0;
  const r = await render(React.createElement(Modal, { open: true, title: 'Период', onClose: () => closed++ }, React.createElement(DateInput, { value: '2026-11-14', onChange() {} })));
  try {
    const trigger = document.querySelector('[aria-haspopup="dialog"]'); await click(trigger);
    const dayButton = document.querySelector('.pms-cal-day'); dayButton.focus(); await key(dayButton, 'Escape');
    assert.equal(document.querySelector('.pms-cal'), null); assert.equal(closed, 0); assert.equal(document.activeElement, trigger);
  } finally { await r.close(); }
});

test('фон и Escape используют один вопрос, drag из окна на фон не закрывает его', async () => {
  function Guarded() {
    const [open, setOpen] = React.useState(true);
    const guard = useModalCloseGuard({ dirty: true, onClose: () => setOpen(false) });
    return open ? React.createElement(React.Fragment, null, React.createElement(Modal, { open, title: 'Черновик', onClose: guard.requestClose }, React.createElement('input', { defaultValue: 'Название' })), guard.confirmation) : null;
  }
  const opener = document.getElementById('opener'); opener.focus();
  const r = await render(React.createElement(Guarded));
  try {
    const background = document.querySelector('[data-pms-overlay]');
    await act(async () => document.querySelector('input').dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    await click(background); assert.equal(document.querySelector('[role="alertdialog"]'), null);
    await act(async () => background.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })));
    await click(background); assert.equal(document.querySelectorAll('[role="alertdialog"]').length, 1);
    await key(document.activeElement, 'Escape'); assert.equal(document.querySelector('[role="alertdialog"]'), null);
    assert.ok(document.querySelector('[role="dialog"]'));
    await key(document.activeElement, 'Escape');
    const confirm = [...document.querySelectorAll('[role="alertdialog"] button')].find((b) => b.textContent === 'Закрыть без сохранения');
    await click(confirm); assert.equal(document.querySelector('[data-pms-overlay]'), null); assert.equal(document.activeElement, opener);
  } finally { await r.close(); }
});
