import React, { useState, useMemo, useEffect } from 'react';
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  addMonths, subMonths, parseISO,
} from 'date-fns';
import { ru } from 'date-fns/locale';
import classes from './Revenue.module.css';
import { useRoomTypes } from '../../../../hooks/api/useRoomTypes';
import { useInventory, useBulkUpdateInventory } from '../../../../hooks/api/useInventory';
import { useRestrictions, useUpsertRestriction, useDeleteRestriction } from '../../../../hooks/api/useRestrictions';

const DOW_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const TODAY_STR = format(new Date(), 'yyyy-MM-dd');

// ─── Toggle component ─────────────────────────────────────────────────────────
function Toggle({ checked, onChange }) {
  return (
    <label className={classes.toggle}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span className={classes.toggleSlider} />
    </label>
  );
}

// ─── Inventory edit modal ─────────────────────────────────────────────────────
function InventoryModal({ date, roomType, row, onSave, onClose, saving, error }) {
  const [blocked, setBlocked] = useState(String(row?.blockedRooms ?? 0));
  const [stopSell, setStopSell] = useState(row?.stopSell ?? false);

  return (
    <div className={classes.overlay} onClick={onClose}>
      <div className={classes.modal} onClick={e => e.stopPropagation()}>
        <div className={classes.modalHeader}>
          <div className={classes.modalTitle}>
            Инвентарь · {format(parseISO(date), 'd MMMM yyyy', { locale: ru })}
          </div>
          <button className={classes.closeBtn} onClick={onClose}>✕</button>
        </div>
        <div className={classes.modalBody}>
          <div style={{ fontSize: 13, color: '#6B7280' }}>
            Категория: <strong style={{ color: '#0F1F3F' }}>{roomType?.name}</strong>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, background: '#F8FAFC', borderRadius: 8, padding: 14 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#16A34A' }}>{row?.available ?? 0}</div>
              <div style={{ fontSize: 11, color: '#6B7280' }}>Доступно</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#374151' }}>{row?.totalRooms ?? 0}</div>
              <div style={{ fontSize: 11, color: '#6B7280' }}>Всего</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#1E88E5' }}>{row?.bookedRooms ?? 0}</div>
              <div style={{ fontSize: 11, color: '#6B7280' }}>Забронировано</div>
            </div>
          </div>

          <div className={classes.formGroup}>
            <label>Заблокировано вручную (ремонт, OOO)</label>
            <input
              className={classes.input}
              type="number"
              min="0"
              value={blocked}
              onChange={e => setBlocked(e.target.value)}
            />
          </div>

          <div className={classes.checkRow} style={{ borderBottom: 'none' }}>
            <div className={classes.checkLabel}>
              <div className={classes.checkName}>Стоп-продажа</div>
              <div className={classes.checkHint}>Запрет всех новых бронирований на эту дату</div>
            </div>
            <Toggle checked={stopSell} onChange={setStopSell} />
          </div>
        </div>
        {error && <div style={{ padding: '0 22px 10px', color: '#EF4444', fontSize: 13 }}>{error}</div>}
        <div className={classes.modalFooter}>
          <div style={{ flex: 1 }} />
          <button className={classes.btnCancel} onClick={onClose}>Отмена</button>
          <button
            className={classes.btnSave}
            disabled={saving}
            onClick={() => onSave({ date, blockedRooms: Number(blocked) || 0, stopSell })}
          >
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Restrictions edit modal ──────────────────────────────────────────────────
function RestrictionsModal({ date, roomType, restriction, onSave, onDelete, onClose, saving, error }) {
  const r = restriction;
  const [form, setForm] = useState({
    closed:        r?.closed        ?? false,
    cta:           r?.cta           ?? false,
    ctd:           r?.ctd           ?? false,
    stopSell:      r?.stopSell      ?? false,
    minLos:        String(r?.minLos        ?? ''),
    maxLos:        String(r?.maxLos        ?? ''),
    minLosArrival: String(r?.minLosArrival ?? ''),
    maxLosArrival: String(r?.maxLosArrival ?? ''),
    minAdvance:    String(r?.minAdvance    ?? ''),
    maxAdvance:    String(r?.maxAdvance    ?? ''),
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const toInt = (v) => { const n = parseInt(v, 10); return isNaN(n) ? null : n; };

  const buildPayload = () => ({
    roomTypeId: roomType.id,
    date,
    closed:        form.closed,
    cta:           form.cta,
    ctd:           form.ctd,
    stopSell:      form.stopSell,
    minLos:        toInt(form.minLos),
    maxLos:        toInt(form.maxLos),
    minLosArrival: toInt(form.minLosArrival),
    maxLosArrival: toInt(form.maxLosArrival),
    minAdvance:    toInt(form.minAdvance),
    maxAdvance:    toInt(form.maxAdvance),
  });

  const checkRows = [
    { key: 'closed',   name: 'Закрыто',         hint: 'Дата полностью закрыта для бронирования' },
    { key: 'cta',      name: 'CTA (нет заезда)', hint: 'Нельзя заехать в эту дату (можно выехать)' },
    { key: 'ctd',      name: 'CTD (нет выезда)', hint: 'Нельзя выехать в эту дату (можно заехать)' },
    { key: 'stopSell', name: 'Стоп-продажа',    hint: 'Остановить продажи (игнорирует лимит номеров)' },
  ];

  const numFields = [
    { key: 'minLos',        label: 'Мин. ночей (LOS)' },
    { key: 'maxLos',        label: 'Макс. ночей (LOS)' },
    { key: 'minLosArrival', label: 'Мин. ночей при заезде' },
    { key: 'maxLosArrival', label: 'Макс. ночей при заезде' },
    { key: 'minAdvance',    label: 'Мин. аванс (дней)' },
    { key: 'maxAdvance',    label: 'Макс. аванс (дней)' },
  ];

  return (
    <div className={classes.overlay} onClick={onClose}>
      <div className={classes.modal} style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
        <div className={classes.modalHeader}>
          <div className={classes.modalTitle}>
            Ограничения · {format(parseISO(date), 'd MMMM yyyy', { locale: ru })}
          </div>
          <button className={classes.closeBtn} onClick={onClose}>✕</button>
        </div>
        <div className={classes.modalBody}>
          <div style={{ fontSize: 13, color: '#6B7280' }}>
            Категория: <strong style={{ color: '#0F1F3F' }}>{roomType?.name}</strong>
          </div>

          {/* Bool flags */}
          <div>
            {checkRows.map(row => (
              <div key={row.key} className={classes.checkRow}>
                <div className={classes.checkLabel}>
                  <div className={classes.checkName}>{row.name}</div>
                  <div className={classes.checkHint}>{row.hint}</div>
                </div>
                <Toggle checked={form[row.key]} onChange={v => set(row.key, v)} />
              </div>
            ))}
          </div>

          {/* Number fields */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {numFields.map(f => (
              <div key={f.key} className={classes.formGroup}>
                <label>{f.label}</label>
                <input
                  className={classes.input}
                  type="number"
                  min="0"
                  placeholder="—"
                  value={form[f.key]}
                  onChange={e => set(f.key, e.target.value)}
                />
              </div>
            ))}
          </div>
        </div>
        {error && <div style={{ padding: '0 22px 10px', color: '#EF4444', fontSize: 13 }}>{error}</div>}
        <div className={classes.modalFooter}>
          {r?.id && (
            <button className={classes.btnDelete} onClick={() => onDelete(r.id)}>Удалить</button>
          )}
          <div style={{ flex: 1 }} />
          <button className={classes.btnCancel} onClick={onClose}>Отмена</button>
          <button className={classes.btnSave} disabled={saving} onClick={() => onSave(buildPayload())}>
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Calendar header row ──────────────────────────────────────────────────────
function CalDayHeaders({ dayStrs }) {
  return dayStrs.map(d => {
    const dow = parseISO(d).getDay();
    const isWe = dow === 0 || dow === 6;
    const isToday = d === TODAY_STR;
    return (
      <div
        key={d}
        className={[classes.calDayHead, isWe && classes.weekend, isToday && classes.today].filter(Boolean).join(' ')}
      >
        <div className={classes.calDayNum}>{format(parseISO(d), 'd')}</div>
        <div className={classes.calDow}>{DOW_SHORT[dow]}</div>
      </div>
    );
  });
}

// ─── Inventory calendar ───────────────────────────────────────────────────────
function InventoryCalendar({ roomType, viewMonth }) {
  const fromStr = format(startOfMonth(viewMonth), 'yyyy-MM-dd');
  const toStr   = format(endOfMonth(viewMonth),   'yyyy-MM-dd');
  const dayStrs = useMemo(
    () => eachDayOfInterval({ start: startOfMonth(viewMonth), end: endOfMonth(viewMonth) }).map(d => format(d, 'yyyy-MM-dd')),
    [viewMonth],
  );

  const { data: rows = [], isFetching } = useInventory({ roomTypeId: roomType.id, from: fromStr, to: toStr });
  const bulkUpdate = useBulkUpdateInventory();

  const rowMap = useMemo(() => {
    const map = {};
    rows.forEach(r => { map[r.date] = r; });
    return map;
  }, [rows]);

  const [editCell, setEditCell] = useState(null);
  const [saveError, setSaveError] = useState(null);

  const handleSave = async ({ date, blockedRooms, stopSell }) => {
    setSaveError(null);
    try {
      await bulkUpdate.mutateAsync({ roomTypeId: roomType.id, rows: [{ date, blockedRooms, stopSell }] });
      setEditCell(null);
    } catch (err) {
      const msg = err?.response?.data?.message;
      setSaveError(Array.isArray(msg) ? msg.join(', ') : (msg ?? err.message ?? 'Ошибка'));
    }
  };

  return (
    <>
      {saveError && <div className={classes.errorBanner}>{saveError}</div>}
      <div className={classes.calScroll}>
        <div className={classes.calGrid} style={{ gridTemplateColumns: `160px repeat(${dayStrs.length}, 62px)` }}>
          <div className={classes.calCorner}>Категория {isFetching ? '…' : ''}</div>
          <CalDayHeaders dayStrs={dayStrs} />

          <div className={classes.rowLabel}>
            <div className={classes.rowName}>{roomType.name}</div>
            <div className={classes.rowMeta}>до {roomType.maxOccupancy ?? '?'} чел.</div>
          </div>

          {dayStrs.map(d => {
            const row = rowMap[d];
            const avail = row?.available ?? 0;
            const total = row?.totalRooms ?? 0;
            const blocked = row?.blockedRooms ?? 0;
            const booked = row?.bookedRooms ?? 0;
            const stopSell = row?.stopSell ?? false;
            const dow = parseISO(d).getDay();
            const isWe = dow === 0 || dow === 6;
            const isToday = d === TODAY_STR;

            const availClass = stopSell || avail === 0 ? classes.avNone
              : avail <= Math.max(1, Math.floor(total * 0.2)) ? classes.avLow
              : classes.avGood;

            return (
              <div
                key={d}
                className={[
                  classes.invCell,
                  stopSell && classes.cellStopSell,
                  isWe && !stopSell && classes.cellWeekend,
                  isToday && classes.cellToday,
                ].filter(Boolean).join(' ')}
                onClick={() => setEditCell(d)}
              >
                <span className={`${classes.invAvail} ${availClass}`}>{avail}</span>
                {total > 0 && (
                  <span className={classes.invMeta}>Т:{total} З:{booked}{blocked > 0 ? ` Б:${blocked}` : ''}</span>
                )}
                {stopSell && <span className={classes.invStopSell}>стоп</span>}
              </div>
            );
          })}
        </div>
      </div>

      {editCell && (
        <InventoryModal
          date={editCell}
          roomType={roomType}
          row={rowMap[editCell]}
          onSave={handleSave}
          onClose={() => { setEditCell(null); setSaveError(null); }}
          saving={bulkUpdate.isPending}
          error={saveError}
        />
      )}
    </>
  );
}

// ─── Restrictions calendar ────────────────────────────────────────────────────
function RestrictionsCalendar({ roomType, viewMonth }) {
  const fromStr = format(startOfMonth(viewMonth), 'yyyy-MM-dd');
  const toStr   = format(endOfMonth(viewMonth),   'yyyy-MM-dd');
  const dayStrs = useMemo(
    () => eachDayOfInterval({ start: startOfMonth(viewMonth), end: endOfMonth(viewMonth) }).map(d => format(d, 'yyyy-MM-dd')),
    [viewMonth],
  );

  const { data: restrictions = [], isFetching } = useRestrictions({ roomTypeId: roomType.id, from: fromStr, to: toStr });
  const upsert = useUpsertRestriction();
  const remove = useDeleteRestriction();

  // Normalize date from ISO string to YYYY-MM-DD
  const restMap = useMemo(() => {
    const map = {};
    restrictions.forEach(r => {
      const d = typeof r.date === 'string' ? r.date.slice(0, 10) : format(new Date(r.date), 'yyyy-MM-dd');
      map[d] = r;
    });
    return map;
  }, [restrictions]);

  const [editCell, setEditCell] = useState(null);
  const [saveError, setSaveError] = useState(null);

  const handleSave = async (payload) => {
    setSaveError(null);
    try {
      await upsert.mutateAsync(payload);
      setEditCell(null);
    } catch (err) {
      const msg = err?.response?.data?.message;
      setSaveError(Array.isArray(msg) ? msg.join(', ') : (msg ?? err.message ?? 'Ошибка'));
    }
  };

  const handleDelete = async (id) => {
    setSaveError(null);
    try {
      await remove.mutateAsync(id);
      setEditCell(null);
    } catch (err) {
      const msg = err?.response?.data?.message;
      setSaveError(Array.isArray(msg) ? msg.join(', ') : (msg ?? err.message ?? 'Ошибка'));
    }
  };

  return (
    <>
      {saveError && <div className={classes.errorBanner}>{saveError}</div>}
      <div className={classes.calScroll}>
        <div className={classes.calGrid} style={{ gridTemplateColumns: `160px repeat(${dayStrs.length}, 62px)` }}>
          <div className={classes.calCorner}>Категория {isFetching ? '…' : ''}</div>
          <CalDayHeaders dayStrs={dayStrs} />

          <div className={classes.rowLabel}>
            <div className={classes.rowName}>{roomType.name}</div>
            <div className={classes.rowMeta}>до {roomType.maxOccupancy ?? '?'} чел.</div>
          </div>

          {dayStrs.map(d => {
            const r = restMap[d];
            const hasAny = r && (r.closed || r.cta || r.ctd || r.stopSell || r.minLos || r.minAdvance);
            const dow = parseISO(d).getDay();
            const isWe = dow === 0 || dow === 6;
            const isToday = d === TODAY_STR;

            return (
              <div
                key={d}
                className={[
                  classes.restCell,
                  isWe && classes.cellWeekend,
                  isToday && classes.cellToday,
                ].filter(Boolean).join(' ')}
                onClick={() => setEditCell(d)}
              >
                {hasAny ? (
                  <div className={classes.flagsRow}>
                    {r.closed   && <span className={`${classes.flag} ${classes.flagClosed}`}>Закр.</span>}
                    {r.cta      && <span className={`${classes.flag} ${classes.flagCTA}`}>CTA</span>}
                    {r.ctd      && <span className={`${classes.flag} ${classes.flagCTD}`}>CTD</span>}
                    {r.stopSell && <span className={`${classes.flag} ${classes.flagStop}`}>Стоп</span>}
                    {r.minLos   && <span className={`${classes.flag} ${classes.flagLos}`}>мин {r.minLos}н</span>}
                    {r.minAdvance && <span className={`${classes.flag} ${classes.flagLos}`}>авн {r.minAdvance}д</span>}
                  </div>
                ) : (
                  <span className={classes.flagNone}>—</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {editCell && (
        <RestrictionsModal
          date={editCell}
          roomType={roomType}
          restriction={restMap[editCell]}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => { setEditCell(null); setSaveError(null); }}
          saving={upsert.isPending || remove.isPending}
          error={saveError}
        />
      )}
    </>
  );
}

// ─── Main Revenue component ───────────────────────────────────────────────────
function Revenue() {
  const { data: roomTypes = [], isLoading } = useRoomTypes();
  const [selectedRtId, setSelectedRtId] = useState(null);
  const [tab, setTab] = useState('inventory');
  const [viewMonth, setViewMonth] = useState(() => { const d = new Date(); d.setDate(1); return d; });

  const selectedRt = roomTypes.find(rt => rt.id === selectedRtId) ?? roomTypes[0] ?? null;

  if (isLoading) {
    return (
      <div className={classes.root}>
        <div className={classes.pageHeader}><div className={classes.pageTitle}>Revenue Management</div></div>
        <div className={classes.empty}>Загрузка...</div>
      </div>
    );
  }

  if (roomTypes.length === 0) {
    return (
      <div className={classes.root}>
        <div className={classes.pageHeader}><div className={classes.pageTitle}>Revenue Management</div></div>
        <div className={classes.empty}>Нет категорий номеров. Создайте их в разделе «Номера».</div>
      </div>
    );
  }

  return (
    <div className={classes.root}>
      <div className={classes.pageHeader}>
        <div className={classes.pageTitle}>Revenue Management</div>
      </div>

      {/* Room type selector */}
      <div className={classes.rtTabs}>
        {roomTypes.map(rt => (
          <button
            key={rt.id}
            className={`${classes.rtTab} ${selectedRt?.id === rt.id ? classes.rtTabActive : ''}`}
            onClick={() => setSelectedRtId(rt.id)}
          >
            {rt.name}
          </button>
        ))}
      </div>

      {/* Sub-tabs */}
      <div className={classes.subTabs}>
        <button
          className={`${classes.subTab} ${tab === 'inventory' ? classes.subTabActive : ''}`}
          onClick={() => setTab('inventory')}
        >
          Инвентарь
        </button>
        <button
          className={`${classes.subTab} ${tab === 'restrictions' ? classes.subTabActive : ''}`}
          onClick={() => setTab('restrictions')}
        >
          Ограничения
        </button>
      </div>

      {selectedRt && (
        <div className={classes.panel}>
          {/* Month nav */}
          <div className={classes.panelHeader}>
            <div>
              <div className={classes.panelTitle}>
                {tab === 'inventory' ? 'Управление инвентарём' : 'Ограничения бронирования'}
              </div>
            </div>
            <div className={classes.panelActions}>
              <div className={classes.calNav} style={{ padding: 0 }}>
                <div className={classes.calNavLeft}>
                  <button className={classes.calNavBtn} onClick={() => setViewMonth(m => subMonths(m, 1))}>‹</button>
                  <span className={classes.calMonthLabel}>{format(viewMonth, 'LLLL yyyy', { locale: ru })}</span>
                  <button className={classes.calNavBtn} onClick={() => setViewMonth(m => addMonths(m, 1))}>›</button>
                  <button className={classes.calTodayBtn} onClick={() => setViewMonth(new Date())}>Сегодня</button>
                </div>
              </div>
            </div>
          </div>

          {/* Legend */}
          {tab === 'inventory' && (
            <div style={{ padding: '8px 16px', background: '#F8FAFC', borderBottom: '1px solid #E5E7EB', fontSize: 11.5, color: '#6B7280', display: 'flex', gap: 16 }}>
              <span>Т — всего номеров</span>
              <span>З — забронировано</span>
              <span>Б — заблокировано</span>
              <span style={{ color: '#D97706' }}>Жёлтый — мало мест</span>
              <span style={{ color: '#EF4444' }}>Красный — нет мест / стоп</span>
            </div>
          )}
          {tab === 'restrictions' && (
            <div style={{ padding: '8px 16px', background: '#F8FAFC', borderBottom: '1px solid #E5E7EB', fontSize: 11.5, color: '#6B7280', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <span style={{ color: '#EF4444', fontWeight: 700 }}>Закр.</span><span>— дата закрыта</span>
              <span style={{ color: '#F59E0B', fontWeight: 700 }}>CTA</span><span>— нет заезда</span>
              <span style={{ color: '#8B5CF6', fontWeight: 700 }}>CTD</span><span>— нет выезда</span>
              <span style={{ color: '#EF4444', fontWeight: 700 }}>Стоп</span><span>— стоп-продажа</span>
              <span>мин Xн — минимум ночей</span>
            </div>
          )}

          {tab === 'inventory' && (
            <InventoryCalendar key={`inv-${selectedRt.id}`} roomType={selectedRt} viewMonth={viewMonth} />
          )}
          {tab === 'restrictions' && (
            <RestrictionsCalendar key={`rest-${selectedRt.id}`} roomType={selectedRt} viewMonth={viewMonth} />
          )}
        </div>
      )}
    </div>
  );
}

export default Revenue;
