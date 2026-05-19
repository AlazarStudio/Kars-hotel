import { useMemo, useState } from 'react';
import classes from './Tariffs.module.css';
import { useRates, useBulkUpsertRates } from '../../../../hooks/api/useRates';

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

function startOfMonth(year, month) {
  return new Date(Date.UTC(year, month, 1));
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

const DOW = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

/**
 * Calendar grid of editable per-night prices for one RatePlan.
 * Rows = roomTypes (passed in), Cols = days of the selected month.
 * Click a cell → inline edit → save on blur/Enter.
 */
export default function RateCalendar({ ratePlan, roomTypes }) {
  const today = new Date();
  const [year, setYear] = useState(today.getUTCFullYear());
  const [month, setMonth] = useState(today.getUTCMonth());

  const first = startOfMonth(year, month);
  const total = daysInMonth(year, month);
  const dates = useMemo(
    () => Array.from({ length: total }, (_, i) => new Date(Date.UTC(year, month, i + 1))),
    [year, month, total],
  );
  const from = ymd(dates[0]);
  const to = ymd(dates[dates.length - 1]);

  const ratesQ = useRates({ ratePlanId: ratePlan?.id, from, to });
  const bulkUpsert = useBulkUpsertRates();

  // Index rates by (roomTypeId, ISO date).
  const ratesByKey = useMemo(() => {
    const m = new Map();
    for (const r of ratesQ.data ?? []) {
      const date = new Date(r.date).toISOString().slice(0, 10);
      m.set(`${r.roomTypeId}|${date}`, r);
    }
    return m;
  }, [ratesQ.data]);

  const [editing, setEditing] = useState(null); // { roomTypeId, date, value }

  const startEdit = (rt, dateISO) => {
    const existing = ratesByKey.get(`${rt.id}|${dateISO}`);
    setEditing({
      roomTypeId: rt.id,
      date: dateISO,
      value: existing ? Number(existing.price).toString() : '',
    });
  };

  const commitEdit = async () => {
    if (!editing) return;
    const num = Number(editing.value);
    if (Number.isNaN(num) || num < 0) {
      setEditing(null);
      return;
    }
    try {
      await bulkUpsert.mutateAsync([
        {
          ratePlanId: ratePlan.id,
          roomTypeId: editing.roomTypeId,
          date: editing.date,
          occupancy: 2,
          price: num,
          currency: 'RUB',
        },
      ]);
    } finally {
      setEditing(null);
    }
  };

  const prevMonth = () => {
    if (month === 0) { setYear((y) => y - 1); setMonth(11); }
    else setMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setYear((y) => y + 1); setMonth(0); }
    else setMonth((m) => m + 1);
  };
  const goToday = () => {
    setYear(today.getUTCFullYear());
    setMonth(today.getUTCMonth());
  };

  const todayISO = today.toISOString().slice(0, 10);

  if (!ratePlan) return null;
  if (!roomTypes || roomTypes.length === 0) {
    return (
      <div className={classes.calendarEmpty}>
        Сначала создайте категории номеров в разделе «Номера».
      </div>
    );
  }

  return (
    <div className={classes.calendarRoot}>
      <div className={classes.calendarHeader}>
        <div className={classes.calMonth}>
          <button type="button" className={classes.calNavBtn} onClick={prevMonth} title="Предыдущий месяц">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <div className={classes.calMonthLabel}>{MONTHS[month]} {year}</div>
          <button type="button" className={classes.calNavBtn} onClick={nextMonth} title="Следующий месяц">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><polyline points="9 18 15 12 9 6" /></svg>
          </button>
          <button type="button" className={classes.calTodayBtn} onClick={goToday}>Сегодня</button>
        </div>
        <div className={classes.calHint}>
          {ratesQ.isLoading ? 'Загружаем…' : `${ratesByKey.size} ценовых ячеек в этом месяце`}
        </div>
      </div>

      <div className={classes.calendarScroll}>
        <div className={classes.calendarGrid} style={{ gridTemplateColumns: `200px repeat(${total}, 56px)` }}>
          {/* Top-left empty cell */}
          <div className={`${classes.calCornerCell}`}>Категория</div>
          {/* Day headers */}
          {dates.map((d) => {
            const dayNum = d.getUTCDate();
            const dow = (d.getUTCDay() + 6) % 7;
            const isToday = ymd(d) === todayISO;
            const isWeekend = dow >= 5;
            return (
              <div
                key={d.toISOString()}
                className={`${classes.calDayHeader} ${isToday ? classes.calToday : ''} ${isWeekend ? classes.calWeekend : ''}`}
              >
                <div className={classes.calDayNum}>{dayNum}</div>
                <div className={classes.calDow}>{DOW[dow]}</div>
              </div>
            );
          })}

          {/* One row per roomType */}
          {roomTypes.map((rt) => (
            <RateRow
              key={rt.id}
              rt={rt}
              dates={dates}
              ratesByKey={ratesByKey}
              editing={editing}
              setEditing={setEditing}
              startEdit={startEdit}
              commitEdit={commitEdit}
              todayISO={todayISO}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function RateRow({ rt, dates, ratesByKey, editing, setEditing, startEdit, commitEdit, todayISO }) {
  return (
    <>
      <div className={classes.calRowLabel}>
        <div className={classes.calRoomTypeName}>{rt.name}</div>
        <div className={classes.calRoomTypeMeta}>от {Number(rt.basePrice || 0).toLocaleString('ru-RU')} ₽</div>
      </div>
      {dates.map((d) => {
        const dateISO = ymd(d);
        const rate = ratesByKey.get(`${rt.id}|${dateISO}`);
        const isEditing = editing && editing.roomTypeId === rt.id && editing.date === dateISO;
        const isToday = dateISO === todayISO;
        const isWeekend = ((d.getUTCDay() + 6) % 7) >= 5;
        const cellClass = [
          classes.calCell,
          isToday && classes.calCellToday,
          isWeekend && classes.calCellWeekend,
        ]
          .filter(Boolean)
          .join(' ');
        return isEditing ? (
          <input
            key={dateISO}
            className={`${cellClass} ${classes.calInput}`}
            type="number"
            min="0"
            step="0.01"
            autoFocus
            value={editing.value}
            onChange={(e) => setEditing({ ...editing, value: e.target.value })}
            onBlur={commitEdit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitEdit();
              if (e.key === 'Escape') setEditing(null);
            }}
          />
        ) : (
          <div
            key={dateISO}
            className={cellClass}
            onClick={() => startEdit(rt, dateISO)}
            tabIndex={0}
            role="button"
          >
            {rate ? (
              <span className={classes.calPrice}>{Number(rate.price).toLocaleString('ru-RU')}</span>
            ) : (
              <span className={classes.calNoPrice}>—</span>
            )}
          </div>
        );
      })}
    </>
  );
}
