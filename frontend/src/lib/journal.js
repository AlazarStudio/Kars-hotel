/* След действий в кабинете — журнал действий (23.10.2026; перенос из Kars Avia,
 * operator-web/src/lib/journal.ts — общего кода у систем нет).
 *
 * Что человек нажал, куда перешёл, какое окно открылось и закрылось, какую
 * форму отправил, какая ошибка вылезла на экране — пачками на сервер
 * (`POST /journal/ui`). Запросы к API несут номер вкладки и номер последнего
 * нажатия (`x-client-session`, `x-client-action`): по ним серверная строка
 * «PATCH /requests/…» сводится с кнопкой, от которой пошла.
 *
 * Введённый текст НЕ пишется — только ЧТО нажато и в каком поле правили.
 * Значения, ушедшие на сервер, журнал и так видит в теле запроса (с маской
 * секретов) — второй, неотфильтрованной копии им тут не нужно.
 */

const SESSION_KEY = 'kars-pms:journal-session';
/** Сколько после нажатия запросы считаются «от него». */
const ACTION_WINDOW_MS = 4000;
const FLUSH_MS = 3000;
const MAX_BATCH = 200;

const CLICKABLE =
  'button, a, [role=button], [role=tab], [role=menuitem], [role=menuitemcheckbox], [role=option], [role=switch], [role=checkbox], [role=radio], [role=link], input[type=checkbox], input[type=radio], input[type=submit], input[type=button], summary, label, th, tr[data-id], [data-journal]';
const DIALOG = '[role=dialog], [role=alertdialog], .modal';

function uid() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

function readSession() {
  try {
    const s = sessionStorage.getItem(SESSION_KEY);
    if (s) return s;
    const n = uid();
    sessionStorage.setItem(SESSION_KEY, n);
    return n;
  } catch {
    return uid();
  }
}

let sessionId = null;
let lastAction = null;
let queue = [];
let postUrl = null;
let tokenOf = () => null;

function session() {
  if (!sessionId) sessionId = typeof window === 'undefined' ? uid() : readSession();
  return sessionId;
}

/** Заголовки для запроса к API: вкладка и нажатие, от которого он пошёл. */
export function journalHeaders(headers) {
  if (typeof window === 'undefined') return;
  headers.set('x-client-session', session());
  // Экран, с которого ушёл запрос: адрес уже закодирован браузером — ASCII.
  headers.set('x-client-page', (location.pathname + location.search).slice(0, 500));
  if (lastAction && Date.now() - lastAction.at < ACTION_WINDOW_MS) headers.set('x-client-action', lastAction.id);
}

const squash = (s, n = 120) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export function labelOf(el) {
  const aria = el.getAttribute('aria-label') || el.getAttribute('data-journal');
  if (aria) return squash(aria);
  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
    const lab = el.labels?.[0];
    if (lab) return squash(lab.textContent);
  }
  const text = squash((el).innerText ?? el.textContent);
  return text || squash(el.getAttribute('title')) || squash(el.getAttribute('name'));
}

export function describe(el) {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : '';
  const name = el.getAttribute('name') ? `[name=${el.getAttribute('name')}]` : '';
  const role = el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : '';
  const cls = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 2).filter(Boolean) : [];
  return `${tag}${id}${name}${role}${cls.length ? '.' + cls.join('.') : ''}`.slice(0, 300);
}

function dialogLabel(d) {
  return (
    squash(d.getAttribute('aria-label')) ||
    squash(d.querySelector('h1, h2, h3, .modal-title, .modal-head')?.textContent) ||
    describe(d)
  );
}

function page() {
  return (location.pathname + location.search).slice(0, 500);
}

function push(e) {
  queue.push({ at: new Date().toISOString(), page: page(), ...e });
  if (queue.length >= MAX_BATCH) flushJournal();
}

/** Отправить накопленное сейчас (перед выходом, при уходе со вкладки). */
export function flushJournal() {
  if (!postUrl || !queue.length) return;
  const events = queue.slice(0, MAX_BATCH);
  queue = queue.slice(MAX_BATCH);
  const body = JSON.stringify({ sessionId: session(), sentAt: new Date().toISOString(), events });
  try {
    // keepalive — пачка доходит и тогда, когда вкладку уже закрывают.
    void fetch(postUrl, {
      method: 'POST',
      keepalive: body.length < 60_000,
      // Кабинет входит по Bearer-токену, а не по куке.
      headers: { 'Content-Type': 'application/json', ...(tokenOf() ? { Authorization: `Bearer ${tokenOf()}` } : {}) },
      body,
    }).catch(() => undefined);
  } catch {
    /* журнал не мешает работе */
  }
  if (queue.length) flushJournal();
}

