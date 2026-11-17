import { MAX_GALLERY_PHOTOS, galleryCanAdd, galleryWriteDecision } from './gallery-limit';

/* Отрицанием: сверх потолка НЕ растём, из старой галереи НЕ запираемся. */
describe('правило галереи гостиницы', () => {
  it('добавлять можно, пока меньше 30', () => {
    expect(galleryCanAdd(0)).toBe(true);
    expect(galleryCanAdd(29)).toBe(true);
    expect(galleryCanAdd(30)).toBe(false);
    expect(galleryCanAdd(37)).toBe(false);
  });

  it('список в пределах потолка пишется всегда', () => {
    expect(galleryWriteDecision(30, 30)).toBe('ok');
    expect(galleryWriteDecision(29, 30)).toBe('ok');
    expect(galleryWriteDecision(0, 3)).toBe('ok');
  });

  it('из галереи ДЛИННЕЕ потолка можно только уменьшать', () => {
    expect(MAX_GALLERY_PHOTOS).toBe(30);
    expect(galleryWriteDecision(36, 37)).toBe('ok');
    expect(galleryWriteDecision(31, 37)).toBe('ok');
    expect(galleryWriteDecision(30, 37)).toBe('ok');
    expect(galleryWriteDecision(37, 37)).toBe('add-at-limit');
    expect(galleryWriteDecision(38, 37)).toBe('add-at-limit');
  });

  it('сверх потолка НЕ растим', () => {
    // На потолке — «сначала удалите лишние», ниже потолка — «не больше 30».
    expect(galleryWriteDecision(31, 30)).toBe('add-at-limit');
    expect(galleryWriteDecision(31, 5)).toBe('over-limit');
  });
});
