-- АКТ УХОДА ГОСТИНИЦЫ ИЗ PMS (08.10.2026, 152-ФЗ, Г-22, ГС-09; план 13.8).
--
-- Гостиница уходит — её данные выгружаются ей и уничтожаются. Удаление строки
-- tenant раньше оставляло брони, номера, счета (у них нет внешнего ключа на
-- tenant) и журнал с ФИО гостей — 171 запись, 75 с ФИО. Акт — что выгружено
-- (контрольная сумма), когда и кем уничтожено, сколько строк в каких
-- таблицах. Персональных данных в акте нет; внешнего ключа на tenant тоже —
-- акт переживает гостиницу. Пишет и читает его только сервер.
CREATE TABLE "tenant_exit_act" (
  "id"            UUID         NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"     UUID         NOT NULL,
  "tenant_slug"   TEXT         NOT NULL,
  "tenant_name"   TEXT         NOT NULL,
  "exported_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "exported_by"   UUID         NOT NULL,
  "export_sha256" TEXT         NOT NULL,
  "destroyed_at"  TIMESTAMP(3),
  "destroyed_by"  UUID,
  "counts"        JSONB,
  CONSTRAINT "tenant_exit_act_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "tenant_exit_act_tenant_id_idx" ON "tenant_exit_act" ("tenant_id");
REVOKE ALL ON TABLE "tenant_exit_act" FROM app_user;
