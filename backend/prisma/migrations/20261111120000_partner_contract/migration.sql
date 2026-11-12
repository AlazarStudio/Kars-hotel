-- 11.11.2026 · Реестр договоров оператора: договор существует и тогда, когда
-- ценового приложения к нему ещё нет.
--
-- До этого гостиница знала о договоре только по приложению: у «Апартаментов
-- сети Карс Авиа» 27 договоров и ни одного приложения — в кабинете пусто, и
-- завести тариф не с чем. Список приходит набором в той же синхронизации, что
-- и цены: присланное заменяет прежнее, чего в наборе нет — того нет.
CREATE TABLE "partner_contract" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"    UUID NOT NULL REFERENCES "tenant"("id") ON DELETE CASCADE,
  "partner_id"   UUID NOT NULL REFERENCES "partner"("id") ON DELETE CASCADE,
  "number"       TEXT NOT NULL,
  "account_code" TEXT,
  "account_name" TEXT,
  "valid_from"   TIMESTAMP(3),
  "valid_to"     TIMESTAMP(3),
  "is_primary"   BOOLEAN NOT NULL DEFAULT false,
  "state"        TEXT NOT NULL DEFAULT 'ACTIVE',
  "services"     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "sheets_count" INTEGER NOT NULL DEFAULT 0,
  "received_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "partner_contract_key"
  ON "partner_contract" ("tenant_id", "partner_id", "number");
CREATE INDEX "partner_contract_tenant_idx" ON "partner_contract" ("tenant_id");

-- Изоляция арендаторов — как у цен: договор с оператором у каждой гостиницы
-- свой, и подглядывать в чужой она не должна.
ALTER TABLE "partner_contract" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "partner_contract" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "partner_contract";
CREATE POLICY tenant_isolation ON "partner_contract"
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
