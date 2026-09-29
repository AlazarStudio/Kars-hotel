-- КОРПОРАТИВНЫЕ ТАРИФЫ С УСЛОВИЯМИ (29.09.2026).
--
-- Было: один корпоративный тариф на гостиницу, признак «для оператора». Но
-- договор бывает с разными ценами для разных авиакомпаний, юрлиц партнёра и
-- видов брони («Космос»: «Россия» и «Смартавиа», эстафета и сбой) — одним
-- тарифом его не выразить, и сверка вечно показывала бы «расходится».
-- Теперь тариф принадлежит партнёру и говорит, к чему применяется.

ALTER TABLE "rate_plan"
  ADD COLUMN "partner_id"          UUID,
  ADD COLUMN "partner_account_id"  UUID,
  ADD COLUMN "partner_customer_id" UUID,
  ADD COLUMN "guest_kind"          "GuestKind",
  ADD COLUMN "vat_rate"            DECIMAL(5, 2);
ALTER TABLE "rate_plan" ADD CONSTRAINT "rate_plan_partner_id_fkey"
  FOREIGN KEY ("partner_id") REFERENCES "partner" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rate_plan" ADD CONSTRAINT "rate_plan_partner_account_id_fkey"
  FOREIGN KEY ("partner_account_id") REFERENCES "partner_account" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rate_plan" ADD CONSTRAINT "rate_plan_partner_customer_id_fkey"
  FOREIGN KEY ("partner_customer_id") REFERENCES "partner_customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Нынешние корпоративные тарифы — тарифы Kars Avia «для любого».
UPDATE "rate_plan" SET "partner_id" = (SELECT "id" FROM "partner" WHERE "code" = 'kars-avia')
 WHERE "for_operator";

-- Условия — только у тарифа партнёра; тариф партнёра не наследует цены.
ALTER TABLE "rate_plan" ADD CONSTRAINT "rate_plan_partner_scope_check" CHECK (
  ("partner_id" IS NOT NULL OR ("partner_account_id" IS NULL AND "partner_customer_id" IS NULL AND "guest_kind" IS NULL))
  AND ("partner_id" IS NULL OR "parent_rate_plan_id" IS NULL)
  AND ("for_operator" = ("partner_id" IS NOT NULL))
);

-- «Один корпоративный на гостиницу» больше не правда: уникален НАБОР условий
-- с питанием. Два действующих тарифа на одно и то же сделали бы цену
-- случайной.
DROP INDEX IF EXISTS "rate_plan_operator_key";
CREATE UNIQUE INDEX "rate_plan_partner_scope_key"
  ON "rate_plan" ("tenant_id", "partner_id", "partner_account_id", "partner_customer_id", "guest_kind", "meal_plan")
  NULLS NOT DISTINCT
  WHERE "partner_id" IS NOT NULL AND "is_active";
CREATE INDEX "rate_plan_partner_idx" ON "rate_plan" ("tenant_id", "partner_id");

-- Цена по числу гостей у базовой цены и сезона; 0 — на любое число (все
-- прежние цены).
ALTER TABLE "standard_rate" ADD COLUMN "occupancy" INTEGER NOT NULL DEFAULT 0;
DROP INDEX IF EXISTS "standard_rate_tenant_id_rate_plan_id_room_type_id_key";
CREATE UNIQUE INDEX "standard_rate_tenant_id_rate_plan_id_room_type_id_occupancy_key"
  ON "standard_rate" ("tenant_id", "rate_plan_id", "room_type_id", "occupancy");
ALTER TABLE "rate_season" ADD COLUMN "occupancy" INTEGER NOT NULL DEFAULT 0;
