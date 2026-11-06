import { useCallback, useEffect, useState } from 'react';
import classes from './Reports.module.css';
import { getFapReport, listFapReports, sendFapInvoice, sendFapReport } from '../../../../api/aviaReports';

/**
 * 4.2 · Детализация для Kars Avia по заявкам ФАП. Состав гостей приходит из Авиа,
 * гостиница вносит номера, ночи и питание и отправляет на согласование. После
 * утверждения авиакомпанией прикладывает счёт PDF. Денег здесь нет: цены считает Авиа.
 */

const STAGE = ['Отчёт у диспетчера', 'На проверке', 'Цены согласованы', 'Утверждён авиакомпанией'];
const FIELDS = [
  ['roomNumber', 'Номер', 'text'],
  ['daysCount', 'Сутки', 'number'],
  ['breakfastCount', 'Завтраки', 'number'],
  ['lunchCount', 'Обеды', 'number'],
  ['dinnerCount', 'Ужины', 'number'],
];
const errorOf = (e, fallback) => e?.response?.data?.message || fallback;

function Report({ item, onDone }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getFapReport(item.fapHotelId)
      .then((r) => setRows(r.rows))
      .catch((e) => setError(errorOf(e, 'Не удалось загрузить детализацию')));
  }, [item.fapHotelId]);

  const change = (i, key, type, value) =>
    setRows((list) => list.map((r, n) => (n === i ? { ...r, [key]: type === 'number' ? Number(value) : value } : r)));

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await sendFapReport(item.fapHotelId, rows);
      onDone();
    } catch (e) {
      setError(errorOf(e, 'Не удалось отправить'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: 12 }}>
      {error && <div style={{ color: 'var(--danger-text, #b42318)', marginBottom: 8 }}>{error}</div>}
      {!rows && !error && <div>Загрузка…</div>}
      {rows && (
        <>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>Гость</th>
                {FIELDS.map(([k, label]) => (
                  <th key={k} style={{ textAlign: 'left' }}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.guestId ?? i}>
                  <td>{r.fullName}</td>
                  {FIELDS.map(([k, label, type]) => (
                    <td key={k}>
                      <input aria-label={label} type={type} min="0" disabled={item.submitted} value={r[k] ?? ''} onChange={(e) => change(i, k, type, e.target.value)} style={{ width: 80 }} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {!item.submitted && (
            <button style={{ marginTop: 10 }} disabled={busy} onClick={send}>
              Отправить на согласование
            </button>
          )}
        </>
      )}
    </div>
  );
}

function Invoice({ item, onDone }) {
  const [file, setFile] = useState(null);
  const [rub, setRub] = useState('');
  const [number, setNumber] = useState('');
  const [error, setError] = useState(null);

  const send = async () => {
    setError(null);
    try {
      await sendFapInvoice(item.fapHotelId, file, Math.round(Number(rub.replace(',', '.')) * 100), number);
      onDone();
    } catch (e) {
      setError(errorOf(e, 'Не удалось отправить счёт'));
    }
  };

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: 12, flexWrap: 'wrap' }}>
      <input aria-label="Номер счёта" placeholder="Номер счёта" value={number} onChange={(e) => setNumber(e.target.value)} />
      <input aria-label="Сумма, ₽" placeholder="Сумма, ₽" inputMode="decimal" value={rub} onChange={(e) => setRub(e.target.value)} />
      <input aria-label="Счёт, PDF" type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <button disabled={!file || !rub.trim()} onClick={send}>Приложить счёт</button>
      {error && <span style={{ color: 'var(--danger-text, #b42318)' }}>{error}</span>}
    </div>
  );
}

export default function FapReportsTab() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);

  const load = useCallback(() => {
    listFapReports()
      .then(setItems)
      .catch((e) => {
        setError(errorOf(e, 'Не удалось загрузить заявки'));
        setItems([]);
      });
  }, []);
  useEffect(load, [load]);

  const done = () => {
    setOpen(null);
    load();
  };

  return (
    <div className={classes.section}>
      <div className={classes.sectionTitle}>Детализация для Kars Avia</div>
      {error && <div>{error}</div>}
      {items?.length === 0 && !error && <div style={{ padding: 12 }}>Заявок с вашей гостиницей пока нет.</div>}
      {items?.map((i) => (
        <div key={i.fapHotelId} style={{ borderTop: '1px solid var(--border, #e5e7eb)' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '10px 12px' }}>
            <b>{i.number}</b>
            <span>{i.airport} · {i.flight}</span>
            <span style={{ marginLeft: 'auto' }}>
              {i.invoice ? `Счёт отправлен: ${i.invoice}` : i.submitted ? STAGE[Math.min(i.stage, 3)] : i.filled ? 'Детализация отправлена' : 'Не заполнена'}
            </span>
            <button onClick={() => setOpen(open === i.fapHotelId ? null : i.fapHotelId)}>
              {i.filled ? 'Открыть' : 'Сформировать детализацию'}
            </button>
          </div>
          {i.comment && <div style={{ padding: '0 12px 8px' }}>Комментарий авиакомпании: {i.comment}</div>}
          {open === i.fapHotelId && <Report item={i} onDone={done} />}
          {i.approved && !i.invoice && <Invoice item={i} onDone={done} />}
        </div>
      ))}
    </div>
  );
}
