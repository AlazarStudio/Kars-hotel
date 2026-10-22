-- ЖУРНАЛ ДЕЙСТВИЙ (23.10.2026, просьба владельца). Каждый запрос, меняющий
-- данные, и каждое нажатие в кабинете — кто, когда, что нажал и что вышло, —
-- чтобы по нему восстанавливать события. Пример, ради которого: «кто сменил
-- взрослых 1 → 2 на брони 0913» восстанавливали по журналу прокси.
-- audit_log остаётся журналом смысловых событий. Пишет только сервер
-- (admin-клиент); app_user к таблице доступа не имеет. Хранится бессрочно.
-- Внешних ключей нет намеренно: запись журнала переживает и пользователя,
-- и гостиницу.
CREATE TABLE "action_journal" (
  "id"              UUID         NOT NULL DEFAULT gen_random_uuid(),
  "at"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "kind"            TEXT         NOT NULL,
  "tenant_id"       UUID,
  "user_id"         UUID,
  "email"           TEXT,
  "impersonated_by" TEXT,
  "partner_id"      TEXT,
  "session_id"      TEXT,
  "action_id"       TEXT,
  "method"          TEXT,
  "route"           TEXT,
  "path"            TEXT,
  "page"            TEXT,
  "status"          INTEGER,
  "duration_ms"     INTEGER,
  "body"            JSONB,
  "query"           JSONB,
  "error"           TEXT,
  "event"           TEXT,
  "label"           TEXT,
  "target"          TEXT,
  "meta"            JSONB,
  "ip"              TEXT,
  "user_agent"      TEXT,
  CONSTRAINT "action_journal_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "action_journal_at_idx" ON "action_journal" ("at");
CREATE INDEX "action_journal_tenant_id_at_idx" ON "action_journal" ("tenant_id", "at");
CREATE INDEX "action_journal_user_id_at_idx" ON "action_journal" ("user_id", "at");
CREATE INDEX "action_journal_session_id_at_idx" ON "action_journal" ("session_id", "at");
CREATE INDEX "action_journal_action_id_idx" ON "action_journal" ("action_id");
REVOKE ALL ON TABLE "action_journal" FROM app_user;
