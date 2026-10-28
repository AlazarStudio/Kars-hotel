import { useCallback, useState } from 'react';

/* Свёрнутые категории «Номерного фонда» (28.10.2026). Запоминаются в браузере,
   как свёрнутая подсказка «Тарифов»: категорию сворачивают, чтобы не мешала,
   и после перезагрузки она должна остаться свёрнутой. */
const KEY = 'pms.rooms.collapsed';

function read() {
  try {
    const ids = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return new Set(Array.isArray(ids) ? ids : []);
  } catch {
    return new Set();
  }
}

export function useCollapsedCategories() {
  const [collapsed, setCollapsed] = useState(read);

  const toggle = useCallback((id) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try { localStorage.setItem(KEY, JSON.stringify([...next])); } catch { /* приватный режим */ }
      return next;
    });
  }, []);

  return { collapsed, toggle };
}
