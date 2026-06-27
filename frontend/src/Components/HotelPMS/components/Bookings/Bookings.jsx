import React, { useState, useMemo } from 'react';
import { parseISO, format, differenceInDays, subDays, addDays } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useQuery } from '@tanstack/react-query';
import classes from './Bookings.module.css';
import { BOOKING_STATUS, BOOKING_SOURCE } from '../../constants';
import BookingForm from '../Timeline/BookingForm';
import { useTimeline } from '../../../../hooks/useTimeline';
import {
  createReservation,
  updateReservation,
  getArrivals,
  getDepartures,
  checkIn,
  checkOut,
} from '../../../../api/reservations';

// Show bookings from 60 days ago to 180 days ahead
const VIEW_START = subDays(new Date(), 60);
const DAYS_COUNT = 240;

// Status groups for the bookings views.
//  • active   — operational bookings shown under «Все брони»
//  • archived — completed stays (выехал) → «Архивные»
//  • cancelled/no-show — closed bookings → «Отменённые»
const ACTIVE_STATUSES = ['new', 'confirmed', 'checked_in'];
const ARCHIVED_STATUSES = ['checked_out'];
const CANCELLED_STATUSES = ['cancelled', 'no_show'];

function Bookings() {
  const { data, loading, error, reload } = useTimeline(VIEW_START, DAYS_COUNT);

  const bookings   = data?.bookings   ?? [];
  const rooms      = data?.rooms      ?? [];
  const categories = data?.categories ?? [];

  const [activeTab, setActiveTab] = useState('all');
  const today = new Date().toISOString().split('T')[0];

  const { data: arrivals = [], refetch: refetchArrivals } = useQuery({
    queryKey: ['arrivals', today],
    queryFn: () => getArrivals(today),
    enabled: activeTab === 'arrivals',
  });

  const { data: departures = [], refetch: refetchDepartures } = useQuery({
    queryKey: ['departures', today],
    queryFn: () => getDepartures(today),
    enabled: activeTab === 'departures',
  });

  const handleCheckIn = async (id) => {
    try {
      await checkIn(id);
      refetchArrivals();
    } catch (err) {
      setSavingError(err?.response?.data?.message ?? err.message ?? 'Ошибка заселения');
    }
  };

  const handleCheckOut = async (id) => {
    try {
      await checkOut(id);
      refetchDepartures();
    } catch (err) {
      setSavingError(err?.response?.data?.message ?? err.message ?? 'Ошибка выселения');
    }
  };

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState(null);
  const [savingError, setSavingError] = useState(null);

  const matchesSearch = (b) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      b.guestName.toLowerCase().includes(q) ||
      b.phone?.includes(q) ||
      rooms.find(r => r.id === b.roomId)?.number.includes(q)
    );
  };
  const byCheckInDesc = (a, b) => (a.checkIn < b.checkIn ? 1 : -1);

  // «Все брони» — only active (operational) bookings; archived & cancelled
  // live in their own tabs.
  const activeBookings = useMemo(
    () => bookings.filter(b => ACTIVE_STATUSES.includes(b.status)),
    [bookings],
  );

  const filtered = useMemo(() => {
    return activeBookings
      .filter(b => (statusFilter === 'all' || b.status === statusFilter) && matchesSearch(b))
      .sort(byCheckInDesc);
  }, [activeBookings, statusFilter, search, rooms]);

  const archivedBookings = useMemo(
    () => bookings.filter(b => ARCHIVED_STATUSES.includes(b.status) && matchesSearch(b)).sort(byCheckInDesc),
    [bookings, search, rooms],
  );

  const cancelledBookings = useMemo(
    () => bookings.filter(b => CANCELLED_STATUSES.includes(b.status) && matchesSearch(b)).sort(byCheckInDesc),
    [bookings, search, rooms],
  );

  const statusCounts = useMemo(() => {
    const counts = { all: activeBookings.length };
    ACTIVE_STATUSES.forEach(k => {
      counts[k] = activeBookings.filter(b => b.status === k).length;
    });
    return counts;
  }, [activeBookings]);

  const tabCounts = useMemo(() => ({
    archived: bookings.filter(b => ARCHIVED_STATUSES.includes(b.status)).length,
    cancelled: bookings.filter(b => CANCELLED_STATUSES.includes(b.status)).length,
  }), [bookings]);

  const getRoomNumber   = (roomId) => rooms.find(r => r.id === roomId)?.number || '?';
  const getCategoryName = (roomId) => {
    const room = rooms.find(r => r.id === roomId);
    return categories.find(c => c.id === room?.categoryId)?.name || '';
  };

  const openEdit = (booking) => { setSavingError(null); setFormData({ ...booking }); setShowForm(true); };
  const openNew  = () => { setSavingError(null); setFormData({ adults: 1, children: 0, status: 'confirmed', source: 'direct' }); setShowForm(true); };

  const handleSave = async (data) => {
    setSavingError(null);
    try {
      if (data.id) {
        await updateReservation(data.id, {
          version:    data.version,
          guestName:  data.guestName,
          phone:      data.phone  || undefined,
          email:      data.email  || undefined,
          roomId:     data.roomId,
          checkIn:    data.checkIn,
          checkOut:   data.checkOut,
          adults:     data.adults,
          children:   data.children ?? 0,
          status:     data.status,
          source:     data.source || 'DIRECT',
          notes:      data.notes || undefined,
          totalPrice: data.totalPrice || undefined,
        });
      } else {
        await createReservation({
          roomId:     data.roomId,
          guestName:  data.guestName,
          phone:      data.phone  || undefined,
          checkIn:    data.checkIn,
          checkOut:   data.checkOut,
          adults:     data.adults,
          children:   data.children ?? 0,
          status:     data.status || 'CONFIRMED',
          source:     data.source || 'DIRECT',
          notes:      data.notes  || undefined,
          totalPrice: data.totalPrice || undefined,
        });
      }
      await reload();
      setShowForm(false);
      setFormData(null);
    } catch (err) {
      const msg = err?.response?.data?.message ?? err.message ?? 'Ошибка сохранения';
      setSavingError(msg);
    }
  };

  const handleDelete = async (id) => {
    const booking = bookings.find(b => b.id === id);
    if (!booking) return;
    setSavingError(null);
    try {
      await updateReservation(id, { version: booking.version, status: 'CANCELLED' });
      await reload();
      setShowForm(false);
      setFormData(null);
    } catch (err) {
      const msg = err?.response?.data?.message ?? err.message ?? 'Ошибка';
      setSavingError(msg);
    }
  };

  const renderBookingsTable = (list, emptyText) => (
    <div className={classes.table}>
      <div className={classes.tableHead}>
        <div className={classes.th}>Гость</div>
        <div className={classes.th}>Номер</div>
        <div className={classes.th}>Заезд</div>
        <div className={classes.th}>Выезд</div>
        <div className={classes.th}>Статус</div>
        <div className={classes.th}>Сумма</div>
        <div className={classes.th}></div>
      </div>
      <div className={classes.tableBody}>
        {list.length === 0 && !loading && (
          <div className={classes.empty}>{emptyText}</div>
        )}
        {list.map(b => {
          const cfg = BOOKING_STATUS[b.status] || BOOKING_STATUS.new;
          const nights = differenceInDays(parseISO(b.checkOut), parseISO(b.checkIn));
          return (
            <div key={b.id} className={classes.tableRow} onClick={() => openEdit(b)}>
              <div className={classes.td}>
                <div className={classes.guestName}>{b.guestName}</div>
                <div className={classes.guestPhone}>{b.phone || '—'} · {b.adults} взр{b.children ? `, ${b.children} дет` : ''}</div>
              </div>
              <div className={classes.td}>
                <div className={classes.roomBadge}>№{getRoomNumber(b.roomId)}</div>
                <div style={{ fontSize: 10, color: '#8896AB', marginTop: 2 }}>{getCategoryName(b.roomId)}</div>
              </div>
              <div className={classes.td}>{format(parseISO(b.checkIn), 'd MMM', { locale: ru })}</div>
              <div className={classes.td}>{format(parseISO(b.checkOut), 'd MMM', { locale: ru })} <span style={{ color: '#8896AB', fontSize: 11 }}>({nights} н.)</span></div>
              <div className={classes.td}>
                <span className={classes.statusBadge} style={{ background: cfg.color + '22', color: cfg.color }}>
                  {cfg.label}
                </span>
              </div>
              <div className={`${classes.td} ${classes.price}`}>
                {b.totalPrice ? `${b.totalPrice.toLocaleString('ru-RU')} ₽` : '—'}
              </div>
              <div className={classes.td}>
                <button className={classes.actionBtn} onClick={e => { e.stopPropagation(); openEdit(b); }}>
                  Открыть
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className={classes.root}>
      <div className={classes.pageHeader}>
        <div className={classes.pageTitle}>Бронирования</div>
        <div className={classes.headerRight}>
          <input
            className={classes.searchInput}
            placeholder="Поиск по гостю, телефону, номеру..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button className={classes.btnAdd} onClick={openNew}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Новая бронь
          </button>
        </div>
      </div>

      <div className={classes.filterRow} style={{ marginBottom: 12 }}>
        {[
          { key: 'all', label: 'Все брони' },
          { key: 'arrivals', label: 'Заезды' },
          { key: 'departures', label: 'Выезды' },
          { key: 'archived', label: `Архивные${tabCounts.archived ? ` (${tabCounts.archived})` : ''}` },
          { key: 'cancelled', label: `Отменённые${tabCounts.cancelled ? ` (${tabCounts.cancelled})` : ''}` },
        ].map(tab => (
          <div
            key={tab.key}
            className={`${classes.filterChip} ${activeTab === tab.key ? classes.active : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </div>
        ))}
      </div>

      {error && (
        <div style={{ padding: '12px 16px', background: '#FEF2F2', color: '#DC2626', borderRadius: 8, marginBottom: 16, fontSize: 14 }}>
          Ошибка загрузки: {error}
        </div>
      )}

      {activeTab === 'all' && (
        <>
          {loading && !bookings.length && (
            <div style={{ padding: 48, textAlign: 'center', color: '#9CA3AF' }}>Загрузка...</div>
          )}

          <div className={classes.filterRow}>
            <div
              className={`${classes.filterChip} ${statusFilter === 'all' ? classes.active : ''}`}
              onClick={() => setStatusFilter('all')}
            >
              Все ({statusCounts.all})
            </div>
            {ACTIVE_STATUSES.map(key => {
              const cfg = BOOKING_STATUS[key];
              return statusCounts[key] > 0 && (
                <div
                  key={key}
                  className={`${classes.filterChip} ${statusFilter === key ? classes.active : ''}`}
                  style={statusFilter === key ? { background: cfg.color, borderColor: cfg.color } : {}}
                  onClick={() => setStatusFilter(key)}
                >
                  {cfg.label} ({statusCounts[key]})
                </div>
              );
            })}
          </div>

          {renderBookingsTable(filtered, 'Бронирования не найдены')}
        </>
      )}

      {activeTab === 'archived' && (
        <>
          <div style={{ fontSize: 12, color: '#8896AB', margin: '0 2px 10px' }}>
            Завершённые брони (гость выехал). В шахматке отображаются полупрозрачными.
          </div>
          {renderBookingsTable(archivedBookings, 'Архивных броней нет')}
        </>
      )}

      {activeTab === 'cancelled' && (
        <>
          <div style={{ fontSize: 12, color: '#8896AB', margin: '0 2px 10px' }}>
            Отменённые брони и неявки. Сохраняются для истории, в шахматке не отображаются.
          </div>
          {renderBookingsTable(cancelledBookings, 'Отменённых броней нет')}
        </>
      )}

      {activeTab === 'arrivals' && (
        <div className={classes.table}>
          <div className={classes.tableHead} style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 100px' }}>
            <div className={classes.th}>Гость</div>
            <div className={classes.th}>Номер</div>
            <div className={classes.th}>Заезд</div>
            <div className={classes.th}>Выезд</div>
            <div className={classes.th}>Статус</div>
            <div className={classes.th}></div>
          </div>
          <div className={classes.tableBody}>
            {arrivals.length === 0 && (
              <div className={classes.empty}>Заездов на сегодня нет</div>
            )}
            {arrivals.map(b => {
              const cfg = BOOKING_STATUS[b.status] || BOOKING_STATUS.new;
              return (
                <div key={b.id} className={classes.tableRow} style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 100px' }}>
                  <div className={classes.td}>
                    <div className={classes.guestName}>{b.guestName}</div>
                    <div className={classes.guestPhone}>{b.phone || '—'} · {b.adults} взр{b.children ? `, ${b.children} дет` : ''}</div>
                  </div>
                  <div className={classes.td}>
                    <div className={classes.roomBadge}>№{getRoomNumber(b.roomId)}</div>
                    <div style={{ fontSize: 10, color: '#8896AB', marginTop: 2 }}>{getCategoryName(b.roomId)}</div>
                  </div>
                  <div className={classes.td}>{format(parseISO(b.checkIn), 'd MMM', { locale: ru })}</div>
                  <div className={classes.td}>{format(parseISO(b.checkOut), 'd MMM', { locale: ru })}</div>
                  <div className={classes.td}>
                    <span className={classes.statusBadge} style={{ background: cfg.color + '22', color: cfg.color }}>
                      {cfg.label}
                    </span>
                  </div>
                  <div className={classes.td}>
                    <button
                      className={classes.btnAdd}
                      style={{ padding: '5px 10px', fontSize: 12 }}
                      onClick={() => handleCheckIn(b.id)}
                    >
                      Заселить
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeTab === 'departures' && (
        <div className={classes.table}>
          <div className={classes.tableHead} style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 100px' }}>
            <div className={classes.th}>Гость</div>
            <div className={classes.th}>Номер</div>
            <div className={classes.th}>Заезд</div>
            <div className={classes.th}>Выезд</div>
            <div className={classes.th}>Статус</div>
            <div className={classes.th}></div>
          </div>
          <div className={classes.tableBody}>
            {departures.length === 0 && (
              <div className={classes.empty}>Выездов на сегодня нет</div>
            )}
            {departures.map(b => {
              const cfg = BOOKING_STATUS[b.status] || BOOKING_STATUS.new;
              return (
                <div key={b.id} className={classes.tableRow} style={{ gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 100px' }}>
                  <div className={classes.td}>
                    <div className={classes.guestName}>{b.guestName}</div>
                    <div className={classes.guestPhone}>{b.phone || '—'} · {b.adults} взр{b.children ? `, ${b.children} дет` : ''}</div>
                  </div>
                  <div className={classes.td}>
                    <div className={classes.roomBadge}>№{getRoomNumber(b.roomId)}</div>
                    <div style={{ fontSize: 10, color: '#8896AB', marginTop: 2 }}>{getCategoryName(b.roomId)}</div>
                  </div>
                  <div className={classes.td}>{format(parseISO(b.checkIn), 'd MMM', { locale: ru })}</div>
                  <div className={classes.td}>{format(parseISO(b.checkOut), 'd MMM', { locale: ru })}</div>
                  <div className={classes.td}>
                    <span className={classes.statusBadge} style={{ background: cfg.color + '22', color: cfg.color }}>
                      {cfg.label}
                    </span>
                  </div>
                  <div className={classes.td}>
                    <button
                      className={classes.btnAdd}
                      style={{ padding: '5px 10px', fontSize: 12, background: '#43A047' }}
                      onClick={() => handleCheckOut(b.id)}
                    >
                      Выселить
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showForm && formData && (
        <BookingForm
          booking={formData}
          rooms={rooms}
          categories={categories}
          bookings={bookings}
          onSave={handleSave}
          onDelete={formData.id ? handleDelete : undefined}
          onClose={() => { setShowForm(false); setFormData(null); setSavingError(null); }}
          savingError={savingError}
        />
      )}
    </div>
  );
}

export default Bookings;
