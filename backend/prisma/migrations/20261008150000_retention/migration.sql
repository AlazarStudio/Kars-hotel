-- СРОКИ ХРАНЕНИЯ ПДн В PMS (08.10.2026, 152-ФЗ, Р-11, решение владельца 21;
-- план 13.9).
--
-- 1. Сроки гостиницы: по умолчанию — системные (решение 21), гостиница
--    вправе их СОКРАТИТЬ (не удлинить — это проверяет приложение):
--    retention_cancelled_days — отмена и неявка без начислений (30 дн. от заезда),
--    retention_contacts_days  — телефон и почта гостя (92 дн. от выезда).
-- 2. Дата выключения сотрудника: уволенного обезличивают через срок после
--    выключения, а без даты срок не от чего считать. Уже выключенным —
--    сегодняшняя дата: срок пойдёт с момента выхода этой версии.
ALTER TABLE "tenant"
  ADD COLUMN "retention_cancelled_days" INTEGER,
  ADD COLUMN "retention_contacts_days"  INTEGER;

ALTER TABLE "app_user" ADD COLUMN "deactivated_at" TIMESTAMP(3);
UPDATE "app_user" SET "deactivated_at" = now() WHERE NOT "isActive" AND "deactivated_at" IS NULL;
