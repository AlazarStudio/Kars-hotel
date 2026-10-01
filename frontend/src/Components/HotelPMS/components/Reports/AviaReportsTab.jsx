import { useEffect, useMemo, useState } from 'react';
import classes from './Reports.module.css';
import { downloadAviaReport, listAviaReports } from '../../../../api/aviaReports';

/**
 * «Отчёты Kars Avia» — кабинет гостиницы раздела «Отчёты» старой системы
 * (перенос 01.10.2026): выпущенные для этой гостиницы реестры, «Текущие» и
 * «Архив» (старше двух декад или убранные в архив), скачивание файла.
 * Собирает и выпускает отчёты диспетчер Kars Avia.
 */

const pad = (n) => String(n).padStart(2, '0');
/** Период — настенное время, хранится как UTC. */
const dayUtc = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
};
/** Момент выпуска — по Москве. */
const dateTimeMsk = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).replace(',', '');
};
/** «Реестр · Кавказ» из заголовка реестра (shortReportTitle старой). */
const shortTitle = (title) => {
  if (typeof title !== 'string') return null;
  const name = /"(.*)"/.exec(title)?.[1]?.trim();
  if (!name) return null;
  const city = /в г\.\s*(.*)$/.exec(title.slice(title.lastIndexOf('"') + 1))?.[1]?.trim();
  return ['Реестр', name, city].filter(Boolean).join(' · ');
};
const reportsWord = (n) => {
  const m100 = n % 100;
  if (m100 >= 11 && m100 <= 14) return 'отчётов';
  const m10 = n % 10;
  if (m10 === 1) return 'отчёт';
  if (m10 >= 2 && m10 <= 4) return 'отчёта';
  return 'отчётов';
};

export default function AviaReportsTab() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [archive, setArchive] = useState(false);

  useEffect(() => {
    listAviaReports()
      .then(setItems)
      .catch((e) => {
        setError(e?.response?.data?.message || 'Не удалось загрузить отчёты');
        setItems([]);
      });
  }, []);

  const shown = useMemo(() => (items ?? []).filter((r) => Boolean(r.archived) === archive), [items, archive]);

  const download = async (r) => {
    try {
      await downloadAviaReport(r.id, r.name);
    } catch {
      setError('Не удалось скачать отчёт');
    }
  };

  return (
    <div className={classes.section}>
      <div className={classes.sectionTitle} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ marginRight: 'auto' }}>Отчёты Kars Avia</span>
        {[
          [false, 'Текущие'],
          [true, 'Архив'],
        ].map(([v, label]) => (
          <button key={label} onClick={() => setArchive(v)} style={{ ...toggleStyle, ...(archive === v ? toggleOn : null) }}>
            {label}
          </button>
        ))}
      </div>
      {error && <div style={errorStyle}>{error}</div>}
      <div className={classes.table}>
        <div className={classes.tableHead} style={{ gridTemplateColumns: '56px 3fr 2fr 2fr 120px' }}>
          <div className={classes.th}>№</div>
          <div className={classes.th}>Гостиница</div>
          <div className={classes.th}>Дата формирования</div>
          <div className={classes.th}>Период</div>
          <div className={classes.th} />
        </div>
        {items === null && <div style={emptyStyle}>Загрузка…</div>}
        {items !== null && shown.length === 0 && (
          <div style={emptyStyle}>
            <b style={{ display: 'block', color: '#334155', marginBottom: 4 }}>Отчётов пока нет</b>
            {archive
              ? 'В архиве пусто. Сюда попадают отчёты старше двух декад и убранные вручную.'
              : 'Здесь появятся выпущенные отчёты по вашей гостинице.'}
          </div>
        )}
        {shown.map((r, i) => (
          <div key={r.id} className={classes.tableRow} style={{ gridTemplateColumns: '56px 3fr 2fr 2fr 120px' }}>
            <div className={classes.td}>{i + 1}</div>
            <div className={classes.td} title={r.title || r.name}>
              {shortTitle(r.title) || r.title || r.name || '—'}
            </div>
            <div className={classes.td}>{dateTimeMsk(r.createdAt)}</div>
            <div className={classes.td}>
              {dayUtc(r.startDate)} - {dayUtc(r.endDate)}
            </div>
            <div className={classes.td}>
              <button onClick={() => download(r)} style={linkBtn}>
                Скачать
              </button>
            </div>
          </div>
        ))}
      </div>
      {shown.length > 0 && (
        <div style={{ padding: '10px 4px', color: '#8896AB', fontSize: 12 }}>
          Всего {shown.length} {reportsWord(shown.length)}
        </div>
      )}
    </div>
  );
}

const toggleStyle = {
  background: 'none',
  border: '1px solid #D8E2F0',
  borderRadius: 6,
  padding: '5px 12px',
  cursor: 'pointer',
  fontSize: 12,
  color: '#475569',
  fontFamily: 'inherit',
  fontWeight: 600,
};
const toggleOn = { color: '#1E88E5', borderColor: '#1E88E5' };
const linkBtn = { ...toggleStyle, color: '#1E88E5' };
const emptyStyle = { padding: '24px 20px', color: '#8896AB', fontSize: 13 };
const errorStyle = { padding: '10px 16px', background: '#FEF2F2', color: '#DC2626', borderRadius: 8, margin: '8px 0', fontSize: 13 };
