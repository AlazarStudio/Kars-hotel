import { useCallback, useEffect, useRef, useState } from 'react';
import classes from './Reports.module.css';
import form from '../../shared/Form.module.css';
import NumberInput from '../../shared/NumberInput.jsx';
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
    setRows((list) => list.map((r, n) => (n === i ? { ...r, [key]: type === 'number' ? (value ?? 0) : value } : r)));

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
    <div className={classes.fapBody}>
      {error && <div className={form.alert}>{error}</div>}
      {!rows && !error && <div className={classes.fapMuted}>Загрузка…</div>}
      {rows && (
        <>
          <div className={classes.fapTableWrap}>
            <table className={classes.fapTable}>
              <thead>
                <tr>
                  <th>Гость</th>
                  {FIELDS.map(([k, label]) => (
                    <th key={k}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.guestId ?? i}>
                    <td className={classes.fapGuest}>{r.fullName}</td>
                    {FIELDS.map(([k, label, type]) => (
                      <td key={k}>
                        {type === 'number' ? (
                          <NumberInput
                            className={form.input}
                            aria-label={label}
                            decimal={false}
                            disabled={item.submitted}
                            value={r[k] ?? 0}
                            onChange={(v) => change(i, k, type, v)}
                          />
                        ) : (
                          <input
                            className={form.input}
                            aria-label={label}
                            disabled={item.submitted}
                            value={r[k] ?? ''}
                            onChange={(e) => change(i, k, type, e.target.value)}
                          />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!item.submitted && (
            <div className={classes.fapActions}>
              <button type="button" className={form.btnPrimary} disabled={busy} onClick={send}>
                Отправить на согласование
              </button>
            </div>
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
  const fileRef = useRef(null);
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
    <div className={classes.fapInvoice}>
      <div className={form.field}>
        <label className={form.label} htmlFor={`inv-num-${item.fapHotelId}`}>Номер счёта</label>
        <input id={`inv-num-${item.fapHotelId}`} className={form.input} value={number} onChange={(e) => setNumber(e.target.value)} />
      </div>
      <div className={form.field}>
        <label className={form.label} htmlFor={`inv-sum-${item.fapHotelId}`}>Сумма, ₽</label>
        <input id={`inv-sum-${item.fapHotelId}`} className={form.input} inputMode="decimal" value={rub} onChange={(e) => setRub(e.target.value)} />
      </div>
      <div className={form.field}>
        <span className={form.label}>Счёт, PDF</span>
        <div className={classes.fapFile}>
          <button type="button" className={form.btnSecondary} onClick={() => fileRef.current?.click()}>
            {file ? 'Заменить файл' : 'Выбрать файл'}
          </button>
          <span className={classes.fapMuted}>{file?.name ?? 'Файл не выбран'}</span>
          <input
            ref={fileRef}
            aria-label="Счёт, PDF"
            type="file"
            accept="application/pdf"
            hidden
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>
      </div>
      <button type="button" className={form.btnPrimary} disabled={!file || !rub.trim()} onClick={send}>
        Приложить счёт
      </button>
      {error && <div className={form.fieldError}>{error}</div>}
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
      {error && <div className={form.alert}>{error}</div>}
      {items?.length === 0 && !error && <div className={classes.fapEmpty}>Заявок с вашей гостиницей пока нет.</div>}
      {items?.map((i) => (
        <div key={i.fapHotelId} className={classes.fapItem}>
          <div className={classes.fapHead}>
            <b>{i.number}</b>
            <span className={classes.fapMuted}>{i.airport} · {i.flight}</span>
            <span className={classes.fapState}>
              {i.invoice ? `Счёт отправлен: ${i.invoice}` : i.submitted ? STAGE[Math.min(i.stage, 3)] : i.filled ? 'Детализация отправлена' : 'Не заполнена'}
            </span>
            <button type="button" className={form.btnSecondary} onClick={() => setOpen(open === i.fapHotelId ? null : i.fapHotelId)}>
              {open === i.fapHotelId ? 'Свернуть' : i.filled ? 'Открыть' : 'Сформировать детализацию'}
            </button>
          </div>
          {i.comment && <div className={classes.fapComment}>Комментарий авиакомпании: {i.comment}</div>}
          {open === i.fapHotelId && <Report item={i} onDone={done} />}
          {i.approved && !i.invoice && <Invoice item={i} onDone={done} />}
        </div>
      ))}
    </div>
  );
}
