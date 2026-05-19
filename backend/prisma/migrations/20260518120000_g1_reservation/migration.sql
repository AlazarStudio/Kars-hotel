-- Phase G.1 — Reservation table + RLS
-- ---------------------------------------------------------------------------

CREATE TYPE "ReservationStatus" AS ENUM (
  'NEW', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW'
);

CREATE TYPE "ReservationSource" AS ENUM (
  'DIRECT', 'PHONE', 'ONLINE', 'OTA', 'CORPORATE'
);

CREATE TABLE "reservation" (
    "id"           UUID                NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"    UUID                NOT NULL,
    "room_id"      UUID                NOT NULL,
    "room_type_id" UUID                NOT NULL,
    "guest_name"   TEXT                NOT NULL,
    "phone"        TEXT,
    "email"        TEXT,
    "check_in"     DATE                NOT NULL,
    "check_out"    DATE                NOT NULL,
    "status"       "ReservationStatus" NOT NULL DEFAULT 'NEW',
    "adults"       INTEGER             NOT NULL DEFAULT 1,
    "children"     INTEGER             NOT NULL DEFAULT 0,
    "total_price"  NUMERIC(12,2),
    "rate_plan_id" UUID,
    "source"       "ReservationSource" NOT NULL DEFAULT 'DIRECT',
    "notes"        TEXT,
    "version"      INTEGER             NOT NULL DEFAULT 0,
    "created_at"   TIMESTAMPTZ         NOT NULL DEFAULT now(),
    "updated_at"   TIMESTAMPTZ         NOT NULL DEFAULT now(),

    CONSTRAINT "reservation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "reservation_room_id_fkey"
        FOREIGN KEY ("room_id") REFERENCES "room"("id"),
    CONSTRAINT "reservation_check_out_after_check_in"
        CHECK ("check_out" > "check_in"),
    CONSTRAINT "reservation_adults_positive"
        CHECK ("adults" >= 1),
    CONSTRAINT "reservation_children_non_negative"
        CHECK ("children" >= 0)
);

-- Indexes
CREATE INDEX "reservation_tenant_id_idx"
    ON "reservation" ("tenant_id");

CREATE INDEX "reservation_tenant_room_dates_idx"
    ON "reservation" ("tenant_id", "room_id", "check_in", "check_out");

CREATE INDEX "reservation_tenant_dates_idx"
    ON "reservation" ("tenant_id", "check_in", "check_out");

CREATE INDEX "reservation_tenant_status_idx"
    ON "reservation" ("tenant_id", "status");

-- updated_at trigger
CREATE TRIGGER "reservation_updated_at"
    BEFORE UPDATE ON "reservation"
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE "reservation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reservation" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "reservation"
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ---------------------------------------------------------------------------
-- Demo reservations for the "Парковый" hotel (seeded by demo-seed)
-- We'll insert via the application seed, not here.
-- ---------------------------------------------------------------------------
