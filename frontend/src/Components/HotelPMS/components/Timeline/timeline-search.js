/* Поиск по шахматке (30.10.2026): сужает строки, а не только брони.
 * Чистые функции без React — проверяются `npm test` (timeline-search.test.mjs).
 *
 * Замечание диспетчеров: «вбиваю квартиру или фамилию — он оставляет все
 * квартиры». У апартаментов адрес записан в номере («Новоселов 3 кв 115»),
 * поэтому номер — первое, по чему ищем. */

/** Номера, совпавшие с запросом сами: по номеру (адресу) или по категории.
 *  Пустой запрос — `null`: шахматка не сужается. */
export function matchRooms(query, rooms, categories) {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const catHit = new Set(categories.filter((c) => c.name.toLowerCase().includes(q)).map((c) => c.id));
  return new Set(
    rooms
      .filter((r) => String(r.number).toLowerCase().includes(q) || catHit.has(r.categoryId))
      .map((r) => r.id),
  );
}

/** Бронь остаётся на шахматке: её номер найден целиком, или найден гость. */
export function bookingMatches(query, booking, matchedRoomIds) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return matchedRoomIds.has(booking.roomId) || (booking.guestName ?? '').toLowerCase().includes(q);
}

/** Строки шахматки при поиске: найденные номера и номера найденных гостей. */
export function roomsWithHits(matchedRoomIds, bookings) {
  if (!matchedRoomIds) return null;
  return new Set([...matchedRoomIds, ...bookings.map((b) => b.roomId)]);
}
