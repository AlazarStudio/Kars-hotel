import React, { useState, useMemo } from 'react';
import { differenceInDays, parseISO } from 'date-fns';
import classes from './Timeline.module.css';
import { BOOKING_STATUS, BOOKING_SOURCE } from '../../constants';
import { cancelReservation } from '../../../../api/reservations';
import { useFolio, useAddPayment } from '../../../../hooks/api/useFolio';

function FolioTab({ reservationId }) {
  const { data: folio, isLoading } = useFolio(reservationId);
  const addPaymentMutation = useAddPayment(reservationId);

  if (isLoading) return <div className="p-4 text-sm text-gray-500">Загрузка счёта...</div>;
  if (!folio) return null;

  return (
    <div className="space-y-4 p-1">
      {/* Charges */}
      <div>
        <h3 className="font-medium text-sm mb-2">Начисления</h3>
        {folio.charges?.length === 0 && (
          <p className="text-sm text-gray-400">Начислений нет</p>
        )}
        <table className="w-full text-xs">
          <tbody>
            {folio.charges?.map((c) => (
              <tr key={c.id} className="border-b">
                <td className="py-1">{c.description}</td>
                <td className="py-1 text-right">{c.quantity} × {Number(c.unitPrice).toLocaleString('ru-RU')} ₽</td>
                <td className="py-1 text-right font-medium">{Number(c.total).toLocaleString('ru-RU')} ₽</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Payments */}
      <div>
        <h3 className="font-medium text-sm mb-2">Оплаты</h3>
        {folio.payments?.length === 0 && (
          <p className="text-sm text-gray-400">Оплат нет</p>
        )}
        {folio.payments?.map((p) => (
          <div key={p.id} className="flex justify-between text-xs py-1 border-b">
            <span>{p.method === 'CASH' ? 'Наличные' : p.method} ({p.type})</span>
            <span className="font-medium">{Number(p.amount).toLocaleString('ru-RU')} ₽</span>
          </div>
        ))}
      </div>

      {/* Balance */}
      <div className="border-t pt-2 space-y-1 text-sm">
        <div className="flex justify-between text-gray-600">
          <span>Начислено:</span>
          <span>{Number(folio.totalCharged ?? 0).toLocaleString('ru-RU')} ₽</span>
        </div>
        <div className="flex justify-between text-gray-600">
          <span>Оплачено:</span>
          <span>{Number(folio.totalPaid ?? 0).toLocaleString('ru-RU')} ₽</span>
        </div>
        <div className={`flex justify-between font-bold ${Number(folio.balance) > 0 ? 'text-red-600' : 'text-green-600'}`}>
          <span>Остаток:</span>
          <span>{Number(folio.balance ?? 0).toLocaleString('ru-RU')} ₽</span>
        </div>
      </div>

      {/* Quick pay button */}
      {Number(folio.balance) > 0 && (
        <button
          onClick={() => addPaymentMutation.mutate({ method: 'CASH', amount: Number(folio.balance) })}
          disabled={addPaymentMutation.isPending}
          className="w-full py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700 disabled:opacity-50"
        >
          {addPaymentMutation.isPending
            ? 'Обработка...'
            : `Принять ${Number(folio.balance).toLocaleString('ru-RU')} ₽ (наличные)`}
        </button>
      )}
    </div>
  );
}

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
  const [activeTab, setActiveTab] = useState('booking'); // 'booking' | 'folio'

  // In-app cancellation dialog (replaces native confirm/prompt)
  const [showCancel, setShowCancel] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState(null);

  const nights = form.checkIn && form.checkOut
    ? Math.max(0, differenceInDays(parseISO(form.checkOut), parseISO(form.checkIn)))
    : 0;

  const room = rooms.find(r => r.id === form.roomId);
  const category = categories.find(c => c.id === room?.categoryId);
  const pricePerNight = category?.basePrice || 0;
  const computedTotal = nights * pricePerNight;

  // A partner/corporate booking is priced by its rate plan and stores that
  // total on the reservation; the category base price is just the rack rate.
  // Keep the stored total while the price-affecting fields (room + dates) are
  // untouched, and recompute from the base price only when they change — so
  // opening an existing booking shows its real tariff price and saving it does
  // not overwrite that with the rack rate.
  const storedTotal = booking.totalPrice != null ? Number(booking.totalPrice) : null;
  const priceUnchanged =
    !isNew &&
    form.roomId === booking.roomId &&
    form.checkIn === booking.checkIn &&
    form.checkOut === booking.checkOut;
  const totalPrice = priceUnchanged && storedTotal != null ? storedTotal : computedTotal;
  // Nightly figure shown next to the total — derived from the effective total
  // so the line stays consistent even for a stored rate-plan price.
  const displayNightly = nights > 0 ? Math.round(totalPrice / nights) : pricePerNight;

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

  const openCancel = () => {
    setCancelReason('');
    setCancelError(null);
    setShowCancel(true);
  };

  const confirmCancel = async () => {
    if (cancelling) return;
    setCancelling(true);
    setCancelError(null);
    try {
      const reason = cancelReason.trim() || undefined;
      await cancelReservation(booking.id, reason);
      setShowCancel(false);
      onClose?.();
      if (typeof onDelete === 'function') onDelete(booking.id);
    } catch (err) {
      console.error('Cancel failed:', err);
      setCancelError('Не удалось отменить бронь. Попробуйте ещё раз.');
    } finally {
      setCancelling(false);
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
          {!isNew && (
            <div style={{ display: 'flex', borderBottom: '1px solid #E5E7EB', marginBottom: 16 }}>
              <button
                onClick={() => setActiveTab('booking')}
                style={{
                  padding: '8px 16px',
                  fontSize: 14,
                  fontWeight: 500,
                  background: 'none',
                  border: 'none',
                  borderBottom: activeTab === 'booking' ? '2px solid #2563EB' : '2px solid transparent',
                  color: activeTab === 'booking' ? '#2563EB' : '#6B7280',
                  cursor: 'pointer',
                }}
              >
                Бронь
              </button>
              <button
                onClick={() => setActiveTab('folio')}
                style={{
                  padding: '8px 16px',
                  fontSize: 14,
                  fontWeight: 500,
                  background: 'none',
                  border: 'none',
                  borderBottom: activeTab === 'folio' ? '2px solid #2563EB' : '2px solid transparent',
                  color: activeTab === 'folio' ? '#2563EB' : '#6B7280',
                  cursor: 'pointer',
                }}
              >
                Счёт
              </button>
            </div>
          )}

          {activeTab === 'folio' && !isNew ? (
            <FolioTab reservationId={booking.id} />
          ) : (
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
                  <div className={classes.priceLabel}>{nights} ноч. × {displayNightly.toLocaleString('ru-RU')} ₽</div>
                </div>
                <div className={classes.priceValue}>{totalPrice.toLocaleString('ru-RU')} ₽</div>
              </div>
            )}
          </div>
          )}
        </div>

        {savingError && (
          <div style={{ padding: '10px 24px', background: '#FEF2F2', color: '#DC2626', fontSize: 13, borderTop: '1px solid #FECACA' }}>
            {savingError}
          </div>
        )}

        <div className={classes.modalFooter}>
          {!isNew && ['new', 'confirmed'].includes(booking?.status) && (
            <button className={classes.btnDanger} onClick={openCancel}>
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

      {showCancel && (
        <div
          className={classes.modalOverlay}
          style={{ zIndex: 60 }}
          onClick={() => !cancelling && setShowCancel(false)}
        >
          <div
            className={`${classes.modal} ${classes.confirmModal}`}
            onClick={e => e.stopPropagation()}
          >
            <div className={classes.modalHeader}>
              <div className={classes.modalTitle}>Отменить бронь?</div>
              <button
                className={classes.modalClose}
                onClick={() => setShowCancel(false)}
                disabled={cancelling}
              >
                ×
              </button>
            </div>

            <div className={classes.modalBody}>
              <div className={classes.confirmText}>
                Бронь гостя <strong>{form.guestName || '—'}</strong> будет отменена.
                Это действие нельзя отменить.
              </div>
              <div className={classes.formGroup} style={{ marginTop: 14 }}>
                <div className={classes.formLabel}>Причина отмены (необязательно)</div>
                <textarea
                  className={classes.formTextarea}
                  value={cancelReason}
                  onChange={e => setCancelReason(e.target.value)}
                  placeholder="Например: гость отменил, дубль брони…"
                  autoFocus
                />
              </div>
              {cancelError && <div className={classes.confirmError}>{cancelError}</div>}
            </div>

            <div className={classes.modalFooter}>
              <button
                className={classes.btnSecondary}
                onClick={() => setShowCancel(false)}
                disabled={cancelling}
              >
                Назад
              </button>
              <button
                className={classes.btnDangerSolid}
                onClick={confirmCancel}
                disabled={cancelling}
              >
                {cancelling ? 'Отмена…' : 'Отменить бронь'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default BookingForm;
