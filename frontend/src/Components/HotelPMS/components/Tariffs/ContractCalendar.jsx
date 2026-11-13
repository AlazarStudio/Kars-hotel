import { Fragment, useMemo, useState } from 'react';
import { addDays, format, parseISO, subDays } from 'date-fns';
import { ru } from 'date-fns/locale';
import classes from './Tariffs.module.css';
import { useContractPrices } from '../../../../hooks/api/useContracts';

/**
 * «Календарь» корпоративного тарифа — только чтение: цена каждой ночи из
 * периодов договора. Полоса сверху показывает, с какого числа действует новая
 * ДС; ночь вне договора помечена «—» — тариф на неё не посчитается.
 */

const DOW_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const fmtRub = (v) => Number(v).toLocaleString('ru-RU');
const TODAY = (() => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
})();

export default function ContractCalendar({ plan }) {
  const [daysCount, setDaysCount] = useState(14);
  const [start, setStart] = useState(() => subDays(TODAY, 7));

  const days = useMemo(
    () => Array.from({ length: daysCount }, (_, i) => addDays(start, i)),
    [start, daysCount],
  );
  const dayStrs = useMemo(() => days.map((d) => format(d, 'yyyy-MM-dd')), [days]);
  const { data, isLoading } = useContractPrices(
    plan.id,
    dayStrs[0],
    dayStrs[dayStrs.length - 1],
  );

  const byDay = useMemo(() => {
    const map = new Map();
    for (const n of data?.nights ?? []) {
      const perCat = new Map();
      for (const p of n.prices) perCat.set(p.categoryId, p.price);
      map.set(n.day, perCat);
    }
    return map;
  }, [data]);

  const label =
    format(start, 'LLLL', { locale: ru }) + ' ' + format(start, 'yyyy');

  return (
    <div>
      <div className={classes.sectionHint}>
        Цена каждой ночи из договора. Полоса показывает, с какого числа действует
        новая ДС. Ночь вне договора тарифом не считается.
      </div>

      <div className={classes.calendarHeader}>
        <div className={classes.calMonth}>
          <button className={classes.calNavBtn} onClick={() => setStart((v) => subDays(v, 7))}>
            ‹
          </button>
          <span className={classes.calMonthLabel}>{label}</span>
          <button className={classes.calNavBtn} onClick={() => setStart((v) => addDays(v, 7))}>
            ›
          </button>
          <button className={classes.calTodayBtn} onClick={() => setStart(subDays(TODAY, 7))}>
            Сегодня
          </button>
          <div className={classes.calDaysToggle}>
            {[14, 30].map((n) => (
              <button
                key={n}
                className={[classes.calDaysToggleBtn, daysCount === n && classes.calDaysToggleActive]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setDaysCount(n)}
              >
                {n} дн
              </button>
            ))}
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className={classes.sectionHint}>Загрузка…</div>
      ) : (
        <div className={classes.calendarScroll}>
          <div
            className={classes.calendarGrid}
            style={{ gridTemplateColumns: '168px repeat(' + dayStrs.length + ', minmax(46px, 1fr))' }}
          >
            <div className={classes.calCornerCell}>Категория</div>
            {dayStrs.map((d) => {
              const dow = parseISO(d).getDay();
              const isWe = dow === 0 || dow === 6;
              const isStart = (data?.periods ?? []).includes(d);
              return (
                <div
                  key={d}
                  className={[classes.calDayHeader, isWe && classes.calWeekend, isStart && classes.calToday]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <div className={classes.calDayNum}>{format(parseISO(d), 'd')}</div>
                  <div className={classes.calDow}>{DOW_SHORT[dow]}</div>
                </div>
              );
            })}
            {(data?.categories ?? []).map((cat) => (
              <Fragment key={cat.categoryId}>
                <div className={classes.calRowLabel}>
                  <div className={classes.calRoomTypeName}>{cat.name}</div>
                  <div className={classes.calRoomTypeMeta}>до {cat.capacity ?? '?'} чел.</div>
                </div>
                {dayStrs.map((d) => {
                  const price = byDay.get(d)?.get(cat.categoryId);
                  return (
                    <div
                      key={d}
                      className={[classes.calCell, classes.calCellRel].join(' ')}
                      title={price == null ? 'Вне договора' : undefined}
                    >
                      {price != null ? (
                        <span className={classes.cellStandard}>{fmtRub(price)}</span>
                      ) : (
                        <span className={classes.calNoPrice}>—</span>
                      )}
                    </div>
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
