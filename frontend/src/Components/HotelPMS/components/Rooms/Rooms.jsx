import { useState } from 'react';
import classes from './Rooms.module.css';
import RoomTypeFormModal from './RoomTypeFormModal';
import RoomFormModal from './RoomFormModal';
import ConfirmDialog from '../../shared/ConfirmDialog';
import formClasses from '../../shared/Form.module.css';
import { useRoomSelection } from './useRoomSelection';
import { useCollapsedCategories } from './useCollapsedCategories';
import { archiveSummary, numberList, plural } from './room-range';
import {
  ROOM_STATUS_CONFIG,
  bedsLabel,
  PARTNER_HOLD_CONFIG,
} from '../../shared/status-config';
import {
  useRoomTypes,
  useCreateRoomType,
  useUpdateRoomType,
  useDeleteRoomType,
} from '../../../../hooks/api/useRoomTypes';
import {
  useRooms,
  useCreateRoom,
  useCreateRooms,
  useUpdateRoom,
  useUpdateRoomStatus,
  useArchiveRoom,
  useArchiveRooms,
  useRestoreRoom,
} from '../../../../hooks/api/useRooms';
import { useRunDemoSeed } from '../../../../hooks/api/useDemoSeed';

/* Удаление номера — «в архив» (решение владельца 25.10.2026: удаление не
   стирает данные из базы). Кнопка «Удалить номер» в окне правки убирает номер
   из фонда, шахматки и продажи; брони и история остаются, номер возвращается
   кнопкой «Восстановить» в разделе «Удалённые номера» внизу страницы.
   Физическое удаление (DELETE) выключено на сервере — room-delete.switch.ts. */

