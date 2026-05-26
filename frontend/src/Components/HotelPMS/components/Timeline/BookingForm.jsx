import React, { useState, useMemo } from 'react';
import { differenceInDays, parseISO } from 'date-fns';
import classes from './Timeline.module.css';
import { BOOKING_STATUS, BOOKING_SOURCE } from '../../constants';
import { cancelReservation } from '../../../../api/reservations';

/**
 * Check if ALL places in a room are occupied during [checkIn, checkOut).
 * For multi-place rooms: returns a conflict only if no free place exists.
 * For single-place rooms: original behaviour.
 */
function getConflict(bookings, roomId, checkIn, checkOut, excludeId, roomCapacity = 1) {
  if (!roomId || !checkIn || !checkOut || checkOut <= checkIn) return null;
  const overlapping = bookings.filter(b => {
    if (b.roomId !== roomId) return false;
    if (b.id === excludeId) return false;
    if (b.status === 'cancelled' || b.status === 'no_show') return false;
    return b.checkIn < checkOut && b.checkOut > checkIn;
  });
  // If the number of occupied places is less than capacity, there's a free place
  const occupiedPlaces = new Set(overlapping.map(b => b.placeNumber ?? 1));
  if (occupiedPlaces.size < roomCapacity) return null;
  return overlapping[0] ?? null;
}

