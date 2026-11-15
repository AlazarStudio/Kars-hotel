import { useCallback, useEffect, useRef, useState } from 'react';
import classes from './Reports.module.css';
import form from '../../shared/Form.module.css';
import DateInput from '../../shared/DateInput.jsx';
import NumberInput from '../../shared/NumberInput.jsx';
import { getSquadronReport, listSquadronReports, previewSquadronReport, sendSquadronReport } from '../../../../api/aviaReports';

const MAX_KOPECKS = 999999999999;
const STATUS = { SUBMITTED: 'На проверке', RETURNED: 'Возвращён на доработку', ACCEPTED: 'Принят' };
const STATUS_CLASS = { SUBMITTED: classes.statusSubmitted, RETURNED: classes.statusReturned, ACCEPTED: classes.statusAccepted };
const FIELDS = [['accommodationKopecks', 'Проживание, ₽'], ['mealKopecks', 'Питание, ₽']];
const FACT_FIELDS = ['reservationId', 'requestNumber', 'roomNumber', 'stayStart', 'stayEnd', 'nights',
  'guestCount', 'breakfastCount', 'lunchCount', 'dinnerCount'];
const messageOf = (error, fallback) => {
  const message = error?.response?.data?.message;
  return typeof message === 'string' ? message : fallback;
};
const formatMoney = (value) => value == null ? 'Не указана' : `${(value / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₽`;
const formatDate = (value) => typeof value === 'string' ? value.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$3.$2.$1') : '';
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

// NumberInput отдаёт число или null. Перевод в копейки через десятичную строку,
// чтобы не терять копейки и не округлять дробь больше двух знаков.
function kopecks(value) {
  if (value == null || !Number.isFinite(value) || value < 0) return null;
  const text = String(value);
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const [rub, fraction = ''] = text.split('.');
  const result = BigInt(rub) * 100n + BigInt(fraction.padEnd(2, '0'));
  return result <= BigInt(MAX_KOPECKS) ? Number(result) : null;
}

function submissionId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function dateRange(value, segment) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  const first = segment === 0 ? 1 : segment === 1 ? 11 : 21;
  const last = segment === 0 ? 10 : segment === 1 ? 20 : new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  const month = value.slice(0, 7);
  return [`${month}-${String(first).padStart(2, '0')}`, `${month}-${String(last).padStart(2, '0')}`];
}

