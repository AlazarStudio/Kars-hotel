-- Phase H.1 — Multi-place rooms
-- ---------------------------------------------------------------------------
-- 1. Add capacity to room (how many bookable places exist in this room)
-- 2. Add place_number to reservation (which place within the room)
-- ---------------------------------------------------------------------------

ALTER TABLE "room"
  ADD COLUMN "capacity" INTEGER NOT NULL DEFAULT 1
    CONSTRAINT "room_capacity_positive" CHECK ("capacity" >= 1);

ALTER TABLE "reservation"
  ADD COLUMN "place_number" INTEGER NOT NULL DEFAULT 1
    CONSTRAINT "reservation_place_number_positive" CHECK ("place_number" >= 1);

-- Drop the old per-room date index, replace with per-place index
DROP INDEX IF EXISTS "reservation_tenant_room_dates_idx";

CREATE INDEX "reservation_tenant_room_place_dates_idx"
  ON "reservation" ("tenant_id", "room_id", "place_number", "check_in", "check_out");

-- Unique constraint: one booking per place per date range overlap is enforced
-- in application logic (optimistic), but we add a partial index for fast lookups
CREATE INDEX "reservation_room_place_active_idx"
  ON "reservation" ("room_id", "place_number")
  WHERE status NOT IN ('CANCELLED', 'NO_SHOW');
