import { useEffect, useState } from 'react';
import Modal from '../../shared/Modal';
import formClasses from '../../shared/Form.module.css';

const MEAL_PLANS = [
  { value: 'NONE', label: 'Без питания' },
  { value: 'BB', label: 'Завтрак (BB)' },
  { value: 'HB', label: 'Завтрак + ужин (HB)' },
  { value: 'FB', label: 'Полный пансион (FB)' },
  { value: 'AI', label: 'Всё включено (AI)' },
];

const EMPTY = {
  code: '',
  name: '',
  description: '',
  mealPlan: 'NONE',
  occupancyPricing: false,
  parentRatePlanId: '',
  priceModifierType: 'PERCENT',
  priceModifierValue: 0,
};

export default function RatePlanFormModal({ open, editing, ratePlans, onClose, onSubmit }) {
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setValues(
        editing
          ? {
              code: editing.code,
              name: editing.name,
              description: editing.description ?? '',
              mealPlan: editing.mealPlan,
              occupancyPricing: editing.occupancyPricing,
              parentRatePlanId: editing.parentRatePlanId ?? '',
              priceModifierType: editing.priceModifierType,
              priceModifierValue: Number(editing.priceModifierValue ?? 0),
            }
          : EMPTY,
      );
      setErrors({});
      setServerError(null);
    }
  }, [open, editing]);

  const set = (k, v) => setValues((p) => ({ ...p, [k]: v }));

  const validate = () => {
    const e = {};
    if (!/^[A-Z0-9_-]{2,32}$/.test(values.code)) e.code = 'Только A-Z, 0-9, _, -, 2–32 символа';
    if (!values.name || values.name.trim().length < 2) e.name = 'Минимум 2 символа';
    if (values.parentRatePlanId && editing && values.parentRatePlanId === editing.id) {
      e.parentRatePlanId = 'Тариф не может быть родителем сам себе';
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    if (!validate()) return;
    setBusy(true);
    setServerError(null);
    try {
      const payload = {
        code: values.code.trim(),
        name: values.name.trim(),
        description: values.description?.trim() || undefined,
        mealPlan: values.mealPlan,
        occupancyPricing: !!values.occupancyPricing,
        parentRatePlanId: values.parentRatePlanId || undefined,
        priceModifierType: values.priceModifierType,
        priceModifierValue: Number(values.priceModifierValue) || 0,
      };
      await onSubmit(payload);
      onClose?.();
    } catch (e) {
      const msg = e?.response?.data?.message || e?.message || 'Не удалось сохранить';
      setServerError(Array.isArray(msg) ? msg.join(', ') : msg);
    } finally {
      setBusy(false);
    }
  };

  // Don't list children of the edited plan as candidate parents (cycle prevention).
  const parentCandidates = (ratePlans || []).filter(
    (rp) => !editing || rp.id !== editing.id,
  );

  return (
    <Modal
      open={open}
      title={editing ? `Редактировать «${editing.name}»` : 'Новый тариф'}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <button type="button" className={formClasses.btnSecondary} onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button type="submit" form="rp-form" className={formClasses.btnPrimary} disabled={busy}>
            {busy ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </>
      }
    >
      <form id="rp-form" onSubmit={handleSubmit} noValidate>
        {serverError && <div className={formClasses.alert}>{serverError}</div>}

        <div className={formClasses.row}>
          <div className={formClasses.field}>
            <label className={formClasses.label}>Код</label>
            <input
              className={formClasses.input}
              value={values.code}
              onChange={(e) => set('code', e.target.value.toUpperCase())}
              disabled={!!editing}
              aria-invalid={errors.code ? 'true' : 'false'}
              placeholder="STD_RATE"
              autoFocus={!editing}
            />
            <div className={formClasses.hint}>Не меняется после создания</div>
            {errors.code && <div className={formClasses.fieldError}>{errors.code}</div>}
          </div>
          <div className={formClasses.field}>
            <label className={formClasses.label}>Название</label>
            <input
              className={formClasses.input}
              value={values.name}
              onChange={(e) => set('name', e.target.value)}
              aria-invalid={errors.name ? 'true' : 'false'}
              placeholder="Стандартный тариф"
              autoFocus={!!editing}
            />
            {errors.name && <div className={formClasses.fieldError}>{errors.name}</div>}
          </div>
        </div>

        <div className={formClasses.field}>
          <label className={formClasses.label}>Описание</label>
          <textarea
            className={formClasses.textarea}
            value={values.description}
            onChange={(e) => set('description', e.target.value)}
            placeholder="Тариф для прямых броней без предоплаты"
          />
        </div>

        <div className={formClasses.row}>
          <div className={formClasses.field}>
            <label className={formClasses.label}>Питание</label>
            <select
              className={formClasses.select}
              value={values.mealPlan}
              onChange={(e) => set('mealPlan', e.target.value)}
            >
              {MEAL_PLANS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
          <div className={formClasses.field}>
            <label className={formClasses.label}>Цены по occupancy</label>
            <div style={{ display: 'flex', alignItems: 'center', height: 38, gap: 8 }}>
              <input
                type="checkbox"
                checked={!!values.occupancyPricing}
                onChange={(e) => set('occupancyPricing', e.target.checked)}
                id="occPricing"
              />
              <label htmlFor="occPricing" style={{ fontSize: 13, color: '#374151', cursor: 'pointer' }}>
                Разные цены для разного числа гостей
              </label>
            </div>
          </div>
        </div>

        <div className={formClasses.field}>
          <label className={formClasses.label}>Родительский тариф (наследование)</label>
          <select
            className={formClasses.select}
            value={values.parentRatePlanId}
            onChange={(e) => set('parentRatePlanId', e.target.value)}
            aria-invalid={errors.parentRatePlanId ? 'true' : 'false'}
          >
            <option value="">— Нет (свои цены) —</option>
            {parentCandidates.map((rp) => (
              <option key={rp.id} value={rp.id}>{rp.name} ({rp.code})</option>
            ))}
          </select>
          <div className={formClasses.hint}>
            Если выбран — цены наследуются от родителя, с модификатором ниже.
          </div>
          {errors.parentRatePlanId && <div className={formClasses.fieldError}>{errors.parentRatePlanId}</div>}
        </div>

        {values.parentRatePlanId && (
          <div className={formClasses.row}>
            <div className={formClasses.field}>
              <label className={formClasses.label}>Тип модификатора</label>
              <select
                className={formClasses.select}
                value={values.priceModifierType}
                onChange={(e) => set('priceModifierType', e.target.value)}
              >
                <option value="PERCENT">Процент (%)</option>
                <option value="ABSOLUTE">Сумма (₽)</option>
              </select>
            </div>
            <div className={formClasses.field}>
              <label className={formClasses.label}>
                Значение {values.priceModifierType === 'PERCENT' ? '(например -20 = скидка 20%)' : '(₽)'}
              </label>
              <input
                className={formClasses.input}
                type="number"
                step="0.01"
                value={values.priceModifierValue}
                onChange={(e) => set('priceModifierValue', e.target.value)}
              />
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
}
