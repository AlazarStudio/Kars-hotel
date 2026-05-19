import { useEffect, useState } from 'react';
import Modal from '../../shared/Modal';
import formClasses from '../../shared/Form.module.css';
import { BED_TYPE_LABELS, ROOM_STATUS_CONFIG, ROOM_VIEW_LABELS } from '../../shared/status-config';

const EMPTY = {
  roomTypeId: '',
  number: '',
  floor: 1,
  capacity: 1,
  bedType: 'DOUBLE',
  view: 'NONE',
  status: 'CLEAN',
  notes: '',
};

/**
 * Modal for create/edit Room.
 *
 * Props:
 *   open: boolean
 *   editing: Room | null
 *   roomTypes: RoomType[]
 *   defaultRoomTypeId: string | undefined  (auto-select when creating from inside a category)
 *   onClose: () => void
 *   onSubmit: (payload) => Promise<void>
 */
export default function RoomFormModal({ open, editing, roomTypes, defaultRoomTypeId, onClose, onSubmit }) {
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setValues(
        editing
          ? {
              roomTypeId: editing.roomTypeId,
              number: editing.number,
              floor: editing.floor,
              capacity: editing.capacity ?? 1,
              bedType: editing.bedType,
              view: editing.view,
              status: editing.status,
              notes: editing.notes ?? '',
            }
          : {
              ...EMPTY,
              roomTypeId: defaultRoomTypeId ?? roomTypes?.[0]?.id ?? '',
            },
      );
      setErrors({});
      setServerError(null);
    }
  }, [open, editing, defaultRoomTypeId, roomTypes]);

  const set = (k, v) => setValues((p) => ({ ...p, [k]: v }));

  const validate = () => {
    const e = {};
    if (!values.roomTypeId) e.roomTypeId = 'Выберите категорию';
    if (!values.number || values.number.trim().length === 0) e.number = 'Обязательно';
    if (values.number && values.number.length > 16) e.number = 'Максимум 16 символов';
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
        roomTypeId: values.roomTypeId,
        number: values.number.trim(),
        floor: Number(values.floor),
        capacity: Number(values.capacity) || 1,
        bedType: values.bedType,
        view: values.view,
        status: values.status,
        notes: values.notes?.trim() || undefined,
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
      title={editing ? `Номер №${editing.number}` : 'Новый номер'}
      onClose={busy ? undefined : onClose}
      footer={
        <>
          <button type="button" className={formClasses.btnSecondary} onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button type="submit" form="room-form" className={formClasses.btnPrimary} disabled={busy}>
            {busy ? 'Сохраняем…' : 'Сохранить'}
          </button>
        </>
      }
    >
      <form id="room-form" onSubmit={handleSubmit} noValidate>
        {serverError && <div className={formClasses.alert}>{serverError}</div>}

        <div className={formClasses.row}>
          <div className={formClasses.field}>
            <label className={formClasses.label}>Категория</label>
            <select
              className={formClasses.select}
              value={values.roomTypeId}
              onChange={(e) => set('roomTypeId', e.target.value)}
              aria-invalid={errors.roomTypeId ? 'true' : 'false'}
            >
              <option value="">— выбрать —</option>
              {roomTypes?.map((rt) => (
                <option key={rt.id} value={rt.id}>{rt.name}</option>
              ))}
            </select>
            {errors.roomTypeId && <div className={formClasses.fieldError}>{errors.roomTypeId}</div>}
          </div>
          <div className={formClasses.field}>
            <label className={formClasses.label}>Номер</label>
            <input
              className={formClasses.input}
              type="text"
              value={values.number}
              onChange={(e) => set('number', e.target.value)}
              aria-invalid={errors.number ? 'true' : 'false'}
              placeholder="101"
              maxLength={16}
            />
            {errors.number && <div className={formClasses.fieldError}>{errors.number}</div>}
          </div>
        </div>

        <div className={formClasses.row3}>
          <div className={formClasses.field}>
            <label className={formClasses.label}>Этаж</label>
            <input
              className={formClasses.input}
              type="number"
              value={values.floor}
              onChange={(e) => set('floor', e.target.value)}
            />
          </div>
          <div className={formClasses.field}>
            <label className={formClasses.label}>Мест</label>
            <input
              className={formClasses.input}
              type="number"
              min={1}
              max={10}
              value={values.capacity}
              onChange={(e) => set('capacity', e.target.value)}
            />
          </div>
          <div className={formClasses.field}>
            <label className={formClasses.label}>Кровать</label>
            <select
              className={formClasses.select}
              value={values.bedType}
              onChange={(e) => set('bedType', e.target.value)}
            >
              {Object.entries(BED_TYPE_LABELS).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className={formClasses.row}>
          <div className={formClasses.field}>
            <label className={formClasses.label}>Вид</label>
            <select
              className={formClasses.select}
              value={values.view}
              onChange={(e) => set('view', e.target.value)}
            >
              {Object.entries(ROOM_VIEW_LABELS).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className={formClasses.field}>
          <label className={formClasses.label}>Статус уборки</label>
          <select
            className={formClasses.select}
            value={values.status}
            onChange={(e) => set('status', e.target.value)}
          >
            {Object.entries(ROOM_STATUS_CONFIG).map(([k, cfg]) => (
              <option key={k} value={k}>{cfg.label}</option>
            ))}
          </select>
        </div>

        <div className={formClasses.field}>
          <label className={formClasses.label}>Заметки</label>
          <textarea
            className={formClasses.textarea}
            value={values.notes}
            onChange={(e) => set('notes', e.target.value)}
            placeholder="Угловой, тише соседних, ремонт в ноябре"
          />
        </div>
      </form>
    </Modal>
  );
}
