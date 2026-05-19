-- ============================================================================
-- Phase B.2 — PostgreSQL Row-Level Security for multi-tenant isolation.
-- ============================================================================
-- This migration:
--   1. Creates DB role `app_user` (LOGIN, NOSUPERUSER, NOBYPASSRLS) for runtime.
--      Migrations continue to run under the superuser (DATABASE_URL_MIGRATIONS).
--   2. Grants `app_user` the privileges it needs on the current schema.
--   3. Sets default privileges so new tables created by future migrations are
--      automatically usable by `app_user`.
--   4. Enables ROW LEVEL SECURITY (with FORCE) on every tenant-scoped table.
--   5. Creates a `tenant_isolation` policy:
--        USING / WITH CHECK
--          (tenant_id IS NOT NULL
--           AND tenant_id = current_setting('app.tenant_id', true)::uuid)
--      Any query running as `app_user` returns only rows belonging to the tenant
--      whose UUID was set with `SET LOCAL app.tenant_id = '...'`. If the GUC is
--      not set, queries return 0 rows (fail-safe).
-- ============================================================================

-- ─── 1. Create runtime DB role ───────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD 'app_user_dev_pwd'
      NOSUPERUSER
      NOBYPASSRLS
      NOCREATEDB
      NOCREATEROLE
      INHERIT;
  ELSE
    ALTER ROLE app_user WITH LOGIN PASSWORD 'app_user_dev_pwd'
      NOSUPERUSER
      NOBYPASSRLS
      NOCREATEDB
      NOCREATEROLE
      INHERIT;
  END IF;
END
$$;

-- ─── 2. Privileges on existing objects ───────────────────────────────────────
GRANT CONNECT ON DATABASE kars_hotel TO app_user;
GRANT USAGE ON SCHEMA public TO app_user;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO app_user;

-- ─── 3. Default privileges for future tables/sequences ───────────────────────
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO app_user;

-- ─── 4 + 5. Enable RLS and create tenant_isolation policy on each table ──────

-- 4a. role
ALTER TABLE "role" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "role" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "role";
CREATE POLICY tenant_isolation ON "role"
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

-- 4b. app_user table (the application's user table — NOT to be confused with the DB role)
ALTER TABLE "app_user" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app_user" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "app_user";
CREATE POLICY tenant_isolation ON "app_user"
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

-- 4c. refresh_token
ALTER TABLE "refresh_token" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "refresh_token" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "refresh_token";
CREATE POLICY tenant_isolation ON "refresh_token"
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

-- 4d. audit_log (tenant_id NULLABLE — RLS hides NULL rows from app_user)
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "audit_log";
CREATE POLICY tenant_isolation ON "audit_log"
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

-- ─── 6. Tenant table — NOT tenant-isolated by tenant_id (it IS the tenant) ──
-- Instead, app_user can SELECT only the tenant whose id matches app.tenant_id.
ALTER TABLE "tenant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "tenant";
CREATE POLICY tenant_isolation ON "tenant"
  AS PERMISSIVE FOR ALL
  TO app_user
  USING (id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (id = current_setting('app.tenant_id', true)::uuid);

-- ─── 7. Permission + RolePermission — global catalogs, READ-ONLY for app ────
-- Permissions are a system-wide reference. app_user can read all rows but
-- cannot modify them (writes are migration-only).
REVOKE INSERT, UPDATE, DELETE ON TABLE "permission" FROM app_user;
REVOKE INSERT, UPDATE, DELETE ON TABLE "role_permission" FROM app_user;

-- ─── 8. _schema_info — readable for /health, not writable by runtime ─────────
REVOKE INSERT, UPDATE, DELETE ON TABLE "_schema_info" FROM app_user;

-- ─── 9. _prisma_migrations — internal, app_user does NOT need access ─────────
-- Guard with IF EXISTS: the table is absent in Prisma's shadow database.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = '_prisma_migrations'
  ) THEN
    EXECUTE 'REVOKE ALL ON TABLE "_prisma_migrations" FROM app_user';
  END IF;
END
$$;
