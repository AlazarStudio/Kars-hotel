-- ============================================================================
-- Standard prices + seasonal prices for rate plans.
--
-- Adds two tenant-scoped tables that sit "below" the per-day Rate rows:
--   standard_rate  — one baseline price per (rate_plan × room_type)
--   rate_season    — named date-range price overrides per (rate_plan × room_type)
--
-- Price resolution for a (rate_plan, room_type, date):
--   per-day rate  →  covering season  →  standard_rate  →  room_type.base_price
--
-- Both tables follow the same tenant_isolation RLS template as rate/rate_plan.
-- Table-level GRANTs to app_user are provided automatically by the ALTER
-- DEFAULT PRIVILEGES set in migration 20260516184247_b2_rls_policies.
-- ============================================================================

-- ─── standard_rate ───────────────────────────────────────────────────────────
CREATE TABLE "standard_rate" (
    "id"            UUID NOT NULL,
    "tenant_id"     UUID NOT NULL,
    "rate_plan_id"  UUID NOT NULL,
    "room_type_id"  UUID NOT NULL,
    "price"         DECIMAL(12,2) NOT NULL,
    "currency"      TEXT NOT NULL DEFAULT 'RUB',
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,
    CONSTRAINT "standard_rate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "standard_rate_tenant_id_rate_plan_id_room_type_id_key"
    ON "standard_rate" ("tenant_id", "rate_plan_id", "room_type_id");
CREATE INDEX "standard_rate_tenant_id_idx" ON "standard_rate" ("tenant_id");
CREATE INDEX "standard_rate_rate_plan_id_room_type_id_idx"
    ON "standard_rate" ("rate_plan_id", "room_type_id");

ALTER TABLE "standard_rate"
    ADD CONSTRAINT "standard_rate_rate_plan_id_fkey"
    FOREIGN KEY ("rate_plan_id") REFERENCES "rate_plan"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "standard_rate"
    ADD CONSTRAINT "standard_rate_room_type_id_fkey"
    FOREIGN KEY ("room_type_id") REFERENCES "room_type"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── rate_season ─────────────────────────────────────────────────────────────
CREATE TABLE "rate_season" (
    "id"            UUID NOT NULL,
    "tenant_id"     UUID NOT NULL,
    "rate_plan_id"  UUID NOT NULL,
    "room_type_id"  UUID NOT NULL,
    "name"          TEXT NOT NULL,
    "color"         TEXT,
    "date_from"     DATE NOT NULL,
    "date_to"       DATE NOT NULL,
    "price"         DECIMAL(12,2) NOT NULL,
    "currency"      TEXT NOT NULL DEFAULT 'RUB',
    "sort_order"    INTEGER NOT NULL DEFAULT 0,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL,
    CONSTRAINT "rate_season_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "rate_season_tenant_id_idx" ON "rate_season" ("tenant_id");
CREATE INDEX "rate_season_rate_plan_id_room_type_id_date_from_date_to_idx"
    ON "rate_season" ("rate_plan_id", "room_type_id", "date_from", "date_to");

ALTER TABLE "rate_season"
    ADD CONSTRAINT "rate_season_rate_plan_id_fkey"
    FOREIGN KEY ("rate_plan_id") REFERENCES "rate_plan"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "rate_season"
    ADD CONSTRAINT "rate_season_room_type_id_fkey"
    FOREIGN KEY ("room_type_id") REFERENCES "room_type"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- ─── RLS: tenant_isolation (same template as rate / rate_plan) ────────────────
ALTER TABLE "standard_rate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "standard_rate" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "standard_rate";
CREATE POLICY tenant_isolation ON "standard_rate"
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

ALTER TABLE "rate_season" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rate_season" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "rate_season";
CREATE POLICY tenant_isolation ON "rate_season"
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

-- Belt-and-suspenders: explicit grants in case default privileges were altered.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "standard_rate" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "rate_season" TO app_user;
