-- Закупочные цены договора с оператором: снапшот, присланный Kars Avia.
--
-- Гостиница должна видеть, по какой цене её посчитает оператор. До сих пор не
-- видела никак: цена жила только в реестре договоров Авии, и спор по акту
-- решался перепиской. Вести вторую копию у себя гостиница при этом не должна —
-- договор подписан двумя, и менять его в одностороннем порядке нельзя.
--
-- Поэтому здесь снимок и только снимок: запись приходит по партнёрскому API,
-- правится на стороне Авии, а PMS её показывает. Гостиница, работающая без
-- оператора, таких строк не имеет вовсе — и правильно, что не имеет.
--
-- Строки — JSON: это снимок чужого документа, а не сущность, по которой PMS
-- считает. Считает она по СВОИМ тарифам; корпоративный тариф для оператора
-- заводится отдельно.
CREATE TABLE "partner_contract_price" (
  "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"        UUID NOT NULL REFERENCES "tenant"("id") ON DELETE CASCADE,
  "contract_number"  TEXT NOT NULL,
  "amendment_number" TEXT,
  "service"          TEXT NOT NULL,
  "valid_from"       TIMESTAMP(3) NOT NULL,
  "valid_to"         TIMESTAMP(3),
  "vat_rate"         DECIMAL(5,2),
  "rows"             JSONB NOT NULL,
  "received_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Полная замена по документу: у пары «договор + ДС» и услуги приложение одно.
-- NULLS NOT DISTINCT — иначе строки без ДС не считались бы дублями, и каждое
-- зеркалирование договора без ДС плодило бы новую запись.
CREATE UNIQUE INDEX "partner_contract_price_doc_key"
  ON "partner_contract_price" ("tenant_id", "contract_number", "amendment_number", "service")
  NULLS NOT DISTINCT;
CREATE INDEX "partner_contract_price_tenant_idx"
  ON "partner_contract_price" ("tenant_id");

-- Изоляция арендаторов — как у всех тенантных таблиц: гостиница видит только
-- свои цены. Договор с оператором у каждой свой, и подглядывать в чужой она не
-- должна тем более.
ALTER TABLE "partner_contract_price" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "partner_contract_price" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "partner_contract_price";
CREATE POLICY tenant_isolation ON "partner_contract_price"
  AS PERMISSIVE FOR ALL
  TO app_user
  USING (
    tenant_id IS NOT NULL
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  )
  WITH CHECK (
    tenant_id IS NOT NULL
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );

-- Право на запись цен — отдельным правом, а не «hotels:write»: заводить
-- гостиницу и присылать её цены умеют разные стороны, и смешивать это в одном
-- ключе значит однажды выдать одно вместе с другим.
--
-- Выдаётся сразу существующим живым ключам: право, которого никому не выдано,
-- ничем не отличается от отсутствующего эндпоинта — этот класс ошибки в
-- соседнем проекте уже ловили на досье Автопарка.
UPDATE "partner_api_key"
SET "scopes" = array_append("scopes", 'contract-prices:write')
WHERE "is_active" = TRUE
  AND NOT ('contract-prices:write' = ANY("scopes"));
