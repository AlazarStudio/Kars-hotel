import { useCallback, useState } from 'react';

/* Выбор номеров для удаления пачкой (28.10.2026). Набор id — как выбор
   гостиниц в админ-панели (AdminPanel.jsx, FeaturesSection). */
export function useRoomSelection() {
  const [active, setActive] = useState(false);
  const [selected, setSelected] = useState(() => new Set());

  const start = useCallback(() => setActive(true), []);

  const stop = useCallback(() => {
    setActive(false);
    setSelected(new Set());
  }, []);

  const toggle = useCallback((id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /** Отметить (on=true) или снять (on=false) сразу несколько: категорию, итог удаления. */
  const setMany = useCallback((ids, on) => {
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });
  }, []);

  return { active, selected, start, stop, toggle, setMany };
}
