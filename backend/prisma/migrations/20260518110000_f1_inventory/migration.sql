-- Phase F.1 — Inventory table + RLS
-- ---------------------------------------------------------------------------
-- inventory: per-date availability snapshot per room type.
-- ---------------------------------------------------------------------------

CREATE TABLE "inventory" (
    "id"            UUID        NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id"     UUID        NOT NULL,
    "room_type_id"  UUID        NOT NULL,
    "date"          DATE        NOT NULL,
    "total_rooms"   INTEGER     NOT NULL,
    "booked_rooms"  INTEGER     NOT NULL DEFAULT 0,
    "blocked_rooms" INTEGER     NOT NULL DEFAULT 0,
    "stop_sell"     BOOLEAN     NOT NULL DEFAULT false,
    "created_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"    TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "inventory_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "inventory_room_type_id_fkey"
        FOREIGN KEY ("room_type_id") REFERENCES "room_type"("id") ON DELETE CASCADE,
    CONSTRAINT "inventory_booked_non_negative"  CHECK ("booked_rooms"  >= 0),
    CONSTRAINT "inventory_blocked_non_negative" CHECK ("blocked_rooms" >= 0),
    CONSTRAINT "inventory_total_positive"       CHECK ("total_rooms"   >= 0)
);

-- Unique: one row per (tenant, roomType, date)
CREATE UNIQUE INDEX "inventory_tenant_id_room_type_id_date_key"
    ON "inventory" ("tenant_id", "room_type_id", "date");

-- For availability queries: range scans on roomType+date
CREATE INDEX "inventory_room_type_id_date_idx"
    ON "inventory" ("room_type_id", "date");

-- For RLS predicate
CREATE INDEX "inventory_tenant_id_idx"
    ON "inventory" ("tenant_id");

-- updated_at trigger (re-use the helper from earlier migrations if it exists,
-- otherwise create it here)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at'
  ) THEN
    CREATE OR REPLACE FUNCTION set_updated_at()
    RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
    BEGIN NEW.updated_at = now(); RETURN NEW; END;
    $fn$;
  END IF;
END $$;

CREATE TRIGGER "inventory_updated_at"
    BEFORE UPDATE ON "inventory"
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------
ALTER TABLE "inventory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "inventory" FORCE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON "inventory"
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
