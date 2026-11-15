import { Fragment, useMemo, useState } from 'react';
import { addDays, format, parseISO, subDays } from 'date-fns';
import classes from './Tariffs.module.css';
import Select from '../../shared/Select';
import PriceBasis, { PriceBasisLegend } from './PriceBasis';
import { useContractPrices } from '../../../../hooks/api/useContracts';
import { calendarPrices, contractViewKey, occupancyLabel, priceKey, PRICE_REASON } from './corporateTariff';
import { ContractPriceNotice } from './ContractPricesTab';

const DOW_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const fmtRub = (v) => Number(v).toLocaleString('ru-RU');
const day = (d) => format(d, 'yyyy-MM-dd');

export default function ContractCalendar({ plan }) {
  const [daysCount, setDaysCount] = useState(14);
  const [start, setStart] = useState(null);
  const [occupancy, setOccupancy] = useState(1);
  const revision = contractViewKey(plan);
  // Сегодня — в часовом поясе гостиницы, а не компьютера сотрудника.
  const base = useContractPrices(plan.id, undefined, undefined, true, revision);
  const today = base.data?.today;
  const firstDay = start ?? (today ? day(subDays(parseISO(today), 7)) : null);
  const dayStrs = useMemo(() => firstDay ? Array.from({ length: daysCount }, (_, i) => day(addDays(parseISO(firstDay), i))) : [], [firstDay, daysCount]);
  const query = useContractPrices(plan.id, firstDay ?? undefined, dayStrs.at(-1), !!firstDay, revision);
  const { data } = query;
  const prices = useMemo(() => calendarPrices(data?.nights), [data]);
  const nights = useMemo(() => new Map((data?.nights ?? []).map((n) => [n.day, n])), [data]);
  const bands = useMemo(() => {
    const result = [];
    for (const d of dayStrs) {
      const n = nights.get(d);
      const key = n?.periodFrom ?? n?.reason ?? 'NO_PRICES';
      const last = result.at(-1);
      if (last?.key === key) last.count++;
      else result.push({ key, count: 1, from: n?.periodFrom, amendment: n?.amendmentNumber, reason: n?.reason });
    }
    return result;
  }, [dayStrs, nights]);

  if (base.isError || query.isError) return <ContractPriceNotice title="Не удалось загрузить календарь" onRetry={() => { base.refetch(); if (firstDay) query.refetch(); }}>Повторите загрузку, чтобы увидеть актуальные цены.</ContractPriceNotice>;
  if (!data) return <div className={classes.sectionHint} role="status">Загрузка календаря…</div>;
  if (data.hasSlice === false || data.unknownCustomer) return <ContractPriceNotice title="Проверьте условия тарифа">Юрлицо или авиакомпания отсутствуют в справочнике партнёра.</ContractPriceNotice>;

  const categories = data.categories ?? [];
  const maxCapacity = Math.max(1, ...categories.map((c) => c.capacity ?? 1));
  const guests = Math.min(occupancy, maxCapacity);
  return <div className={classes.contractCalendar}>
    <div className={classes.calendarToolbar}>
      <div className={classes.calendarNav}>
        <button className={classes.calNavBtn} aria-label="На неделю назад" onClick={() => setStart(day(subDays(parseISO(firstDay), 7)))}>‹</button>
        <strong>{format(parseISO(firstDay), 'dd.MM.yyyy')} — {format(parseISO(dayStrs.at(-1)), 'dd.MM.yyyy')}</strong>
        <button className={classes.calNavBtn} aria-label="На неделю вперёд" onClick={() => setStart(day(addDays(parseISO(firstDay), 7)))}>›</button>
        <button className={classes.calTodayBtn} onClick={() => setStart(null)}>Сегодня</button>
      </div>
      <div className={classes.calendarControls}>
        <label className={classes.guestsField}>Размещение
          <Select className={classes.input} aria-label="Число гостей" value={guests} onChange={(e) => setOccupancy(Number(e.target.value))}>
            {Array.from({ length: maxCapacity }, (_, i) => i + 1).map((g) => <option key={g} value={g}>На {occupancyLabel(g)}</option>)}
          </Select>
        </label>
        <div className={classes.calDaysToggle} aria-label="Дней в календаре">{[14, 30].map((n) => <button key={n} aria-pressed={daysCount === n} className={[classes.calDaysToggleBtn, daysCount === n && classes.calDaysToggleActive].filter(Boolean).join(' ')} onClick={() => setDaysCount(n)}>{n} дней</button>)}</div>
      </div>
    </div>
    <div className={classes.priceContext}>Цена за номер за ночь · на {occupancyLabel(guests)} · ₽<span>Даты в часовом поясе гостиницы: {data.timezone}</span></div>
    {!data.periods.length && <ContractPriceNotice title="Ждёт цен по договору">{PRICE_REASON[data.nights?.[0]?.reason] ?? 'Приложение с ценами ещё не пришло.'}</ContractPriceNotice>}
    {categories.length === 0 ? <ContractPriceNotice title="Нет категорий номеров">Добавьте категории в разделе «Номера».</ContractPriceNotice> : <div className={classes.calendarScroll} tabIndex={0} role="region" aria-label="Календарь договорных цен">
      <div className={classes.calendarGrid} style={{ gridTemplateColumns: '184px repeat(' + dayStrs.length + ', minmax(112px, 1fr))' }}>
        <div className={classes.periodCorner}>Период договора</div>
        {bands.map((band, i) => <div key={i} className={[classes.periodBand, !band.from && classes.periodBandEmpty].filter(Boolean).join(' ')} style={{ gridColumn: 'span ' + band.count }} title={band.from ? (band.amendment ? 'ДС № ' + band.amendment : 'Договор № ' + data.contractNumber) + ' · с ' + format(parseISO(band.from), 'dd.MM.yyyy') : PRICE_REASON[band.reason]}>
          {band.from ? (band.amendment ? 'ДС № ' + band.amendment : 'Договор') + ' · с ' + format(parseISO(band.from), 'dd.MM') : PRICE_REASON[band.reason] ?? 'Нет цен'}
        </div>)}
        <div className={classes.calCornerCell}>Категория номера</div>
        {dayStrs.map((d) => <div key={d} className={[classes.calDayHeader, [0, 6].includes(parseISO(d).getDay()) && classes.calWeekend, d === today && classes.calToday].filter(Boolean).join(' ')}>
          <div className={classes.calDayNum}>{format(parseISO(d), 'd')}</div><div className={classes.calDow}>{DOW_SHORT[parseISO(d).getDay()]}</div>
        </div>)}
        {categories.map((cat) => <Fragment key={cat.categoryId}>
          <div className={classes.calRowLabel}><div className={classes.calRoomTypeName}>{cat.name}</div><div className={classes.calRoomTypeMeta}>до {cat.capacity ?? 1} чел.</div></div>
          {dayStrs.map((d) => {
            const price = prices.get(d)?.get(priceKey(cat.categoryId, guests));
            const n = nights.get(d);
            const basis = n?.prices?.find((p) => p.categoryId === cat.categoryId && p.occupancy === guests)?.basis;
            const missing = n?.missing?.find((m) => m.categoryId === cat.categoryId && m.occupancy === guests);
            const exceeds = guests > (cat.capacity ?? 1);
            const hint = exceeds ? 'Превышает вместимость категории' : PRICE_REASON[n?.reason] ?? PRICE_REASON[missing?.reason] ?? 'Нет цены для этого размещения';
            return <div key={d} className={[classes.calCell, classes.contractCalendarPrice, exceeds && classes.cellUnavailable].filter(Boolean).join(' ')} title={price == null || exceeds ? hint : cat.name + ' · на ' + occupancyLabel(guests) + ' · ' + fmtRub(price) + ' ₽'}>
              {!exceeds && price != null ? <><span className={classes.money}>{fmtRub(price)}</span><PriceBasis basis={basis} compact /></> : <span className={classes.calNoPrice} aria-label={hint}>—</span>}
            </div>;
          })}
        </Fragment>)}
      </div>
    </div>}
    <PriceBasisLegend prices={(data.nights ?? []).flatMap((n) => n.prices ?? []).filter((p) => p.occupancy === guests)} />
    <div className={classes.coverageNote}>Прочерк — нет цены на выбранное размещение. Наведите на ячейку, чтобы узнать причину. Если цены нет хотя бы на одну ночь, тариф не предлагается для всей брони.</div>
  </div>;
}
