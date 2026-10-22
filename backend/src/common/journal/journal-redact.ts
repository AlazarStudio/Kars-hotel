/* Что из тела запроса попадает в журнал действий (23.10.2026).
 *
 * Решение владельца: «значения, но без секретов». Журнал хранится бессрочно и
 * читается суперадмином и диспетчером платформы — значит, пароль, ПИН, код входа,
 * ключ или паспортные данные, попавшие сюда однажды, лежат открыто навсегда.
 *
 * Маска — по ИМЕНИ поля, на любой глубине (переменные GraphQL, массивы людей).
 * Лучше скрыть лишнее («tokenId»), чем пропустить: поэтому, кроме точных имён,
 * — подстроки. `code` — секрет только на входе и привязке устройства: в
 * остальных местах это код организации, тарифа, аэропорта.
 */

export const JOURNAL_HIDDEN = '***';
const MAX_STRING = 2000;
const MAX_ARRAY = 50;
const MAX_DEPTH = 8;

/** Подстроки имени поля (без регистра и разделителей), которые всегда скрываются. */
const SECRET_PARTS = ['password', 'passwd', 'secret', 'token', 'apikey', 'mrz', 'passport', 'otp', 'cookie', 'authorization'];
/** Точные имена (без регистра и разделителей). */
const SECRET_KEYS = new Set([
  'pin', 'newpin', 'oldpin', 'currentpin',
  // Паспорт гостя — поля документа (гостевая карточка, гости брони).
  'document', 'documentnumber', 'docnumber', 'docseries', 'series', 'passportseries', 'passportnumber',
  'cardnumber', 'cvv', 'cvc', 'snils', 'inn_personal', 'docnum', 'documentseries', 'birthplace',
]);

const norm = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Путь, где `code` — одноразовый код (вход, второй фактор, устройство, телефон). */
export function isAuthPath(path: string): boolean {
  return /\/(auth|sso|login|verify|password|pin|2fa|otp)(\/|$|\?)/i.test(path);
}

export function isSecretKey(key: string, authPath: boolean): boolean {
  const k = norm(key);
  if (SECRET_KEYS.has(k)) return true;
  if (authPath && (k === 'code' || k.endsWith('code'))) return true;
  return SECRET_PARTS.some((p) => k.includes(p));
}

/** Тело или параметры запроса — для журнала: секреты скрыты, длинное обрезано с пометкой. */
export function redactForJournal(value: unknown, path: string): unknown {
  return walk(value, isAuthPath(path), 0);
}

function walk(value: unknown, authPath: boolean, depth: number): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}… (+${value.length - MAX_STRING})` : value;
  }
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (depth >= MAX_DEPTH) return '…';
  if (Array.isArray(value)) {
    const head = value.slice(0, MAX_ARRAY).map((v) => walk(v, authPath, depth + 1));
    return value.length > MAX_ARRAY ? [...head, `… (+${value.length - MAX_ARRAY})`] : head;
  }
  if (Buffer.isBuffer(value)) return `<${value.length} B>`;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = isSecretKey(k, authPath) && v !== null && v !== undefined && v !== '' ? JOURNAL_HIDDEN : walk(v, authPath, depth + 1);
  }
  return out;
}
