import classes from './WizardSteps.module.css';

/* ШАГИ МАСТЕРА — тот же нумерованный приём, что в окнах TenantDialogs
 * (.steps / .stepNo): кружок с номером и подпись. Проект уже так показывает
 * процедуру, поэтому шаги мастера — не свободный текст «1. Для кого
 * 2. Питание», а одна строка пронумерованных кружков со связкой.
 *
 * Цвет здесь несёт состояние, а не украшение: пройденный шаг — зелёный,
 * текущий — синий. Иконок и эмодзи нет.
 *
 * props: steps — подписи по порядку; current — индекс текущего шага;
 * hint — пояснение под строкой (необязательно). */
export default function WizardSteps({ steps, current, hint }) {
  return (
    <div className={classes.steps}>
      <ol className={classes.list}>
        {steps.map((label, i) => {
          const state = i < current ? classes.stepDone : i === current ? classes.stepCurrent : '';
          return (
            <li
              key={label}
              className={[classes.step, state].filter(Boolean).join(' ')}
              aria-current={i === current ? 'step' : undefined}
            >
              <span className={classes.stepNo}>{i + 1}</span>
              <span className={classes.stepLabel}>{label}</span>
            </li>
          );
        })}
      </ol>
      {hint ? <div className={classes.hint}>{hint}</div> : null}
    </div>
  );
}
