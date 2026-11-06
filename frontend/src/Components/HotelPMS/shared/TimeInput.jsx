import { useEffect, useState } from 'react';
import './controls.css';

/* Своё поле времени PMS: ввод ЧЧ:ММ без системных стрелок и значка часов.
   Значение и onChange те же, что у <input type="time">. */
const mask = (raw) => {
  const d = raw.replace(/\D/g, '').slice(0, 4);
  return d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d;
};
const valid = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

export default function TimeInput({ value, onChange, name, className = '', ...rest }) {
  const [text, setText] = useState(value ?? '');
  useEffect(() => setText(value ?? ''), [value]);
  return (
    <input
      {...rest}
      name={name}
      className={className}
      inputMode="numeric"
      placeholder="ЧЧ:ММ"
      maxLength={5}
      value={text}
      aria-invalid={text !== '' && text.length === 5 && !valid(text)}
      onChange={(e) => {
        const next = mask(e.target.value);
        setText(next);
        if (next === '' || valid(next)) onChange?.({ target: { value: next, name }, currentTarget: { value: next, name } });
      }}
      onBlur={() => {
        if (text !== '' && !valid(text)) setText(value ?? '');
      }}
    />
  );
}
