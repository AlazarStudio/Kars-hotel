-- Б5/Е2/Е4 · каталог услуг отеля для партнёра: питание и доп. услуги.
--
-- Тарифные планы (rate_plan) отвечают за проживание — сколько стоит ночь в
-- категории. Но диспетчеру нужна и цена обеда, и «сколько стоит поздний
-- выезд»: это отдельные строки в заявке и в расчёте с авиакомпанией. Раньше
-- такие цены жили только в заглушке hotel-mock, то есть нигде: на живой PMS
-- вкладка «Тарифы» показывала одно проживание.
CREATE TYPE "PartnerServiceGroup" AS ENUM ('MEAL', 'EXTRA');

CREATE TABLE "partner_service" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "group" "PartnerServiceGroup" NOT NULL,
  "name" TEXT NOT NULL,
  -- Цена без НДС в рублях; NULL допустим для услуг «по запросу».
  "price_net" DECIMAL(12,2),
  -- Ставка НДС хранится у услуги, а не берётся у отеля: у питания и
  -- проживания ставки различаются.
  "vat_rate" DECIMAL(5,2) NOT NULL DEFAULT 20,
  -- «Стоимость по запросу»: цена есть, но называется в переписке — так
  -- работают банкеты и нестандартные заказы. Отдельный флаг, а не price = 0:
  -- ноль читается как «бесплатно» и попадёт в расчёт.
  "on_request" BOOLEAN NOT NULL DEFAULT false,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "partner_service_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "partner_service_tenant_id_group_idx"
  ON "partner_service"("tenant_id", "group");

ALTER TABLE "partner_service"
  ADD CONSTRAINT "partner_service_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: каталог услуг — данные тенанта, как и всё остальное в этой базе.
-- Форма политики та же, что у role/app_user (миграция b2_rls_policies), чтобы
-- изоляция везде работала одинаково и её не приходилось перепроверять на
-- каждой таблице отдельно.
ALTER TABLE "partner_service" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "partner_service" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "partner_service";
CREATE POLICY tenant_isolation ON "partner_service"
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
