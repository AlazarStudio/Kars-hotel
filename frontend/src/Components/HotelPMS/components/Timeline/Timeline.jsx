import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import {
  addDays, subDays, startOfMonth, getDate, getMonth, getYear, setMonth, setYear,
  differenceInDays, parseISO, format, isSameDay, getDay,
} from 'date-fns';
import { ru } from 'date-fns/locale';
import classes from './Timeline.module.css';
import { DAY_WIDTH, LEFT_PANEL_WIDTH, BOOKING_STATUS, HK_STATUS } from '../../constants';
import BookingForm from './BookingForm';
import { useTimeline } from '../../../../hooks/useTimeline';
import { createReservation, updateReservation } from '../../../../api/reservations';

const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);

function Timeline() {
  const [viewStart, setViewStart] = useState(subDays(TODAY, 7));
  const [daysCount, setDaysCount] = useState(30);

  // ── Real API data ─────────────────────────────────────────────────────────
  const { data: apiData, loading: apiLoading, error: apiError, reload } = useTimeline(viewStart, daysCount);

  const rooms      = apiData?.rooms      ?? [];
  const categories = apiData?.categories ?? [];
  const [bookings, setBookings] = useState([]);

  useEffect(() => {
    if (apiData?.bookings) setBookings(apiData.bookings);
  }, [apiData]);

  const [search, setSearch] = useState('');
  const [tooltip, setTooltip] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState(null);
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [pickerYear, setPickerYear] = useState(getYear(TODAY));

  // Pending drag: waiting for user confirmation before API call
  const [pendingDrag, setPendingDrag] = useState(null);
  const [dragSaving, setDragSaving] = useState(false);
  const [dragError, setDragError] = useState(null);
  const [formError, setFormError] = useState(null);

  const [dayWidth, setDayWidth] = useState(DAY_WIDTH);
  const dayWidthRef = useRef(DAY_WIDTH);

  const dragRef = useRef(null);
  // Set to true when mouseup finalises a real drag (prevents subsequent click from opening form)
  const dragMovedRef = useRef(false);
  const [dragBookingId, setDragBookingId] = useState(null);
  const [ghostBooking, setGhostBooking] = useState(null);
  const [selection, setSelection] = useState(null);

  const containerRef = useRef(null);
  const hoveredRoomRef = useRef(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      if (w > 0) {
        const effectiveDays = Math.min(daysCount, 30);
        const computed = Math.max(DAY_WIDTH, (w - LEFT_PANEL_WIDTH) / effectiveDays);
        dayWidthRef.current = computed;
        setDayWidth(computed);
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [daysCount]);

  const days = useMemo(() => (
    Array.from({ length: daysCount }, (_, i) => addDays(viewStart, i))
  ), [viewStart, daysCount]);

  const gridWidth = LEFT_PANEL_WIDTH + daysCount * dayWidth;

  const availByDay = useMemo(() => {
    return days.map(day => {
      const occ = new Set(
        bookings.filter(b => {
          if (b.status === 'cancelled' || b.status === 'no_show') return false;
          const ci = parseISO(b.checkIn);
          const co = parseISO(b.checkOut);
          return day >= ci && day < co;
        }).map(b => b.roomId)
      );
      return rooms.length - occ.size;
    });
  }, [days, bookings, rooms]);

  const visibleBookings = useMemo(() => {
    const end = addDays(viewStart, daysCount);
    return bookings.filter(b => {
      if (search) {
        const q = search.toLowerCase();
        if (!b.guestName.toLowerCase().includes(q)) return false;
      }
      const ci = parseISO(b.checkIn);
      const co = parseISO(b.checkOut);
      return co > viewStart && ci < end;
    });
  }, [bookings, viewStart, daysCount, search]);

  // ── Geometry helpers ──────────────────────────────────────────
  const getBookingLeft = useCallback((checkIn) => {
    const d = differenceInDays(parseISO(checkIn), viewStart);
    return d * dayWidthRef.current;
  }, [viewStart]);

  const getBookingWidth = useCallback((checkIn, checkOut) => {
    const dw = dayWidthRef.current;
    return Math.max(dw, differenceInDays(parseISO(checkOut), parseISO(checkIn)) * dw) - 2;
  }, []);

  const getDayFromClientX = useCallback((clientX) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const scrollLeft = containerRef.current.scrollLeft;
    const x = clientX - rect.left + scrollLeft - LEFT_PANEL_WIDTH;
    return Math.floor(x / dayWidthRef.current);
  }, []);

  const dayToDate = useCallback((dayIndex) => (
    format(addDays(viewStart, dayIndex), 'yyyy-MM-dd')
  ), [viewStart]);

  // ── Mouse handlers ────────────────────────────────────────────
  const handleBookingMouseDown = useCallback((e, booking, type) => {
    e.stopPropagation();
    e.preventDefault();
    dragMovedRef.current = false;
    setTooltip(null);
    const dayIndex = getDayFromClientX(e.clientX);
    dragRef.current = {
      type,
      booking: { ...booking },
      startX: e.clientX,
      startDayIndex: dayIndex,
      origCheckIn: booking.checkIn,
      origCheckOut: booking.checkOut,
      origRoomId: booking.roomId,
    };
    setDragBookingId(booking.id);
    setGhostBooking({ ...booking });
  }, [getDayFromClientX]);

  const handleGridMouseDown = useCallback((e, roomId, dayIndex) => {
    e.preventDefault();
    const dw = dayWidthRef.current;
    dragRef.current = { type: 'create', roomId, startDayIndex: dayIndex, endDayIndex: dayIndex };
    setSelection({ roomId, left: dayIndex * dw, width: dw });
  }, []);

  const handleMouseMove = useCallback((e) => {
    const drag = dragRef.current;
    if (!drag) return;

    const curDayIndex = getDayFromClientX(e.clientX);
    const targetRoomId = hoveredRoomRef.current;

    if (drag.type === 'create') {
      const dw = dayWidthRef.current;
      drag.endDayIndex = curDayIndex;
      const startD = Math.min(drag.startDayIndex, drag.endDayIndex);
      const endD   = Math.max(drag.startDayIndex, drag.endDayIndex) + 1;
      setSelection({
        roomId: drag.roomId,
        left: startD * dw,
        width: (endD - startD) * dw,
      });
      return;
    }

    if (drag.type === 'move') {
      const delta = curDayIndex - drag.startDayIndex;
      if (delta !== 0 || (targetRoomId && targetRoomId !== drag.origRoomId)) {
        dragMovedRef.current = true;
      }
      const newCI = format(addDays(parseISO(drag.origCheckIn), delta), 'yyyy-MM-dd');
      const newCO = format(addDays(parseISO(drag.origCheckOut), delta), 'yyyy-MM-dd');
      setGhostBooking(prev => ({
        ...prev,
        checkIn: newCI,
        checkOut: newCO,
        roomId: targetRoomId || drag.origRoomId,
      }));
      return;
    }

    if (drag.type === 'resize-right') {
      const delta = curDayIndex - drag.startDayIndex;
      const newCO = format(addDays(parseISO(drag.origCheckOut), delta), 'yyyy-MM-dd');
      if (newCO > drag.origCheckIn) {
        if (delta !== 0) dragMovedRef.current = true;
        setGhostBooking(prev => ({ ...prev, checkOut: newCO }));
      }
      return;
    }

    if (drag.type === 'resize-left') {
      const delta = curDayIndex - drag.startDayIndex;
      const newCI = format(addDays(parseISO(drag.origCheckIn), delta), 'yyyy-MM-dd');
      if (newCI < drag.origCheckOut) {
        if (delta !== 0) dragMovedRef.current = true;
        setGhostBooking(prev => ({ ...prev, checkIn: newCI }));
      }
    }
  }, [getDayFromClientX]);

  const handleMouseUp = useCallback((e) => {
    const drag = dragRef.current;
    dragRef.current = null;

    if (!drag) return;

    if (drag.type === 'create') {
      const startD = Math.min(drag.startDayIndex, drag.endDayIndex);
      const endD   = Math.max(drag.startDayIndex, drag.endDayIndex) + 1;
      setSelection(null);
      setFormData({
        roomId: drag.roomId,
        checkIn: dayToDate(startD),
        checkOut: dayToDate(endD),
        adults: 1,
        children: 0,
        status: 'confirmed',
        source: 'direct',
      });
      setShowForm(true);
      return;
    }

    const ghost = ghostBooking;
    setDragBookingId(null);
    setGhostBooking(null);

    if (!ghost) return;

    // Determine what changed
    const targetRoomId = hoveredRoomRef.current || drag.origRoomId;
    const newCheckIn  = drag.type === 'resize-right' ? drag.origCheckIn : ghost.checkIn;
    const newCheckOut = drag.type === 'resize-left'  ? drag.origCheckOut : ghost.checkOut;
    const newRoomId   = drag.type === 'move' ? targetRoomId : drag.origRoomId;

    // If nothing actually changed — no confirmation needed
    const unchanged =
      newCheckIn  === drag.origCheckIn &&
      newCheckOut === drag.origCheckOut &&
      newRoomId   === drag.origRoomId;

    if (unchanged) return;

    // Show confirmation dialog (booking stays at original position)
    setPendingDrag({
      booking: drag.booking,
      newCheckIn,
      newCheckOut,
      newRoomId,
      type: drag.type,
    });
  }, [ghostBooking, dayToDate]);

  useEffect(() => {
    const onMove = (e) => handleMouseMove(e);
    const onUp   = (e) => handleMouseUp(e);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  // ── Confirm drag ──────────────────────────────────────────────
  const confirmDrag = useCallback(async () => {
    if (!pendingDrag) return;
    setDragSaving(true);
    setDragError(null);
    try {
      await updateReservation(pendingDrag.booking.id, {
        version:  pendingDrag.booking.version,
        roomId:   pendingDrag.newRoomId   !== pendingDrag.booking.roomId   ? pendingDrag.newRoomId   : undefined,
        checkIn:  pendingDrag.newCheckIn  !== pendingDrag.booking.checkIn  ? pendingDrag.newCheckIn  : undefined,
        checkOut: pendingDrag.newCheckOut !== pendingDrag.booking.checkOut ? pendingDrag.newCheckOut : undefined,
      });
      await reload();
      setPendingDrag(null);
    } catch (err) {
      const msg = err?.response?.data?.message ?? err.message ?? 'Ошибка сохранения';
      setDragError(msg);
    } finally {
      setDragSaving(false);
    }
  }, [pendingDrag, reload]);

  const cancelDrag = useCallback(() => {
    setPendingDrag(null);
    setDragError(null);
  }, []);

  // ── Form handlers ─────────────────────────────────────────────
  const handleFormSave = useCallback(async (data) => {
    setFormError(null);
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
          source:     data.source  || 'DIRECT',
          notes:      data.notes   || undefined,
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
          status:     data.status  || 'CONFIRMED',
          source:     data.source  || 'DIRECT',
          notes:      data.notes   || undefined,
          totalPrice: data.totalPrice || undefined,
          ratePlanId: data.ratePlanId || undefined,
        });
      }
      await reload();
      setShowForm(false);
      setFormData(null);
    } catch (err) {
      const msg = err?.response?.data?.message ?? err.message ?? 'Ошибка сохранения';
      setFormError(msg);
    }
  }, [reload]);

  const handleFormDelete = useCallback(async (id) => {
    const booking = bookings.find(b => b.id === id);
    if (!booking) return;
    setFormError(null);
    try {
      await updateReservation(id, { version: booking.version, status: 'CANCELLED' });
      await reload();
      setShowForm(false);
      setFormData(null);
    } catch (err) {
      const msg = err?.response?.data?.message ?? err.message ?? 'Ошибка';
      setFormError(msg);
    }
  }, [bookings, reload]);

  const openEditForm = useCallback((booking) => {
    // Prevent click that fires right after mouseup from opening the form
    if (dragRef.current || dragMovedRef.current) {
      dragMovedRef.current = false;
      return;
    }
    setFormError(null);
    setFormData({ ...booking });
    setShowForm(true);
  }, []);

  // ── Navigation ────────────────────────────────────────────────
  const goToday = () => setViewStart(subDays(TODAY, 7));
  const navStep = daysCount === 14 ? 7 : 14;
  const prevPeriod = () => setViewStart(v => subDays(v, navStep));
  const nextPeriod = () => setViewStart(v => addDays(v, navStep));

  const isDragging = !!dragRef.current || dragBookingId != null;

  const isWeekend = (date) => { const d = getDay(date); return d === 0 || d === 6; };
  const isToday   = (date) => isSameDay(date, TODAY);

  // ── Render booking block ──────────────────────────────────────
  const renderBooking = useCallback((b, isGhost = false) => {
    const dw = dayWidthRef.current;
    const rawLeft  = differenceInDays(parseISO(b.checkIn),  viewStart) * dw;
    const rawRight = differenceInDays(parseISO(b.checkOut), viewStart) * dw;

    const clampedLeft  = Math.max(0, rawLeft);
    const clampedRight = Math.min(daysCount * dw, rawRight);

    if (clampedRight - clampedLeft <= 0) return null;

    const left  = clampedLeft;
    const width = Math.max(6, clampedRight - clampedLeft - 2);

    const cfg    = BOOKING_STATUS[b.status] || BOOKING_STATUS.new;
    const nights = differenceInDays(parseISO(b.checkOut), parseISO(b.checkIn));
    const isBeingDragged = b.id === dragBookingId && !isGhost;

    return (
      <div
        key={isGhost ? `ghost-${b.id}` : b.id}
        className={`${classes.bookingBlock} ${isBeingDragged ? classes.isDragging : ''} ${isGhost ? classes.isGhost : ''}`}
        style={{ left, width, background: cfg.color }}
        onMouseDown={!isGhost ? (e) => handleBookingMouseDown(e, b, 'move') : undefined}
        onClick={!isGhost ? (e) => { e.stopPropagation(); openEditForm(b); } : undefined}
        onMouseEnter={!isGhost ? (e) => {
          if (isDragging) return;
          setTooltip({ booking: b, x: e.clientX, y: e.clientY });
        } : undefined}
        onMouseMove={!isGhost ? (e) => {
          if (isDragging) return;
          setTooltip(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : null);
        } : undefined}
        onMouseLeave={!isGhost ? () => setTooltip(null) : undefined}
      >
        <div
          className={`${classes.resizeHandle} ${classes.resizeHandleLeft}`}
          onMouseDown={(e) => { e.stopPropagation(); handleBookingMouseDown(e, b, 'resize-left'); }}
        />
        <div className={classes.bookingInner}>
          <div className={classes.bookingText}>
            <div className={classes.bookingGuestName}>{b.guestName.split(' ')[0]} {b.guestName.split(' ')[1]?.[0]}.</div>
            <div className={classes.bookingNights}>{nights} н.</div>
          </div>
        </div>
        <div
          className={`${classes.resizeHandle} ${classes.resizeHandleRight}`}
          onMouseDown={(e) => { e.stopPropagation(); handleBookingMouseDown(e, b, 'resize-right'); }}
        />
      </div>
    );
  }, [viewStart, daysCount, handleBookingMouseDown, openEditForm, dragBookingId, isDragging]);

  // ── Main render ───────────────────────────────────────────────
  if (apiError) {
    return (
      <div className={classes.root} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#EF4444', padding: 48 }}>
        Ошибка загрузки шахматки: {apiError}
      </div>
    );
  }

  return (
    <div className={classes.root}>
      {apiLoading && (
        <div style={{ position: 'absolute', top: 8, right: 16, fontSize: 12, color: '#6B7280', zIndex: 10 }}>
          Загрузка...
        </div>
      )}

      {/* Controls */}
      <div className={classes.controls}>
        <div className={classes.monthNav}>
          <button className={classes.navBtn} onClick={prevPeriod}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <div className={classes.monthLabelWrap}>
            <button
              className={classes.monthLabel}
              onClick={() => { setPickerYear(getYear(viewStart)); setShowMonthPicker(v => !v); }}
            >
              {(() => {
                const viewEnd = addDays(viewStart, daysCount - 1);
                const startLabel = format(viewStart, 'LLLL', { locale: ru }).replace(/^\w/, c => c.toUpperCase());
                if (getMonth(viewEnd) !== getMonth(viewStart)) {
                  return `${startLabel} – ${format(viewEnd, 'LLLL', { locale: ru })} ${format(viewEnd, 'yyyy')}`;
                }
                return `${startLabel} ${format(viewStart, 'yyyy')}`;
              })()}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 4 }}>
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>
            {showMonthPicker && (
              <MonthPicker
                year={pickerYear}
                onYearChange={setPickerYear}
                onSelect={(year, month) => {
                  setViewStart(startOfMonth(setMonth(setYear(new Date(), year), month)));
                  setShowMonthPicker(false);
                }}
                onClose={() => setShowMonthPicker(false)}
              />
            )}
          </div>
          <button className={classes.navBtn} onClick={nextPeriod}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
        <button className={classes.todayBtn} onClick={goToday}>Сегодня</button>
        <div className={classes.daysToggle}>
          {[14, 30].map(n => (
            <button
              key={n}
              className={`${classes.daysToggleBtn} ${daysCount === n ? classes.active : ''}`}
              onClick={() => setDaysCount(n)}
            >{n} дн</button>
          ))}
        </div>
        <input
          className={classes.searchInput}
          placeholder="Поиск по гостю..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className={classes.legend}>
          {Object.entries(BOOKING_STATUS).map(([key, cfg]) => (
            <div key={key} className={classes.legendItem}>
              <div className={classes.legendDot} style={{ background: cfg.color }} />
              {cfg.label}
            </div>
          ))}
        </div>
      </div>

      {/* Timeline grid */}
      <div
        ref={containerRef}
        className={`${classes.timelineWrapper} ${isDragging ? classes.dragging : ''}`}
        onMouseLeave={() => { if (!dragRef.current) setTooltip(null); }}
      >
        <div className={classes.timelineInner} style={{ width: gridWidth, minWidth: gridWidth }}>
          {/* Sticky date header */}
          <div className={classes.stickyHeader}>
            <div className={classes.headerCorner}>
              <span className={classes.headerCornerLabel}>Номер</span>
            </div>
            <div className={classes.datesRow}>
              {days.map((day, i) => (
                <div
                  key={i}
                  className={`${classes.dayCell} ${isWeekend(day) ? classes.isWeekend : ''} ${isToday(day) ? classes.isToday : ''}`}
                  style={{ width: dayWidth }}
                >
                  <div className={classes.dayName}>{format(day, 'EE', { locale: ru })}</div>
                  <div className={classes.dayNum}>{format(day, 'd')}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Availability row */}
          <div className={classes.availRow}>
            <div className={classes.availCorner}>Своб.</div>
            <div style={{ display: 'flex' }}>
              {availByDay.map((count, i) => (
                <div
                  key={i}
                  className={classes.availCell}
                  style={{ width: dayWidth, color: count === 0 ? '#EF5350' : count <= 2 ? '#FB8C00' : '#43A047' }}
                >
                  {count}
                </div>
              ))}
            </div>
          </div>

          {/* Category groups */}
          {categories.map(cat => {
            const catRooms = rooms.filter(r => r.categoryId === cat.id);
            return (
              <div key={cat.id} className={classes.categoryGroup}>
                <div className={classes.categoryHeader} style={{ width: gridWidth }}>
                  <div className={classes.categoryLabel}>
                    <span className={classes.categoryName}>{cat.name}</span>
                    <span className={classes.categoryMeta}>
                      {catRooms.length} ном. · {cat.basePrice.toLocaleString('ru-RU')} ₽/ночь
                    </span>
                  </div>
                  <div className={classes.categoryBgCells}>
                    {days.map((_, i) => <div key={i} className={classes.categoryBgCell} style={{ width: dayWidth }} />)}
                  </div>
                </div>

                {catRooms.map(room => {
                  const roomBookings = visibleBookings.filter(b => b.roomId === room.id);
                  const hkCfg = HK_STATUS[room.hk] || HK_STATUS.clean;

                  return (
                    <div
                      key={room.id}
                      className={classes.roomRow}
                      style={{ width: gridWidth }}
                      onMouseEnter={() => { hoveredRoomRef.current = room.id; }}
                    >
                      <div className={classes.roomLabel}>
                        <div className={classes.roomNumber}>№{room.number}</div>
                        <div className={classes.roomCategory}>{cat.name}</div>
                        <div
                          className={classes.hkBadge}
                          style={{ background: hkCfg.bg, color: hkCfg.color }}
                        >
                          {hkCfg.label}
                        </div>
                      </div>

                      <div className={classes.roomCells}>
                        {days.map((day, di) => (
                          <div
                            key={di}
                            className={`${classes.gridCell} ${isWeekend(day) ? classes.isWeekend : ''} ${isToday(day) ? classes.isToday : ''}`}
                            style={{ width: dayWidth }}
                            onMouseDown={(e) => handleGridMouseDown(e, room.id, di)}
                          />
                        ))}

                        {roomBookings.map(b => renderBooking(b))}

                        {ghostBooking && ghostBooking.roomId === room.id && dragBookingId &&
                          renderBooking({ ...ghostBooking, id: ghostBooking.id }, true)
                        }

                        {selection && selection.roomId === room.id && (
                          <div
                            className={classes.selectionRect}
                            style={{ left: selection.left, width: selection.width }}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && !isDragging && (
        <Tooltip booking={tooltip.booking} x={tooltip.x} y={tooltip.y} rooms={rooms} />
      )}

      {/* Drag confirmation dialog */}
      {pendingDrag && (
        <DragConfirmDialog
          pending={pendingDrag}
          rooms={rooms}
          saving={dragSaving}
          error={dragError}
          onConfirm={confirmDrag}
          onCancel={cancelDrag}
        />
      )}

      {/* Booking form modal */}
      {showForm && formData && (
        <BookingForm
          booking={formData}
          rooms={rooms}
          categories={categories}
          bookings={bookings}
          onSave={handleFormSave}
          onDelete={handleFormDelete}
          onClose={() => { setShowForm(false); setFormData(null); setFormError(null); }}
          savingError={formError}
        />
      )}
    </div>
  );
}

// ── Drag confirmation dialog ──────────────────────────────────────────────────

function DragConfirmDialog({ pending, rooms, saving, error, onConfirm, onCancel }) {
  const { booking, newCheckIn, newCheckOut, newRoomId, type } = pending;

  const oldRoom = rooms.find(r => r.id === booking.roomId);
  const newRoom = rooms.find(r => r.id === newRoomId);

  const fmtDate = (d) => format(parseISO(d), 'd MMM yyyy', { locale: ru });

  const roomChanged  = newRoomId   !== booking.roomId;
  const datesChanged = newCheckIn  !== booking.checkIn || newCheckOut !== booking.checkOut;

  return (
    <div className={classes.modalOverlay} onClick={onCancel}>
      <div className={classes.modal} style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <div className={classes.modalHeader}>
          <div className={classes.modalTitle}>Подтвердить изменение</div>
          <button className={classes.modalClose} onClick={onCancel}>×</button>
        </div>
        <div className={classes.modalBody}>
          <p style={{ margin: '0 0 12px', color: '#374151', fontWeight: 600 }}>
            {booking.guestName}
          </p>
          {datesChanged && (
            <div style={{ display: 'flex', gap: 12, marginBottom: 8, fontSize: 14 }}>
              <div style={{ color: '#9CA3AF' }}>
                <div style={{ fontSize: 11, marginBottom: 2 }}>Было</div>
                <div>{fmtDate(booking.checkIn)} — {fmtDate(booking.checkOut)}</div>
              </div>
              <div style={{ color: '#374151', fontWeight: 500 }}>
                <div style={{ fontSize: 11, marginBottom: 2 }}>Станет</div>
                <div>{fmtDate(newCheckIn)} — {fmtDate(newCheckOut)}</div>
              </div>
            </div>
          )}
          {roomChanged && (
            <div style={{ display: 'flex', gap: 12, fontSize: 14 }}>
              <div style={{ color: '#9CA3AF' }}>
                <div style={{ fontSize: 11, marginBottom: 2 }}>Номер (было)</div>
                <div>№{oldRoom?.number ?? '?'}</div>
              </div>
              <div style={{ color: '#374151', fontWeight: 500 }}>
                <div style={{ fontSize: 11, marginBottom: 2 }}>Номер (станет)</div>
                <div>№{newRoom?.number ?? '?'}</div>
              </div>
            </div>
          )}
        </div>
        {error && (
          <div style={{ padding: '10px 24px', background: '#FEF2F2', color: '#DC2626', fontSize: 13, borderTop: '1px solid #FECACA' }}>
            {error}
          </div>
        )}
        <div className={classes.modalFooter}>
          <button className={classes.btnSecondary} onClick={onCancel} disabled={saving}>Отменить</button>
          <button className={classes.btnPrimary} onClick={onConfirm} disabled={saving}>
            {saving ? 'Сохранение...' : 'Подтвердить'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

function Tooltip({ booking, x, y, rooms }) {
  const room = rooms.find(r => r.id === booking.roomId);
  const nights = differenceInDays(parseISO(booking.checkOut), parseISO(booking.checkIn));
  const cfg = BOOKING_STATUS[booking.status] || BOOKING_STATUS.new;

  const style = {
    left: Math.min(x + 14, window.innerWidth - 300),
    top: y + 14,
  };
  if (y + 14 + 180 > window.innerHeight) {
    style.top = y - 180;
  }

  return (
    <div className={classes.tooltip} style={style}>
      <div className={classes.tooltipName}>{booking.guestName}</div>
      <div className={classes.tooltipRow}>
        <span className={classes.tooltipLabel}>Номер:</span>
        <span className={classes.tooltipValue}>№{room?.number}</span>
      </div>
      <div className={classes.tooltipRow}>
        <span className={classes.tooltipLabel}>Заезд:</span>
        <span className={classes.tooltipValue}>{format(parseISO(booking.checkIn), 'd MMM yyyy', { locale: ru })}</span>
      </div>
      <div className={classes.tooltipRow}>
        <span className={classes.tooltipLabel}>Выезд:</span>
        <span className={classes.tooltipValue}>{format(parseISO(booking.checkOut), 'd MMM yyyy', { locale: ru })}</span>
      </div>
      <div className={classes.tooltipRow}>
        <span className={classes.tooltipLabel}>Ночей:</span>
        <span className={classes.tooltipValue}>{nights}</span>
      </div>
      <div className={classes.tooltipRow}>
        <span className={classes.tooltipLabel}>Статус:</span>
        <span className={classes.tooltipValue} style={{ color: cfg.color }}>{cfg.label}</span>
      </div>
      {booking.totalPrice > 0 && (
        <div className={classes.tooltipRow}>
          <span className={classes.tooltipLabel}>Сумма:</span>
          <span className={classes.tooltipValue}>{booking.totalPrice.toLocaleString('ru-RU')} ₽</span>
        </div>
      )}
      {booking.notes && (
        <div className={classes.tooltipRow}>
          <span className={classes.tooltipLabel}>Заметка:</span>
          <span className={classes.tooltipValue}>{booking.notes}</span>
        </div>
      )}
    </div>
  );
}

// ── Month picker ──────────────────────────────────────────────────────────────

const MONTHS_RU = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

function MonthPicker({ year, onYearChange, onSelect, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div ref={ref} className={classes.monthPicker}>
      <div className={classes.monthPickerYear}>
        <button className={classes.monthPickerYearBtn} onClick={() => onYearChange(y => y - 1)}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <span className={classes.monthPickerYearLabel}>{year}</span>
        <button className={classes.monthPickerYearBtn} onClick={() => onYearChange(y => y + 1)}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>
      <div className={classes.monthPickerGrid}>
        {MONTHS_RU.map((name, i) => (
          <button key={i} className={classes.monthPickerCell} onClick={() => onSelect(year, i)}>
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}

export default Timeline;
