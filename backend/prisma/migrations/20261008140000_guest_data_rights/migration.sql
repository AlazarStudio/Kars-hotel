-- ПРАВА НА ОБЕЗЛИЧИВАНИЕ БРОНИ И ВЫГРУЗКУ ДАННЫХ ГОСТЯ (08.10.2026, 152-ФЗ,
-- Р-49, Г-22; план 13.7): владельцу и менеджеру во всех гостиницах. Каталог
-- прав приложение синхронизирует при запуске — здесь права заводятся заранее,
-- чтобы выдать их ролям уже существующих гостиниц.
INSERT INTO "permission" ("id", "code", "name")
SELECT gen_random_uuid(), v.code, v.name
  FROM (VALUES ('guest.anonymize', 'Обезличить бронь гостя'),
               ('guest.export', 'Выгрузить данные гостя по запросу')) AS v(code, name)
 WHERE NOT EXISTS (SELECT 1 FROM "permission" p WHERE p."code" = v.code);

INSERT INTO "role_permission" ("role_id", "permission_id")
SELECT r."id", p."id"
  FROM "role" r
  JOIN "permission" p ON p."code" IN ('guest.anonymize', 'guest.export')
 WHERE r."code" IN ('OWNER', 'MANAGER')
   AND NOT EXISTS (
     SELECT 1 FROM "role_permission" rp WHERE rp."role_id" = r."id" AND rp."permission_id" = p."id"
   );
