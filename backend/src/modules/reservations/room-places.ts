/**
 * МЕСТА В НОМЕРЕ — одно правило на создание брони, её перенос и выбор номера
 * при бронировании партнёром (01.10.2026).
 *
 * Раньше номер считался свободным, пока число броней в нём меньше его
 * вместимости, а каждая бронь занимала ОДНО место, сколько бы в ней ни было
 * людей. Бронь на двоих в двухместном номере оставляла его «свободным», и
 * вторая бронь на двоих ложилась туда же: четыре человека в номере на двоих.
 * Найдено пилотным прогоном Авиа (две заявки экипажа в «Кавказе» — один
 * номер 208).
 *
 * Правило:
 *  - продажа по местам ВЫКЛЮЧЕНА (обычная гостиница) — бронь занимает номер
 *    ЦЕЛИКОМ: пока в номере живёт одна бронь, другой туда нельзя;
 *  - продажа по местам ВКЛЮЧЕНА (койко-места) — бронь занимает столько мест,
 *    сколько в ней людей (взрослые + дети, не меньше одного).
 */

export interface PlaceHolder {
  /** Первое место брони в номере (1…capacity). */
  placeNumber: number;
  adults: number;
  children: number;
}

/** Сколько мест занимает бронь. */
export function placesOf(
  guests: { adults: number; children?: number | null },
  capacity: number,
  multiPlace: boolean,
): number {
  if (!multiPlace) return Math.max(1, capacity);
  return Math.max(1, (guests.adults ?? 0) + (guests.children ?? 0));
}

/**
 * Первое место для новой брони или `null` — номер занят на эти даты.
 * `others` — брони этого номера, пересекающиеся по датам (без самой брони).
 */
export function allocatePlace(input: {
  capacity: number;
  multiPlace: boolean;
  guests: { adults: number; children?: number | null };
  others: PlaceHolder[];
}): number | null {
  const { capacity, multiPlace, guests, others } = input;
  if (!multiPlace) return others.length === 0 ? 1 : null;
  const taken = new Set<number>();
  for (const o of others) {
    const n = placesOf(o, capacity, true);
    for (let p = o.placeNumber; p < o.placeNumber + n; p++) taken.add(p);
  }
  const need = placesOf(guests, capacity, true);
  if (capacity - taken.size < need) return null;
  for (let p = 1; p <= capacity; p++) if (!taken.has(p)) return p;
  return null;
}

/** Свободен ли номер для брони на столько людей. */
export function roomFits(input: {
  capacity: number;
  multiPlace: boolean;
  guests: { adults: number; children?: number | null };
  others: PlaceHolder[];
}): boolean {
  return allocatePlace(input) !== null;
}
