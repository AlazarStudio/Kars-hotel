-- ПАРТНЁР КАК СУЩНОСТЬ И ЕГО СПРАВОЧНИК (29.09.2026).
--
-- До сих пор оператор жил булевым признаком «для оператора» у тарифа и
-- глобальным ключом API: партнёр в системе один, его юрлиц и заказчиков нет.
-- Корпоративные тарифы с условиями (юрлицо партнёра × авиакомпания × вид
-- брони) без этого не выразить, а PMS как отдельный продукт должна работать с
-- любым числом партнёров.

CREATE TABLE "partner" (
  "id"         UUID         NOT NULL DEFAULT gen_random_uuid(),
  "code"       TEXT         NOT NULL,
  "name"       TEXT         NOT NULL,
  "is_active"  BOOLEAN      NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "partner_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "partner_code_key" ON "partner" ("code");

CREATE TABLE "partner_account" (
  "id"         UUID         NOT NULL DEFAULT gen_random_uuid(),
  "partner_id" UUID         NOT NULL,
  "code"       TEXT         NOT NULL,
  "name"       TEXT         NOT NULL,
  "inn"        TEXT,
  "is_active"  BOOLEAN      NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "partner_account_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "partner_account_partner_id_fkey" FOREIGN KEY ("partner_id")
    REFERENCES "partner" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "partner_account_partner_id_code_key" ON "partner_account" ("partner_id", "code");

CREATE TABLE "partner_customer" (
  "id"         UUID         NOT NULL DEFAULT gen_random_uuid(),
  "partner_id" UUID         NOT NULL,
  "code"       TEXT         NOT NULL,
  "name"       TEXT         NOT NULL,
  "is_active"  BOOLEAN      NOT NULL DEFAULT TRUE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "partner_customer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "partner_customer_partner_id_fkey" FOREIGN KEY ("partner_id")
    REFERENCES "partner" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "partner_customer_partner_id_code_key" ON "partner_customer" ("partner_id", "code");

-- Справочник общий, не тенантный: гостиница читает его, чтобы выбрать
-- юрлицо и авиакомпанию в тарифе, но не пишет. Пишет только партнёр — через
-- API подключения (служебный клиент). Права по умолчанию (миграция b2) дают
-- рабочей роли полный доступ к новым таблицам — забираем запись.
REVOKE INSERT, UPDATE, DELETE ON TABLE "partner", "partner_account", "partner_customer" FROM app_user;

-- Нынешние ключи — ключи Kars Avia: другого партнёра не было.
INSERT INTO "partner" ("code", "name", "updated_at") VALUES ('kars-avia', 'Kars Avia', CURRENT_TIMESTAMP);
ALTER TABLE "partner_api_key" ADD COLUMN "partner_id" UUID;
UPDATE "partner_api_key" SET "partner_id" = (SELECT "id" FROM "partner" WHERE "code" = 'kars-avia');
ALTER TABLE "partner_api_key" ALTER COLUMN "partner_id" SET NOT NULL;
ALTER TABLE "partner_api_key" ADD CONSTRAINT "partner_api_key_partner_id_fkey"
  FOREIGN KEY ("partner_id") REFERENCES "partner" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Право прислать справочник — отдельное: список своих юрлиц и заказчиков
-- партнёр ведёт сам, и это не то же, что бронировать. Выдаётся живым ключам
-- сразу: право, которого никому не выдали, не отличается от отсутствующего.
UPDATE "partner_api_key"
SET "scopes" = array_append("scopes", 'directory:write')
WHERE "is_active" = TRUE
  AND NOT ('directory:write' = ANY("scopes"));
