import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Modal from '../../shared/Modal';
import formClasses from '../../shared/Form.module.css';
import {
  uploadRoomTypePhoto,
  deleteRoomTypePhoto,
} from '../../../../api/roomTypes';

const EMPTY = {
  code: '',
  name: '',
  description: '',
  baseOccupancy: 2,
  maxOccupancy: 2,
  extraBeds: 0,
  basePrice: 0,
};

const readPhotos = (rt) => (Array.isArray(rt?.photos) ? rt.photos.filter((p) => typeof p === 'string') : []);

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
  const [photos, setPhotos] = useState([]);
  // Files chosen in CREATE mode before the category exists. They're held in
  // memory (with object-URL previews) and uploaded right after the category is
  // created on submit — so the user can add photos straight away.
  const [staged, setStaged] = useState([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState(null);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const fileRef = useRef(null);
  // Survives across a retry so a failed photo upload never recreates the category.
  const createdIdRef = useRef(null);
  const qc = useQueryClient();

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
      setPhotos(readPhotos(editing));
      setStaged((prev) => {
        prev.forEach((s) => URL.revokeObjectURL(s.url));
        return [];
      });
      createdIdRef.current = null;
      setErrors({});
      setServerError(null);
      setPhotoError(null);
    }
  }, [open, editing]);

  const set = (k, v) => setValues((p) => ({ ...p, [k]: v }));

  const handlePickFile = async (ev) => {
    const files = Array.from(ev.target.files ?? []);
    if (fileRef.current) fileRef.current.value = ''; // allow re-picking the same file
    if (!files.length) return;

    // Create mode: stage locally, upload happens on save.
    if (!editing) {
      setStaged((prev) => [
        ...prev,
        ...files.map((file) => ({
          key: `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`,
          file,
          url: URL.createObjectURL(file),
        })),
      ]);
      return;
    }

    // Edit mode: upload immediately to the existing category.
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      let next;
      for (const file of files) {
        ({ photos: next } = await uploadRoomTypePhoto(editing.id, file));
      }
      if (next) setPhotos(next);
      qc.invalidateQueries({ queryKey: ['roomTypes'] });
    } catch (e) {
      const msg = e?.response?.data?.message || e?.message || 'Не удалось загрузить фото';
      setPhotoError(Array.isArray(msg) ? msg.join(', ') : msg);
    } finally {
      setPhotoBusy(false);
    }
  };

  const handleRemovePhoto = async (url) => {
    if (!editing) return;
    setPhotoBusy(true);
    setPhotoError(null);
    try {
      const { photos: next } = await deleteRoomTypePhoto(editing.id, url);
      setPhotos(next);
      qc.invalidateQueries({ queryKey: ['roomTypes'] });
    } catch (e) {
      const msg = e?.response?.data?.message || e?.message || 'Не удалось удалить фото';
      setPhotoError(Array.isArray(msg) ? msg.join(', ') : msg);
    } finally {
      setPhotoBusy(false);
    }
  };

  const handleRemoveStaged = (key) => {
    setStaged((prev) => {
      const hit = prev.find((s) => s.key === key);
      if (hit) URL.revokeObjectURL(hit.url);
      return prev.filter((s) => s.key !== key);
    });
  };

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
      // Create the category once. createdIdRef survives a failed photo upload so
      // a retry uploads the leftover photos instead of creating a duplicate.
      let createdId = createdIdRef.current;
      if (!createdId) {
        const created = await onSubmit({
          code: values.code.trim(),
          name: values.name.trim(),
          description: values.description?.trim() || undefined,
          baseOccupancy: Number(values.baseOccupancy),
          maxOccupancy: Number(values.maxOccupancy),
          extraBeds: Number(values.extraBeds),
          basePrice: Number(values.basePrice),
        });
        // Edit mode: onSubmit resolves without an entity — nothing more to do here.
        createdId = editing ? editing.id : created?.id ?? null;
        if (!editing) createdIdRef.current = createdId;
      }

      // Upload any photos staged during create mode against the freshly made id.
      if (!editing && createdId && staged.length) {
        setUploadingPhotos(true);
        for (const item of staged) {
          await uploadRoomTypePhoto(createdId, item.file);
          // Drop each uploaded item so a retry only re-sends what failed.
          setStaged((prev) => prev.filter((s) => s.key !== item.key));
          URL.revokeObjectURL(item.url);
        }
        qc.invalidateQueries({ queryKey: ['roomTypes'] });
      }

      onClose?.();
    } catch (e) {
      const msg = e?.response?.data?.message || e?.message || 'Не удалось сохранить';
      setServerError(Array.isArray(msg) ? msg.join(', ') : msg);
    } finally {
      setUploadingPhotos(false);
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
            {uploadingPhotos ? 'Загружаем фото…' : busy ? 'Сохраняем…' : 'Сохранить'}
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

        <div className={formClasses.field}>
          <label className={formClasses.label}>Фотографии</label>
          <div style={photoGridStyle}>
            {/* Edit mode: already-uploaded photos. */}
            {photos.map((url) => (
              <div key={url} style={photoThumbStyle}>
                <img src={url} alt="" style={photoImgStyle} loading="lazy" />
                <button
                  type="button"
                  title="Удалить фото"
                  onClick={() => handleRemovePhoto(url)}
                  disabled={photoBusy || busy}
                  style={photoRemoveStyle}
                >
                  ×
                </button>
              </div>
            ))}
            {/* Create mode: photos staged locally, uploaded on save. */}
            {staged.map((s) => (
              <div key={s.key} style={photoThumbStyle}>
                <img src={s.url} alt="" style={photoImgStyle} />
                <button
                  type="button"
                  title="Убрать фото"
                  onClick={() => handleRemoveStaged(s.key)}
                  disabled={busy}
                  style={photoRemoveStyle}
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={photoBusy || busy}
              style={photoAddStyle}
            >
              {photoBusy ? '…' : '＋'}
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={handlePickFile}
            style={{ display: 'none' }}
          />
          <div className={formClasses.hint}>
            JPEG, PNG, WebP или GIF, до 5 МБ. Эти фото уходят партнёрам по API.
            {!editing && ' Загрузятся сразу после сохранения категории.'}
          </div>
          {photoError && <div className={formClasses.fieldError}>{photoError}</div>}
        </div>
      </form>
    </Modal>
  );
}

const photoGridStyle = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  marginBottom: 6,
};
const photoThumbStyle = {
  position: 'relative',
  width: 84,
  height: 84,
  borderRadius: 8,
  overflow: 'hidden',
  border: '1px solid var(--border, #d0d5dd)',
};
const photoImgStyle = { width: '100%', height: '100%', objectFit: 'cover', display: 'block' };
const photoRemoveStyle = {
  position: 'absolute',
  top: 2,
  right: 2,
  width: 20,
  height: 20,
  borderRadius: '50%',
  border: 'none',
  background: 'rgba(0,0,0,0.6)',
  color: '#fff',
  fontSize: 14,
  lineHeight: '20px',
  cursor: 'pointer',
  padding: 0,
};
const photoAddStyle = {
  width: 84,
  height: 84,
  borderRadius: 8,
  border: '1px dashed var(--border, #d0d5dd)',
  background: 'transparent',
  fontSize: 28,
  color: 'var(--text-muted, #667085)',
  cursor: 'pointer',
};
