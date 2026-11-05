import { useEffect, useRef, useState } from 'react';
import { cleanNumberText, numberToText, parseNumberText } from './number-text.js';

/* ПОЛЕ ЧИСЛА (5.4, тестирование 04.11.2026) — одно на всю PMS, то же
 * поведение, что в Kars Avia (`operator-web/src/components/number-input.tsx`).
 *
 * Хранит СТРОКУ, а наружу отдаёт число или null: пустое поле — «не задано»,
 * а не 0, и «0350» не получается (ведущие нули убираются). Принимает и
 * запятую, и точку. Пока поле в фокусе, стёртое остаётся пустым, даже если
 * форма подставила свой минимум; с ухода из поля показывается принятое
 * формой. `type="text"` с `inputMode`: number-поле браузера само решает, что
 * показать, и спорит с React — отсюда и был «0350».
 *
 * `min`/`max` не обрезают ввод на лету (иначе не набрать «12» при min=10) —
 * проверку делает форма, как и раньше. */
export default function NumberInput({
  value,
  onChange,
  decimal = true,
  allowNegative = false,
  min,
  max,
  step,
  onFocus,
  onBlur,
  ...rest
}) {
  const [text, setText] = useState(() => numberToText(value));
  const focused = useRef(false);

  // Значение сменилось снаружи (сброс формы, загрузка) — показать его.
  useEffect(() => {
    if (focused.current && text === '') return;
    const outer = value == null || value === '' ? null : Number(String(value).replace(',', '.'));
    if (parseNumberText(text) !== outer) setText(numberToText(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      {...rest}
      type="text"
      inputMode={decimal ? 'decimal' : 'numeric'}
      aria-valuemin={min}
      aria-valuemax={max}
      data-step={step}
      value={text}
      onFocus={(e) => {
        focused.current = true;
        onFocus?.(e);
      }}
      onBlur={(e) => {
        focused.current = false;
        if (text === '' && value != null && value !== '') setText(numberToText(value));
        onBlur?.(e);
      }}
      onChange={(e) => {
        const next = cleanNumberText(e.target.value, { decimal, allowNegative });
        setText(next);
        onChange(parseNumberText(next));
      }}
    />
  );
}
