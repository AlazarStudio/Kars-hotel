import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { addDays, addMonths, endOfMonth, endOfWeek, format, isSameMonth, parseISO, startOfMonth, startOfWeek } from 'date-fns';
import { ru } from 'date-fns/locale';
import './controls.css';

/* Свой выбор даты PMS. Значение то же, что у <input type="date">: 'YYYY-MM-DD',
   onChange получает { target: { value, name } }. */
const ISO = 'yyyy-MM-dd';
const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const Chevron = ({ d }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);

export default function DateInput({ value, onChange, min, max, name, id, disabled, required, className = '', style, placeholder = 'Выберите дату', ...rest }) {
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => (value ? parseISO(value) : new Date()));
  const [box, setBox] = useState(null);
  const button = useRef(null);
  const pop = useRef(null);

  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const r = button.current.getBoundingClientRect();
    const up = window.innerHeight - r.bottom < 330 && r.top > 330;
    setBox({ left: Math.min(r.left, window.innerWidth - 300), ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }) });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    setMonth(value ? parseISO(value) : new Date());
    const away = (e) => {
      if (!button.current?.contains(e.target) && !pop.current?.contains(e.target)) setOpen(false);
    };
    const esc = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc, true);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const emit = (v) => {
    setOpen(false);
    button.current?.focus();
    onChange?.({ target: { value: v, name }, currentTarget: { value: v, name } });
  };

  const first = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const last = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
  const days = [];
  for (let d = first; d <= last; d = addDays(d, 1)) days.push(d);

  return (
    <>
      <button
        {...rest}
        id={id}
        ref={button}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`${className} pms-select`}
        style={style}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={value ? 'pms-select-val' : 'pms-select-val is-empty'}>{value ? format(parseISO(value), 'dd.MM.yyyy') : placeholder}</span>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></svg>
      </button>
      {open && box && createPortal(
        <div ref={pop} className="pms-pop pms-cal" role="dialog" aria-label="Календарь" style={box}>
          <div className="pms-cal-head">
            <button type="button" aria-label="Предыдущий месяц" onClick={() => setMonth(addMonths(month, -1))}><Chevron d="m15 6-6 6 6 6" /></button>
            <b>{format(month, 'LLLL yyyy', { locale: ru })}</b>
            <button type="button" aria-label="Следующий месяц" onClick={() => setMonth(addMonths(month, 1))}><Chevron d="m9 6 6 6-6 6" /></button>
          </div>
          <div className="pms-cal-grid">
            {DAYS.map((d) => <span key={d} className="pms-cal-dow">{d}</span>)}
            {days.map((d) => {
              const iso = format(d, ISO);
              const off = (min && iso < min) || (max && iso > max);
              return (
                <button
                  key={iso}
                  type="button"
                  disabled={!!off}
                  className={`pms-cal-day${isSameMonth(d, month) ? '' : ' is-out'}${iso === value ? ' is-on' : ''}${iso === format(new Date(), ISO) ? ' is-today' : ''}`}
                  onClick={() => emit(iso)}
                >
                  {format(d, 'd')}
                </button>
              );
            })}
          </div>
          <div className="pms-cal-foot">
            {!required && value ? <button type="button" onClick={() => emit('')}>Очистить</button> : <span />}
            <button type="button" onClick={() => emit(format(new Date(), ISO))}>Сегодня</button>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
