-- КЛЮЧ ГОСТИНИЦЫ К «ОТЧЁТАМ KARS AVIA» (07.10.2026, 152-ФЗ, Р-44; план 11.3).
--
-- Отчёты гостиницы PMS забирала у Kars Avia по общему секрету вебхуков: кто
-- знал его, читал отчёты (ФИО гостей, суммы) любой гостиницы. Теперь у каждой
-- гостиницы свой ключ — его выдаёт и присылает Kars Avia (при приглашении в
-- кабинет и при выпуске отчёта), PMS только хранит и предъявляет.
--
-- Отдельная таблица, а не колонка в "tenant": строку гостиницы целиком отдают
-- её же настройки, и ключ уехал бы в браузер. Таблица служебная: читает и
-- пишет её только сервер от своего имени (admin-клиент).

CREATE TABLE "avia_reports_key" (
  "tenant_id"  UUID         NOT NULL,
  "key"        TEXT         NOT NULL,
  "partner_id" UUID,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "avia_reports_key_pkey" PRIMARY KEY ("tenant_id"),
  CONSTRAINT "avia_reports_key_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

REVOKE ALL ON TABLE "avia_reports_key" FROM app_user;