function Rooms() {
  const roomTypesQ = useRoomTypes();
  const roomsQ = useRooms();
  const archivedQ = useRooms({ archived: true });

  const createRT = useCreateRoomType();
  const updateRT = useUpdateRoomType();
  const deleteRT = useDeleteRoomType();
  const createRoom = useCreateRoom();
  const createRooms = useCreateRooms();
  const updateRoom = useUpdateRoom();
  const updateRoomStatus = useUpdateRoomStatus();
  const archiveRoom = useArchiveRoom();
  const restoreRoom = useRestoreRoom();
  const archiveRooms = useArchiveRooms();
  const selection = useRoomSelection();
  const collapsedCats = useCollapsedCategories();
  const [archiveResult, setArchiveResult] = useState(null);
  // Страница прокручена — под прилипшей шапкой нужна черта (см. .pageHeaderStuck).
  const [stuck, setStuck] = useState(false);
  const runDemoSeed = useRunDemoSeed();
  const [showArchived, setShowArchived] = useState(false);
  const [restoreError, setRestoreError] = useState(null);
  const archived = archivedQ.data ?? [];

  // ── Modal state ────────────────────────────────────────────────────────────
  const [rtModal, setRtModal] = useState({ open: false, editing: null });
  const [roomModal, setRoomModal] = useState({
    open: false,
    editing: null,
    defaultRoomTypeId: undefined,
  });
  const [confirm, setConfirm] = useState(null); // { type: 'room'|'roomType'|'rooms', target, name }
  const [hkMenu, setHkMenu] = useState(null); // { roomId, x, y }

  const roomTypes = roomTypesQ.data ?? [];
  const rooms = roomsQ.data ?? [];
  /* Считаем только номера, видимые в фонде: удалённый в другой вкладке из
     выбора выпадает сам. */
  const selectedRooms = rooms.filter((r) => selection.selected.has(r.id));
  const stopSelection = () => {
    selection.stop();
    setArchiveResult(null);
  };

  /* Удаление пачкой: удалённые и пропавшие снимаются с выбора, номера с
     бронями остаются отмеченными — их удаляют снова после переноса броней. */
  const archiveSelected = async (targets) => {
    const res = await archiveRooms.mutateAsync(targets.map((r) => r.id));
    selection.setMany([...res.archived.map((r) => r.id), ...res.notFound], false);
    const summary = archiveSummary(res);
    if (summary) setArchiveResult(summary);
    else stopSelection();
  };
  const isLoading = roomTypesQ.isLoading || roomsQ.isLoading;
  /* Заставка «пусто» — только без удалённых номеров: иначе она прятала бы
     «Удалённые номера», а через их «Восстановить» возвращается и удалённая
     категория. */
  const isEmpty =
    !isLoading && roomTypes.length === 0 && rooms.length === 0 && archived.length === 0;

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
    <div
      className={classes.root}
      onClick={() => setHkMenu(null)}
      onScroll={(e) => setStuck(e.currentTarget.scrollTop > 0)}
    >
      {/* В режиме выбора шапка становится панелью действий: счётчик и
          «Удалить» там же, где нажали «Выбрать». Шапка прилипает к верху. */}
      <div className={stuck ? `${classes.pageHeader} ${classes.pageHeaderStuck}` : classes.pageHeader}>
        <div className={classes.pageTitle}>
          {selection.active
            ? `Выбрано: ${selectedRooms.length} из ${rooms.length}`
            : 'Номерной фонд'}
        </div>
        <div className={classes.headerActions}>
          {selection.active ? (
            <>
              {/* Свои ключи: без них React переиспользует эти кнопки под
                  «Категорию» и «Добавить номер», и красный фон «Удалить»
                  на миг вспыхивает на соседней кнопке (переход цвета). */}
              <button key="sel-cancel" type="button" className={classes.btnGhost} onClick={stopSelection}>
                Отмена
              </button>
              <button
                key="sel-delete"
                type="button"
                className={classes.btnDelete}
                onClick={() => setConfirm({ type: 'rooms', target: selectedRooms })}
                disabled={selectedRooms.length === 0}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                </svg>
                {selectedRooms.length > 0 ? `Удалить ${selectedRooms.length}` : 'Удалить'}
              </button>
            </>
          ) : (
            <>
              {rooms.length > 0 && (
                <button type="button" className={classes.btnGhost} onClick={selection.start}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 11 12 14 22 4" />
                    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                  </svg>
                  Выбрать
                </button>
              )}
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
            </>
          )}
        </div>
        {selection.active && archiveResult && (
          <div className={`${formClasses.notice} ${classes.selectionNotice}`}>{archiveResult}</div>
        )}
      </div>

      {roomTypes.map((cat) => {
        const catRooms = rooms.filter((r) => r.roomTypeId === cat.id);
        const readyCount = catRooms.filter((r) => r.status === 'READY').length;
        const catIds = catRooms.map((r) => r.id);
        const allCatSelected = catIds.length > 0 && catIds.every((id) => selection.selected.has(id));
        const isCollapsed = collapsedCats.collapsed.has(cat.id);
        return (
          <div key={cat.id} className={classes.categorySection}>
            <div
              className={isCollapsed ? `${classes.catHeader} ${classes.catHeaderCollapsed}` : classes.catHeader}
            >
              {/* Вся левая часть шапки — кнопка сворачивания: попасть по
                  названию проще, чем по маленькой стрелке. */}
              <button
                type="button"
                className={classes.catToggle}
                onClick={() => collapsedCats.toggle(cat.id)}
                aria-expanded={!isCollapsed}
                title={isCollapsed ? 'Показать номера' : 'Скрыть номера'}
              >
                <svg
                  className={isCollapsed ? `${classes.catChevron} ${classes.catChevronCollapsed}` : classes.catChevron}
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
                <span className={classes.catInfo}>
                  <span className={classes.catName}>{cat.name}</span>
                  <span className={classes.catMeta}>
                    {catRooms.length} номеров · {readyCount} готово · вместимость{' '}
                    {cat.baseOccupancy}–{cat.maxOccupancy} чел.
                  </span>
                </span>
              </button>
              <div className={classes.catRight}>
                <div className={classes.catPrice}>
                  {Number(cat.basePrice ?? 0).toLocaleString('ru-RU')} ₽
                </div>
                {selection.active ? (
                  catIds.length > 0 && (
                    <button
                      type="button"
                      className={classes.catSelect}
                      onClick={() => selection.setMany(catIds, !allCatSelected)}
                    >
                      {allCatSelected ? 'Снять все' : 'Выбрать все в категории'}
                    </button>
                  )
                ) : (
                  <>
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
                  </>
                )}
              </div>
            </div>

            <div className={isCollapsed ? `${classes.roomsGrid} ${classes.roomsGridCollapsed}` : classes.roomsGrid}>
              {catRooms.map((room) => {
                const cfg = ROOM_STATUS_CONFIG[room.status] || ROOM_STATUS_CONFIG.CLEAN;
                const isSelected = selection.selected.has(room.id);
                return (
                  <div
                    key={room.id}
                    className={[
                      classes.roomCard,
                      selection.active && classes.roomCardSelecting,
                      isSelected && classes.roomCardSelected,
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() =>
                      selection.active
                        ? selection.toggle(room.id)
                        : setRoomModal({ open: true, editing: room, defaultRoomTypeId: undefined })
                    }
                  >
                    {/* Настоящая галочка, а не нарисованная: её состояние пишет
                        журнал действий (lib/journal.js), а клавиатура до неё
                        дотягивается. */}
                    {selection.active && (
                      <input
                        type="checkbox"
                        className={classes.roomCheck}
                        checked={isSelected}
                        onChange={() => selection.toggle(room.id)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`№${room.number}`}
                      />
                    )}
                    <div className={classes.roomNumber}>№{room.number}</div>
                    <div className={classes.roomMeta}>
                      {room.floor} этаж · {bedsLabel(room)}
                    </div>
                    {/* А3 · договорный блок виден прямо на карточке: администратор
                        решает «продавать или нет» здесь, а не открывая номер. */}
                    {room.partnerHold && room.partnerHold !== 'NONE' && (
                      <div
                        className={classes.holdBadge}
                        style={{
                          background: PARTNER_HOLD_CONFIG[room.partnerHold]?.bg,
                          color: PARTNER_HOLD_CONFIG[room.partnerHold]?.color,
                        }}
                        title={PARTNER_HOLD_CONFIG[room.partnerHold]?.hint}
                      >
                        {PARTNER_HOLD_CONFIG[room.partnerHold]?.short}
                      </div>
                    )}
                    <div
                      className={classes.hkBadge}
                      style={{ background: cfg.bg, color: cfg.color }}
                      onClick={selection.active ? undefined : (e) => openHkMenu(e, room.id)}
                      title={selection.active ? undefined : 'Изменить статус уборки'}
                    >
                      <div className={classes.hkDot} style={{ background: cfg.color }} />
                      {cfg.label}
                    </div>
                  </div>
                );
              })}
              {!selection.active && (
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
              )}
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
        onSubmitMany={(payload) => createRooms.mutateAsync(payload)}
        onDelete={() => {
          const room = roomModal.editing;
          setRoomModal({ open: false, editing: null, defaultRoomTypeId: undefined });
          setConfirm({ type: 'room', target: room, name: room.number });
        }}
      />

      <ConfirmDialog
        open={!!confirm}
        title={confirmTitle(confirm)}
        message={confirmMessage(confirm)}
        confirmLabel="Удалить"
        danger
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          if (confirm?.type === 'roomType') await deleteRT.mutateAsync(confirm.target.id);
          else if (confirm?.type === 'room') await archiveRoom.mutateAsync(confirm.target.id);
          else if (confirm?.type === 'rooms') await archiveSelected(confirm.target);
        }}
      />

      {/* ── Удалённые номера (архив) ───────────────────────────────────────── */}
      {archived.length > 0 && (
        <div className={classes.archiveSection}>
          <button
            type="button"
            className={classes.archiveToggle}
            onClick={() => setShowArchived((v) => !v)}
            aria-expanded={showArchived}
          >
            {showArchived ? 'Скрыть' : 'Показать'} удалённые номера ({archived.length})
          </button>
          {showArchived && (
            <>
              {restoreError && <div className={classes.archiveError}>{restoreError}</div>}
              <table className={classes.archiveTable}>
                <thead>
                  <tr>
                    <th style={{ width: '40%' }}>Номер</th>
                    <th style={{ width: '30%' }}>Категория</th>
                    <th style={{ width: '15%' }}>Удалён</th>
                    <th style={{ width: '15%' }} />
                  </tr>
                </thead>
                <tbody>
                  {archived.map((room) => (
                    <tr key={room.id}>
                      <td>№{room.number}</td>
                      <td>{room.roomType?.name ?? '—'}</td>
                      <td>{room.archivedAt ? new Date(room.archivedAt).toLocaleDateString('ru-RU') : '—'}</td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          className={classes.btnGhost}
                          disabled={restoreRoom.isPending}
                          onClick={() => {
                            setRestoreError(null);
                            restoreRoom.mutate(room.id, {
                              onError: (e) => {
                                const msg = e?.response?.data?.message || e?.message || 'Не удалось восстановить';
                                setRestoreError(Array.isArray(msg) ? msg.join(', ') : msg);
                              },
                            });
                          }}
                        >
                          Восстановить
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/* Тексты подтверждения удаления: категория, один номер, пачка номеров. */
function confirmTitle(confirm) {
  if (confirm?.type === 'roomType') return 'Удалить категорию?';
  if (confirm?.type === 'rooms') {
    const n = confirm.target.length;
    return `Удалить ${n} ${plural(n, 'номер', 'номера', 'номеров')}?`;
  }
  return 'Удалить номер?';
}

function confirmMessage(confirm) {
  if (confirm?.type === 'roomType') {
    return `Категория «${confirm?.name}» пропадёт из номерного фонда и продажи. Если в ней есть номера — удаление не пройдёт (удалённые номера не мешают). Восстановите любой её номер из «Удалённых номеров» — категория вернётся вместе с ним.`;
  }
  if (confirm?.type === 'rooms') {
    const one = confirm.target.length === 1;
    const list = numberList(confirm.target.map((r) => r.number));
    return one
      ? `${list} пропадёт из номерного фонда, шахматки и продажи. Брони и история сохранятся — номер можно восстановить в разделе «Удалённые номера» внизу страницы. Номер с действующими бронями не удалится — после удаления назовём его.`
      : `${list} пропадут из номерного фонда, шахматки и продажи. Брони и история сохранятся — номера можно восстановить в разделе «Удалённые номера» внизу страницы. Номера с действующими бронями не удалятся — после удаления назовём их.`;
  }
  return `Номер №${confirm?.name} пропадёт из номерного фонда, шахматки и продажи. Брони и история сохранятся — номер можно восстановить в разделе «Удалённые номера» внизу страницы. Номер с действующими бронями удалить нельзя: сначала перенесите их на другой номер.`;
}

export default Rooms;
