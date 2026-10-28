import classes from './Rooms.module.css';
import formClasses from '../../shared/Form.module.css';

/* Нижняя строка режима выбора (28.10.2026): сколько отмечено, удалить, выйти.
   Под ней — итог прошлого удаления, если что-то не удалилось: номера с
   бронями остаются отмеченными, и итог объясняет почему. */
export default function SelectionBar({ count, result, onDelete, onCancel }) {
  return (
    <div className={classes.selectionBar}>
      <div className={classes.selectionRow}>
        <span className={classes.selectionCount}>Выбрано: {count}</span>
        <div className={classes.headerActions}>
          <button type="button" className={classes.btnGhost} onClick={onCancel}>
            Отмена
          </button>
          <button type="button" className={formClasses.btnDanger} onClick={onDelete} disabled={count === 0}>
            Удалить выбранные
          </button>
        </div>
      </div>
      {result && <div className={formClasses.notice}>{result}</div>}
    </div>
  );
}
