import React, { useState, useMemo } from 'react';
import { parseISO, format, differenceInDays, startOfMonth, endOfMonth, eachDayOfInterval } from 'date-fns';
import { ru } from 'date-fns/locale';
import classes from './Reports.module.css';
import { BOOKING_STATUS } from '../../constants';

const TODAY = '2026-04-24';

function Reports({ bookings, rooms, categories }) {
  const [dateFrom, setDateFrom] = useState('2026-04-01');
  const [dateTo, setDateTo]     = useState('2026-04-30');
  const [tab, setTab]           = useState('occupancy');

  const rangeBookings = useMemo(() => {
    return bookings.filter(b => b.status !== 'cancelled' && b.checkOut > dateFrom && b.checkIn < dateTo);
  }, [bookings, dateFrom, dateTo]);

  const days = useMemo(() => {
    try {
      return eachDayOfInterval({ start: parseISO(dateFrom), end: parseISO(dateTo) });
    } catch { return []; }
  }, [dateFrom, dateTo]);

  const totalRooms = rooms.length;
  const totalRoomNights = totalRooms * days.length;

  const occupiedNights = useMemo(() => {
    let count = 0;
    rangeBookings.forEach(b => {
      const s = b.checkIn < dateFrom ? dateFrom : b.checkIn;
      const e = b.checkOut > dateTo   ? dateTo   : b.checkOut;
      count += Math.max(0, differenceInDays(parseISO(e), parseISO(s)));
    });
    return count;
  }, [rangeBookings, dateFrom, dateTo]);

  const occupancy = totalRoomNights > 0 ? Math.round(occupiedNights / totalRoomNights * 100) : 0;

  const revenue = useMemo(() => {
    return rangeBookings.reduce((sum, b) => sum + (b.totalPrice || 0), 0);
  }, [rangeBookings]);

  const adr = rangeBookings.length > 0 ? Math.round(revenue / rangeBookings.length) : 0;

  const catStats = useMemo(() => {
    return categories.map(cat => {
      const catRooms = rooms.filter(r => r.categoryId === cat.id);
      const catBookings = rangeBookings.filter(b => catRooms.some(r => r.id === b.roomId));
      const catRevenue = catBookings.reduce((s, b) => s + (b.totalPrice || 0), 0);
      const catNights = catRooms.length * days.length;
      let occupied = 0;
      catBookings.forEach(b => {
        const s = b.checkIn < dateFrom ? dateFrom : b.checkIn;
        const e = b.checkOut > dateTo   ? dateTo   : b.checkOut;
        occupied += Math.max(0, differenceInDays(parseISO(e), parseISO(s)));
      });
      return {
        ...cat,
        bookings: catBookings.length,
        revenue: catRevenue,
        occupancy: catNights > 0 ? Math.round(occupied / catNights * 100) : 0,
      };
    });
  }, [categories, rooms, rangeBookings, dateFrom, dateTo, days]);

  const sourceStats = useMemo(() => {
    const map = {};
    rangeBookings.forEach(b => {
      const src = b.source || 'direct';
      if (!map[src]) map[src] = { count: 0, revenue: 0 };
      map[src].count++;
      map[src].revenue += b.totalPrice || 0;
    });
    return Object.entries(map).sort((a, b) => b[1].revenue - a[1].revenue);
  }, [rangeBookings]);

  const SOURCE_LABELS = { direct: 'Стойка', online: 'Онлайн', phone: 'Телефон', ota: 'ОТА', corporate: 'Корпоратив' };

  return (
    <div className={classes.root}>
      <div className={classes.pageHeader}>
        <div className={classes.pageTitle}>Отчёты</div>
        <div className={classes.dateRange}>
          <input type="date" className={classes.dateInput} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          <span className={classes.dateSep}>—</span>
          <input type="date" className={classes.dateInput} value={dateTo} onChange={e => setDateTo(e.target.value)} />
        </div>
      </div>

      <div className={classes.kpiRow}>
        <div className={classes.kpi}>
          <div className={classes.kpiValue}>{occupancy}%</div>
          <div className={classes.kpiLabel}>Загрузка</div>
        </div>
        <div className={classes.kpi}>
          <div className={classes.kpiValue}>{revenue.toLocaleString('ru-RU')} ₽</div>
          <div className={classes.kpiLabel}>Выручка</div>
        </div>
        <div className={classes.kpi}>
          <div className={classes.kpiValue}>{adr.toLocaleString('ru-RU')} ₽</div>
          <div className={classes.kpiLabel}>ADR (ср. цена брони)</div>
        </div>
        <div className={classes.kpi}>
          <div className={classes.kpiValue}>{rangeBookings.length}</div>
          <div className={classes.kpiLabel}>Бронирований</div>
        </div>
      </div>

      <div className={classes.tabs}>
        {[['occupancy', 'По категориям'], ['source', 'По источникам'], ['bookings', 'Список броней']].map(([key, label]) => (
          <button key={key} className={`${classes.tab} ${tab === key ? classes.tabActive : ''}`} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>

      {tab === 'occupancy' && (
        <div className={classes.section}>
          <div className={classes.sectionTitle}>Загрузка и выручка по категориям</div>
          <div className={classes.table}>
            <div className={classes.tableHead}>
              <div className={classes.th}>Категория</div>
              <div className={classes.th}>Загрузка</div>
              <div className={classes.th}>Брони</div>
              <div className={classes.th}>Выручка</div>
            </div>
            {catStats.map(cat => (
              <div key={cat.id} className={classes.tableRow}>
                <div className={classes.td}>{cat.name}</div>
                <div className={classes.td}>
                  <div className={classes.barWrap}>
                    <div className={classes.bar} style={{ width: `${cat.occupancy}%` }} />
                    <span>{cat.occupancy}%</span>
                  </div>
                </div>
                <div className={classes.td}>{cat.bookings}</div>
                <div className={classes.td}>{cat.revenue.toLocaleString('ru-RU')} ₽</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'source' && (
        <div className={classes.section}>
          <div className={classes.sectionTitle}>По источникам бронирования</div>
          <div className={classes.table}>
            <div className={classes.tableHead}>
              <div className={classes.th}>Источник</div>
              <div className={classes.th}>Бронирований</div>
              <div className={classes.th}>Выручка</div>
              <div className={classes.th}>Доля</div>
            </div>
            {sourceStats.map(([src, s]) => (
              <div key={src} className={classes.tableRow}>
                <div className={classes.td}>{SOURCE_LABELS[src] || src}</div>
                <div className={classes.td}>{s.count}</div>
                <div className={classes.td}>{s.revenue.toLocaleString('ru-RU')} ₽</div>
                <div className={classes.td}>
                  <div className={classes.barWrap}>
                    <div className={classes.bar} style={{ width: `${revenue > 0 ? Math.round(s.revenue / revenue * 100) : 0}%`, background: '#1E88E5' }} />
                    <span>{revenue > 0 ? Math.round(s.revenue / revenue * 100) : 0}%</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'bookings' && (
        <div className={classes.section}>
          <div className={classes.sectionTitle}>Бронирования за период</div>
          <div className={classes.table}>
            <div className={classes.tableHead}>
              <div className={classes.th}>Гость</div>
              <div className={classes.th}>Номер</div>
              <div className={classes.th}>Заезд</div>
              <div className={classes.th}>Выезд</div>
              <div className={classes.th}>Статус</div>
              <div className={classes.th}>Сумма</div>
            </div>
            {rangeBookings.sort((a, b) => a.checkIn < b.checkIn ? -1 : 1).map(b => {
              const cfg = BOOKING_STATUS[b.status] || BOOKING_STATUS.new;
              const room = rooms.find(r => r.id === b.roomId);
              return (
                <div key={b.id} className={classes.tableRow}>
                  <div className={classes.td}>{b.guestName}</div>
                  <div className={classes.td}>№{room?.number || '?'}</div>
                  <div className={classes.td}>{format(parseISO(b.checkIn), 'd MMM', { locale: ru })}</div>
                  <div className={classes.td}>{format(parseISO(b.checkOut), 'd MMM', { locale: ru })}</div>
                  <div className={classes.td}>
                    <span className={classes.statusBadge} style={{ background: cfg.color + '22', color: cfg.color }}>{cfg.label}</span>
                  </div>
                  <div className={classes.td}>{b.totalPrice ? `${b.totalPrice.toLocaleString('ru-RU')} ₽` : '—'}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default Reports;
