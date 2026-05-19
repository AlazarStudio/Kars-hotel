-- ============================================================================
-- Phase D.2 — RLS for room_type and room tables.
-- ============================================================================
-- ALTER DEFAULT PRIVILEGES from B.2 already grants SELECT/INSERT/UPDATE/DELETE
-- to app_user for any newly created table in `public`. Here we only need to
-- ENABLE/FORCE ROW LEVEL SECURITY and install the standard
-- `tenant_isolation` policy.
-- ============================================================================

-- room_type
ALTER TABLE "room_type" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "room_type" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "room_type";
CREATE POLICY tenant_isolation ON "room_type"
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

-- room
ALTER TABLE "room" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "room" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "room";
CREATE POLICY tenant_isolation ON "room"
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
