-- Учётки диспетчеров Kars Avia, авто-провижн через partner SSO. Держат роль
-- SUPER_ADMIN (полные права), но в UI помечены «Администратор/Диспетчер».
ALTER TABLE "app_user" ADD COLUMN "is_dispatcher" BOOLEAN NOT NULL DEFAULT false;
