import classes from './Tariffs.module.css';
import { priceBasisText } from './priceBasis.i18n';

const annotated = ['class', 'default-class', 'kind'];
const known = ['category', ...annotated];
const texts = (locale) => priceBasisText[locale] ?? priceBasisText.ru;

export default function PriceBasis({ basis, compact = false, locale = 'ru' }) {
  if (!annotated.includes(basis)) return null;
  const text = texts(locale)[basis];
  return <span className={[classes.priceBasis, basis === 'default-class' && classes.priceBasisFallback, compact && classes.priceBasisCompact].filter(Boolean).join(' ')}
    title={text.description} aria-label={text.label + '. ' + text.description}>{text.label}</span>;
}

/** Visible explanations also work on touch screens and without hover. */
export function PriceBasisLegend({ prices = [], locale = 'ru' }) {
  const text = texts(locale);
  const present = new Set(prices.map((price) => price.basis));
  const bases = annotated.filter((basis) => present.has(basis));
  const unknown = [...present].some((basis) => !known.includes(basis));
  if (!bases.length && !unknown) return null;
  return <aside className={classes.priceBasisLegend} aria-label={text.title}>
    <strong>{text.title}</strong>
    {bases.length > 0 && <ul>{bases.map((basis) => <li key={basis}>
      <PriceBasis basis={basis} locale={locale} /><span>{text[basis].description}</span>
    </li>)}</ul>}
    {unknown && <p>{text.unknown}</p>}
  </aside>;
}
