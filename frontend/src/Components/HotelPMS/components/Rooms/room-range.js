/* Пачка номеров (28.10.2026): диапазон, предпросмотр и тексты итогов.
 * Чистые функции без React — проверяются `npm test` (room-range.test.mjs). */

/** Склонение по числу: 1 номер, 2 номера, 5 номеров. */
export function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

const roomsWord = (n) => `${n} ${plural(n, 'номер', 'номера', 'номеров')}`;

/** Тот же предел, что на сервере (CreateManyRoomsDto, @Max(200)). */
export const MAX_ROOMS = 200;

/** Ошибки полей диапазона; пустой объект — диапазон верный. */
export function validateRange({ start, count }) {
  const e = {};
  const s = Number(start);
  const c = Number(count);
  if (String(start).trim() === '' || !Number.isInteger(s) || s < 0) e.start = 'Целое число от 0';
  if (String(count).trim() === '' || !Number.isInteger(c) || c < 1 || c > MAX_ROOMS) {
    e.count = `От 1 до ${MAX_ROOMS}`;
  }
  return e;
}

/** Номера диапазона — так же, как их собирает сервер: префикс + число + суффикс. */
export function rangeNumbers({ start, count, prefix = '', suffix = '' }) {
  const s = Number(start);
  return Array.from({ length: Number(count) }, (_, i) => `${prefix}${s + i}${suffix}`);
}

/** Перечень номеров: до `max` штук, дальше — «и ещё K». */
export function numberList(numbers, max = 10) {
  const shown = numbers
    .slice(0, max)
    .map((n) => `№${n}`)
    .join(', ');
  const rest = numbers.length - max;
  return rest > 0 ? `${shown} и ещё ${rest}` : shown;
}

/**
 * «Будут созданы: №101, №102 … №140 (40 номеров)». До 6 номеров перечисляем
 * все: ошибку в поле «Сколько» видно до нажатия «Создать».
 */
export function rangePreview(numbers) {
  const n = numbers.length;
  const list =
    n <= 6
      ? numbers.map((x) => `№${x}`).join(', ')
      : `№${numbers[0]}, №${numbers[1]} … №${numbers[n - 1]}`;
  return `${n === 1 ? 'Будет создан' : 'Будут созданы'}: ${list} (${roomsWord(n)})`;
}

/**
 * Итог создания пачки; null — создано всё, окно можно закрыть. Удалённые
 * называем отдельно: номер в архиве в фонде не виден, и без подсказки его
 * ищут там, где его нет.
 */
export function createSummary({ created, skipped = [], skippedArchived = [] }, requested) {
  if (!skipped.length && !skippedArchived.length) return null;
  const parts = [created ? `Создано ${created} из ${requested}.` : 'Ничего не создано.'];
  if (skipped.length) parts.push(`Уже есть в фонде: ${numberList(skipped)}.`);
  if (skippedArchived.length) {
    const it = skippedArchived.length === 1 ? 'его' : 'их';
    parts.push(
      `В удалённых: ${numberList(skippedArchived)} — восстановите ${it} в блоке «Удалённые номера» внизу страницы.`,
    );
  }
  return parts.join(' ');
}