/** Включить след для вошедшего пользователя. Возвращает выключатель. */
export function startJournal(url, getToken) {
  postUrl = url;
  tokenOf = getToken;
  const onClick = (ev) => {
    const el = (ev.target)?.closest?.(CLICKABLE);
    if (!el) return;
    const id = uid();
    lastAction = { id, at: Date.now() };
    const meta = {};
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) meta.checked = el.checked;
    const ariaChecked = el.getAttribute('aria-checked') ?? el.getAttribute('aria-selected');
    if (ariaChecked) meta.state = ariaChecked;
    if (el instanceof HTMLAnchorElement && el.href) {
      try {
        const u = new URL(el.href);
        meta.href = u.origin === location.origin ? u.pathname + u.search : u.origin + u.pathname;
      } catch {
        /* относительная ссылка без адреса */
      }
    }
    const dlg = el.closest(DIALOG);
    if (dlg) meta.dialog = dialogLabel(dlg);
    if (el instanceof HTMLButtonElement && el.disabled) meta.disabled = true;
    push({ event: 'click', label: labelOf(el), target: describe(el), actionId: id, meta: Object.keys(meta).length ? meta : undefined });
  };
  const onChange = (ev) => {
    const el = ev.target;
    if (!el) return;
    const dlg = el.closest(DIALOG);
    const meta = dlg ? { dialog: dialogLabel(dlg) } : {};
    if (el instanceof HTMLSelectElement) {
      // Выбор из списка — не ввод текста: пишем, что выбрано.
      push({ event: 'select', label: squash(el.selectedOptions[0]?.textContent), target: describe(el), meta });
    } else if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
      return; // уже записано нажатием
    } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      // Поле правили — какое, а не что ввели. Файл — имя и размер.
      if (el instanceof HTMLInputElement && el.type === 'file') {
        meta.files = Array.from(el.files ?? []).map((f) => ({ name: f.name, size: f.size }));
      }
      const label = el.labels?.[0]?.textContent || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.name;
      push({ event: 'edit', label: squash(label), target: describe(el), meta: Object.keys(meta).length ? meta : undefined });
    }
  };
  const onSubmit = (ev) => {
    const f = ev.target;
    const id = uid();
    lastAction = { id, at: Date.now() };
    const dlg = f.closest(DIALOG);
    push({ event: 'submit', label: squash(f.getAttribute('aria-label') || f.id || f.name), target: describe(f), actionId: id, meta: dlg ? { dialog: dialogLabel(dlg) } : undefined });
  };
  const onKey = (ev) => {
    // Enter и Escape — тоже «нажал»: сохраняют и закрывают окна без мыши.
    if (ev.key !== 'Enter' && ev.key !== 'Escape') return;
    const el = ev.target;
    if (el instanceof HTMLTextAreaElement && ev.key === 'Enter') return;
    const id = uid();
    lastAction = { id, at: Date.now() };
    const dlg = el?.closest?.(DIALOG);
    push({ event: 'key', label: ev.key, target: el ? describe(el) : undefined, actionId: id, meta: dlg ? { dialog: dialogLabel(dlg) } : undefined });
  };

  let lastPage = page();
  push({ event: 'open', meta: { width: innerWidth, height: innerHeight } });
  const onNav = () => {
    const p = page();
    if (p === lastPage) return;
    push({ event: 'nav', meta: { from: lastPage } });
    lastPage = p;
  };
  const origPush = history.pushState.bind(history);
  const origReplace = history.replaceState.bind(history);
  history.pushState = (...a) => {
    origPush(...a);
    onNav();
  };
  history.replaceState = (...a) => {
    origReplace(...a);
    onNav();
  };

  // Окна: появилось / пропало. Наблюдатель, а не правка всех 60 окон.
  const open = new Set();
  const scan = () => {
    const now = new Set(Array.from(document.querySelectorAll(DIALOG)).filter((d) => !d.parentElement?.closest(DIALOG)));
    for (const d of now) if (!open.has(d)) push({ event: 'dialog-open', label: dialogLabel(d), target: describe(d) });
    for (const d of open) if (!now.has(d)) push({ event: 'dialog-close', label: dialogLabel(d), target: describe(d) });
    open.clear();
    for (const d of now) open.add(d);
  };
  const mo = new MutationObserver(scan);
  mo.observe(document.body, { childList: true, subtree: true });

  const onError = (ev) => push({ event: 'js-error', label: squash(ev.message, 300), meta: { src: `${ev.filename}:${ev.lineno}` } });
  const onRejection = (ev) =>
    push({ event: 'js-error', label: squash(String((ev.reason)?.message ?? ev.reason), 300) });
  const onVisibility = () => {
    push({ event: document.visibilityState === 'hidden' ? 'tab-hidden' : 'tab-visible' });
    if (document.visibilityState === 'hidden') flushJournal();
  };

  document.addEventListener('click', onClick, true);
  document.addEventListener('change', onChange, true);
  document.addEventListener('submit', onSubmit, true);
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('popstate', onNav);
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', flushJournal);
  const timer = setInterval(flushJournal, FLUSH_MS);

  return () => {
    flushJournal();
    clearInterval(timer);
    mo.disconnect();
    history.pushState = origPush;
    history.replaceState = origReplace;
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('change', onChange, true);
    document.removeEventListener('submit', onSubmit, true);
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('popstate', onNav);
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', flushJournal);
    postUrl = null;
  };
}
