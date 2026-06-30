-- ============================================================================
-- Mark reservations that are owned by an external partner channel.
--
-- `channel_managed = true` means the reservation was created by a partner
-- (e.g. Kars Avia) through the connectivity API. The owning channel controls
-- its lifecycle: hotel staff may view it but cannot cancel it from the PMS —
-- only the partner can release it via the connectivity API. The cancel guard
-- lives in the application layer (ReservationsService.cancel).
--
-- No RLS change needed: the column lives on the existing tenant-isolated
-- `reservation` table and inherits its policy.
-- ============================================================================

ALTER TABLE "reservation"
    ADD COLUMN "channel_managed" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: existing partner-created bookings are tagged with an operator
-- reference in their notes ("[ref:...]") written by the connectivity service.
-- Treat those as channel-managed so the guard applies to historical data too.
UPDATE "reservation"
SET "channel_managed" = true
WHERE "notes" LIKE '%[ref:%';
