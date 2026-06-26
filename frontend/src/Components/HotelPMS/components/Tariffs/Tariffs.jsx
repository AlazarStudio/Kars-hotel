import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  format, startOfMonth,
  addDays, subDays, parseISO,
  getMonth, getYear, setMonth, setYear,
} from 'date-fns';
import { ru } from 'date-fns/locale';
import classes from './Tariffs.module.css';
import { useRatePlans, useCreateRatePlan, useUpdateRatePlan, useDeleteRatePlan } from '../../../../hooks/api/useRatePlans';
import { useRoomTypes } from '../../../../hooks/api/useRoomTypes';
import {
  useRates, useBulkUpsertRates, useFillRates,
  useStandardRates, useSetStandardRates,
  useSeasons, useReplaceSeasons,
} from '../../../../hooks/api/useRates';

const MEAL_PLAN_LABELS = {
  NONE: 'Без питания',
  BB: 'Завтрак (BB)',
  HB: 'Полупансион (HB)',
  FB: 'Полный пансион (FB)',
  AI: 'Всё включено (AI)',
};

const DOW_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const SEASON_COLORS = ['#F59E0B', '#10B981', '#3B82F6', '#EF4444', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316'];
const MONTHS_RU = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

// Calendar geometry (mirrors the шахматка rolling-window layout).
const CAL_LABEL_W = 168;
const CAL_DAY_MIN = 46;
const TODAY = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();

const codeFromName = (name) =>
  name.toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_-]/g, '').slice(0, 32) || 'PLAN';

const fmtRub = (v) => Number(v).toLocaleString('ru-RU');
const day10 = (s) => (typeof s === 'string' ? s.slice(0, 10) : format(s, 'yyyy-MM-dd'));

