import { useMemo, useState } from 'react';
import classes from './Housekeeping.module.css';
import { ROOM_STATUS_CONFIG, ROOM_STATUS_FLOW } from '../../shared/status-config';
import { useRooms, useUpdateRoomStatus } from '../../../../hooks/api/useRooms';
import { useRoomTypes } from '../../../../hooks/api/useRoomTypes';

const STATUSES = Object.keys(ROOM_STATUS_CONFIG);

function Housekeeping() {
  const roomsQ = useRooms();
  const roomTypesQ = useRoomTypes();
  const updateStatus = useUpdateRoomStatus();

  const rooms = roomsQ.data ?? [];
  const roomTypes = roomTypesQ.data ?? [];
  const catNameById = useMemo(
    () => new Map(roomTypes.map((rt) => [rt.id, rt.name])),
    [roomTypes],
  );

  const [filter, setFilter] = useState('all');

  const counts = useMemo(() => {
    const c = { all: rooms.length };
    for (const s of STATUSES) c[s] = rooms.filter((r) => r.status === s).length;
    return c;
  }, [rooms]);

  const filtered = filter === 'all' ? rooms : rooms.filter((r) => r.status === filter);

  if (roomsQ.isLoading) {
    return (
      <div className={classes.root}>
        <div className={classes.pageHeader}>
          <div className={classes.pageTitle}>Уборка</div>
        </div>
        <div className={classes.empty}>Загружаем номера…</div>
      </div>
    );
  }

  if (rooms.length === 0) {
    return (
      <div className={classes.root}>
        <div className={classes.pageHeader}>
          <div className={classes.pageTitle}>Уборка</div>
        </div>
        <div className={classes.empty}>
          Сначала добавьте номерной фонд в разделе «Номера».
        </div>
      </div>
    );
  }

  return (
    <div className={classes.root}>
      <div className={classes.pageHeader}>
        <div className={classes.pageTitle}>Уборка</div>
      </div>

      <div className={classes.statsRow}>
        <div
          className={`${classes.statChip} ${filter === 'all' ? classes.active : ''}`}
          style={filter === 'all' ? { color: '#1E88E5' } : {}}
          onClick={() => setFilter('all')}
        >
          <div className={classes.statCount}>{counts.all}</div>
          <div className={classes.statLabel}>Всего</div>
        </div>
        {STATUSES.map((key) => {
          const cfg = ROOM_STATUS_CONFIG[key];
          return (
            <div
              key={key}
              className={`${classes.statChip} ${filter === key ? classes.active : ''}`}
              style={filter === key ? { color: cfg.color } : {}}
              onClick={() => setFilter(key)}
            >
              <div className={classes.statDot} style={{ background: cfg.color }} />
              <div>
                <div className={classes.statCount}>{counts[key]}</div>
                <div className={classes.statLabel}>{cfg.label}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className={classes.grid}>
        {filtered.map((room) => {
          const cfg = ROOM_STATUS_CONFIG[room.status] || ROOM_STATUS_CONFIG.CLEAN;
          const nextStatuses = ROOM_STATUS_FLOW[room.status] || [];
          const catName = catNameById.get(room.roomTypeId) || room.roomType?.name || '';
          return (
            <div key={room.id} className={classes.card} style={{ borderColor: cfg.bg }}>
              <div className={classes.cardTop}>
                <div>
                  <div className={classes.roomNum}>№{room.number}</div>
                  <div className={classes.roomCat}>{catName} · {room.floor} эт.</div>
                </div>
                <div
                  className={classes.hkBadge}
                  style={{ background: cfg.bg, color: cfg.color }}
                >
                  {cfg.label}
                </div>
              </div>
              <div className={classes.cardActions}>
                {nextStatuses.map((next, i) => (
                  <button
                    key={next}
                    type="button"
                    className={`${classes.actionBtn} ${i === 0 ? classes.primary : ''}`}
                    onClick={() => updateStatus.mutate({ id: room.id, status: next })}
                    disabled={updateStatus.isPending && updateStatus.variables?.id === room.id}
                  >
                    → {ROOM_STATUS_CONFIG[next]?.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default Housekeeping;
