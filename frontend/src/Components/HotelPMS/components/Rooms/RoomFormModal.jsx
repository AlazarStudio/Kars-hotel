import { useEffect, useState } from 'react';
import Modal from '../../shared/Modal';
import formClasses from '../../shared/Form.module.css';
import {
  PARTNER_HOLD_CONFIG,
  ROOM_STATUS_CONFIG,
  ROOM_VIEW_LABELS,
} from '../../shared/status-config';

/* Поля кроватей номера — в порядке формы; первые три — спальные места. */
const BEDS = [
  ['singleBeds', 'Односпальных'],
  ['doubleBeds', 'Двуспальных'],
  ['sofas', 'Диванов'],
  ['extraBeds', 'Доп. кроватей'],
];

const EMPTY = {
  roomTypeId: '',
  number: '',
  floor: 1,
  capacity: 1,
  singleBeds: 0,
  doubleBeds: 1,
  sofas: 0,
  extraBeds: 0,
  view: 'NONE',
  status: 'CLEAN',
  partnerHold: 'NONE',
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
 *   onDelete: (() => void) | undefined  (only when editing; opens the confirm dialog)
 */
export default function RoomFormModal({ open, editing, roomTypes, defaultRoomTypeId, onClose, onSubmit, onDelete }) {
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
              singleBeds: editing.singleBeds ?? 0,
              doubleBeds: editing.doubleBeds ?? 0,
              sofas: editing.sofas ?? 0,
              extraBeds: editing.extraBeds ?? 0,
              view: editing.view,
              status: editing.status,
              partnerHold: editing.partnerHold ?? 'NONE',
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
    // Тот же предел, что на сервере (CreateRoomDto): номер бывает и адресом квартиры.
    if (values.number && values.number.length > 100) e.number = 'Максимум 100 символов';
    const beds = BEDS.map(([k]) => Number(values[k]));
    if (beds.some((n) => !Number.isInteger(n) || n < 0 || n > 20)) e.beds = 'Целое число от 0 до 20';
    else if (beds[0] + beds[1] + beds[2] === 0) e.beds = 'Укажите хотя бы одну кровать или диван';
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
        singleBeds: Number(values.singleBeds),
        doubleBeds: Number(values.doubleBeds),
        sofas: Number(values.sofas),
        extraBeds: Number(values.extraBeds),
        view: values.view,
        status: values.status,
        partnerHold: values.partnerHold,
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
          {editing && onDelete && (
            <button type="button" className={formClasses.btnDangerGhost} onClick={onDelete} disabled={busy}>
              Удалить номер
            </button>
          )}
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
              maxLength={100}
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

        {/* Кровати числами (27.10.2026): из одного списка нельзя было сказать
            «двуспальная и диван». Доп. кровати — здесь, у номера: в одной
            категории они есть не у всех номеров. */}
        <div className={formClasses.row4}>
          {BEDS.map(([k, label]) => (
            <div key={k} className={formClasses.field}>
              <label className={formClasses.label}>{label}</label>
              <input
                className={formClasses.input}
                type="number"
                min={0}
                max={20}
                value={values[k]}
                onChange={(e) => set(k, e.target.value)}
                aria-invalid={errors.beds ? 'true' : 'false'}
              />
            </div>
          ))}
        </div>
        {errors.beds && <div className={formClasses.fieldError}>{errors.beds}</div>}

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

        {/* А3 · договорный блок. Стоит рядом со статусом уборки, а не в
            отдельной вкладке: это свойство номера, и вспоминают о нём тогда
            же, когда правят остальное. Подпись объясняет разницу между
            квотой и резервом прямо здесь — иначе выбор делается наугад. */}
        <div className={formClasses.field}>
          <label className={formClasses.label}>Договорный блок</label>
          <select
            className={formClasses.select}
            value={values.partnerHold}
            onChange={(e) => set('partnerHold', e.target.value)}
          >
            {Object.entries(PARTNER_HOLD_CONFIG).map(([k, cfg]) => (
              <option key={k} value={k}>{cfg.label}</option>
            ))}
          </select>
          <div className={formClasses.hint}>
            {PARTNER_HOLD_CONFIG[values.partnerHold]?.hint ??
              'Номер не держится ни за кем по договору'}
          </div>
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