// ─────────────────────────────────────────────────────────────────────────────
// Baseline resolver — mirrors backend: covering season → standard price → null.
// Built from the standard prices + seasons loaded for the current plan.
// ─────────────────────────────────────────────────────────────────────────────
function buildResolver(standardRates, seasons) {
  const stdByRt = {};
  standardRates.forEach((s) => { stdByRt[s.roomTypeId] = String(s.price); });

  const seasonsByRt = {};
  seasons.forEach((s) => {
    (seasonsByRt[s.roomTypeId] ||= []).push({
      from: day10(s.dateFrom),
      to: day10(s.dateTo),
      price: String(s.price),
      name: s.name,
      color: s.color,
      sortOrder: s.sortOrder ?? 0,
    });
  });
  // Most-specific first: latest start date, then higher sortOrder.
  Object.values(seasonsByRt).forEach((arr) =>
    arr.sort((a, b) => (a.from !== b.from ? (a.from < b.from ? 1 : -1) : b.sortOrder - a.sortOrder)),
  );

  return (rtId, day) => {
    for (const s of seasonsByRt[rtId] || []) {
      if (day >= s.from && day <= s.to) return { price: s.price, source: 'season', season: s };
    }
    if (rtId in stdByRt) return { price: stdByRt[rtId], source: 'standard' };
    return null;
  };
}

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
// StandardPrices — baseline price per category (the "everyday" price)
// ─────────────────────────────────────────────────────────────────────────────
function StandardPrices({ plan, roomTypes }) {
  const { data: standard = [], isLoading } = useStandardRates(plan.id);
  const save = useSetStandardRates();

  const stdMap = useMemo(() => {
    const m = {};
    standard.forEach((s) => { m[s.roomTypeId] = String(s.price); });
    return m;
  }, [standard]);

  const [draft, setDraft] = useState(stdMap);
  const [error, setError] = useState(null);
  useEffect(() => { setDraft(stdMap); setError(null); }, [stdMap, plan.id]);

  const dirty = roomTypes.some((rt) => (draft[rt.id] ?? '') !== (stdMap[rt.id] ?? ''));

  const handleSave = async () => {
    setError(null);
    const items = roomTypes.map((rt) => ({
      roomTypeId: rt.id,
      price: Number(draft[rt.id]) || 0,
    }));
    try {
      await save.mutateAsync({ ratePlanId: plan.id, items });
    } catch (err) {
      const msg = err?.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : (msg ?? err.message ?? 'Ошибка'));
    }
  };

  return (
    <div>
      <div className={classes.sectionHint}>
        Базовая цена за ночь применяется ко всем датам, если на этот день нет сезона
        или индивидуальной цены. Это самый быстрый способ задать цены — один раз на категорию.
      </div>
      {roomTypes.length === 0 ? (
        <div className={classes.seasonsEmpty}>Нет категорий номеров. Создайте их в разделе «Номера».</div>
      ) : (
        <div className={classes.stdTable}>
          {roomTypes.map((rt) => (
            <div key={rt.id} className={classes.stdRow}>
              <div>
                <div className={classes.stdName}>{rt.name}</div>
                <div className={classes.stdMeta}>
                  до {rt.maxOccupancy ?? '?'} чел.
                  {rt.basePrice != null && ` · базовая цена категории ${fmtRub(rt.basePrice)} ₽`}
                </div>
              </div>
              <div className={classes.priceInputWrap}>
                <input
                  className={classes.input}
                  type="number"
                  min="0"
                  step="0.01"
                  value={draft[rt.id] ?? ''}
                  placeholder="—"
                  onChange={(e) => setDraft((d) => ({ ...d, [rt.id]: e.target.value }))}
                />
                <span className={classes.priceCurrency}>₽</span>
              </div>
            </div>
          ))}
        </div>
      )}
      {error && <div style={{ padding: '8px 22px', color: '#DC2626', fontSize: 13 }}>{error}</div>}
      {roomTypes.length > 0 && (
        <div className={classes.sectionActions}>
          <button className={classes.btnPrimary} onClick={handleSave} disabled={!dirty || save.isPending || isLoading}>
            {save.isPending ? 'Сохранение...' : 'Сохранить базовые цены'}
          </button>
          {dirty && <button className={classes.btnGhost} onClick={() => setDraft(stdMap)}>Сбросить</button>}
          <span style={{ fontSize: 12, color: '#9CA3AF' }}>Пустое поле или 0 — без базовой цены</span>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Seasons — named date ranges with a price per category
// ─────────────────────────────────────────────────────────────────────────────
function Seasons({ plan, roomTypes }) {
  const { data: seasonRows = [], isLoading } = useSeasons(plan.id);
  const save = useReplaceSeasons();

  // Group flat rows back into seasons keyed by their identity.
  const initial = useMemo(() => {
    const map = new Map();
    seasonRows.forEach((r) => {
      const key = `${r.sortOrder}|${r.name}|${day10(r.dateFrom)}|${day10(r.dateTo)}`;
      if (!map.has(key)) {
        map.set(key, {
          name: r.name,
          color: r.color || SEASON_COLORS[0],
          dateFrom: day10(r.dateFrom),
          dateTo: day10(r.dateTo),
          sortOrder: r.sortOrder ?? 0,
          prices: {},
        });
      }
      map.get(key).prices[r.roomTypeId] = String(r.price);
    });
    return [...map.values()].sort((a, b) => a.sortOrder - b.sortOrder);
  }, [seasonRows]);

  const [list, setList] = useState(initial);
  const [error, setError] = useState(null);
  useEffect(() => { setList(initial); setError(null); }, [initial, plan.id]);

  const dirty = JSON.stringify(list) !== JSON.stringify(initial);

  const update = (idx, patch) => setList((l) => l.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  const updatePrice = (idx, rtId, v) =>
    setList((l) => l.map((s, i) => (i === idx ? { ...s, prices: { ...s.prices, [rtId]: v } } : s)));

  const addSeason = () => {
    const today = format(new Date(), 'yyyy-MM-dd');
    setList((l) => [
      ...l,
      { name: '', color: SEASON_COLORS[l.length % SEASON_COLORS.length], dateFrom: today, dateTo: today, sortOrder: l.length, prices: {} },
    ]);
  };
  const removeSeason = (idx) => setList((l) => l.filter((_, i) => i !== idx));

  const handleSave = async () => {
    setError(null);
    for (const s of list) {
      if (!s.name.trim()) return setError('У каждого сезона должно быть название');
      if (s.dateTo < s.dateFrom) return setError(`Сезон «${s.name}»: дата окончания раньше начала`);
    }
    const payload = {
      ratePlanId: plan.id,
      seasons: list.map((s, idx) => ({
        name: s.name.trim(),
        color: s.color,
        dateFrom: s.dateFrom,
        dateTo: s.dateTo,
        sortOrder: idx,
        items: roomTypes
          .filter((rt) => Number(s.prices[rt.id]) > 0)
          .map((rt) => ({ roomTypeId: rt.id, price: Number(s.prices[rt.id]) })),
      })),
    };
    try {
      await save.mutateAsync(payload);
    } catch (err) {
      const msg = err?.response?.data?.message;
      setError(Array.isArray(msg) ? msg.join(', ') : (msg ?? err.message ?? 'Ошибка'));
    }
  };

  return (
    <div>
      <div className={classes.sectionHint}>
        Сезон — это период (например, «Высокий сезон» или «Новогодние праздники») со своей ценой.
        В эти даты цена сезона заменяет базовую. Индивидуальные цены на конкретный день — в календаре — главнее сезона.
      </div>

      {roomTypes.length === 0 ? (
        <div className={classes.seasonsEmpty}>Сначала создайте категории номеров в разделе «Номера».</div>
      ) : list.length === 0 ? (
        <div className={classes.seasonsEmpty}>Сезонов пока нет. Добавьте первый, чтобы поднять или снизить цену на нужный период.</div>
      ) : (
        <div className={classes.seasonList}>
          {list.map((s, idx) => (
            <div key={idx} className={classes.seasonCard}>
              <div className={classes.seasonCardHead}>
                <input
                  type="color"
                  className={classes.colorInput}
                  value={s.color}
                  onChange={(e) => update(idx, { color: e.target.value })}
                  title="Цвет в календаре"
                />
                <input
                  className={`${classes.input} ${classes.seasonNameInput}`}
                  value={s.name}
                  placeholder="Название сезона"
                  onChange={(e) => update(idx, { name: e.target.value })}
                />
                <div className={classes.seasonDates}>
                  <input className={classes.input} type="date" value={s.dateFrom} onChange={(e) => update(idx, { dateFrom: e.target.value })} style={{ width: 150 }} />
                  <span>—</span>
                  <input className={classes.input} type="date" value={s.dateTo} onChange={(e) => update(idx, { dateTo: e.target.value })} style={{ width: 150 }} />
                </div>
                <button className={classes.seasonRemove} onClick={() => removeSeason(idx)}>Удалить</button>
              </div>
              <div className={classes.seasonPrices}>
                {roomTypes.map((rt) => (
                  <div key={rt.id} className={classes.seasonPriceRow}>
                    <label>{rt.name}</label>
                    <div className={classes.priceInputWrap}>
                      <input
                        className={classes.input}
                        type="number"
                        min="0"
                        step="0.01"
                        value={s.prices[rt.id] ?? ''}
                        placeholder="—"
                        onChange={(e) => updatePrice(idx, rt.id, e.target.value)}
                      />
                      <span className={classes.priceCurrency}>₽</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {error && <div style={{ padding: '8px 22px', color: '#DC2626', fontSize: 13 }}>{error}</div>}

      {roomTypes.length > 0 && (
        <div className={classes.sectionActions}>
          <button className={classes.btnGhost} onClick={addSeason}>+ Добавить сезон</button>
          <div style={{ flex: 1 }} />
          {dirty && <button className={classes.btnGhost} onClick={() => setList(initial)}>Отмена</button>}
          <button className={classes.btnPrimary} onClick={handleSave} disabled={!dirty || save.isPending || isLoading}>
            {save.isPending ? 'Сохранение...' : 'Сохранить сезоны'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FillModal — apply one price to a date range (per-day overrides)
// ─────────────────────────────────────────────────────────────────────────────
function FillModal({ roomTypes, defaultFrom, defaultTo, onFill, onClose, saving, error }) {
  const [form, setForm] = useState({
    roomTypeId: roomTypes[0]?.id ?? '',
    from: defaultFrom,
    to:   defaultTo,
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
            onClick={() => onFill({ roomTypeId: form.roomTypeId, fromDate: form.from, toDate: form.to, price: +form.price })}
          >
            {saving ? 'Применяется...' : 'Применить'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RateCalendar — month grid showing resolved prices (override → season → standard)
// ─────────────────────────────────────────────────────────────────────────────
function RateCalendar({ plan, roomTypes }) {
  // Rolling window like the шахматка: a week before today, then forward.
  const [viewStart, setViewStart] = useState(() => subDays(TODAY, 7));
  const [daysCount, setDaysCount] = useState(14);
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const [pickerYear, setPickerYear] = useState(() => getYear(TODAY));

  // Dynamic column width so the window fills the container — no horizontal scroll.
  const containerRef = useRef(null);
  const [dayWidth, setDayWidth] = useState(CAL_DAY_MIN);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      if (w > 0) setDayWidth(Math.max(CAL_DAY_MIN, (w - CAL_LABEL_W) / Math.min(daysCount, 31)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [daysCount]);

  const days = useMemo(
    () => Array.from({ length: daysCount }, (_, i) => addDays(viewStart, i)),
    [viewStart, daysCount],
  );
  const dayStrs = useMemo(() => days.map(d => format(d, 'yyyy-MM-dd')), [days]);
  const fromStr = dayStrs[0];
  const toStr   = dayStrs[dayStrs.length - 1];

  const { data: rates = [], isFetching } = useRates({ ratePlanId: plan.id, from: fromStr, to: toStr });
  const { data: standard = [] } = useStandardRates(plan.id);
  const { data: seasons = [] } = useSeasons(plan.id);
  const bulkUpsert = useBulkUpsertRates();
  const fillMutation = useFillRates();

  const resolve = useMemo(() => buildResolver(standard, seasons), [standard, seasons]);

  const SEP = '|';

  // Per-day manual overrides (Rate rows).
  const overrideMap = useMemo(() => {
    const map = {};
    rates.forEach(r => { map[`${r.roomTypeId}${SEP}${day10(r.date)}`] = String(r.price); });
    return map;
  }, [rates]);

  const [pending, setPending] = useState({});
  const [editingCell, setEditingCell] = useState(null);
  const [showFill, setShowFill] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [fillError, setFillError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => { setPending({}); setSaveError(null); }, [plan.id]);
  useEffect(() => { if (editingCell && inputRef.current) inputRef.current.focus(); }, [editingCell]);

  const isDirty = Object.keys(pending).length > 0;

  // Effective info for a cell: override (pending or saved) wins, else baseline.
  const cellInfo = (rtId, date) => {
    const key = `${rtId}${SEP}${date}`;
    const override = key in pending ? pending[key] : overrideMap[key];
    if (override != null && override !== '') {
      return { value: override, source: 'override' };
    }
    const base = resolve(rtId, date);
    if (base) return { value: base.price, source: base.source, season: base.season };
    return { value: '', source: 'none' };
  };

  const startEdit = (rtId, date) => {
    const key = `${rtId}${SEP}${date}`;
    setPending(p => ({ ...p, [key]: p[key] ?? overrideMap[key] ?? '' }));
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
        setPending(p => ({ ...p, [nextKey]: p[nextKey] ?? overrideMap[nextKey] ?? '' }));
        setEditingCell({ rtId, date: nextDate });
      }
    }
  };

  const handleSave = async () => {
    setSaveError(null);
    const items = Object.entries(pending).map(([key, priceStr]) => {
      const sepIdx = key.indexOf(SEP);
      return { ratePlanId: plan.id, roomTypeId: key.slice(0, sepIdx), date: key.slice(sepIdx + 1), price: Number(priceStr) || 0 };
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
      await fillMutation.mutateAsync({ ...data, ratePlanId: plan.id });
      setShowFill(false);
    } catch (err) {
      const msg = err?.response?.data?.message;
      setFillError(Array.isArray(msg) ? msg.join(', ') : (msg ?? err.message ?? 'Ошибка'));
    }
  };

  const todayStr = format(TODAY, 'yyyy-MM-dd');

  // Period navigation, mirroring the шахматка.
  const goToday = () => setViewStart(subDays(TODAY, 7));
  const navStep = daysCount === 14 ? 7 : 14;
  const prevPeriod = () => setViewStart(v => subDays(v, navStep));
  const nextPeriod = () => setViewStart(v => addDays(v, navStep));

  const viewEnd = days[days.length - 1] ?? viewStart;
  const monthLabel = (() => {
    const startLabel = format(viewStart, 'LLLL', { locale: ru }).replace(/^\w/, c => c.toUpperCase());
    if (getMonth(viewEnd) !== getMonth(viewStart)) {
      return `${startLabel} – ${format(viewEnd, 'LLLL', { locale: ru })} ${format(viewEnd, 'yyyy')}`;
    }
    return `${startLabel} ${format(viewStart, 'yyyy')}`;
  })();

  const gridWidth = CAL_LABEL_W + daysCount * dayWidth;

  return (
    <div>
      <div className={classes.sectionHint}>
        Календарь показывает итоговую цену каждого дня. <b style={{ color: '#1D4ED8' }}>Синим</b> — индивидуальная цена дня,
        цветная полоса сверху — действует сезон, серым — базовая цена. Нажмите на ячейку, чтобы задать цену конкретного дня.
      </div>

      <div className={classes.calendarRoot}>
        <div className={classes.calendarHeader}>
          <div className={classes.calMonth}>
            <button className={classes.calNavBtn} onClick={prevPeriod}>‹</button>
            <div className={classes.calMonthLabelWrap}>
              <button
                className={classes.calMonthLabelBtn}
                onClick={() => { setPickerYear(getYear(viewStart)); setShowMonthPicker(v => !v); }}
              >
                {monthLabel}
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 5 }}>
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
            <button className={classes.calNavBtn} onClick={nextPeriod}>›</button>
            <button className={classes.calTodayBtn} onClick={goToday}>Сегодня</button>
            <div className={classes.calDaysToggle}>
              {[14, 30].map(n => (
                <button
                  key={n}
                  className={`${classes.calDaysToggleBtn} ${daysCount === n ? classes.calDaysToggleActive : ''}`}
                  onClick={() => setDaysCount(n)}
                >{n} дн</button>
              ))}
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
                <span className={classes.calHint}>{isFetching ? 'Загрузка...' : 'Tab — следующий день'}</span>
                <button className={classes.btnGhost} onClick={() => setShowFill(true)} disabled={roomTypes.length === 0}>Заполнить диапазон</button>
              </>
            )}
          </div>
        </div>

        {saveError && (
          <div style={{ padding: '8px 4px', color: '#DC2626', fontSize: 13 }}>{saveError}</div>
        )}

        {roomTypes.length === 0 ? (
          <div className={classes.calendarEmpty}>Нет категорий номеров. Создайте категории в разделе «Номера».</div>
        ) : (
          <div className={classes.calendarScroll} ref={containerRef}>
            <div
              className={classes.calendarGrid}
              style={{ gridTemplateColumns: `${CAL_LABEL_W}px repeat(${daysCount}, ${dayWidth}px)`, width: gridWidth }}
            >
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

              {roomTypes.map(rt => (
                <React.Fragment key={rt.id}>
                  <div className={classes.calRowLabel}>
                    <div className={classes.calRoomTypeName}>{rt.name}</div>
                    <div className={classes.calRoomTypeMeta}>до {rt.maxOccupancy ?? '?'} чел.</div>
                  </div>
                  {dayStrs.map(d => {
                    const key = `${rt.id}${SEP}${d}`;
                    const isEditing = editingCell?.rtId === rt.id && editingCell?.date === d;
                    const info = cellInfo(rt.id, d);
                    const hasPending = key in pending;
                    const dow = parseISO(d).getDay();
                    const isWe = dow === 0 || dow === 6;
                    const isToday = d === todayStr;
                    const editVal = isEditing ? (pending[key] ?? '') : '';

                    return (
                      <div
                        key={d}
                        className={[
                          classes.calCell, classes.calCellRel,
                          isToday && classes.calCellToday,
                          isWe && classes.calCellWeekend,
                        ].filter(Boolean).join(' ')}
                        style={hasPending ? { background: '#FFFBEB' } : {}}
                        onClick={() => !isEditing && startEdit(rt.id, d)}
                        title={info.source === 'season' ? `Сезон: ${info.season?.name}` : undefined}
                      >
                        {info.source === 'season' && info.season?.color && (
                          <span className={classes.cellSeasonStripe} style={{ background: info.season.color }} />
                        )}
                        {isEditing ? (
                          <input
                            ref={inputRef}
                            className={classes.calInput}
                            style={{ width: '100%', boxSizing: 'border-box' }}
                            value={editVal}
                            placeholder={info.value ? fmtRub(info.value) : ''}
                            onChange={e => setPending(p => ({ ...p, [key]: e.target.value }))}
                            onBlur={e => commitCell(rt.id, d, e.target.value)}
                            onKeyDown={e => handleKeyDown(e, rt.id, d, editVal)}
                          />
                        ) : info.value !== '' ? (
                          <span className={
                            info.source === 'override' ? classes.cellOverride
                            : info.source === 'season' ? classes.cellSeason
                            : classes.cellStandard
                          }>
                            {fmtRub(info.value)}
                          </span>
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
          roomTypes={roomTypes}
          defaultFrom={fromStr}
          defaultTo={toStr}
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
// MonthPicker — popover for jumping the calendar window to a given month
// ─────────────────────────────────────────────────────────────────────────────
function MonthPicker({ year, onYearChange, onSelect, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div ref={ref} className={classes.calMonthPicker}>
      <div className={classes.calMonthPickerYear}>
        <button className={classes.calMonthPickerYearBtn} onClick={() => onYearChange(y => y - 1)}>‹</button>
        <span className={classes.calMonthPickerYearLabel}>{year}</span>
        <button className={classes.calMonthPickerYearBtn} onClick={() => onYearChange(y => y + 1)}>›</button>
      </div>
      <div className={classes.calMonthPickerGrid}>
        {MONTHS_RU.map((name, i) => (
          <button key={i} className={classes.calMonthPickerCell} onClick={() => onSelect(year, i)}>
            {name.slice(0, 3)}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PlanPanel — sub-tabs: базовые цены / сезоны / календарь
// ─────────────────────────────────────────────────────────────────────────────
function PlanPanel({ plan, roomTypes, onEditPlan }) {
  const [tab, setTab] = useState('standard');
  const { data: seasons = [] } = useSeasons(plan.id);
  const seasonCount = useMemo(() => {
    const set = new Set(seasons.map((s) => `${s.sortOrder}|${s.name}|${day10(s.dateFrom)}|${day10(s.dateTo)}`));
    return set.size;
  }, [seasons]);

  useEffect(() => { setTab('standard'); }, [plan.id]);

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
          <button className={classes.iconBtn} title="Редактировать план" onClick={onEditPlan}>
            <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
        </div>
      </div>

      <div className={classes.subTabs}>
        <button className={`${classes.subTab} ${tab === 'standard' ? classes.subTabActive : ''}`} onClick={() => setTab('standard')}>
          Базовые цены
        </button>
        <button className={`${classes.subTab} ${tab === 'seasons' ? classes.subTabActive : ''}`} onClick={() => setTab('seasons')}>
          Сезоны {seasonCount > 0 && <span className={classes.subTabBadge}>{seasonCount}</span>}
        </button>
        <button className={`${classes.subTab} ${tab === 'calendar' ? classes.subTabActive : ''}`} onClick={() => setTab('calendar')}>
          Календарь
        </button>
      </div>

      {plan.parentRatePlanId && (
        <div className={classes.inheritedNote}>
          Этот план наследует цены от базового. Цены, заданные здесь, переопределяют унаследованные.
        </div>
      )}

      {tab === 'standard' && <StandardPrices plan={plan} roomTypes={roomTypes} />}
      {tab === 'seasons' && <Seasons plan={plan} roomTypes={roomTypes} />}
      {tab === 'calendar' && (
        <RateCalendar plan={plan} roomTypes={roomTypes} />
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
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState(null);
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
            <PlanPanel
              key={selectedPlan.id}
              plan={selectedPlan}
              roomTypes={roomTypes}
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
