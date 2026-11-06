import { useMemo, useState } from 'react';
import classes from './Housekeeping.module.css';
import { ROOM_STATUS_CONFIG, ROOM_STATUS_FLOW } from '../../shared/status-config';
import { useRooms, useUpdateRoomStatus } from '../../../../hooks/api/useRooms';
import { useRoomTypes } from '../../../../hooks/api/useRoomTypes';
import {
  useHousekeepingTasks,
  useAssignTask,
  useCompleteTask,
  useCreateTask,
} from '../../../../hooks/api/useHousekeepingTasks';
import { useTenantUsers } from '../../../../hooks/api/useTenantUsers';
import { useAuth } from '../../../../auth/AuthContext';
import Modal from '../../shared/Modal';
import formClasses from '../../shared/Form.module.css';
import Select from '../../shared/Select';

const STATUSES = Object.keys(ROOM_STATUS_CONFIG);

const TASK_STATUS_CONFIG = {
  PENDING:     { label: 'Ожидает',   color: '#EF6C00', bg: '#FFF3E0' },
  IN_PROGRESS: { label: 'Убирается', color: '#1E88E5', bg: '#E3F2FD' },
  DONE:        { label: 'Готово',    color: '#2E7D32', bg: '#E8F5E9' },
  INSPECTED:   { label: 'Проверено', color: '#6A1B9A', bg: '#F3E5F5' },
};

const TASK_TYPE_LABEL = {
  CLEANING:    'Уборка',
  TURNDOWN:    'Вечерняя подготовка',
  INSPECTION:  'Проверка',
  MAINTENANCE: 'Ремонт',
  DEEP_CLEAN:  'Генеральная уборка',
};

/* 5.8 · Значок вместо эмодзи: в интерфейсе только монохромные значки. */
function PersonIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true" style={{ verticalAlign: '-2px', marginRight: 4 }}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
    </svg>
  );
}

/* 5.8 · Новая задача: тип, исполнитель и что сделать — задача без текста горничной
   ни о чём не говорит. */
function NewTaskModal({ room, users, busy, onSubmit, onClose }) {
  const [type, setType] = useState('CLEANING');
  const [assigneeId, setAssigneeId] = useState('');
  const [notes, setNotes] = useState('');
  return (
    <Modal
      open
      title={`Новая задача · №${room.number}`}
      width="sm"
      onClose={onClose}
      footer={
        <>
          <button type="button" className={classes.actionBtn} onClick={onClose}>Отмена</button>
          <button
            type="button"
            className={`${classes.actionBtn} ${classes.primary}`}
            disabled={busy}
            onClick={() => onSubmit({
              roomId: room.id,
              type,
              ...(assigneeId ? { assigneeId } : {}),
              ...(notes.trim() ? { notes: notes.trim() } : {}),
            })}
          >
            Создать
          </button>
        </>
      }
    >
      <div className={formClasses.field}>
        <label className={formClasses.label}>Тип</label>
        <Select className={formClasses.select} value={type} onChange={(e) => setType(e.target.value)}>
          {Object.entries(TASK_TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </Select>
      </div>
      <div className={formClasses.field}>
        <label className={formClasses.label}>Исполнитель</label>
        <Select className={formClasses.select} value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
          <option value="">Назначить позже</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>{u.fullName}</option>
          ))}
        </Select>
      </div>
      <div className={formClasses.field}>
        <label className={formClasses.label}>Что сделать</label>
        <textarea
          className={formClasses.textarea}
          rows={3}
          value={notes}
          placeholder="Смена белья, влажная уборка"
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
    </Modal>
  );
}

