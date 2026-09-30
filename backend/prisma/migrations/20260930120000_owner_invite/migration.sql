-- ПРИГЛАШЕНИЕ ВЛАДЕЛЬЦА В КАБИНЕТ ГОСТИНИЦЫ (30.09.2026, Э10).
--
-- Из 393 гостиниц свой кабинет был у одной: остальные заведены партнёром и
-- ведутся им. Чтобы гостиница сама вела корпоративные тарифы, партнёр её
-- приглашает; владелец задаёт пароль по одноразовой ссылке — пароль через
-- партнёра не проходит. Токен ссылки хранится хешем.
--
-- Таблица служебная: читает и пишет её только сервер от своего имени
-- (admin-клиент); рабочей роли приложения доступ не нужен.

CREATE TABLE "owner_invite" (
  "id"         UUID         NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"  UUID         NOT NULL,
  "email"      TEXT         NOT NULL,
  "full_name"  TEXT         NOT NULL,
  "token_hash" TEXT         NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "used_at"    TIMESTAMP(3),
  "revoked"    BOOLEAN      NOT NULL DEFAULT FALSE,
  "partner_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "owner_invite_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "owner_invite_tenant_id_fkey" FOREIGN KEY ("tenant_id")
    REFERENCES "tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "owner_invite_token_hash_key" ON "owner_invite" ("token_hash");
CREATE INDEX "owner_invite_tenant_id_idx" ON "owner_invite" ("tenant_id");

REVOKE ALL ON TABLE "owner_invite" FROM app_user;
