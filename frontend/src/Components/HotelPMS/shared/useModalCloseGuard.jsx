import { useEffect, useState } from 'react';
import ConfirmDialog from './ConfirmDialog';

/** Крестик, фон и Escape используют один вопрос; успешная запись закрывает напрямую. */
export default function useModalCloseGuard({ onClose, dirty, force = false, busy = false, message }) {
  const [asking, setAsking] = useState(false);
  const needsConfirm = dirty || force;
  useEffect(() => {
    if (!needsConfirm || typeof window === 'undefined') return undefined;
    const beforeUnload = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [needsConfirm]);
  return {
    requestClose: () => {
      if (busy) return;
      if (needsConfirm) setAsking(true);
      else onClose();
    },
    confirmation: <ConfirmDialog open={asking} title="Закрыть без сохранения?"
      message={message ?? 'Несохранённые изменения будут потеряны. Вы можете вернуться к вводу и продолжить работу.'}
      confirmLabel="Закрыть без сохранения" cancelLabel="Вернуться к вводу" danger
      onClose={() => setAsking(false)} onConfirm={onClose} />,
  };
}