function AssignSelect({ task, users, onAssign }) {
  const [open, setOpen] = useState(false);

  const handleSelect = (userId) => {
    onAssign({ taskId: task.id, assigneeId: userId });
    setOpen(false);
  };

  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      <button
        type="button"
        className={classes.actionBtn}
        onClick={() => setOpen((v) => !v)}
        title="Назначить горничную"
      >
        {task.assignee_name ? <><PersonIcon />{task.assignee_name}</> : '+ Назначить'}
      </button>
      {open && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          zIndex: 100,
          background: '#fff',
          border: '1px solid #E0E7F0',
          borderRadius: 8,
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          minWidth: 180,
          padding: '4px 0',
        }}>
          {users.length === 0 && (
            <div style={{ padding: '8px 14px', fontSize: 13, color: '#8896AB' }}>
              Нет сотрудников
            </div>
          )}
          {users.map((u) => (
            <div
              key={u.id}
              style={{
                padding: '8px 14px',
                fontSize: 13,
                cursor: 'pointer',
                background: u.id === task.assignee_id ? '#F0F4FF' : 'transparent',
                fontWeight: u.id === task.assignee_id ? 600 : 400,
              }}
              onClick={() => handleSelect(u.id)}
            >
              {u.fullName}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TasksTab() {
  const [statusFilter, setStatusFilter] = useState('active'); // 'active' | 'PENDING' | 'IN_PROGRESS' | 'DONE'
  const { data: allTasks = [], isLoading } = useHousekeepingTasks();
  const { data: users = [] } = useTenantUsers();
  const assignTask = useAssignTask();
  const completeTask = useCompleteTask();
  const { user } = useAuth();
  const [mine, setMine] = useState(false);

  const tasks = useMemo(() => {
    const own = mine ? allTasks.filter((t) => t.assignee_id === user?.id) : allTasks;
    if (statusFilter === 'active') return own.filter((t) => t.status !== 'DONE' && t.status !== 'INSPECTED');
    return own.filter((t) => t.status === statusFilter);
  }, [allTasks, statusFilter, mine, user?.id]);

  const counts = useMemo(() => ({
    active: allTasks.filter((t) => t.status !== 'DONE' && t.status !== 'INSPECTED').length,
    PENDING: allTasks.filter((t) => t.status === 'PENDING').length,
    IN_PROGRESS: allTasks.filter((t) => t.status === 'IN_PROGRESS').length,
    DONE: allTasks.filter((t) => t.status === 'DONE' || t.status === 'INSPECTED').length,
  }), [allTasks]);

  if (isLoading) {
    return <div className={classes.empty}>Загружаем задачи…</div>;
  }

  return (
    <>
      <div className={classes.statsRow}>
        {[
          { key: 'active', label: 'Активные', color: '#1E88E5' },
          { key: 'PENDING', label: 'Ожидают', color: '#EF6C00' },
          { key: 'IN_PROGRESS', label: 'В работе', color: '#1E88E5' },
          { key: 'DONE', label: 'Готово', color: '#2E7D32' },
        ].map(({ key, label, color }) => (
          <div
            key={key}
            className={`${classes.statChip} ${statusFilter === key ? classes.active : ''}`}
            style={statusFilter === key ? { color } : {}}
            onClick={() => setStatusFilter(key)}
          >
            <div className={classes.statCount}>{counts[key]}</div>
            <div className={classes.statLabel}>{label}</div>
          </div>
        ))}
      </div>

      <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 13, marginBottom: 10 }}>
        <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
        Мои задачи
      </label>

      {tasks.length === 0 ? (
        <div className={classes.empty}>
          {statusFilter === 'active' ? 'Нет активных задач.' : 'Задач нет.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {tasks.map((task) => {
            const cfg = TASK_STATUS_CONFIG[task.status] || TASK_STATUS_CONFIG.PENDING;
            const isWorking = assignTask.isPending || completeTask.isPending;
            return (
              <div
                key={task.id}
                style={{
                  background: '#fff',
                  borderRadius: 10,
                  padding: '14px 16px',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                  borderLeft: `4px solid ${cfg.color}`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                }}
              >
                {/* Room + type */}
                <div style={{ minWidth: 80 }}>
                  <div style={{ fontSize: 20, fontWeight: 800, color: '#1B2A47' }}>
                    №{task.room_number}
                  </div>
                  <div style={{ fontSize: 11, color: '#8896AB', fontWeight: 500 }}>
                    {task.room_type_name}
                  </div>
                </div>

                {/* Task type + status */}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#1B2A47' }}>
                    {TASK_TYPE_LABEL[task.type] || task.type}
                  </div>
                  {task.notes && (
                    <div style={{ fontSize: 13, color: '#1B2A47', marginTop: 2, whiteSpace: 'pre-wrap' }}>
                      {task.notes}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: '#8896AB', marginTop: 2 }}>
                    {new Date(task.created_at).toLocaleString('ru-RU', {
                      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                    })}
                  </div>
                </div>

                {/* Status badge */}
                <div style={{
                  padding: '3px 10px',
                  borderRadius: 5,
                  fontSize: 11,
                  fontWeight: 700,
                  background: cfg.bg,
                  color: cfg.color,
                  whiteSpace: 'nowrap',
                }}>
                  {cfg.label}
                </div>

                {/* Assign */}
                <AssignSelect
                  task={task}
                  users={users}
                  onAssign={(args) => assignTask.mutate(args)}
                />

                {/* Complete */}
                {(task.status === 'IN_PROGRESS' || task.status === 'PENDING') && (
                  <button
                    type="button"
                    className={`${classes.actionBtn} ${classes.primary}`}
                    onClick={() => completeTask.mutate(task.id)}
                    disabled={isWorking}
                  >
                    ✓ Готово
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function RoomsTab() {
  const roomsQ = useRooms();
  const roomTypesQ = useRoomTypes();
  const updateStatus = useUpdateRoomStatus();
  const createTask = useCreateTask();
  const { data: users = [] } = useTenantUsers();

  const rooms = roomsQ.data ?? [];
  const roomTypes = roomTypesQ.data ?? [];
  const catNameById = useMemo(
    () => new Map(roomTypes.map((rt) => [rt.id, rt.name])),
    [roomTypes],
  );

  const [filter, setFilter] = useState('all');
  const [creatingFor, setCreatingFor] = useState(null);

  const counts = useMemo(() => {
    const c = { all: rooms.length };
    for (const s of STATUSES) c[s] = rooms.filter((r) => r.status === s).length;
    return c;
  }, [rooms]);

  const filtered = filter === 'all' ? rooms : rooms.filter((r) => r.status === filter);

  const handleCreateTask = (dto) => {
    createTask.mutate(dto, { onSettled: () => setCreatingFor(null) });
  };

  if (roomsQ.isLoading) {
    return <div className={classes.empty}>Загружаем номера…</div>;
  }

  if (rooms.length === 0) {
    return (
      <div className={classes.empty}>
        Сначала добавьте номерной фонд в разделе «Номера».
      </div>
    );
  }

  return (
    <>
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
                <button
                  type="button"
                  className={classes.actionBtn}
                  onClick={() => setCreatingFor(room)}
                >
                  + Задача
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {creatingFor && (
        <NewTaskModal
          room={creatingFor}
          users={users}
          busy={createTask.isPending}
          onSubmit={handleCreateTask}
          onClose={() => setCreatingFor(null)}
        />
      )}
    </>
  );
}

function Housekeeping() {
  const [tab, setTab] = useState('rooms'); // 'rooms' | 'tasks'
  const { data: allTasks = [] } = useHousekeepingTasks();
  const activeTaskCount = allTasks.filter((t) => t.status !== 'DONE' && t.status !== 'INSPECTED').length;

  return (
    <div className={classes.root}>
      <div className={classes.pageHeader}>
        <div className={classes.pageTitle}>Уборка</div>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex',
        gap: 0,
        marginBottom: 20,
        borderBottom: '2px solid #E0E7F0',
      }}>
        {[
          { key: 'rooms', label: 'Номера' },
          { key: 'tasks', label: `Задачи${activeTaskCount > 0 ? ` (${activeTaskCount})` : ''}` },
        ].map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            style={{
              padding: '8px 20px',
              fontSize: 14,
              fontWeight: 600,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              borderBottom: tab === key ? '2px solid #1E88E5' : '2px solid transparent',
              color: tab === key ? '#1E88E5' : '#6B7280',
              marginBottom: -2,
              transition: 'color 0.15s',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'rooms' ? <RoomsTab /> : <TasksTab />}
    </div>
  );
}

export default Housekeeping;
