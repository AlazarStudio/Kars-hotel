/* ЧИСЛО В ПОЛЕ ВВОДА (5.4, тестирование 04.11.2026).
 *
 * Поля `type="number"` со значением-числом давали «0350»: пустое поле
 * превращалось в 0 (`+"" = 0`), а набранное вставало рядом с нулём — React не
 * переписывает number-поле, когда число совпало. Очистить поле было нельзя.
 *
 * Здесь только правило текста — компонент `NumberInput` хранит строку и
 * отдаёт наружу число или null. Чистая функция: проверяется `npm test`.
 */

/**
 * Привести набранное к допустимому тексту поля: только цифры, одна десятичная
 * точка (запятая — тоже точка), минус в начале, если разрешён; ведущие нули
 * убираются («0350» → «350»), но «0» и «0.5» остаются.
 */
export function cleanNumberText(raw, { decimal = true, allowNegative = false } = {}) {
  let s = String(raw ?? '').replace(/,/g, '.').replace(/\s/g, '');
  const negative = allowNegative && s.startsWith('-');
  s = s.replace(/[^\d.]/g, '');
  if (decimal) {
    const dot = s.indexOf('.');
    if (dot !== -1) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '');
  } else {
    s = s.replace(/\./g, '');
  }
  // Ведущие нули: «0350» → «350», «00» → «0», «00.5» → «0.5».
  s = s.replace(/^0+(?=\d)/, '');
  if (s.startsWith('.')) s = `0${s}`;
  return (negative ? '-' : '') + s;
}

/** Текст поля → число или null (пусто, «-», «.» — «не задано»). */
export function parseNumberText(text) {
  if (text == null) return null;
  const s = String(text).trim();
  if (s === '' || s === '-' || s === '.' || s === '-.') return null;
  const n = Number(s.endsWith('.') ? s.slice(0, -1) : s);
  return Number.isFinite(n) ? n : null;
}

/** Значение снаружи → текст поля. null / '' / NaN — пустое поле. */
export function numberToText(value) {
  if (value == null || value === '') return '';
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? String(n) : '';
}
