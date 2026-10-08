-- Роль DISPATCHER в тенанте платформы и перевод на неё всех учёток
-- диспетчеров (см. 20261008100000_role_dispatcher). Если платформа ещё не
-- заведена (чистая установка) — роль создаст первый вход диспетчера.
INSERT INTO "role" ("id", "tenant_id", "code", "name", "isSystem", "createdAt", "updatedAt")
SELECT gen_random_uuid(), t."id", 'DISPATCHER', 'Диспетчер Kars Avia', TRUE, now(), now()
  FROM "tenant" t
 WHERE t."slug" = 'platform'
   AND NOT EXISTS (SELECT 1 FROM "role" r WHERE r."tenant_id" = t."id" AND r."code" = 'DISPATCHER');

UPDATE "app_user" u
   SET "role_id" = r."id"
  FROM "role" r
  JOIN "tenant" t ON t."id" = r."tenant_id" AND t."slug" = 'platform'
 WHERE r."code" = 'DISPATCHER'
   AND u."is_dispatcher";

-- ВХОД ДИСПЕТЧЕРОВ — ОТДЕЛЬНЫМ КЛЮЧОМ (Р-34; план 13.3). sso:create выписывал
-- вход по любому e-mail из запроса, и держал его тот же общий ключ
-- интеграции, что читает и пишет брони. Теперь ключ с sso:create не может
-- иметь других прав (проверка при выпуске и в гарде); с общих ключей право
-- снимается — для входа диспетчеров выпускается свой ключ.
UPDATE "partner_api_key"
   SET "scopes" = array_remove("scopes", 'sso:create')
 WHERE 'sso:create' = ANY ("scopes")
   AND cardinality("scopes") > 1;
