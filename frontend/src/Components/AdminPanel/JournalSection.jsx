import React from 'react';
import * as superAdminApi from '../../api/superadmin';
import Modal from '../HotelPMS/shared/Modal';
import classes from './AdminPanel.module.css';
import jr from './JournalSection.module.css';

/* «Журнал действий» (23.10.2026): каждое нажатие в кабинетах гостиниц и
 * каждый запрос, меняющий данные, — кто, когда, что нажал и чем кончилось.
 * Видит платформа (суперадмин и диспетчер Kars Avia), по всем гостиницам;
 * сама гостиница журнал не видит (решение владельца). */

const EVENT_LABEL = {
  click: 'Нажатие',
  nav: 'Переход',
  open: 'Открыл кабинет',
  'dialog-open': 'Окно открыто',
  'dialog-close': 'Окно закрыто',
  submit: 'Отправка формы',
  edit: 'Правка поля',
  select: 'Выбор из списка',
  key: 'Клавиша',
  'js-error': 'Ошибка на экране',
  'tab-hidden': 'Ушёл с вкладки',
  'tab-visible': 'Вернулся на вкладку',
};

const PAGE = 100;

function dayToIso(day, end = false) {
  if (!day) return undefined;
  const d = new Date(`${day}T${end ? '23:59:59.999' : '00:00:00.000'}`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function time(iso) {
  const d = new Date(iso);
  return `${d.toLocaleDateString('ru-RU')} ${d.toLocaleTimeString('ru-RU')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
}

const failed = (e) => (e.status ?? 0) >= 400 || e.event === 'js-error';

function what(e) {
  if (e.kind === 'request') return { tag: e.method ?? '', text: e.path ?? '' };
  const dialog = typeof e.meta?.dialog === 'string' ? ` · окно «${e.meta.dialog}»` : '';
  return { tag: EVENT_LABEL[e.event] ?? e.event ?? '', text: `${e.label ?? ''}${dialog}` };
}

function result(e) {
  if (e.kind !== 'request') return '';
  if (e.status === 499) return 'прерван';
  return `${e.status ?? ''}${e.durationMs != null ? ` · ${e.durationMs} мс` : ''}`;
}

function who(e) {
  if (e.userName) return e.userName;
  if (e.partnerId) return `Партнёр: ${e.partnerId}`;
  return e.email ?? 'до входа';
}

export default function JournalSection() {
  const [q, setQ] = React.useState('');
  const [kind, setKind] = React.useState('');
  const [from, setFrom] = React.useState('');
  const [to, setTo] = React.useState('');
  const [onlyFailed, setOnlyFailed] = React.useState(false);
  const [pin, setPin] = React.useState({});
  const [items, setItems] = React.useState([]);
  const [next, setNext] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [detail, setDetail] = React.useState(null);

  const load = React.useCallback(
    async (before) => {
      setLoading(true);
      setError(null);
      try {
        const page = await superAdminApi.listJournal({
          ...pin,
          q: q.trim() || undefined,
          kind,
          failed: onlyFailed ? '1' : undefined,
          from: dayToIso(from),
          to: dayToIso(to, true),
          before,
          take: PAGE,
        });
        setItems((cur) => (before ? [...cur, ...page.items] : page.items));
        setNext(page.nextBefore);
      } catch (err) {
        const msg = err?.response?.data?.message ?? err.message;
        setError(Array.isArray(msg) ? msg.join(', ') : msg);
      } finally {
        setLoading(false);
      }
    },
    [pin, q, kind, onlyFailed, from, to],
  );

  React.useEffect(() => {
    // Поиск — с паузой: запрос на каждую букву ни к чему.
    const t = setTimeout(() => void load(), 300);
    return () => clearTimeout(t);
  }, [load]);

  const pinned = pin.sessionId || pin.actionId || pin.userId || pin.tenantId;
  const pinLabel = pin.actionId
    ? 'это нажатие и его запросы'
    : pin.sessionId
      ? 'вся вкладка'
      : pin.userId
        ? 'действия этого человека'
        : 'эта гостиница';

  return (
    <div className={classes.page}>
      <div className={classes.pageHeader}>
        <div>
          <h1 className={classes.pageTitle}>Журнал действий</h1>
          <div className={classes.muted}>Каждое нажатие и каждый запрос: кто, когда, что нажал и чем это кончилось</div>
        </div>
      </div>

      <div className={classes.card}>
        <div className={jr.toolbar}>
          <div className={classes.searchWrap}>
            <svg className={classes.searchIcon} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input className={classes.searchInput} placeholder="Кнопка, адрес, экран, почта, ошибка" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Поиск" />
          </div>
          <div className={classes.segTabs}>
            {[['', 'Всё'], ['ui', 'В кабинете'], ['request', 'Запросы']].map(([v, label]) => (
              <button type="button" key={v || 'all'} className={`${classes.segTab} ${kind === v ? classes.segTabActive : ''}`} onClick={() => setKind(v)}>
                {label}
              </button>
            ))}
          </div>
          <label className={jr.field}>
            С
            <input type="date" className={classes.searchInput} value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className={jr.field}>
            по
            <input type="date" className={classes.searchInput} value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <label className={jr.check}>
            <input type="checkbox" checked={onlyFailed} onChange={(e) => setOnlyFailed(e.target.checked)} />
            Только отказы и ошибки
          </label>
          <button type="button" className={classes.btnAction} onClick={() => void load()}>Обновить</button>
        </div>
        {pinned && (
          <div className={jr.pin}>
            Отбор: {pinLabel}
            <button type="button" className={classes.btnAction} onClick={() => setPin({})}>Сбросить</button>
          </div>
        )}
        {error && <div className={classes.formError} style={{ margin: '0 20px 12px' }}>{error}</div>}
        <table className={`${classes.table} ${jr.table}`}>
          <thead>
            <tr>
              <th style={{ width: 200 }}>Время</th>
              <th style={{ width: 200 }}>Кто</th>
              <th style={{ width: 180 }}>Гостиница</th>
              <th>Что</th>
              <th style={{ width: 180 }}>Экран</th>
              <th style={{ width: 120 }}>Итог</th>
            </tr>
          </thead>
          <tbody>
            {items.map((e) => {
              const w = what(e);
              return (
                <tr key={e.id} className={failed(e) ? jr.hot : ''} onClick={() => setDetail(e)}>
                  <td className={jr.mono}>{time(e.at)}</td>
                  <td>
                    <div className={jr.cut}>{who(e)}</div>
                    {e.impersonatedBy && <div className={classes.muted}>вход от имени</div>}
                  </td>
                  <td><div className={jr.cut}>{e.tenantName ?? '—'}</div></td>
                  <td>
                    <div className={jr.what}>
                      <span className={jr.tag}>{w.tag}</span>
                      <span className={jr.cut} title={w.text}>{w.text}</span>
                    </div>
                    {e.error && <div className={jr.err}>{e.error}</div>}
                  </td>
                  <td><div className={`${jr.cut} ${jr.mono}`} title={e.page ?? ''}>{e.page ?? '—'}</div></td>
                  <td className={classes.muted}>{result(e)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && items.length === 0 && !error && <div className={classes.loading}>Записей не найдено</div>}
        {loading && <div className={classes.loading}>Загрузка…</div>}
        {next && !loading && (
          <div className={jr.more}>
            <button type="button" className={classes.btnAction} onClick={() => void load(next)}>Показать ещё</button>
          </div>
        )}
      </div>

      {detail && <JournalDetail entry={detail} onClose={() => setDetail(null)} onPin={(p) => { setPin(p); setDetail(null); }} />}
    </div>
  );
}

function Row({ k, v }) {
  if (v === null || v === undefined || v === '') return null;
  return (
    <div className={jr.row}>
      <span className={jr.k}>{k}</span>
      <span className={jr.v}>{v}</span>
    </div>
  );
}

const json = (v) => (v === null || v === undefined ? null : JSON.stringify(v, null, 2));

function JournalDetail({ entry: e, onClose, onPin }) {
  const w = what(e);
  const body = json(e.body);
  const extra = json(e.meta ?? (e.query && Object.keys(e.query).length ? e.query : null));
  return (
    <Modal open title={`${w.tag} ${w.text}`.trim()} onClose={onClose} width="lg">
      <Row k="Время" v={time(e.at)} />
      <Row k="Кто" v={[who(e), e.email && e.userName ? e.email : null].filter(Boolean).join(' · ')} />
      <Row k="Вход от имени" v={e.impersonatedBy} />
      <Row k="Гостиница" v={e.tenantName} />
      <Row k="Экран" v={e.page} />
      <Row k="Маршрут" v={e.route} />
      <Row k="Итог" v={result(e)} />
      <Row k="Отказ" v={e.error} />
      <Row k="Элемент" v={e.target} />
      <Row k="Адрес" v={e.ip} />
      <Row k="Устройство" v={e.userAgent} />
      {body && (
        <>
          <div className={jr.label}>Что отправлено</div>
          <pre className={jr.json}>{body}</pre>
        </>
      )}
      {extra && (
        <>
          <div className={jr.label}>Подробности</div>
          <pre className={jr.json}>{extra}</pre>
        </>
      )}
      <div className={jr.links}>
        {e.actionId && <button type="button" className={classes.btnAction} onClick={() => onPin({ actionId: e.actionId })}>Это нажатие и его запросы</button>}
        {e.sessionId && <button type="button" className={classes.btnAction} onClick={() => onPin({ sessionId: e.sessionId })}>Вся вкладка</button>}
        {e.userId && <button type="button" className={classes.btnAction} onClick={() => onPin({ userId: e.userId })}>Действия этого человека</button>}
        {e.tenantId && <button type="button" className={classes.btnAction} onClick={() => onPin({ tenantId: e.tenantId })}>Вся гостиница</button>}
      </div>
    </Modal>
  );
}
