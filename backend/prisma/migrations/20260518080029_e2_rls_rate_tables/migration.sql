-- ============================================================================
-- Phase E.2 — RLS policies for rate_plan, rate, restriction, cancellation_policy,
-- payment_policy.  Same template as the room_type/room policies from D.2.
-- ============================================================================

-- rate_plan
ALTER TABLE "rate_plan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rate_plan" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "rate_plan";
CREATE POLICY tenant_isolation ON "rate_plan"
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

-- rate
ALTER TABLE "rate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rate" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "rate";
CREATE POLICY tenant_isolation ON "rate"
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

-- restriction
ALTER TABLE "restriction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "restriction" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "restriction";
CREATE POLICY tenant_isolation ON "restriction"
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

-- cancellation_policy
ALTER TABLE "cancellation_policy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cancellation_policy" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "cancellation_policy";
CREATE POLICY tenant_isolation ON "cancellation_policy"
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

-- payment_policy
ALTER TABLE "payment_policy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_policy" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "payment_policy";
CREATE POLICY tenant_isolation ON "payment_policy"
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
