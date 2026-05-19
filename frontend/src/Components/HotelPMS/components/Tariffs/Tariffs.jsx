import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  addMonths, subMonths, parseISO,
} from 'date-fns';
import { ru } from 'date-fns/locale';
import classes from './Tariffs.module.css';
import { useRatePlans, useCreateRatePlan, useUpdateRatePlan, useDeleteRatePlan } from '../../../../hooks/api/useRatePlans';
import { useRoomTypes } from '../../../../hooks/api/useRoomTypes';
import { useRates, useBulkUpsertRates, useFillRates } from '../../../../hooks/api/useRates';

const MEAL_PLAN_LABELS = {
  NONE: 'Без питания',
  BB: 'Завтрак (BB)',
  HB: 'Полупансион (HB)',
  FB: 'Полный пансион (FB)',
  AI: 'Всё включено (AI)',
};

const DOW_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

const codeFromName = (name) =>
  name.toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_-]/g, '').slice(0, 32) || 'PLAN';

// ─────────────────────────────────────────────────────────────────────────────
// RatePlanForm modal
// ─────────────────────────────────────────────────────────────────────────────
function RatePlanForm({ plan, allPlans, onSave, onDelete, onClose, saving, error }) {
  const isNew = !plan?.id;
  const [form, setForm] = useState({
    code:               plan?.code               ?? '',
    name:               plan?.name               ?? '',
    description:        plan?.description        ?? '',
    mealPlan:           plan?.mealPlan            ?? 'NONE',
    isActive:           plan?.isActive            ?? true,
    parentRatePlanId:   plan?.parentRatePlanId    ?? '',
    priceModifierType:  plan?.priceModifierType   ?? 'PERCENT',
    priceModifierValue: plan?.priceModifierValue  ?? 0,
    _autoCode: isNew,
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleNameChange = (v) => {
    setForm(f => ({ ...f, name: v, code: f._autoCode ? codeFromName(v) : f.code }));
  };
  const handleCodeChange = (v) => {
    setForm(f => ({ ...f, code: v.toUpperCase().replace(/[^A-Z0-9_-]/g, ''), _autoCode: false }));
  };

  const parentOptions = allPlans.filter(p => p.id !== plan?.id);

  return (
    <div className={classes.overlay} onClick={onClose}>
      <div className={classes.modal} onClick={e => e.stopPropagation()}>
        <div className={classes.modalHeader}>
          <div className={classes.modalTitle}>{isNew ? 'Новый тарифный план' : 'Редактировать план'}</div>
          <button className={classes.closeBtn} onClick={onClose}>✕</button>
        </div>

        <div className={classes.formGrid}>
          <div className={classes.formGroup}>
            <label>Название *</label>
            <input
              className={classes.input}
              value={form.name}
              onChange={e => handleNameChange(e.target.value)}
              placeholder="Стандартный тариф"
            />
          </div>
          <div className={classes.formGroup}>
            <label>Код *</label>
            <input
              className={classes.input}
              value={form.code}
              onChange={e => handleCodeChange(e.target.value)}
              placeholder="STANDARD"
              style={{ fontFamily: 'monospace', letterSpacing: 0.5 }}
            />
          </div>
          <div className={classes.formGroup}>
            <label>Питание</label>
            <select className={classes.input} value={form.mealPlan} onChange={e => set('mealPlan', e.target.value)}>
              {Object.entries(MEAL_PLAN_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div className={classes.formGroup}>
            <label>Статус</label>
            <select className={classes.input} value={form.isActive ? 'active' : 'inactive'} onChange={e => set('isActive', e.target.value === 'active')}>
              <option value="active">Активен</option>
              <option value="inactive">Неактивен</option>
            </select>
          </div>

          {parentOptions.length > 0 && (
            <div className={classes.formGroup} style={{ gridColumn: '1/-1' }}>
              <label>Базовый план (наследование цен)</label>
              <select className={classes.input} value={form.parentRatePlanId} onChange={e => set('parentRatePlanId', e.target.value)}>
                <option value="">— Нет (независимый план) —</option>
                {parentOptions.map(p => (
                  <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
                ))}
              </select>
            </div>
          )}

          {form.parentRatePlanId && (
            <>
              <div className={classes.formGroup}>
                <label>Тип модификатора</label>
                <select className={classes.input} value={form.priceModifierType} onChange={e => set('priceModifierType', e.target.value)}>
                  <option value="PERCENT">Процент (%)</option>
                  <option value="ABSOLUTE">Фиксированная сумма (₽)</option>
                </select>
              </div>
              <div className={classes.formGroup}>
                <label>
                  Значение {form.priceModifierType === 'PERCENT' ? '(−10 = скидка 10%)' : '(₽, −500 = скидка 500 ₽)'}
                </label>
                <input
                  className={classes.input}
                  type="number"
                  step="0.01"
                  value={form.priceModifierValue}
                  onChange={e => set('priceModifierValue', +e.target.value)}
                />
              </div>
            </>
          )}

          <div className={classes.formGroup} style={{ gridColumn: '1/-1' }}>
            <label>Описание</label>
            <textarea
              className={classes.textarea}
              rows={3}
              value={form.description}
              onChange={e => set('description', e.target.value)}
            />
          </div>
        </div>

        {error && (
          <div style={{ padding: '0 24px 12px', color: '#EF4444', fontSize: 13 }}>{error}</div>
        )}

        <div className={classes.modalFooter}>
          {!isNew && (
            <button className={classes.btnDelete} onClick={() => onDelete(plan.id)}>Удалить</button>
          )}
          <div style={{ flex: 1 }} />
          <button className={classes.btnCancel} onClick={onClose}>Отмена</button>
          <button
            className={classes.btnSave}
            disabled={saving || !form.name || !form.code}
            onClick={() => onSave(form)}
          >
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FillModal
// ─────────────────────────────────────────────────────────────────────────────
function FillModal({ plan, roomTypes, viewMonth, onFill, onClose, saving, error }) {
  const [form, setForm] = useState({
    roomTypeId: roomTypes[0]?.id ?? '',
    from: format(startOfMonth(viewMonth), 'yyyy-MM-dd'),
    to:   format(endOfMonth(viewMonth),   'yyyy-MM-dd'),
    price: '',
  });
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className={classes.overlay} onClick={onClose}>
      <div className={classes.modal} style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <div className={classes.modalHeader}>
          <div className={classes.modalTitle}>Заполнить диапазон</div>
          <button className={classes.closeBtn} onClick={onClose}>✕</button>
        </div>
        <div className={classes.formGrid} style={{ gridTemplateColumns: '1fr' }}>
          <div className={classes.formGroup}>
            <label>Категория номеров</label>
            <select className={classes.input} value={form.roomTypeId} onChange={e => set('roomTypeId', e.target.value)}>
              {roomTypes.map(rt => (
                <option key={rt.id} value={rt.id}>{rt.name}</option>
              ))}
            </select>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div className={classes.formGroup}>
              <label>С даты</label>
              <input className={classes.input} type="date" value={form.from} onChange={e => set('from', e.target.value)} />
            </div>
            <div className={classes.formGroup}>
              <label>По дату</label>
              <input className={classes.input} type="date" value={form.to} onChange={e => set('to', e.target.value)} />
            </div>
          </div>
          <div className={classes.formGroup}>
            <label>Цена за ночь, ₽&nbsp;&nbsp;<span style={{ color: '#6B7280', fontWeight: 400 }}>(0 — удалить цены)</span></label>
            <input
              className={classes.input}
              type="number"
              min="0"
              step="0.01"
              value={form.price}
              placeholder="3800"
              onChange={e => set('price', e.target.value)}
            />
          </div>
        </div>
        {error && <div style={{ padding: '0 24px 12px', color: '#EF4444', fontSize: 13 }}>{error}</div>}
        <div className={classes.modalFooter}>
          <div style={{ flex: 1 }} />
          <button className={classes.btnCancel} onClick={onClose}>Отмена</button>
          <button
            className={classes.btnSave}
            disabled={saving || !form.roomTypeId || form.price === ''}
            onClick={() => onFill({ ratePlanId: plan.id, roomTypeId: form.roomTypeId, fromDate: form.from, toDate: form.to, price: +form.price })}
          >
            {saving ? 'Применяется...' : 'Применить'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RateCalendar — month grid per room type
// ─────────────────────────────────────────────────────────────────────────────
function RateCalendar({ plan, roomTypes, viewMonth, setViewMonth, onEditPlan }) {
  const fromStr = format(startOfMonth(viewMonth), 'yyyy-MM-dd');
  const toStr   = format(endOfMonth(viewMonth),   'yyyy-MM-dd');
  const dayStrs = useMemo(
    () => eachDayOfInterval({ start: startOfMonth(viewMonth), end: endOfMonth(viewMonth) }).map(d => format(d, 'yyyy-MM-dd')),
    [viewMonth],
  );

  const { data: rates = [], isFetching } = useRates({ ratePlanId: plan.id, from: fromStr, to: toStr });
  const bulkUpsert = useBulkUpsertRates();
  const fillMutation = useFillRates();

  // Separator that can't appear in UUID or date
  const SEP = '|';

  const rateMap = useMemo(() => {
    const map = {};
    rates.forEach(r => { map[`${r.roomTypeId}${SEP}${r.date}`] = String(r.price); });
    return map;
  }, [rates]);

  const [pending, setPending] = useState({});
  const [editingCell, setEditingCell] = useState(null); // { rtId, date }
  const [showFill, setShowFill] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [fillError, setFillError] = useState(null);
  const inputRef = useRef(null);

  // Reset pending when plan changes
  useEffect(() => { setPending({}); setSaveError(null); }, [plan.id]);

  useEffect(() => {
    if (editingCell && inputRef.current) inputRef.current.focus();
  }, [editingCell]);

  const isDirty = Object.keys(pending).length > 0;

  const getDisplayValue = (rtId, date) => {
    const key = `${rtId}${SEP}${date}`;
    if (key in pending) return pending[key];
    return rateMap[key] ?? '';
  };

  const startEdit = (rtId, date) => {
    const key = `${rtId}${SEP}${date}`;
    setPending(p => ({ ...p, [key]: p[key] ?? rateMap[key] ?? '' }));
    setEditingCell({ rtId, date });
  };

  const commitCell = (rtId, date, value) => {
    const key = `${rtId}${SEP}${date}`;
    const cleaned = value.trim();
    if (cleaned === '' || isNaN(Number(cleaned))) {
      setPending(p => { const np = { ...p }; delete np[key]; return np; });
    } else {
      setPending(p => ({ ...p, [key]: cleaned }));
    }
    setEditingCell(null);
  };

  const handleKeyDown = (e, rtId, date, value) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitCell(rtId, date, value);
    } else if (e.key === 'Escape') {
      const key = `${rtId}${SEP}${date}`;
      setPending(p => { const np = { ...p }; delete np[key]; return np; });
      setEditingCell(null);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      commitCell(rtId, date, value);
      const idx = dayStrs.indexOf(date);
      if (idx < dayStrs.length - 1) {
        const nextDate = dayStrs[idx + 1];
        const nextKey = `${rtId}${SEP}${nextDate}`;
        setPending(p => ({ ...p, [nextKey]: p[nextKey] ?? rateMap[nextKey] ?? '' }));
        setEditingCell({ rtId, date: nextDate });
      }
    }
  };

  const handleSave = async () => {
    setSaveError(null);
    const items = Object.entries(pending).map(([key, priceStr]) => {
      const sepIdx = key.indexOf(SEP);
      const roomTypeId = key.slice(0, sepIdx);
      const date = key.slice(sepIdx + 1);
      return { ratePlanId: plan.id, roomTypeId, date, price: Number(priceStr) || 0 };
    });
    try {
      await bulkUpsert.mutateAsync(items);
      setPending({});
    } catch (err) {
      const msg = err?.response?.data?.message;
      setSaveError(Array.isArray(msg) ? msg.join(', ') : (msg ?? err.message ?? 'Ошибка сохранения'));
    }
  };

  const handleFill = async (data) => {
    setFillError(null);
    try {
      await fillMutation.mutateAsync(data);
      setShowFill(false);
    } catch (err) {
      const msg = err?.response?.data?.message;
      setFillError(Array.isArray(msg) ? msg.join(', ') : (msg ?? err.message ?? 'Ошибка'));
    }
  };

  const todayStr = format(new Date(), 'yyyy-MM-dd');

  return (
    <div className={classes.planPanel}>
      <div className={classes.planPanelHeader}>
        <div>
          <div className={classes.planPanelTitle}>{plan.name}</div>
          <div className={classes.planPanelMeta}>
            <code>{plan.code}</code>
            {' · '}{MEAL_PLAN_LABELS[plan.mealPlan] ?? plan.mealPlan}
            {plan.parentRatePlanId && ' · наследует цены'}
            {!plan.isActive && <span style={{ marginLeft: 8, color: '#EF4444' }}>Неактивен</span>}
          </div>
        </div>
        <div className={classes.planPanelActions}>
          {isDirty ? (
            <>
              <button className={classes.btnPrimary} onClick={handleSave} disabled={bulkUpsert.isPending}>
                {bulkUpsert.isPending ? 'Сохранение...' : `Сохранить (${Object.keys(pending).length})`}
              </button>
              <button className={classes.btnGhost} onClick={() => setPending({})}>Отмена</button>
            </>
          ) : (
            <>
              <button className={classes.btnGhost} onClick={() => setShowFill(true)}>Заполнить диапазон</button>
              <button className={classes.iconBtn} title="Редактировать план" onClick={onEditPlan}>
                <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>

      {plan.parentRatePlanId && (
        <div className={classes.inheritedNote}>
          Этот план наследует цены от базового. Цены, заданные вручную, переопределяют унаследованные.
        </div>
      )}

      {saveError && (
        <div style={{ padding: '8px 18px', background: '#FEF2F2', color: '#DC2626', fontSize: 13 }}>{saveError}</div>
      )}

      <div className={classes.calendarRoot}>
        <div className={classes.calendarHeader}>
          <div className={classes.calMonth}>
            <button className={classes.calNavBtn} onClick={() => setViewMonth(m => subMonths(m, 1))}>‹</button>
            <span className={classes.calMonthLabel}>{format(viewMonth, 'LLLL yyyy', { locale: ru })}</span>
            <button className={classes.calNavBtn} onClick={() => setViewMonth(m => addMonths(m, 1))}>›</button>
            <button className={classes.calTodayBtn} onClick={() => setViewMonth(new Date())}>Сегодня</button>
          </div>
          <div className={classes.calHint}>
            {isFetching ? 'Загрузка...' : 'Нажмите на ячейку для редактирования · Tab — следующий день'}
          </div>
        </div>

        {roomTypes.length === 0 ? (
          <div className={classes.calendarEmpty}>Нет категорий номеров. Создайте категории в разделе «Номера».</div>
        ) : (
          <div className={classes.calendarScroll}>
            <div
              className={classes.calendarGrid}
              style={{ gridTemplateColumns: `180px repeat(${dayStrs.length}, 58px)` }}
            >
              {/* Header */}
              <div className={classes.calCornerCell}>Категория</div>
              {dayStrs.map(d => {
                const dow = parseISO(d).getDay();
                const isWe = dow === 0 || dow === 6;
                const isToday = d === todayStr;
                return (
                  <div key={d} className={[classes.calDayHeader, isWe && classes.calWeekend, isToday && classes.calToday].filter(Boolean).join(' ')}>
                    <div className={classes.calDayNum}>{format(parseISO(d), 'd')}</div>
                    <div className={classes.calDow}>{DOW_SHORT[dow]}</div>
                  </div>
                );
              })}

              {/* Rows */}
              {roomTypes.map(rt => (
                <React.Fragment key={rt.id}>
                  <div className={classes.calRowLabel}>
                    <div className={classes.calRoomTypeName}>{rt.name}</div>
                    <div className={classes.calRoomTypeMeta}>до {rt.maxOccupancy ?? '?'} чел.</div>
                  </div>
                  {dayStrs.map(d => {
                    const key = `${rt.id}${SEP}${d}`;
                    const isEditing = editingCell?.rtId === rt.id && editingCell?.date === d;
                    const val = getDisplayValue(rt.id, d);
                    const hasPending = key in pending;
                    const dow = parseISO(d).getDay();
                    const isWe = dow === 0 || dow === 6;
                    const isToday = d === todayStr;

                    return (
                      <div
                        key={d}
                        className={[
                          classes.calCell,
                          isToday && classes.calCellToday,
                          isWe && classes.calCellWeekend,
                        ].filter(Boolean).join(' ')}
                        style={hasPending ? { background: '#FFFBEB' } : {}}
                        onClick={() => !isEditing && startEdit(rt.id, d)}
                      >
                        {isEditing ? (
                          <input
                            ref={inputRef}
                            className={classes.calInput}
                            style={{ width: '100%', boxSizing: 'border-box' }}
                            value={val}
                            onChange={e => setPending(p => ({ ...p, [key]: e.target.value }))}
                            onBlur={e => commitCell(rt.id, d, e.target.value)}
                            onKeyDown={e => handleKeyDown(e, rt.id, d, val)}
                          />
                        ) : val !== '' ? (
                          <span className={classes.calPrice}>{Number(val).toLocaleString('ru-RU')}</span>
                        ) : (
                          <span className={classes.calNoPrice}>—</span>
                        )}
                      </div>
                    );
                  })}
                </React.Fragment>
              ))}
            </div>
          </div>
        )}
      </div>

      {showFill && (
        <FillModal
          plan={plan}
          roomTypes={roomTypes}
          viewMonth={viewMonth}
          onFill={handleFill}
          onClose={() => { setShowFill(false); setFillError(null); }}
          saving={fillMutation.isPending}
          error={fillError}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tariffs (main)
// ─────────────────────────────────────────────────────────────────────────────
function Tariffs() {
  const { data: plans = [], isLoading } = useRatePlans();
  const { data: roomTypes = [] } = useRoomTypes();
  const createPlan = useCreateRatePlan();
  const updatePlan = useUpdateRatePlan();
  const deletePlan = useDeleteRatePlan();

  const [selectedPlanId, setSelectedPlanId] = useState(null);
  const [viewMonth, setViewMonth] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState(null); // null = new
  const [formError, setFormError] = useState(null);

  const selectedPlan = plans.find(p => p.id === selectedPlanId) ?? plans[0] ?? null;

  const openNew  = () => { setFormError(null); setFormData(null); setShowForm(true); };
  const openEdit = (plan) => { setFormError(null); setFormData(plan); setShowForm(true); };

  const handleSave = async (form) => {
    setFormError(null);
    const payload = {
      code:               form.code,
      name:               form.name,
      description:        form.description || undefined,
      mealPlan:           form.mealPlan,
      isActive:           form.isActive,
      parentRatePlanId:   form.parentRatePlanId || undefined,
      priceModifierType:  form.parentRatePlanId ? form.priceModifierType  : undefined,
      priceModifierValue: form.parentRatePlanId ? form.priceModifierValue : undefined,
    };
    try {
      if (formData?.id) {
        await updatePlan.mutateAsync({ id: formData.id, payload });
      } else {
        const created = await createPlan.mutateAsync(payload);
        setSelectedPlanId(created.id);
      }
      setShowForm(false);
    } catch (err) {
      const msg = err?.response?.data?.message;
      setFormError(Array.isArray(msg) ? msg.join(', ') : (msg ?? err.message ?? 'Ошибка'));
    }
  };

  const handleDelete = async (id) => {
    try {
      await deletePlan.mutateAsync(id);
      setShowForm(false);
      if (selectedPlanId === id) setSelectedPlanId(null);
    } catch (err) {
      const msg = err?.response?.data?.message;
      setFormError(Array.isArray(msg) ? msg.join(', ') : (msg ?? err.message ?? 'Ошибка'));
    }
  };

  const isSaving = createPlan.isPending || updatePlan.isPending || deletePlan.isPending;

  if (isLoading) {
    return (
      <div className={classes.root}>
        <div className={classes.pageHeader}><div className={classes.pageTitle}>Тарифы</div></div>
        <div className={classes.loadingState}>Загрузка...</div>
      </div>
    );
  }

  return (
    <div className={classes.root}>
      <div className={classes.pageHeader}>
        <div className={classes.pageTitle}>Тарифы</div>
        <button className={classes.btnAdd} onClick={openNew}>
          <svg width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Новый план
        </button>
      </div>

      {plans.length === 0 ? (
        <div className={classes.emptyState}>
          <div className={classes.emptyIcon}>
            <svg width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 11h.01M12 11h.01M15 11h.01M4 5h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7a2 2 0 012-2z" />
            </svg>
          </div>
          <div className={classes.emptyTitle}>Нет тарифных планов</div>
          <div className={classes.emptyText}>Создайте первый план, чтобы начать управлять ценами на номера</div>
          <button className={classes.btnAdd} onClick={openNew}>Создать план</button>
        </div>
      ) : (
        <>
          <div className={classes.planTabsWrapper}>
            <div className={classes.planTabs}>
              {plans.map(p => (
                <div
                  key={p.id}
                  className={`${classes.planTab} ${selectedPlan?.id === p.id ? classes.planTabActive : ''}`}
                  onClick={() => setSelectedPlanId(p.id)}
                >
                  <div className={classes.planTabHead}>
                    <span className={classes.planTabName}>{p.name}</span>
                    {p.parentRatePlanId && <span className={classes.planTabInherits}>Inherited</span>}
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: p.isActive ? '#22C55E' : '#D1D5DB', flexShrink: 0, marginLeft: 'auto' }} />
                  </div>
                  <div className={classes.planTabMeta}>{p.code} · {MEAL_PLAN_LABELS[p.mealPlan] ?? p.mealPlan}</div>
                </div>
              ))}
              <button
                style={{ alignSelf: 'center', marginLeft: 4, background: 'none', border: '1px dashed #CBD5E1', borderRadius: 10, padding: '8px 14px', cursor: 'pointer', color: '#94A3B8', fontSize: 13, fontFamily: 'inherit' }}
                onClick={openNew}
              >+ Добавить</button>
            </div>
          </div>

          {selectedPlan && (
            <RateCalendar
              key={selectedPlan.id}
              plan={selectedPlan}
              roomTypes={roomTypes}
              viewMonth={viewMonth}
              setViewMonth={setViewMonth}
              onEditPlan={() => openEdit(selectedPlan)}
            />
          )}
        </>
      )}

      {showForm && (
        <RatePlanForm
          plan={formData}
          allPlans={plans}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={() => { setShowForm(false); setFormError(null); }}
          saving={isSaving}
          error={formError}
        />
      )}
    </div>
  );
}

export default Tariffs;
