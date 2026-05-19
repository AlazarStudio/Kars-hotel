import React, { useState, useMemo } from 'react';
import { parseISO, format, differenceInDays, eachDayOfInterval } from 'date-fns';
import { ru } from 'date-fns/locale';
import classes from './Reports.module.css';
import { BOOKING_STATUS, BOOKING_SOURCE } from '../../constants';
import { useTimeline } from '../../../../hooks/useTimeline';

// ─── CSV export helper ───────────────────────────────────────────────────────
function exportCSV(rows, filename) {
  const csv = rows
    .map(row => row.map(cell => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Main component ──────────────────────────────────────────────────────────
function Reports() {
  const today = new Date();
  const [dateFrom, setDateFrom] = useState(
    format(new Date(today.getFullYear(), today.getMonth(), 1), 'yyyy-MM-dd'),
  );
  const [dateTo, setDateTo] = useState(
    format(new Date(today.getFullYear(), today.getMonth() + 1, 0), 'yyyy-MM-dd'),
  );
  const [tab, setTab] = useState('occupancy');

  // Derive timeline params from date range
  const fromDate = useMemo(() => { try { return parseISO(dateFrom); } catch { return new Date(); } }, [dateFrom]);
  const daysCount = useMemo(() => {
    try {
      const d = differenceInDays(parseISO(dateTo), parseISO(dateFrom)) + 1;
      return Math.max(1, Math.min(d, 365));
    } catch { return 30; }
  }, [dateFrom, dateTo]);

  const { data, loading, error } = useTimeline(fromDate, daysCount);

  const bookings   = data?.bookings   ?? [];
  const rooms      = data?.rooms      ?? [];
  const categories = data?.categories ?? [];

  // Filter to range, exclude cancelled
  const rangeBookings = useMemo(() =>
    bookings.filter(b =>
      b.status !== 'cancelled' &&
      b.checkOut > dateFrom &&
      b.checkIn  < dateTo,
    ),
    [bookings, dateFrom, dateTo],
  );

  const days = useMemo(() => {
    try { return eachDayOfInterval({ start: parseISO(dateFrom), end: parseISO(dateTo) }); }
    catch { return []; }
  }, [dateFrom, dateTo]);

  // ── KPI metrics ─────────────────────────────────────────────────────────────
  const totalRoomNights = rooms.length * days.length;

  const occupiedNights = useMemo(() => {
    let n = 0;
    rangeBookings.forEach(b => {
      const s = b.checkIn  < dateFrom ? dateFrom : b.checkIn;
      const e = b.checkOut > dateTo   ? dateTo   : b.checkOut;
      n += Math.max(0, differenceInDays(parseISO(e), parseISO(s)));
    });
    return n;
  }, [rangeBookings, dateFrom, dateTo]);

  const occupancy = totalRoomNights > 0 ? Math.round(occupiedNights / totalRoomNights * 100) : 0;
  const revenue   = useMemo(() => rangeBookings.reduce((s, b) => s + (b.totalPrice || 0), 0), [rangeBookings]);
  // ADR = Average Daily Rate = room revenue / occupied room-nights
  const adr = occupiedNights > 0 ? Math.round(revenue / occupiedNights) : 0;

  // ── Category stats ───────────────────────────────────────────────────────────
  const catStats = useMemo(() => categories.map(cat => {
    const catRooms    = rooms.filter(r => r.categoryId === cat.id);
    const catBookings = rangeBookings.filter(b => catRooms.some(r => r.id === b.roomId));
    const catRevenue  = catBookings.reduce((s, b) => s + (b.totalPrice || 0), 0);
    const catNights   = catRooms.length * days.length;
    let occupied = 0;
    catBookings.forEach(b => {
      const s = b.checkIn  < dateFrom ? dateFrom : b.checkIn;
      const e = b.checkOut > dateTo   ? dateTo   : b.checkOut;
      occupied += Math.max(0, differenceInDays(parseISO(e), parseISO(s)));
    });
    return {
      ...cat,
      bookings: catBookings.length,
      revenue:  catRevenue,
      occupancy: catNights > 0 ? Math.round(occupied / catNights * 100) : 0,
    };
  }), [categories, rooms, rangeBookings, dateFrom, dateTo, days]);

  // ── Source stats ─────────────────────────────────────────────────────────────
  const sourceStats = useMemo(() => {
    const map = {};
    rangeBookings.forEach(b => {
      const src = (b.source || 'direct').toLowerCase();
      if (!map[src]) map[src] = { count: 0, revenue: 0 };
      map[src].count++;
      map[src].revenue += b.totalPrice || 0;
    });
    return Object.entries(map).sort((a, b) => b[1].revenue - a[1].revenue);
  }, [rangeBookings]);

  // ── CSV export ───────────────────────────────────────────────────────────────
  const handleExportBookings = () => {
    const sorted = [...rangeBookings].sort((a, b) => (a.checkIn < b.checkIn ? -1 : 1));
    exportCSV(
      [
        ['Гость', 'Телефон', 'Email', 'Номер', 'Заезд', 'Выезд', 'Ночей', 'Статус', 'Источник', 'Взрослых', 'Детей', 'Сумма (₽)', 'Заметки'],
        ...sorted.map(b => {
          const room   = rooms.find(r => r.id === b.roomId);
          const nights = differenceInDays(parseISO(b.checkOut), parseISO(b.checkIn));
          return [
            b.guestName,
            b.phone    ?? '',
            b.email    ?? '',
            room?.number ?? '',
            b.checkIn,
            b.checkOut,
            nights,
            BOOKING_STATUS[b.status]?.label ?? b.status,
            BOOKING_SOURCE[(b.source || '').toLowerCase()] ?? b.source,
            b.adults,
            b.children,
            b.totalPrice ?? '',
            b.notes ?? '',
          ];
        }),
      ],
      `bookings_${dateFrom}_${dateTo}.csv`,
    );
  };

  const handleExportOccupancy = () => {
    exportCSV(
      [
        ['Категория', 'Загрузка (%)', 'Бронирований', 'Выручка (₽)'],
        ...catStats.map(c => [c.name, c.occupancy, c.bookings, c.revenue]),
        ['ИТОГО', occupancy, rangeBookings.length, revenue],
      ],
      `occupancy_${dateFrom}_${dateTo}.csv`,
    );
  };

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className={classes.root}>
      <div className={classes.pageHeader}>
        <div className={classes.pageTitle}>Отчёты</div>
        <div className={classes.dateRange}>
          <input type="date" className={classes.dateInput} value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          <span className={classes.dateSep}>—</span>
          <input type="date" className={classes.dateInput} value={dateTo}   onChange={e => setDateTo(e.target.value)} />
        </div>
      </div>

      {error && (
        <div style={{ padding: '10px 16px', background: '#FEF2F2', color: '#DC2626', borderRadius: 8, marginBottom: 16, fontSize: 13 }}>
          Ошибка загрузки: {error}
        </div>
      )}

      {/* ── KPIs ── */}
      <div className={classes.kpiRow}>
        <div className={classes.kpi}>
          <div className={classes.kpiValue}>{loading ? '…' : `${occupancy}%`}</div>
          <div className={classes.kpiLabel}>Загрузка</div>
        </div>
        <div className={classes.kpi}>
          <div className={classes.kpiValue}>{loading ? '…' : `${revenue.toLocaleString('ru-RU')} ₽`}</div>
          <div className={classes.kpiLabel}>Выручка</div>
        </div>
        <div className={classes.kpi}>
          <div className={classes.kpiValue}>{loading ? '…' : `${adr.toLocaleString('ru-RU')} ₽`}</div>
          <div className={classes.kpiLabel}>ADR (ср. цена/ночь)</div>
        </div>
        <div className={classes.kpi}>
          <div className={classes.kpiValue}>{loading ? '…' : rangeBookings.length}</div>
          <div className={classes.kpiLabel}>Бронирований</div>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className={classes.tabs}>
        {[
          ['occupancy', 'По категориям'],
          ['source',    'По источникам'],
          ['bookings',  'Список броней'],
        ].map(([key, label]) => (
          <button
            key={key}
            className={`${classes.tab} ${tab === key ? classes.tabActive : ''}`}
            onClick={() => setTab(key)}
          >{label}</button>
        ))}
      </div>

      {/* ── Occupancy by category ── */}
      {tab === 'occupancy' && (
        <div className={classes.section}>
          <div className={classes.sectionTitle} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Загрузка и выручка по категориям</span>
            <button onClick={handleExportOccupancy} style={exportBtnStyle}>Экспорт CSV</button>
          </div>
          <div className={classes.table}>
            <div className={classes.tableHead} style={{ gridTemplateColumns: '2fr 2fr 1fr 1fr' }}>
              <div className={classes.th}>Категория</div>
              <div className={classes.th}>Загрузка</div>
              <div className={classes.th}>Брони</div>
              <div className={classes.th}>Выручка</div>
            </div>
            {!loading && catStats.length === 0 && (
              <div style={emptyStyle}>Нет данных за период</div>
            )}
            {catStats.map(cat => (
              <div key={cat.id} className={classes.tableRow} style={{ gridTemplateColumns: '2fr 2fr 1fr 1fr' }}>
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

      {/* ── Source stats ── */}
      {tab === 'source' && (
        <div className={classes.section}>
          <div className={classes.sectionTitle}>По источникам бронирования</div>
          <div className={classes.table}>
            <div className={classes.tableHead} style={{ gridTemplateColumns: '2fr 1fr 2fr 2fr' }}>
              <div className={classes.th}>Источник</div>
              <div className={classes.th}>Бронирований</div>
              <div className={classes.th}>Выручка</div>
              <div className={classes.th}>Доля</div>
            </div>
            {!loading && sourceStats.length === 0 && (
              <div style={emptyStyle}>Нет данных за период</div>
            )}
            {sourceStats.map(([src, s]) => (
              <div key={src} className={classes.tableRow} style={{ gridTemplateColumns: '2fr 1fr 2fr 2fr' }}>
                <div className={classes.td}>{BOOKING_SOURCE[src] ?? src}</div>
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

      {/* ── Bookings list ── */}
      {tab === 'bookings' && (
        <div className={classes.section}>
          <div className={classes.sectionTitle} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Бронирования за период ({rangeBookings.length})</span>
            <button onClick={handleExportBookings} style={exportBtnStyle}>Экспорт CSV</button>
          </div>
          <div className={classes.table}>
            <div className={classes.tableHead}>
              <div className={classes.th}>Гость</div>
              <div className={classes.th}>Номер</div>
              <div className={classes.th}>Заезд</div>
              <div className={classes.th}>Выезд</div>
              <div className={classes.th}>Статус</div>
              <div className={classes.th}>Сумма</div>
            </div>
            {!loading && rangeBookings.length === 0 && (
              <div style={emptyStyle}>Нет бронирований за период</div>
            )}
            {[...rangeBookings]
              .sort((a, b) => (a.checkIn < b.checkIn ? -1 : 1))
              .map(b => {
                const cfg  = BOOKING_STATUS[b.status] || BOOKING_STATUS.new;
                const room = rooms.find(r => r.id === b.roomId);
                return (
                  <div key={b.id} className={classes.tableRow}>
                    <div className={classes.td}>{b.guestName}</div>
                    <div className={classes.td}>№{room?.number || '?'}</div>
                    <div className={classes.td}>{format(parseISO(b.checkIn),  'd MMM', { locale: ru })}</div>
                    <div className={classes.td}>{format(parseISO(b.checkOut), 'd MMM', { locale: ru })}</div>
                    <div className={classes.td}>
                      <span className={classes.statusBadge} style={{ background: cfg.color + '22', color: cfg.color }}>
                        {cfg.label}
                      </span>
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

const exportBtnStyle = {
  background: 'none',
  border: '1px solid #D8E2F0',
  borderRadius: 6,
  padding: '5px 12px',
  cursor: 'pointer',
  fontSize: 12,
  color: '#1E88E5',
  fontFamily: 'inherit',
  fontWeight: 600,
};

const emptyStyle = {
  padding: '24px 20px',
  color: '#8896AB',
  fontSize: 13,
};

export default Reports;
