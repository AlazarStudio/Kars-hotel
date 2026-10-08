-- ОФЕРТА PMS С ПОРУЧЕНИЕМ И КОНТАКТ ДЛЯ ИНЦИДЕНТОВ (08.10.2026, 152-ФЗ, Р-29,
-- Р-06; план 13.11).
--
-- Обработчиком ПДн гостиницы Карс становится в день выдачи кабинета, а
-- принятие оферты с поручением нигде не фиксировалось; контакта для
-- уведомления об инциденте не было у 393 из 393 гостиниц.
--
-- tenant_offer_acceptance — кто, когда и какую версию принял (с адресом и
-- устройством): факт принятия не переписывается, каждая версия — своя
-- строка. Контакт для инцидентов — у гостиницы: его спрашивают при принятии.
-- Таблица служебная: пишет и читает её сервер от своего имени.
CREATE TABLE "tenant_offer_acceptance" (
  "id"          UUID         NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"   UUID         NOT NULL,
  "version"     INTEGER      NOT NULL,
  "user_id"     UUID         NOT NULL,
  "ip"          TEXT,
  "user_agent"  TEXT,
  "accepted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_offer_acceptance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tenant_offer_acceptance_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "tenant_offer_acceptance_tenant_version_key"
  ON "tenant_offer_acceptance" ("tenant_id", "version");
REVOKE ALL ON TABLE "tenant_offer_acceptance" FROM app_user;

ALTER TABLE "tenant"
  ADD COLUMN "incident_contact_name"  TEXT,
  ADD COLUMN "incident_contact_phone" TEXT,
  ADD COLUMN "incident_contact_email" TEXT;
