import { useState } from 'react';
import classes from './Rooms.module.css';
import RoomTypeFormModal from './RoomTypeFormModal';
import RoomFormModal from './RoomFormModal';
import ConfirmDialog from '../../shared/ConfirmDialog';
import { ROOM_STATUS_CONFIG, BED_TYPE_LABELS } from '../../shared/status-config';
import {
  useRoomTypes,
  useCreateRoomType,
  useUpdateRoomType,
  useDeleteRoomType,
} from '../../../../hooks/api/useRoomTypes';
import {
  useRooms,
  useCreateRoom,
  useUpdateRoom,
  useUpdateRoomStatus,
  useDeleteRoom,
} from '../../../../hooks/api/useRooms';
import { useRunDemoSeed } from '../../../../hooks/api/useDemoSeed';

function Rooms() {
  const roomTypesQ = useRoomTypes();
  const roomsQ = useRooms();

  const createRT = useCreateRoomType();
  const updateRT = useUpdateRoomType();
  const deleteRT = useDeleteRoomType();
  const createRoom = useCreateRoom();
  const updateRoom = useUpdateRoom();
  const updateRoomStatus = useUpdateRoomStatus();
  const deleteRoom = useDeleteRoom();
  const runDemoSeed = useRunDemoSeed();

  // ── Modal state ────────────────────────────────────────────────────────────
  const [rtModal, setRtModal] = useState({ open: false, editing: null });
  const [roomModal, setRoomModal] = useState({
    open: false,
    editing: null,
    defaultRoomTypeId: undefined,
  });
  const [confirm, setConfirm] = useState(null); // { type: 'room'|'roomType', target, name }
  const [hkMenu, setHkMenu] = useState(null); // { roomId, x, y }

  const roomTypes = roomTypesQ.data ?? [];
  const rooms = roomsQ.data ?? [];
  const isLoading = roomTypesQ.isLoading || roomsQ.isLoading;
  const isEmpty = !isLoading && roomTypes.length === 0 && rooms.length === 0;

  // ── Demo seed ──────────────────────────────────────────────────────────────
  const handleSeed = () => {
    runDemoSeed.mutate(undefined, {
      onError: (e) => {
        const msg = e?.response?.data?.message || e?.message || 'Не удалось засеять';
        alert(Array.isArray(msg) ? msg.join(', ') : msg);
      },
    });
  };

  // ── Status menu ────────────────────────────────────────────────────────────
  const openHkMenu = (e, roomId) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setHkMenu({
      roomId,
      x: Math.min(rect.left, window.innerWidth - 200),
      y: rect.bottom + 4,
    });
  };
  const changeStatus = (roomId, status) => {
    updateRoomStatus.mutate({ id: roomId, status });
    setHkMenu(null);
  };

  // ── Pending UI for the loader/empty state ──────────────────────────────────
  if (isLoading) {
    return (
      <div className={classes.root}>
        <div className={classes.pageHeader}>
          <div className={classes.pageTitle}>Номерной фонд</div>
        </div>
        <div className={classes.loadingState}>Загружаем данные…</div>
      </div>
    );
  }

  if (isEmpty) {
    return (
      <div className={classes.root}>
        <div className={classes.pageHeader}>
          <div className={classes.pageTitle}>Номерной фонд</div>
        </div>
        <div className={classes.emptyState}>
          <div className={classes.emptyIcon}>
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9,22 9,12 15,12 15,22" />
            </svg>
          </div>
          <div className={classes.emptyTitle}>Здесь пока пусто</div>
          <div className={classes.emptyText}>
            Создайте первую категорию и добавьте номера — или загрузите готовый набор<br />
            из 4 категорий и 21 номера, чтобы быстро всё попробовать.
          </div>
          <div className={classes.emptyActions}>
            <button
              type="button"
              className={classes.btnPrimary}
              onClick={handleSeed}
              disabled={runDemoSeed.isPending}
            >
              {runDemoSeed.isPending ? 'Заполняем…' : 'Заполнить демо-данными'}
            </button>
            <button
              type="button"
              className={classes.btnGhost}
              onClick={() => setRtModal({ open: true, editing: null })}
            >
              Создать категорию вручную
            </button>
          </div>
        </div>

        <RoomTypeFormModal
          open={rtModal.open}
          editing={rtModal.editing}
          onClose={() => setRtModal({ open: false, editing: null })}
          onSubmit={(payload) => createRT.mutateAsync(payload)}
        />
      </div>
    );
  }

  // ── Main grid ──────────────────────────────────────────────────────────────
  return (
    <div className={classes.root} onClick={() => setHkMenu(null)}>
      <div className={classes.pageHeader}>
        <div className={classes.pageTitle}>Номерной фонд</div>
        <div className={classes.headerActions}>
          <button
            type="button"
            className={classes.btnGhost}
            onClick={() => setRtModal({ open: true, editing: null })}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Категория
          </button>
          <button
            type="button"
            className={classes.btnAdd}
            onClick={() =>
              setRoomModal({ open: true, editing: null, defaultRoomTypeId: undefined })
            }
            disabled={roomTypes.length === 0}
            title={
              roomTypes.length === 0
                ? 'Сначала создайте категорию'
                : undefined
            }
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Добавить номер
          </button>
        </div>
      </div>

      {roomTypes.map((cat) => {
        const catRooms = rooms.filter((r) => r.roomTypeId === cat.id);
        const readyCount = catRooms.filter((r) => r.status === 'READY').length;
        return (
          <div key={cat.id} className={classes.categorySection}>
            <div className={classes.catHeader}>
              <div className={classes.catInfo}>
                <div className={classes.catName}>{cat.name}</div>
                <div className={classes.catMeta}>
                  {catRooms.length} номеров · {readyCount} готово · вместимость{' '}
                  {cat.baseOccupancy}–{cat.maxOccupancy} чел.
                </div>
              </div>
              <div className={classes.catRight}>
                <div className={classes.catPrice}>
                  {Number(cat.basePrice ?? 0).toLocaleString('ru-RU')} ₽
                </div>
                <button
                  type="button"
                  className={classes.iconBtn}
                  onClick={() => setRtModal({ open: true, editing: cat })}
                  title="Изменить категорию"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
                <button
                  type="button"
                  className={classes.iconBtn}
                  onClick={() =>
                    setConfirm({
                      type: 'roomType',
                      target: cat,
                      name: cat.name,
                    })
                  }
                  title="Удалить категорию"
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#DC2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6" /><path d="M14 11v6" />
                  </svg>
                </button>
              </div>
            </div>

            <div className={classes.roomsGrid}>
              {catRooms.map((room) => {
                const cfg = ROOM_STATUS_CONFIG[room.status] || ROOM_STATUS_CONFIG.CLEAN;
                return (
                  <div
                    key={room.id}
                    className={classes.roomCard}
                    onClick={() => setRoomModal({ open: true, editing: room, defaultRoomTypeId: undefined })}
                  >
                    <div className={classes.roomNumber}>№{room.number}</div>
                    <div className={classes.roomMeta}>
                      {room.floor} этаж · {BED_TYPE_LABELS[room.bedType] || room.bedType}
                    </div>
                    <div
                      className={classes.hkBadge}
                      style={{ background: cfg.bg, color: cfg.color }}
                      onClick={(e) => openHkMenu(e, room.id)}
                      title="Изменить статус уборки"
                    >
                      <div className={classes.hkDot} style={{ background: cfg.color }} />
                      {cfg.label}
                    </div>
                  </div>
                );
              })}
              <button
                type="button"
                className={classes.addRoomCard}
                onClick={() =>
                  setRoomModal({ open: true, editing: null, defaultRoomTypeId: cat.id })
                }
                title="Добавить номер в эту категорию"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            </div>
          </div>
        );
      })}

      {/* ── status dropdown ─────────────────────────────────────────────────── */}
      {hkMenu && (
        <div
          className={classes.hkMenu}
          style={{ left: hkMenu.x, top: hkMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {Object.entries(ROOM_STATUS_CONFIG).map(([key, cfg]) => (
            <div
              key={key}
              className={classes.hkMenuItem}
              onClick={() => changeStatus(hkMenu.roomId, key)}
            >
              <div className={classes.hkDot} style={{ background: cfg.color }} />
              {cfg.label}
            </div>
          ))}
        </div>
      )}

      {/* ── modals ──────────────────────────────────────────────────────────── */}
      <RoomTypeFormModal
        open={rtModal.open}
        editing={rtModal.editing}
        onClose={() => setRtModal({ open: false, editing: null })}
        onSubmit={(payload) =>
          rtModal.editing
            ? updateRT.mutateAsync({ id: rtModal.editing.id, payload })
            : createRT.mutateAsync(payload)
        }
      />

      <RoomFormModal
        open={roomModal.open}
        editing={roomModal.editing}
        roomTypes={roomTypes}
        defaultRoomTypeId={roomModal.defaultRoomTypeId}
        onClose={() => setRoomModal({ open: false, editing: null, defaultRoomTypeId: undefined })}
        onSubmit={(payload) =>
          roomModal.editing
            ? updateRoom.mutateAsync({ id: roomModal.editing.id, payload })
            : createRoom.mutateAsync(payload)
        }
      />

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.type === 'roomType' ? 'Удалить категорию?' : 'Удалить номер?'}
        message={
          confirm?.type === 'roomType'
            ? `Категория «${confirm?.name}» будет удалена. Если в ней есть номера — удаление не пройдёт.`
            : `Номер №${confirm?.name} будет удалён без возможности восстановить.`
        }
        confirmLabel="Удалить"
        danger
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          if (confirm?.type === 'roomType') await deleteRT.mutateAsync(confirm.target.id);
          else if (confirm?.type === 'room') await deleteRoom.mutateAsync(confirm.target.id);
        }}
      />

      {/* Edit room: add a delete button at top of edit modal? Keep simple — */}
      {/* delete is accessible by long-press / right-click in a future iteration. */}
    </div>
  );
}

export default Rooms;
