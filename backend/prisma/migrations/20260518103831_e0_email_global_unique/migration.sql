-- ============================================================================
-- E0 — Switch User.email from per-tenant unique to GLOBALLY unique.
-- ============================================================================
-- This enables email+password login without asking the user which tenant they
-- belong to. The tradeoff: one person == one email == one hotel. If the same
-- person needs to work in two hotels they will need two emails.
--
-- Safety: existing data has been verified to contain no duplicate emails.
-- If new duplicates appeared after this migration was authored, the
-- CREATE UNIQUE INDEX below would fail and the migration would abort.
-- ============================================================================

-- Drop the composite uniqueness covering (tenant_id, email).
DROP INDEX IF EXISTS "app_user_tenant_id_email_key";

-- Add a global uniqueness on email alone.
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user"("email");
