-- RLS НА СЧЕТАХ, ПЛАТЕЖАХ И УБОРКЕ (08.10.2026, 152-ФЗ, Р-09; план 13.1).
--
-- Четыре таблицы гостиниц жили без RLS, а FolioService ходил в них
-- суперпользователем (prisma.admin) и не сверял гостиницу: запрос счёта по
-- чужой брони СОЗДАВАЛ чужой счёт и давал в него писать, а 409 при выезде
-- называл остаток чужого счёта. Теперь — та же политика tenant_isolation, что
-- у остальных таблиц гостиницы: app_user видит и пишет только строки той
-- гостиницы, что выбрана в app.tenant_id; без неё — ничего.

ALTER TABLE "folio" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "folio" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "folio";
CREATE POLICY tenant_isolation ON "folio"
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

ALTER TABLE "folio_charge" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "folio_charge" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "folio_charge";
CREATE POLICY tenant_isolation ON "folio_charge"
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

ALTER TABLE "payment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "payment";
CREATE POLICY tenant_isolation ON "payment"
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

ALTER TABLE "housekeeping_task" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "housekeeping_task" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "housekeeping_task";
CREATE POLICY tenant_isolation ON "housekeeping_task"
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
