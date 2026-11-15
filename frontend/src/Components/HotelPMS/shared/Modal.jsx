import DialogLayer from './DialogLayer';
import classes from './Modal.module.css';

/**
 * Lightweight modal overlay. Closes on Escape and on backdrop click.
 *
 * Props:
 *   open: boolean
 *   title: string
 *   onClose: () => void
 *   width: 'sm' | 'md' | 'lg' (defaults to md)
 *   children
 *   footer: ReactNode (rendered in the sticky footer; e.g. submit + cancel buttons)
 */
export default function Modal({ open, title, onClose, width = 'md', children, footer, busy = false, role = 'dialog' }) {
  return (
    <DialogLayer
      open={open} title={title} onClose={onClose} busy={busy} role={role}
      backdropClassName={classes.backdrop}
      className={`${classes.dialog} ${classes[`width_${width}`] || ''}`}
    >
        <div className={classes.header}>
          <div className={classes.title}>{title}</div>
          <button type="button" className={classes.close} onClick={onClose} disabled={busy || !onClose} aria-label="Закрыть">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className={classes.body}>{children}</div>
        {footer && <div className={classes.footer}>{footer}</div>}
    </DialogLayer>
  );
}
