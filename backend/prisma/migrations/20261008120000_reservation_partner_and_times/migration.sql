-- ЧЬЯ БРОНЬ И КОГДА ГОСТЬ ПРИЕХАЛ (08.10.2026, 152-ФЗ, Р-35, Р-41; план 13.10).
--
-- 1. partner_id. Партнёрский API читал (и отменял) любую бронь гостиницы по
--    её UUID: бронь, заведённую самой гостиницей, и бронь другого партнёра.
--    Флага channel_managed для «чья» мало — партнёров уже может быть больше
--    одного. Теперь бронь помнит партнёра, и API видит только свои.
--    Существующие брони канала — у единственного партнёра, Kars Avia.
-- 2. checked_in_at / checked_out_at. Время заезда не хранилось: партнёр
--    получал «время последней правки брони» — и любая правка после заезда
--    сдвигала его. Теперь время ставится в момент заселения и выселения. У
--    старых броней оно неизвестно и остаётся пустым — честнее, чем выдумать.
ALTER TABLE "reservation"
  ADD COLUMN "partner_id"     UUID,
  ADD COLUMN "checked_in_at"  TIMESTAMP(3),
  ADD COLUMN "checked_out_at" TIMESTAMP(3);

ALTER TABLE "reservation"
  ADD CONSTRAINT "reservation_partner_id_fkey" FOREIGN KEY ("partner_id")
  REFERENCES "partner" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "reservation_partner_id_idx" ON "reservation" ("partner_id");

UPDATE "reservation"
   SET "partner_id" = (SELECT "id" FROM "partner" WHERE "code" = 'kars-avia')
 WHERE "channel_managed" AND "partner_id" IS NULL;
