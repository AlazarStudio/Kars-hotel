-- Фото гостиниц и категорий: в базе — путь к файлу, а не полный адрес.
--
-- Раньше хранился адрес `${S3_PUBLIC_URL}/kars-hotel/<папка>/…`, и копия базы
-- на другом стенде ссылалась на чужой сервер. 02.11.2026 лёг Beget — и на
-- локальном стенде пропали все фото, хотя файлы лежали в локальном MinIO.
-- Теперь база хранит ключ объекта (`tenant-gallery/<id>/<uuid>.jpg`), адрес
-- собирает StorageService.toUrl из S3_PUBLIC_URL того стенда, где база живёт.
--
-- Переводится только адрес НАШЕГО хранилища — с любого хоста (боевого,
-- локального): узнаётся по пути `/kars-hotel/<наша папка>/…`. Внешние ссылки
-- (Unsplash в старых сидах) остаются как есть. Повторный запуск безопасен:
-- ключ под шаблон адреса не подходит.
CREATE FUNCTION pg_temp.photo_key(v text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(v, '^https?://[^/]+/(?:.*/)?kars-hotel/((?:room-type-photos|tenant-logos|tenant-gallery)/.+)$', '\1')
$$;

UPDATE "tenant"
SET "gallery_photos" = (
  SELECT coalesce(jsonb_agg(pg_temp.photo_key(e) ORDER BY i), '[]'::jsonb)
  FROM jsonb_array_elements_text("gallery_photos") WITH ORDINALITY AS a(e, i)
)
WHERE jsonb_typeof("gallery_photos") = 'array'
  AND "gallery_photos"::text LIKE '%/kars-hotel/%';

UPDATE "tenant"
SET "logo_url" = pg_temp.photo_key("logo_url")
WHERE "logo_url" LIKE '%/kars-hotel/%';

UPDATE "room_type"
SET "photos" = (
  SELECT coalesce(jsonb_agg(pg_temp.photo_key(e) ORDER BY i), '[]'::jsonb)
  FROM jsonb_array_elements_text("photos") WITH ORDINALITY AS a(e, i)
)
WHERE jsonb_typeof("photos") = 'array'
  AND "photos"::text LIKE '%/kars-hotel/%';
