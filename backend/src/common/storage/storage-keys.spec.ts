import { StorageService } from './storage.service';

/* В базе — путь к файлу, адрес собирается при выдаче (02.11.2026): иначе
 * копия базы на другом стенде ссылается на чужой сервер. */
function storage(publicBase = 'http://localhost:9000') {
  const s = Object.create(StorageService.prototype) as StorageService;
  Object.assign(s, { bucket: 'kars-hotel', publicBase });
  return s;
}

const KEY = 'tenant-gallery/t1/a.jpg';

describe('StorageService: путь ↔ адрес', () => {
  it('путь превращается в адрес ЭТОГО стенда', () => {
    expect(storage().toUrl(KEY)).toBe('http://localhost:9000/kars-hotel/tenant-gallery/t1/a.jpg');
    expect(storage('https://pms.example.ru').toUrl(KEY)).toBe('https://pms.example.ru/kars-hotel/tenant-gallery/t1/a.jpg');
  });

  it('адрес нашего хранилища с ЛЮБОГО стенда сводится к пути', () => {
    const s = storage();
    expect(s.toStored('http://localhost:9000/kars-hotel/tenant-gallery/t1/a.jpg')).toBe(KEY);
    expect(s.toStored('https://app.karsavia.ru/kars-hotel/tenant-gallery/t1/a.jpg')).toBe(KEY);
    expect(s.toStored('https://app.karsavia.ru/kars-hotel/room-type-photos/t1/r1/b.webp')).toBe('room-type-photos/t1/r1/b.webp');
    expect(s.toStored(KEY)).toBe(KEY);
  });

  it('чужая ссылка не становится нашим путём и наружу уходит как есть', () => {
    const s = storage();
    const foreign = 'https://images.unsplash.com/photo-1.jpg';
    expect(s.toStored(foreign)).toBe(foreign);
    expect(s.toUrl(foreign)).toBe(foreign);
    expect(s.isOwnUrl(foreign)).toBe(false);
    // Наш бакет, но не наша папка — тоже чужое.
    expect(s.toStored('https://x.ru/kars-hotel/other/a.jpg')).toBe('https://x.ru/kars-hotel/other/a.jpg');
  });

  it('toUrls пропускает не-строки', () => {
    expect(storage().toUrls([KEY, null, 3])).toEqual(['http://localhost:9000/kars-hotel/tenant-gallery/t1/a.jpg']);
    expect(storage().toUrls(null)).toEqual([]);
  });
});
