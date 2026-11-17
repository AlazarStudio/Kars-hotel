/* ПРАВИЛО ГАЛЕРЕИ ГОСТИНИЦЫ (17.11.2026).
 *
 * Раньше потолок в 30 фотографий стоял ТОЛЬКО на перезаписи списка
 * (PATCH /tenant/gallery), а добавление (POST) и импорт из старой системы
 * писали сколько угодно. Отель, у которого оказалось 37 фото, не мог удалить
 * НИ ОДНОГО: удаление уходит тем же PATCH-ом, и сервер отвечал «photos must
 * contain no more than 30 elements» — убрать семь за раз интерфейс не умеет.
 *
 * Теперь правило одно и живёт здесь:
 *  - добавить можно, только пока фотографий меньше 30;
 *  - записать список можно, если он не длиннее 30 ИЛИ стал короче прежнего —
 *    иначе из тупика не выйти.
 */
export const MAX_GALLERY_PHOTOS = 30;

export type GalleryDecision = 'ok' | 'add-at-limit' | 'over-limit';

/** Можно ли добавить ещё одну фотографию к галерее из `current` штук. */
export function galleryCanAdd(current: number, max: number = MAX_GALLERY_PHOTOS): boolean {
  return current < max;
}

/** Можно ли записать галерею из `next` штук вместо `current`. */
export function galleryWriteDecision(
  next: number,
  current: number,
  max: number = MAX_GALLERY_PHOTOS,
): GalleryDecision {
  if (next <= max) return 'ok';
  // Длиннее потолка — только если двигаемся вниз: так отель выбирается из
  // своей же старой галереи по одной фотографии.
  if (next < current) return 'ok';
  return current >= max ? 'add-at-limit' : 'over-limit';
}
