-- Панель резервных копий (02.11.2026, после аварии Beget).
--
-- 02.11 Beget лёг целиком, а копии PMS лежали только на её же сервере. Теперь
-- служба `backup` читает настройки отсюда, раз в минуту отмечается
-- (agent_seen_at) и пишет каждую копию в журнал; Kars Avia показывает их в
-- своей админке, правит настройки и рассылает оповещения — по API
-- (/api/connect/v1/backups, право ключа `backups:manage`).
--
-- Служебные таблицы: без RLS и без прав app_user — читает их только
-- админский клиент. Скрипт пишет сырым SQL, поэтому умолчания — в базе.
CREATE TABLE "backup_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "at_hour" INTEGER NOT NULL DEFAULT 3,
    "every_hours" INTEGER NOT NULL DEFAULT 24,
    "keep_days" INTEGER NOT NULL DEFAULT 14,
    "mail_to" TEXT,
    "age_recipient" TEXT,
    "run_requested_at" TIMESTAMP(3),
    "agent_seen_at" TIMESTAMP(3),
    "agent_info" JSONB,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "backup_config_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "backup_config_single" CHECK ("id" = 1)
);

INSERT INTO "backup_config" ("id") VALUES (1);

CREATE TABLE "backup_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "file" TEXT,
    "size_bytes" BIGINT,
    "mail" TEXT,
    "offsite" TEXT,
    "error" TEXT,
    CONSTRAINT "backup_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "backup_runs_started_at_idx" ON "backup_runs"("started_at");

-- Права по умолчанию (миграция B.2) выдают app_user всё на новые таблицы —
-- здесь это лишнее: гостиница не должна видеть даже время копий.
REVOKE ALL ON "backup_config", "backup_runs" FROM app_user;
