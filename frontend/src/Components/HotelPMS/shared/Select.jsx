import { Children, isValidElement, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './controls.css';

/* Свой выпадающий список PMS. Принимает то же, что родной <select> с <option> и <optgroup>,
   и зовёт onChange с { target: { value, name } }, поэтому формы менять не нужно. */
function readOptions(children, group = null, out = []) {
  Children.toArray(children).forEach((child) => {
    if (!isValidElement(child)) return;
    if (child.type === 'option') {
      out.push({
        value: String(child.props.value ?? ''),
        label: Children.toArray(child.props.children).join(''),
        disabled: !!child.props.disabled,
        group,
      });
    } else if (child.type === 'optgroup') {
      readOptions(child.props.children, child.props.label, out);
    } else if (child.props?.children) {
      readOptions(child.props.children, group, out);
    }
  });
  return out;
}

const SEARCH_FROM = 9;

export default function Select({ value, onChange, children, className = '', style, disabled, name, id, placeholder, ...rest }) {
  const options = useMemo(() => readOptions(children), [children]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const [box, setBox] = useState(null);
  const button = useRef(null);
  const pop = useRef(null);
  const current = options.find((o) => o.value === String(value ?? ''));
  const needle = query.trim().toLowerCase();
  const shown = needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;

  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const place = () => {
      const r = button.current.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - 12;
      const up = below < 200 && r.top > below;
      setBox({ left: r.left, width: r.width, ...(up ? { bottom: window.innerHeight - r.top + 4, maxHeight: r.top - 12 } : { top: r.bottom + 4, maxHeight: below }) });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => {
      if (!button.current?.contains(e.target) && !pop.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(Math.max(0, options.findIndex((o) => o.value === String(value ?? ''))));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pick = (o) => {
    if (o.disabled) return;
    setOpen(false);
    button.current?.focus();
    if (o.value !== String(value ?? '')) onChange?.({ target: { value: o.value, name }, currentTarget: { value: o.value, name } });
  };

  const onKey = (e) => {
    if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(shown.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (shown[active]) pick(shown[active]);
    }
  };

  return (
    <>
      <button
        {...rest}
        id={id}
        ref={button}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        className={`${className} pms-select`}
        style={style}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKey}
      >
        <span className={current?.label ? 'pms-select-val' : 'pms-select-val is-empty'}>{current?.label || placeholder || '—'}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && box && createPortal(
        <div ref={pop} className="pms-pop" role="listbox" style={box} onKeyDown={onKey}>
          {options.length >= SEARCH_FROM && (
            <input autoFocus className="pms-pop-search" placeholder="Поиск" aria-label="Поиск" value={query} onChange={(e) => { setQuery(e.target.value); setActive(0); }} />
          )}
          {shown.length === 0 && <div className="pms-pop-empty">Ничего не найдено</div>}
          {shown.map((o, i) => (
            <div key={`${o.group ?? ''}|${o.value}|${i}`}>
              {o.group && o.group !== shown[i - 1]?.group && <div className="pms-pop-group">{o.group}</div>}
              <button
                type="button"
                role="option"
                aria-selected={o === current}
                disabled={o.disabled}
                className={`pms-pop-item${o === current ? ' is-on' : ''}${i === active ? ' is-active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(o)}
              >
                {o.label || '—'}
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
