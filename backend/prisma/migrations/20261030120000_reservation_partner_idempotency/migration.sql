-- Идемпотентное создание партнёрских броней: после потери HTTP-ответа повтор
-- возвращает уже занятую им бронь вместо второй записи или конфликта мест.
-- Отпечаток относится к исходному запросу, поэтому правка брони и тарифа его
-- не меняет. Старые брони остаются без ключей; бэкфилл для них не нужен.
ALTER TABLE "reservation"
  ADD COLUMN "partner_idempotency_key" VARCHAR(200),
  ADD COLUMN "partner_payload_hash" CHAR(64),
  ADD CONSTRAINT "reservation_partner_idempotency_check" CHECK (
    ("partner_idempotency_key" IS NULL AND "partner_payload_hash" IS NULL)
    OR (
      "partner_idempotency_key" IS NOT NULL
      AND "partner_payload_hash" IS NOT NULL
      AND "partner_id" IS NOT NULL
      AND "channel_managed" = true
    )
  );

-- NULL сохраняет совместимость для вызовов без ключа. Ключ принадлежит
-- конкретному партнёру в гостинице; ограничение страхует конкурирующие INSERT.
CREATE UNIQUE INDEX "reservation_partner_idempotency_key"
  ON "reservation" ("tenant_id", "partner_id", "partner_idempotency_key");