function Table({ rows, edits, onEdit, readOnly = false, disabled = false }) {
  return (
    <div className={classes.fapTableWrap}>
      <table className={`${classes.fapTable} ${classes.squadronTable}`}>
        <thead><tr><th>Заявка</th><th>Номер</th><th>Даты услуг</th><th>Гостей</th><th>Ночей</th><th>Завтраки</th><th>Обеды</th><th>Ужины</th><th>Проживание, ₽</th><th>Питание, ₽</th></tr></thead>
        <tbody>{rows.map((row) => (
          <tr key={row.reservationId}>
            <td>{row.requestNumber}</td><td>{row.roomNumber}</td><td>{formatDate(row.stayStart)} — {formatDate(row.stayEnd)}</td>
            <td>{row.guestCount}</td><td>{row.nights}</td><td>{row.breakfastCount}</td><td>{row.lunchCount}</td><td>{row.dinnerCount}</td>
            {FIELDS.map(([field, label]) => {
              const edit = edits?.[row.reservationId];
              const value = edit && has(edit, field) ? edit[field] : row[field] == null ? null : row[field] / 100;
              return <td key={field} className={classes.squadronAmount}>{readOnly ? formatMoney(row[field]) : (
                <NumberInput className={form.input} aria-label={`${label} — ${row.requestNumber}, номер ${row.roomNumber}`}
                  value={value} min={0} disabled={disabled || (field === 'accommodationKopecks' && row.nights === 0)}
                  aria-invalid={kopecks(value) === null} onChange={(next) => onEdit(row.reservationId, field, next)} />
              )}</td>;
            })}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

export default function SquadronReportsTab({ dateFrom, dateTo, setDateFrom, setDateTo }) {
  const [items, setItems] = useState(null);
  const [listError, setListError] = useState('');
  const [listBusy, setListBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [edits, setEdits] = useState({});
  const [detail, setDetail] = useState(null);
  const pending = useRef(null);
  const sequence = useRef(0);
  const dates = useRef({ dateFrom, dateTo });
  dates.current = { dateFrom, dateTo };

  const load = useCallback(async () => {
    setListBusy(true);
    try { setItems(await listSquadronReports()); setListError(''); }
    catch (e) { setItems(null); setListError(messageOf(e, 'Не удалось загрузить отчёты гостиницы')); }
    finally { setListBusy(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    pending.current = null;
    setPreview((old) => old && old.startDate === dateFrom && old.endDate === dateTo ? old : null);
    setError('');
    setConflict(false);
  }, [dateFrom, dateTo]);

  const prepare = async (startDate = dateFrom, endDate = dateTo, version = 0, returned = null) => {
    const current = ++sequence.current;
    setBusy(true); setError(''); setConflict(false); setNotice(''); setDetail(null);
    try {
      const matchesVersion = (report) => report?.id === returned?.id && report?.status === 'RETURNED' &&
        report?.version === returned?.version && report?.startDate === startDate && report?.endDate === endDate && Array.isArray(report?.rows);
      const changed = async () => {
        setPreview(null);
        setConflict(true);
        setError('Статус или версия отчёта изменились. Список обновлён, откройте актуальный отчёт.');
        await load();
      };
      const snapshot = returned ? await getSquadronReport(returned.id) : null;
      if (returned && !matchesVersion(snapshot)) { await changed(); return; }
      const next = await previewSquadronReport(startDate, endDate);
      if (returned && !matchesVersion(await getSquadronReport(returned.id))) { await changed(); return; }
      if (current !== sequence.current || dates.current.dateFrom !== startDate || dates.current.dateTo !== endDate) return;
      if (snapshot) {
        const previous = new Map(snapshot.rows.map((row) => [row.reservationId, row]));
        const retained = {};
        for (const row of next.rows) {
          const old = previous.get(row.reservationId);
          if (!old || FACT_FIELDS.some((field) => old[field] !== row[field])) continue;
          if (FIELDS.some(([field]) => !Number.isSafeInteger(old[field]) || old[field] < 0 || old[field] > MAX_KOPECKS)) continue;
          retained[row.reservationId] = Object.fromEntries(FIELDS.map(([field]) => [field, old[field] / 100]));
        }
        setEdits(retained);
        setPreview({ ...next, version, revision: true, transferredCount: Object.keys(retained).length });
        return;
      }
      setEdits((old) => {
        const previous = new Map((preview?.rows ?? []).map((row) => [row.reservationId, row]));
        const retained = {};
        for (const row of next.rows) {
          if (!previous.has(row.reservationId) || previous.get(row.reservationId).factToken !== row.factToken) continue;
          const values = old[row.reservationId];
          if (!values) continue;
          const applicable = {};
          for (const [field] of FIELDS) if (row[field] == null && has(values, field)) applicable[field] = values[field];
          if (Object.keys(applicable).length) retained[row.reservationId] = applicable;
        }
        return retained;
      });
      setPreview({ ...next, version });
    } catch (e) {
      if (current === sequence.current) {
        setPreview(null);
        if (returned && [404, 409].includes(e?.response?.status)) {
          setConflict(true); setError('Статус или версия отчёта изменились. Список обновлён, откройте актуальный отчёт.');
          await load();
        } else setError(messageOf(e, 'Не удалось сформировать отчёт'));
      }
    } finally { if (current === sequence.current) setBusy(false); }
  };

  const modify = (reservationId, field, value) => {
    pending.current = null;
    setEdits((old) => ({ ...old, [reservationId]: { ...old[reservationId], [field]: value } }));
  };

  const chooseRange = (segment) => {
    const range = dateRange(dateFrom, segment);
    if (!range) { setError('Укажите корректную дату начала месяца'); return; }
    pending.current = null;
    setDateFrom(range[0]); setDateTo(range[1]);
  };

  const revise = (item) => {
    pending.current = null;
    dates.current = { dateFrom: item.startDate, dateTo: item.endDate };
    setDateFrom(item.startDate); setDateTo(item.endDate);
    void prepare(item.startDate, item.endDate, item.version, item);
  };

  const open = async (item) => {
    if (detail?.id === item.id) { setDetail(null); return; }
    setBusy(true); setError(''); setConflict(false);
    try { setDetail(await getSquadronReport(item.id)); }
    catch (e) { setError(messageOf(e, 'Не удалось открыть отчёт')); }
    finally { setBusy(false); }
  };

  const active = preview?.startDate === dateFrom && preview?.endDate === dateTo ? preview : null;
  const hasEmptyAmounts = active?.rows.some((row) => FIELDS.some(([field]) => {
    const edit = edits[row.reservationId];
    return (edit && has(edit, field) ? edit[field] : row[field]) == null;
  }));
  const corrections = [];
  let total = 0;
  let valid = Boolean(active?.rows.length);
  for (const row of active?.rows ?? []) {
    const edit = edits[row.reservationId] ?? {};
    const correction = { reservationId: row.reservationId };
    for (const [field] of FIELDS) {
      const amount = has(edit, field) ? kopecks(edit[field]) : row[field];
      if (amount == null || !Number.isSafeInteger(amount) || amount < 0 || amount > MAX_KOPECKS) valid = false;
      else total += amount;
      if (has(edit, field)) correction[field] = amount;
    }
    if (Object.keys(correction).length > 1) corrections.push(correction);
  }
  if (!Number.isSafeInteger(total)) valid = false;
  const payload = active ? { startDate: active.startDate, endDate: active.endDate, version: active.version,
    previewToken: active.previewToken, corrections } : null;
  const signature = payload ? JSON.stringify(payload) : '';
  const existing = items?.find((item) => item.startDate === dateFrom && item.endDate === dateTo);
  const retry = pending.current?.signature === signature && existing?.submissionId === pending.current?.id;
  const canSubmit = items !== null && valid && !busy && !listBusy && (
    (!existing && active?.version === 0) || (existing?.status === 'RETURNED' && active?.version === existing.version) || retry
  );

  const send = async () => {
    if (!canSubmit) return;
    try {
      if (!pending.current || pending.current.signature !== signature) pending.current = { signature, id: submissionId() };
    } catch {
      setError('Не удалось создать идентификатор отправки. Обновите браузер и повторите попытку.');
      return;
    }
    setBusy(true); setError(''); setConflict(false);
    try {
      const result = await sendSquadronReport({ ...payload, submissionId: pending.current.id });
      setPreview(null); setEdits({}); pending.current = null;
      setNotice(`Отчёт отправлен в Авию. Статус: ${STATUS[result.status] ?? result.status}.`);
      await load();
    } catch (e) {
      const fallback = e?.response?.status === 409
        ? 'Данные или статус отчёта изменились. Обновите список и сформируйте отчёт заново.'
        : 'Не удалось отправить отчёт. Повторите попытку.';
      const isConflict = e?.response?.status === 409;
      setConflict(isConflict);
      setError(isConflict ? `${messageOf(e, 'Данные или статус отчёта изменились.')} Обновите список и сформируйте отчёт заново.` : messageOf(e, fallback));
    } finally { setBusy(false); }
  };

  return (
    <>
      <section className={classes.section}>
        <h2 className={classes.sectionTitle}>Отчёты гостиницы по Эскадрилье</h2>
        <div className={classes.sectionBody}>
          <div className={classes.squadronFilters}>
            <div className={classes.filterGroup} role="group" aria-label="Период">
              <span className={classes.filterHeading}>Период</span>
              <div className={classes.dateFields}>
                <label className={classes.dateField} htmlFor="squadron-date-from">
                  <span>С</span>
                  <DateInput id="squadron-date-from" className={classes.dateInput} aria-label={`Начало периода: ${formatDate(dateFrom) || 'выберите дату'}`} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
                </label>
                <label className={classes.dateField} htmlFor="squadron-date-to">
                  <span>По</span>
                  <DateInput id="squadron-date-to" className={classes.dateInput} aria-label={`Конец периода: ${formatDate(dateTo) || 'выберите дату'}`} value={dateTo} onChange={e => setDateTo(e.target.value)} />
                </label>
              </div>
            </div>
            <div className={classes.filterGroup} role="group" aria-label="Декада">
              <span className={classes.filterHeading}>Декада</span>
              <div className={classes.segmented}>
                {['1–10', '11–20', '21–конец месяца'].map((label, index) => {
                  const range = dateRange(dateFrom, index);
                  return <button type="button" className={classes.segment} aria-pressed={range?.[0] === dateFrom && range?.[1] === dateTo} disabled={busy} key={label} onClick={() => chooseRange(index)}>{label}</button>;
                })}
              </div>
            </div>
            <div className={classes.squadronFormAction}>
              {busy && <span className={classes.fapMuted} role="status">Загрузка…</span>}
              <button type="button" className={form.btnPrimary} disabled={busy} onClick={() => prepare()}>Сформировать</button>
            </div>
          </div>
          {error && <div className={`${form.alert} ${classes.sectionAlert}`} role="alert">{error} {conflict && <button type="button" className={form.btnSecondary} onClick={load}>Обновить список</button>}</div>}
          {notice && <p className={classes.sectionNotice} role="status">{notice}</p>}
          {active && <div className={classes.squadronPreview}>
            {!active.rows.length ? <p className={classes.previewEmpty}>Нет записей за выбранный период.</p> : <>
              <div className={classes.previewHeading}>
                <div><h3>Предварительный расчёт</h3><span>{formatDate(active.startDate)} — {formatDate(active.endDate)}</span></div>
                {hasEmptyAmounts && <p>Пустые суммы заполните вручную; если питание включено, укажите 0.</p>}
              </div>
            </>}
            {active.revision && <div className={classes.revisionNotice}>
              {active.rows.length > 0 && <p>{active.pmsAmounts ? 'Показаны суммы текущего расчёта PMS.' : active.transferredCount ? 'По неизменившимся строкам перенесены суммы отправленной версии.' : 'Для изменившихся строк показаны суммы текущего расчёта PMS.'}</p>}
              <button type="button" className={form.btnSecondary} disabled={busy} onClick={() => {
                pending.current = null; setEdits({}); setPreview((old) => old && { ...old, transferredCount: 0, pmsAmounts: true });
              }}>Взять суммы из расчёта PMS</button>
            </div>}
            {active.rows.length > 0 && <>
              <Table rows={active.rows} edits={edits} onEdit={modify} disabled={busy} />
              {existing && !canSubmit && !busy && <p className={classes.sectionNotice}>{existing.status === 'RETURNED' ? 'Для повторной отправки выберите «Доработать» в списке.' : 'Отчёт за этот период уже отправлен или принят.'}</p>}
              <div className={classes.squadronSummary}>
                <div className={classes.squadronTotal}>Итого: {valid ? formatMoney(total) : 'Заполните суммы'}</div>
                <button type="button" className={form.btnPrimary} disabled={!canSubmit} onClick={send}>Отправить в Авию</button>
              </div>
            </>}
          </div>}
        </div>
      </section>
      <section className={classes.section}>
        <div className={`${classes.sectionTitle} ${classes.sectionHeader}`}>
          <h2 className={classes.sectionHeading}>Отправленные отчёты</h2>
          <div className={classes.headerActions}>
            {listBusy && items !== null && <span className={classes.fapMuted} role="status">Загрузка…</span>}
            <button type="button" className={form.btnSecondary} disabled={busy || listBusy} onClick={load}>Обновить</button>
          </div>
        </div>
        {listError && <div className={classes.sectionBody}><div className={form.alert} role="alert">{listError} <button type="button" className={form.btnSecondary} onClick={load}>Повторить</button></div></div>}
        {!items && !listError && <div className={classes.fapEmpty} role="status">Загрузка…</div>}
        {items?.length === 0 && <div className={classes.fapEmpty}>Отправленных отчётов пока нет.</div>}
        {items?.map((item) => <div className={classes.fapItem} key={item.id}>
          <div className={classes.squadronListRow}>
            <b>{formatDate(item.startDate)} — {formatDate(item.endDate)}</b>
            <span className={classes.squadronListAmount}>{formatMoney(item.totalKopecks)}</span>
            <span className={`${classes.squadronStatus} ${STATUS_CLASS[item.status] ?? ''}`}>{STATUS[item.status] ?? item.status}</span>
            <div className={classes.rowActions}>
              <button type="button" className={form.btnSecondary} disabled={busy} aria-expanded={detail?.id === item.id} onClick={() => open(item)}>{detail?.id === item.id ? 'Свернуть' : 'Открыть'}</button>
              {item.status === 'RETURNED' && <button type="button" className={form.btnSecondary} disabled={busy} onClick={() => revise(item)}>Доработать</button>}
            </div>
          </div>
          {item.status === 'RETURNED' && item.returnReason && <div className={classes.fapComment}>Причина возврата: {item.returnReason}</div>}
          {detail?.id === item.id && <div className={classes.fapBody}><Table rows={detail.rows} readOnly /><div className={classes.squadronTotal}>Итого: {formatMoney(detail.totalKopecks)}</div></div>}
        </div>)}
      </section>
    </>
  );
}
