import { useEffect, useState } from 'react';
import Modal from '../../shared/Modal';
import formClasses from '../../shared/Form.module.css';

/**
 * Form to set the SAME price for every date in [from, to] for one (roomType, occupancy).
 * Used as the productivity shortcut "apply 3800 ₽ to next 30 days for Стандарт".
 */
export default function FillRatesModal({ open, ratePlan, roomTypes, defaultRoomTypeId, onClose, onSubmit }) {
  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

  const [values, setValues] = useState({
    roomTypeId: defaultRoomTypeId || '',
    fromDate: today,
    toDate: in30,
    occupancy: 2,
    price: '',
  });
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (open) {
      setValues({
        roomTypeId: defaultRoomTypeId || roomTypes?.[0]?.id || '',
        fromDate: today,
        toDate: in30,
        occupancy: 2,
        price: '',
      });
      setErrors({});
      setServerError(null);
      setResult(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultRoomTypeId]);

  const set = (k, v) => setValues((p) => ({ ...p, [k]: v }));

  const handleSubmit = async (ev) => {
    ev.preventDefault();
    const e = {};
    if (!values.roomTypeId) e.roomTypeId = 'Выберите категорию';
    if (!values.fromDate) e.fromDate = 'Обязательно';
    if (!values.toDate) e.toDate = 'Обязательно';
    if (values.toDate && values.fromDate && values.toDate < values.fromDate) e.toDate = 'Должно быть ≥ начала';
    if (values.price === '' || Number(values.price) < 0) e.price = 'Введите цену ≥ 0';
    setErrors(e);
    if (Object.keys(e).length > 0) return;

    setBusy(true);
    setServerError(null);
    try {
      const out = await onSubmit({
        ratePlanId: ratePlan.id,
        roomTypeId: values.roomTypeId,
        fromDate: values.fromDate,
        toDate: values.toDate,
        occupancy: Number(values.occupancy),
        price: Number(values.price),
      });
      setResult(out);
    } catch (err) {
      const msg = err?.response?.data?.message || err?.message || 'Не удалось применить';
      setServerError(Array.isArray(msg) ? msg.join(', ') : msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={`Заполнить цены — тариф «${ratePlan?.name ?? ''}»`}
      onClose={busy ? undefined : onClose}
      footer={
        result ? (
          <button type="button" className={formClasses.btnPrimary} onClick={onClose}>
            Готово
          </button>
        ) : (
          <>
            <button type="button" className={formClasses.btnSecondary} onClick={onClose} disabled={busy}>
              Отмена
            </button>
            <button type="submit" form="fill-form" className={formClasses.btnPrimary} disabled={busy}>
              {busy ? 'Применяем…' : 'Применить'}
            </button>
          </>
        )
      }
    >
      {result ? (
        <div style={{ padding: 8 }}>
          <div style={{ fontSize: 15, color: '#0F1F3F', marginBottom: 8 }}>
            ✓ Цены обновлены: <strong>{result.written}</strong> дней.
          </div>
          <div style={{ fontSize: 13, color: '#6B7280' }}>
            Теперь они появятся в календаре под этим тарифом.
          </div>
        </div>
      ) : (
        <form id="fill-form" onSubmit={handleSubmit} noValidate>
          {serverError && <div className={formClasses.alert}>{serverError}</div>}

          <div className={formClasses.field}>
            <label className={formClasses.label}>Категория номера</label>
            <select
              className={formClasses.select}
              value={values.roomTypeId}
              onChange={(e) => set('roomTypeId', e.target.value)}
              aria-invalid={errors.roomTypeId ? 'true' : 'false'}
            >
              <option value="">— выберите —</option>
              {roomTypes?.map((rt) => (
                <option key={rt.id} value={rt.id}>{rt.name}</option>
              ))}
            </select>
            {errors.roomTypeId && <div className={formClasses.fieldError}>{errors.roomTypeId}</div>}
          </div>

          <div className={formClasses.row}>
            <div className={formClasses.field}>
              <label className={formClasses.label}>С даты</label>
              <input
                className={formClasses.input}
                type="date"
                value={values.fromDate}
                onChange={(e) => set('fromDate', e.target.value)}
                aria-invalid={errors.fromDate ? 'true' : 'false'}
              />
              {errors.fromDate && <div className={formClasses.fieldError}>{errors.fromDate}</div>}
            </div>
            <div className={formClasses.field}>
              <label className={formClasses.label}>По дату (включительно)</label>
              <input
                className={formClasses.input}
                type="date"
                value={values.toDate}
                onChange={(e) => set('toDate', e.target.value)}
                aria-invalid={errors.toDate ? 'true' : 'false'}
              />
              {errors.toDate && <div className={formClasses.fieldError}>{errors.toDate}</div>}
            </div>
          </div>

          <div className={formClasses.row}>
            <div className={formClasses.field}>
              <label className={formClasses.label}>Цена за ночь (₽)</label>
              <input
                className={formClasses.input}
                type="number"
                step="0.01"
                value={values.price}
                onChange={(e) => set('price', e.target.value)}
                placeholder="3800"
                aria-invalid={errors.price ? 'true' : 'false'}
                autoFocus
              />
              {errors.price && <div className={formClasses.fieldError}>{errors.price}</div>}
            </div>
            <div className={formClasses.field}>
              <label className={formClasses.label}>Размещение</label>
              <input
                className={formClasses.input}
                type="number"
                min={1}
                max={10}
                value={values.occupancy}
                onChange={(e) => set('occupancy', Number(e.target.value))}
              />
              <div className={formClasses.hint}>Обычно 2 для двухместного</div>
            </div>
          </div>
        </form>
      )}
    </Modal>
  );
}
