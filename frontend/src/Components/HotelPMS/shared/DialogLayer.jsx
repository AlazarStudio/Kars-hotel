import { useContext, useId, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { DialogContext } from './dialogContext';

const layers = [];
let pageState;
const topLayer = () => [...layers].sort((a, b) => a.depth - b.depth).at(-1);
const focusable = (root) => [...root.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')].filter((el) => {
  if (el.matches(':disabled, [tabindex="-1"], input[type="hidden"]')) return false;
  for (let node = el; node && node !== root.parentElement; node = node.parentElement) {
    if (node.hidden || getComputedStyle(node).display === 'none' || getComputedStyle(node).visibility === 'hidden') return false;
  }
  return true;
});
const syncLayers = () => {
  const top = topLayer();
  for (const layer of layers) {
    layer.overlay.toggleAttribute('inert', layer !== top);
    if (layer !== top) layer.overlay.setAttribute('aria-hidden', 'true');
    else layer.overlay.removeAttribute('aria-hidden');
  }
  for (const popup of document.querySelectorAll('[data-dialog-owner]')) {
    popup.toggleAttribute('inert', popup.getAttribute('data-dialog-owner') !== top?.id);
  }
};

/** Общая механика PMS: портал, верхний слой, Escape, фокус и возврат к кнопке. */
export default function DialogLayer({ open = true, title, labelledBy, role = 'dialog', onClose, busy = false, className, backdropClassName, style, children }) {
  const id = useId();
  const parent = useContext(DialogContext);
  const depth = parent.depth + 1;
  const overlayRef = useRef(null);
  const dialogRef = useRef(null);
  const closeRef = useRef(null);
  const startedOutside = useRef(false);
  closeRef.current = busy ? null : onClose;

  useLayoutEffect(() => {
    if (!open || !dialogRef.current) return undefined;
    const dialog = dialogRef.current;
    const returnTo = document.activeElement;
    const layer = { overlay: overlayRef.current, dialog, depth, id };
    if (!layers.length) {
      const page = document.getElementById('root');
      pageState = { overflow: document.body.style.overflow, page, returnTo, inert: page?.hasAttribute('inert'), hidden: page?.getAttribute('aria-hidden') };
      document.body.style.overflow = 'hidden';
      page?.setAttribute('inert', '');
      page?.setAttribute('aria-hidden', 'true');
    }
    layers.push(layer);
    syncLayers();
    const popups = () => [...document.querySelectorAll('[data-dialog-owner]')].filter((p) => p.getAttribute('data-dialog-owner') === id);
    const belongs = (el) => dialog.contains(el) || popups().some((p) => p.contains(el));
    const first = () => { const items = focusable(dialog); return items.find((el) => el.hasAttribute('data-autofocus')) ?? items[0] ?? dialog; };
    if (topLayer() === layer && !belongs(document.activeElement)) first().focus();
    const onKey = (e) => {
      if (topLayer() !== layer || e.defaultPrevented || e.isComposing) return;
      if (e.key === 'Escape') {
        if (popups().length) return;
        e.preventDefault(); e.stopPropagation();
        closeRef.current?.();
      } else if (e.key === 'Tab') {
        const items = [...focusable(dialog), ...popups().flatMap(focusable)];
        const firstItem = items[0] ?? dialog;
        const lastItem = items.at(-1) ?? dialog;
        if (!belongs(document.activeElement) || (!e.shiftKey && document.activeElement === lastItem)) {
          e.preventDefault(); firstItem.focus();
        } else if (e.shiftKey && document.activeElement === firstItem) {
          e.preventDefault(); lastItem.focus();
        }
      }
    };
    const onFocus = (e) => { if (topLayer() === layer && !belongs(e.target)) first().focus(); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocus);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocus);
      layers.splice(layers.indexOf(layer), 1);
      syncLayers();
      let restoreTo = returnTo;
      if (!layers.length && pageState) {
        restoreTo = pageState.returnTo;
        document.body.style.overflow = pageState.overflow;
        pageState.page?.toggleAttribute('inert', !!pageState.inert);
        if (pageState.hidden == null) pageState.page?.removeAttribute('aria-hidden');
        else pageState.page?.setAttribute('aria-hidden', pageState.hidden);
        pageState = null;
      }
      if (restoreTo?.isConnected && !restoreTo.closest('[inert]')) restoreTo.focus?.();
    };
  }, [open, id, depth]);

  if (!open || typeof document === 'undefined') return null;
  return createPortal(<DialogContext.Provider value={{ id, depth }}>
    <div ref={overlayRef} className={backdropClassName} style={{ zIndex: 1000 + depth * 10 }} data-pms-overlay="" onMouseDown={(e) => { startedOutside.current = e.target === e.currentTarget; }} onClick={(e) => {
      if (startedOutside.current && e.target === e.currentTarget) closeRef.current?.();
      startedOutside.current = false;
    }}>
      <div ref={dialogRef} className={className} style={style} role={role} aria-modal="true" aria-label={labelledBy ? undefined : title} aria-labelledby={labelledBy} tabIndex={-1} data-pms-dialog={id}>{children}</div>
    </div>
  </DialogContext.Provider>, document.body);
}