function BookingForm({ booking, rooms, categories, bookings = [], onSave, onDelete, onClose, savingError }) {
  const isNew = !booking.id;

  const [form, setForm] = useState({
    guestName: booking.guestName || '',
    phone:     booking.phone || '',
    email:     booking.email || '',
    roomId:    booking.roomId || '',
    checkIn:   booking.checkIn || '',
    checkOut:  booking.checkOut || '',
    adults:    booking.adults || 1,
    children:  booking.children || 0,
    status:    booking.status || 'confirmed',
    source:    booking.source || 'direct',
    notes:     booking.notes || '',
  });

  const [saving, setSaving] = useState(false);

  const nights = form.checkIn && form.checkOut
    ? Math.max(0, differenceInDays(parseISO(form.checkOut), parseISO(form.checkIn)))
    : 0;

  const room = rooms.find(r => r.id === form.roomId);
  const category = categories.find(c => c.id === room?.categoryId);
  const pricePerNight = category?.basePrice || 0;
  const totalPrice = nights * pricePerNight;

  // Availability check for the selected room
  const conflict = useMemo(() => {
    const cap = rooms.find(r => r.id === form.roomId)?.capacity ?? 1;
    return getConflict(bookings, form.roomId, form.checkIn, form.checkOut, booking.id, cap);
  }, [bookings, form.roomId, form.checkIn, form.checkOut, booking.id, rooms]);

  // Per-room availability for the dropdown
  const roomAvailability = useMemo(() => {
    if (!form.checkIn || !form.checkOut || form.checkOut <= form.checkIn) return {};
    const result = {};
    for (const r of rooms) {
      result[r.id] = !getConflict(bookings, r.id, form.checkIn, form.checkOut, booking.id, r.capacity ?? 1);
    }
    return result;
  }, [bookings, rooms, form.checkIn, form.checkOut, booking.id]);

  const set = (field) => (e) => setForm(prev => ({ ...prev, [field]: e.target.value }));

  const canSave = form.guestName.trim() && form.roomId && form.checkIn && form.checkOut && !conflict;

  const handleSave = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      await onSave({
        ...booking,
        ...form,
        adults: Number(form.adults),
        children: Number(form.children),
        totalPrice,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async () => {
    if (!window.confirm('Отменить бронь?')) return;
    const reason = window.prompt('Причина отмены (необязательно):') ?? undefined;
    try {
      await cancelReservation(booking.id, reason);
      onClose?.();
      if (typeof onDelete === 'function') onDelete(booking.id);
    } catch (err) {
      console.error('Cancel failed:', err);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') onClose();
  };

  return (
    <div className={classes.modalOverlay} onClick={onClose} onKeyDown={handleKeyDown}>
      <div className={classes.modal} onClick={e => e.stopPropagation()}>
        <div className={classes.modalHeader}>
          <div className={classes.modalTitle}>
            {isNew ? 'Новое бронирование' : 'Редактировать бронь'}
          </div>
          <button className={classes.modalClose} onClick={onClose}>×</button>
        </div>

        <div className={classes.modalBody}>
          <div className={classes.formGrid}>
            <div className={`${classes.formGroup} ${classes.formFull}`}>
              <div className={classes.formLabel}>ФИО гостя *</div>
              <input className={classes.formInput} value={form.guestName} onChange={set('guestName')} placeholder="Фамилия Имя Отчество" />
            </div>

            <div className={classes.formGroup}>
              <div className={classes.formLabel}>Телефон</div>
              <input className={classes.formInput} value={form.phone} onChange={set('phone')} placeholder="+7 (___) ___-__-__" />
            </div>

            <div className={classes.formGroup}>
              <div className={classes.formLabel}>Email</div>
              <input className={classes.formInput} value={form.email} onChange={set('email')} placeholder="email@domain.ru" type="email" />
            </div>

            <div className={classes.formGroup}>
              <div className={classes.formLabel}>Дата заезда *</div>
              <input className={classes.formInput} value={form.checkIn} onChange={set('checkIn')} type="date" />
            </div>

            <div className={classes.formGroup}>
              <div className={classes.formLabel}>Дата выезда *</div>
              <input className={classes.formInput} value={form.checkOut} onChange={set('checkOut')} type="date" />
            </div>

            <div className={`${classes.formGroup} ${classes.formFull}`}>
              <div className={classes.formLabel}>Номер *</div>
              <select
                className={classes.formSelect}
                value={form.roomId}
                onChange={set('roomId')}
                style={conflict ? { borderColor: '#EF4444' } : undefined}
              >
                <option value="">— выберите —</option>
                {categories.map(cat => (
                  <optgroup key={cat.id} label={cat.name}>
                    {rooms.filter(r => r.categoryId === cat.id).map(r => {
                      const hasDates = form.checkIn && form.checkOut && form.checkOut > form.checkIn;
                      const isFree = roomAvailability[r.id];
                      const isOccupied = hasDates && isFree === false;
                      return (
                        <option key={r.id} value={r.id} disabled={isOccupied}>
                          {hasDates
                            ? `${isFree ? '✓' : '✗'} №${r.number} · ${cat.name}`
                            : `№${r.number} · ${cat.name}`}
                        </option>
                      );
                    })}
                  </optgroup>
                ))}
              </select>
              {conflict && form.roomId && (
                <div style={{ fontSize: 12, color: '#EF4444', marginTop: 4 }}>
                  Номер занят: {conflict.guestName} ({conflict.checkIn} — {conflict.checkOut})
                </div>
              )}
              {!conflict && form.roomId && form.checkIn && form.checkOut && form.checkOut > form.checkIn && (
                <div style={{ fontSize: 12, color: '#22C55E', marginTop: 4 }}>
                  Номер свободен в выбранные даты
                </div>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, gridColumn: '1 / -1' }}>
              <div className={classes.formGroup}>
                <div className={classes.formLabel}>Источник</div>
                <select className={classes.formSelect} value={form.source} onChange={set('source')}>
                  {Object.entries(BOOKING_SOURCE).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div className={classes.formGroup}>
                <div className={classes.formLabel}>Взрослых</div>
                <input className={classes.formInput} value={form.adults} onChange={set('adults')} type="number" min="1" max="10" />
              </div>
              <div className={classes.formGroup}>
                <div className={classes.formLabel}>Детей</div>
                <input className={classes.formInput} value={form.children} onChange={set('children')} type="number" min="0" max="5" />
              </div>
            </div>

            <div className={`${classes.formGroup} ${classes.formFull}`}>
              <div className={classes.formLabel}>Статус</div>
              <div className={classes.statusGrid}>
                {Object.entries(BOOKING_STATUS).map(([key, cfg]) => (
                  <div
                    key={key}
                    className={`${classes.statusOption} ${form.status === key ? classes.selected : ''}`}
                    style={form.status === key ? { background: cfg.color, borderColor: cfg.color, color: '#fff' } : {}}
                    onClick={() => setForm(prev => ({ ...prev, status: key }))}
                    title={cfg.hint}
                  >
                    {cfg.label}
                  </div>
                ))}
              </div>
              {form.status && BOOKING_STATUS[form.status]?.hint && (
                <div style={{ fontSize: 11, color: '#8896AB', marginTop: 5, lineHeight: 1.4 }}>
                  ℹ️ {BOOKING_STATUS[form.status].hint}
                </div>
              )}
            </div>

            <div className={`${classes.formGroup} ${classes.formFull}`}>
              <div className={classes.formLabel}>Примечания</div>
              <textarea className={classes.formTextarea} value={form.notes} onChange={set('notes')} placeholder="Особые пожелания, комментарии..." />
            </div>

            {nights > 0 && (
              <div className={`${classes.priceRow} ${classes.formFull}`}>
                <div>
                  <div className={classes.priceLabel}>{nights} ноч. × {pricePerNight.toLocaleString('ru-RU')} ₽</div>
                </div>
                <div className={classes.priceValue}>{totalPrice.toLocaleString('ru-RU')} ₽</div>
              </div>
            )}
          </div>
        </div>

        {savingError && (
          <div style={{ padding: '10px 24px', background: '#FEF2F2', color: '#DC2626', fontSize: 13, borderTop: '1px solid #FECACA' }}>
            {savingError}
          </div>
        )}

        <div className={classes.modalFooter}>
          {!isNew && ['new', 'confirmed'].includes(booking?.status) && (
            <button className={classes.btnDanger} onClick={handleCancel}>
              Отменить бронь
            </button>
          )}
          <button className={classes.btnSecondary} onClick={onClose}>Закрыть</button>
          <button
            className={classes.btnPrimary}
            onClick={handleSave}
            disabled={!canSave || saving}
            title={conflict ? 'Номер занят в выбранные даты' : undefined}
          >
            {saving ? 'Сохранение...' : isNew ? 'Создать бронь' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default BookingForm;
