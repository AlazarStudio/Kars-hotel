import { useEffect, useState } from 'react';
import Modal from '../../shared/Modal';
import formClasses from '../../shared/Form.module.css';

const EMPTY = {
  code: '',
  name: '',
  description: '',
  baseOccupancy: 2,
  maxOccupancy: 2,
  extraBeds: 0,
  basePrice: 0,
};

/**
 * Modal for create/edit RoomType.
 *
 * Props:
 *   open: boolean
 *   editing: RoomType | null  (null = create mode)
 *   onClose: () => void
 *   onSubmit: (payload) => Promise<void>
 */
export default function RoomTypeFormModal({ open, editing, onClose, onSubmit }) {
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
              baseOccupancy: editing.baseOccupancy,
              maxOccupancy: editing.maxOccupancy,
              extraBeds: editing.extraBeds,
              basePrice: Number(editing.basePrice ?? 0),
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
    if (!/^[A-Z0-9_-]{2,32}$/.test(values.code)) {
      e.code = 'Только A-Z, 0-9, _ и -, 2–32 символа';
    }
    if (!values.name || values.name.trim().length < 2) e.name = 'Минимум 2 символа';
    if (values.baseOccupancy < 1 || values.baseOccupancy > 10)
      e.baseOccupancy = 'От 1 до 10';
    if (values.maxOccupancy < values.baseOccupancy)
      e.maxOccupancy = 'Не меньше базовой';
    if (values.basePrice < 0) e.basePrice = 'Не отрицательно';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    if (!validate()) return;
    setBusy(true);
    setServerError(null);
    try {
      await onSubmit({
        code: values.code.trim(),
        name: values.name.trim(),
        description: values.description?.trim() || undefined,
        baseOccupancy: Number(values.baseOccupancy),
        maxOccupancy: Number(values.maxOccupancy),
        extraBeds: Number(values.extraBeds),
        basePrice: Number(values.basePrice),
      });
      onClose?.();
    } catch (e) {
      const msg = e?.response?.data?.message || e?.message || 'Не удалось сохранить';
      setServerError(Array.isArray(msg) ? msg.join(', ') : msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={editing ? `Редактировать «${editing.name}»` : 'Новая категория'}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <button type="button" className={formClasses.btnSecondary} onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button type="submit" form="rt-form" className={formClasses.btnPrimary} disabled={busy}>
            {busy ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </>
      }
    >
      <form id="rt-form" onSubmit={handleSubmit} noValidate>
        {serverError && <div className={formClasses.alert}>{serverError}</div>}

        <div className={formClasses.row}>
          <div className={formClasses.field}>
            <label className={formClasses.label}>Код</label>
            <input
              className={formClasses.input}
              type="text"
              value={values.code}
              onChange={(e) => set('code', e.target.value.toUpperCase())}
              disabled={!!editing}
              aria-invalid={errors.code ? 'true' : 'false'}
              placeholder="STD"
              autoFocus={!editing}
            />
            <div className={formClasses.hint}>Не меняется после создания</div>
            {errors.code && <div className={formClasses.fieldError}>{errors.code}</div>}
          </div>
          <div className={formClasses.field}>
            <label className={formClasses.label}>Название</label>
            <input
              className={formClasses.input}
              type="text"
              value={values.name}
              onChange={(e) => set('name', e.target.value)}
              aria-invalid={errors.name ? 'true' : 'false'}
              placeholder="Стандарт"
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
            placeholder="Уютный номер с двуспальной кроватью…"
          />
        </div>

        <div className={formClasses.row3}>
          <div className={formClasses.field}>
            <label className={formClasses.label}>Базовое размещение</label>
            <input
              className={formClasses.input}
              type="number"
              min={1}
              max={10}
              value={values.baseOccupancy}
              onChange={(e) => set('baseOccupancy', Number(e.target.value))}
              aria-invalid={errors.baseOccupancy ? 'true' : 'false'}
            />
            {errors.baseOccupancy && <div className={formClasses.fieldError}>{errors.baseOccupancy}</div>}
          </div>
          <div className={formClasses.field}>
            <label className={formClasses.label}>Макс. размещение</label>
            <input
              className={formClasses.input}
              type="number"
              min={1}
              max={10}
              value={values.maxOccupancy}
              onChange={(e) => set('maxOccupancy', Number(e.target.value))}
              aria-invalid={errors.maxOccupancy ? 'true' : 'false'}
            />
            {errors.maxOccupancy && <div className={formClasses.fieldError}>{errors.maxOccupancy}</div>}
          </div>
          <div className={formClasses.field}>
            <label className={formClasses.label}>Доп. кровати</label>
            <input
              className={formClasses.input}
              type="number"
              min={0}
              max={10}
              value={values.extraBeds}
              onChange={(e) => set('extraBeds', Number(e.target.value))}
            />
          </div>
        </div>

        <div className={formClasses.field}>
          <label className={formClasses.label}>Базовая цена за ночь (₽)</label>
          <input
            className={formClasses.input}
            type="number"
            min={0}
            step="0.01"
            value={values.basePrice}
            onChange={(e) => set('basePrice', Number(e.target.value))}
            aria-invalid={errors.basePrice ? 'true' : 'false'}
          />
          <div className={formClasses.hint}>
            Эта цена временная — реальное тарификование появится на Фазе E.
          </div>
          {errors.basePrice && <div className={formClasses.fieldError}>{errors.basePrice}</div>}
        </div>
      </form>
    </Modal>
  );
}
