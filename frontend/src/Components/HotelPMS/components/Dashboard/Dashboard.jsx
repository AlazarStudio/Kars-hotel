import React, { useMemo } from 'react';
import { parseISO, format, isToday } from 'date-fns';
import { ru } from 'date-fns/locale';
import classes from './Dashboard.module.css';
import { BOOKING_STATUS, HK_STATUS } from '../../constants';
import { useDashboard } from '../../../../hooks/useDashboard';

const TODAY_STR = format(new Date(), 'yyyy-MM-dd');

function Dashboard() {
  const { data, loading, error } = useDashboard();

  const bookings   = data?.bookings   ?? [];
  const rooms      = data?.rooms      ?? [];
  const categories = data?.categories ?? [];

  const stats = useMemo(() => {
    const arrivalsToday = bookings.filter(b =>
      b.checkIn === TODAY_STR && b.status !== 'cancelled' && b.status !== 'no_show'
    );
    const departuresToday = bookings.filter(b =>
      b.checkOut === TODAY_STR && b.status !== 'cancelled' && b.status !== 'no_show'
    );
    const currentlyIn = bookings.filter(b => b.status === 'checked_in');
    const occupied = new Set(currentlyIn.map(b => b.roomId)).size;
    const total = rooms.length;
    const available = total - occupied;

    return { arrivalsToday, departuresToday, currentlyIn, occupied, total, available };
  }, [bookings, rooms]);

  const hkCounts = useMemo(() => {
    const counts = {};
    Object.keys(HK_STATUS).forEach(k => { counts[k] = 0; });
    rooms.forEach(r => { if (counts[r.hk] !== undefined) counts[r.hk]++; });
    return counts;
  }, [rooms]);

  const occupancyByCategory = useMemo(() => {
    return categories.map(cat => {
      const catRooms = rooms.filter(r => r.categoryId === cat.id);
      const occupiedIds = new Set(
        bookings.filter(b => b.status === 'checked_in').map(b => b.roomId)
      );
      const occupiedCount = catRooms.filter(r => occupiedIds.has(r.id)).length;
      return {
        ...cat,
        total: catRooms.length,
        occupied: occupiedCount,
        pct: catRooms.length ? Math.round((occupiedCount / catRooms.length) * 100) : 0,
      };
    });
  }, [categories, rooms, bookings]);

  const formatDate = (d) => format(parseISO(d), 'd MMM', { locale: ru });
  const getInitials = (name) => name.split(' ').slice(0, 2).map(p => p[0]).join('');
  const getRoomNumber = (roomId) => rooms.find(r => r.id === roomId)?.number || '?';

  if (loading && !data) {
    return (
      <div className={classes.root}>
        <div className={classes.pageHeader}>
          <div className={classes.pageTitle}>Дашборд</div>
        </div>
        <div style={{ padding: 40, color: '#8896AB', fontSize: 14 }}>Загрузка...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={classes.root}>
        <div className={classes.pageHeader}>
          <div className={classes.pageTitle}>Дашборд</div>
        </div>
        <div style={{ padding: 40, color: '#EF4444', fontSize: 14 }}>Ошибка загрузки: {error}</div>
      </div>
    );
  }

  const occupancyPct = stats.total > 0 ? Math.round((stats.occupied / stats.total) * 100) : 0;

  return (
    <div className={classes.root}>
      <div className={classes.pageHeader}>
        <div className={classes.pageTitle}>Дашборд</div>
        <div className={classes.pageSubtitle}>
          {format(new Date(), 'EEEE, d MMMM yyyy', { locale: ru })}
        </div>
      </div>

      <div className={classes.statsGrid}>
        <div className={classes.statCard}>
          <div className={classes.statLabel}>Загрузка</div>
          <div className={`${classes.statValue} ${classes.statAccent}`}>{occupancyPct}%</div>
          <div className={classes.statSub}>{stats.occupied} из {stats.total} номеров</div>
          <div className={classes.statBar}>
            <div className={classes.statBarFill} style={{ width: `${occupancyPct}%` }} />
          </div>
        </div>
        <div className={classes.statCard}>
          <div className={classes.statLabel}>Заезды сегодня</div>
          <div className={`${classes.statValue} ${classes.statAccentGreen}`}>
            {stats.arrivalsToday.length}
          </div>
          <div className={classes.statSub}>гостей ожидается</div>
        </div>
        <div className={classes.statCard}>
          <div className={classes.statLabel}>Выезды сегодня</div>
          <div className={`${classes.statValue} ${classes.statAccentOrange}`}>
            {stats.departuresToday.length}
          </div>
          <div className={classes.statSub}>номеров освобождается</div>
        </div>
        <div className={classes.statCard}>
          <div className={classes.statLabel}>Свободных номеров</div>
          <div className={classes.statValue}>{stats.available}</div>
          <div className={classes.statSub}>из {stats.total} всего</div>
        </div>
      </div>

      <div className={classes.row}>
        <div className={classes.card}>
          <div className={classes.cardHeader}>
            <div className={classes.cardTitle}>Заезды сегодня</div>
            <div className={classes.cardBadge}>{stats.arrivalsToday.length}</div>
          </div>
          <div className={classes.cardBody}>
            {stats.arrivalsToday.length === 0 && (
              <div className={classes.empty}>Нет заездов на сегодня</div>
            )}
            {stats.arrivalsToday.map(b => (
              <div key={b.id} className={classes.guestRow}>
                <div className={classes.guestAvatar}>{getInitials(b.guestName)}</div>
                <div className={classes.guestInfo}>
                  <div className={classes.guestName}>{b.guestName}</div>
                  <div className={classes.guestMeta}>{b.adults} чел · {formatDate(b.checkIn)} – {formatDate(b.checkOut)}</div>
                </div>
                <div className={classes.guestRoom}>№{getRoomNumber(b.roomId)}</div>
              </div>
            ))}
          </div>
        </div>

        <div className={classes.card}>
          <div className={classes.cardHeader}>
            <div className={classes.cardTitle}>Выезды сегодня</div>
            <div className={classes.cardBadge}>{stats.departuresToday.length}</div>
          </div>
          <div className={classes.cardBody}>
            {stats.departuresToday.length === 0 && (
              <div className={classes.empty}>Нет выездов на сегодня</div>
            )}
            {stats.departuresToday.map(b => (
              <div key={b.id} className={classes.guestRow}>
                <div className={classes.guestAvatar} style={{ background: '#FFF3E0', color: '#FB8C00' }}>
                  {getInitials(b.guestName)}
                </div>
                <div className={classes.guestInfo}>
                  <div className={classes.guestName}>{b.guestName}</div>
                  <div className={classes.guestMeta}>{b.adults} чел · выезд до 12:00</div>
                </div>
                <div className={classes.guestRoom} style={{ background: '#FB8C00' }}>№{getRoomNumber(b.roomId)}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className={classes.row}>
        <div className={classes.card}>
          <div className={classes.cardHeader}>
            <div className={classes.cardTitle}>Статусы уборки</div>
          </div>
          <div className={classes.hkGrid}>
            {Object.entries(HK_STATUS).map(([key, cfg]) => (
              <div key={key} className={classes.hkCell}>
                <div className={classes.hkDot} style={{ background: cfg.color }} />
                <div className={classes.hkCount}>{hkCounts[key]}</div>
                <div className={classes.hkLabel}>{cfg.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div className={classes.card}>
          <div className={classes.cardHeader}>
            <div className={classes.cardTitle}>Загрузка по категориям</div>
          </div>
          <div style={{ padding: '16px 20px' }}>
            {occupancyByCategory.length === 0 && (
              <div className={classes.empty}>Нет данных</div>
            )}
            <div className={classes.occBars}>
              {occupancyByCategory.map(cat => (
                <div key={cat.id} className={classes.occBar}>
                  <div className={classes.occBarLabel}>{cat.name}</div>
                  <div className={classes.occBarTrack}>
                    <div className={classes.occBarFill} style={{ width: `${cat.pct}%` }} />
                  </div>
                  <div className={classes.occBarValue}>{cat.pct}%</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className={classes.card}>
        <div className={classes.cardHeader}>
          <div className={classes.cardTitle}>Проживающие сейчас</div>
          <div className={classes.cardBadge}>{stats.currentlyIn.length}</div>
        </div>
        <div className={classes.cardBody}>
          {stats.currentlyIn.length === 0 && (
            <div className={classes.empty}>Нет проживающих гостей</div>
          )}
          {stats.currentlyIn.map(b => (
            <div key={b.id} className={classes.guestRow}>
              <div className={classes.guestAvatar} style={{ background: '#E3F2FD', color: '#1E88E5' }}>
                {getInitials(b.guestName)}
              </div>
              <div className={classes.guestInfo}>
                <div className={classes.guestName}>{b.guestName}</div>
                <div className={classes.guestMeta}>
                  {b.adults} взр{b.children > 0 ? `, ${b.children} дет` : ''} · выезд {formatDate(b.checkOut)}
                </div>
              </div>
              <div className={classes.guestRoom}>№{getRoomNumber(b.roomId)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default Dashboard;
