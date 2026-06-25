-- ============================================================================
-- Connectivity — Partner API keys for the cross-tenant /api/connect/v1 API.
-- ============================================================================
-- A partner key (TravelLine / Stripe style) lets an external system such as the
-- Kars Avia dispatcher platform call the connectivity API across all hotels.
-- Only a SHA-256 hash of the key is stored; the plaintext is shown once.
--
-- This table is GLOBAL (not tenant-scoped) and holds secrets, so:
--   * it is accessed exclusively through the admin (BYPASSRLS) Prisma client;
--   * the runtime `app_user` role is denied ALL access (defense in depth) so a
--     compromised application connection cannot read or forge key hashes.
-- ============================================================================

-- CreateTable
CREATE TABLE "partner_api_key" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "partner_api_key_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "partner_api_key_key_prefix_key" ON "partner_api_key"("key_prefix");

-- CreateIndex
CREATE INDEX "partner_api_key_key_prefix_idx" ON "partner_api_key"("key_prefix");

-- ─── Security: deny the runtime role any access to the secret store ──────────
-- The b2 migration grants app_user CRUD on all current + future tables via
-- ALTER DEFAULT PRIVILEGES; we explicitly claw that back for this table.
REVOKE ALL ON TABLE "partner_api_key" FROM app_user;
