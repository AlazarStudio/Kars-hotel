import { useState } from 'react';
import Modal from './Modal';
import formClasses from './Form.module.css';

/**
 * Reusable confirm dialog with an async action handler. Shows a spinner / disables
 * buttons while `onConfirm` is in flight; surfaces server errors inline.
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Подтвердить',
  cancelLabel = 'Отмена',
  danger = false,
  onClose,
  onConfirm,
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const handleConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm?.();
      onClose?.();
    } catch (e) {
      const msg = e?.response?.data?.message || e?.message || 'Что-то пошло не так';
      setError(Array.isArray(msg) ? msg.join(', ') : msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title={title}
      onClose={busy ? undefined : onClose}
      width="sm"
      footer={
        <>
          <button
            type="button"
            className={formClasses.btnSecondary}
            onClick={onClose}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? formClasses.btnDanger : formClasses.btnPrimary}
            onClick={handleConfirm}
            disabled={busy}
          >
            {busy ? '…' : confirmLabel}
          </button>
        </>
      }
    >
      {error && <div className={formClasses.alert}>{error}</div>}
      <div style={{ fontSize: 14, color: '#374151', lineHeight: 1.5 }}>{message}</div>
    </Modal>
  );
}
