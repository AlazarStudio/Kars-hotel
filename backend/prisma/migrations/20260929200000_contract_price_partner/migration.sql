-- КОПИЯ ДОГОВОРНЫХ ЦЕН: ЧЕЙ ДОГОВОР И С КАКИМ ЮРЛИЦОМ (29.09.2026).
--
-- Копия договорных цен жила «у гостиницы вообще»: партнёр был один, и чей
-- это договор, не спрашивали. Теперь партнёров может быть несколько, и
-- синхронизация одного не должна стирать документы другого, а номер договора
-- одного не должен совпасть с номером другого при сверке тарифа.
--
-- Юрлицо партнёра, подписавшее договор, — снимок кода и названия: по нему
-- гостиница заводит тариф «для этого юрлица», а справочник партнёра может
-- прийти позже копии цен.

ALTER TABLE "partner_contract_price" ADD COLUMN "partner_id" UUID;
UPDATE "partner_contract_price"
   SET "partner_id" = (SELECT "id" FROM "partner" WHERE "code" = 'kars-avia');
ALTER TABLE "partner_contract_price" ALTER COLUMN "partner_id" SET NOT NULL;
ALTER TABLE "partner_contract_price"
  ADD CONSTRAINT "partner_contract_price_partner_id_fkey" FOREIGN KEY ("partner_id")
  REFERENCES "partner" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "partner_contract_price" ADD COLUMN "account_code" TEXT;
ALTER TABLE "partner_contract_price" ADD COLUMN "account_name" TEXT;

-- Документ один на (гостиница, партнёр, договор, ДС, услуга).
DROP INDEX IF EXISTS "partner_contract_price_doc_key";
CREATE UNIQUE INDEX "partner_contract_price_doc_key"
  ON "partner_contract_price" ("tenant_id", "partner_id", "contract_number", "amendment_number", "service")
  NULLS NOT DISTINCT;
