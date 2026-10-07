#!/bin/sh
# Восстановление базы Kars Hotel PMS из суточной копии.
#
# Лежит рядом с копированием НАМЕРЕННО: инструкция, которой нет под рукой в
# нужный момент, равна её отсутствию. Восстанавливают раз в жизни и в спешке.
#
# Запуск на сервере — своей службой `restore` (у `backup` точка входа run.sh,
# и команда через неё запускала бы копирование, а не восстановление):
#   docker compose run --rm restore                                   # список копий
#   docker compose run --rm -e CONFIRM=yes restore pms-2026-09-02_0300.dump
#
# ЧТО ЭТО ДЕЛАЕТ: сносит текущие данные базы и ставит на их место содержимое
# копии. Обратного хода нет, поэтому нужен CONFIRM=yes — случайный запуск не
# должен стирать боевую базу.
#
# РОЛЬ app_user И ИЗОЛЯЦИЯ ГОСТИНИЦ (152-ФЗ, Р-52; план 12.5). Роли живут в
# кластере, а не в базе, и в дамп не попадают. Раньше восстановление шло с
# --no-privileges: на чистой машине у app_user не оставалось прав, приложение
# падало, и его «чинили» суперпользователем в DATABASE_URL — тот обходит RLS,
# и каждая гостиница видела чужие номера (так было 03.09.2026). Теперь:
#  1. app_user заводится здесь же — NOSUPERUSER NOBYPASSRLS, пароль из
#     APP_DB_PASSWORD (тот же, что в DATABASE_URL api);
#  2. права восстанавливаются из копии (без --no-privileges);
#  3. изоляция ПРОВЕРЯЕТСЯ: app_user не суперпользователь и не обходит RLS,
#     права на таблицы у него есть, а без выбранной гостиницы он не видит ни
#     одной строки. Не сошлось — ошибка, а не «Готово».
set -eu

DIR=/backups
FILE="${1:-}"

if [ -z "$FILE" ]; then
  echo "Укажите файл копии. Доступные:"
  ls -1t "$DIR"/pms-*.dump 2>/dev/null | head -20 || echo "  (копий нет)"
  exit 1
fi

SRC="$DIR/$(basename "$FILE")"
[ -f "$SRC" ] || { echo "Нет такого файла: $SRC"; exit 1; }

echo "Проверяю архив…"
pg_restore --list "$SRC" >/dev/null || { echo "Архив не читается — восстанавливать нечего"; exit 1; }

if [ "${CONFIRM:-}" != "yes" ]; then
  echo
  echo "Это ЗАМЕНИТ данные базы $PGDATABASE содержимым $(basename "$SRC")."
  echo "Обратного хода нет. Повторите с CONFIRM=yes, если это то, что нужно."
  exit 2
fi

[ -n "${APP_DB_PASSWORD:-}" ] || { echo "Нужен APP_DB_PASSWORD — пароль app_user из .env"; exit 1; }

started=$(date +%s)

echo "Роль app_user: без суперпользователя и без обхода RLS…"
psql -v ON_ERROR_STOP=1 -q -v pw="$APP_DB_PASSWORD" <<'SQL'
SELECT NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') AS missing \gset
\if :missing
  CREATE ROLE app_user LOGIN;
\endif
ALTER ROLE app_user WITH LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE INHERIT PASSWORD :'pw';
SQL

# --clean --if-exists: снести существующие объекты перед заливкой. Без этого
# восстановление поверх живой базы падает на первом же конфликте имён и
# оставляет её наполовину старой, наполовину новой — худшее из состояний.
# Права (GRANT app_user) — из копии: роль уже заведена.
echo "Восстанавливаю $PGDATABASE из $(basename "$SRC")…"
pg_restore --clean --if-exists --no-owner -d "$PGDATABASE" "$SRC"

echo "Проверяю изоляцию гостиниц…"
psql -v ON_ERROR_STOP=1 -q -At <<'SQL'
DO $$
DECLARE
  r record;
  n bigint;
  rls_tables int;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user' AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'app_user — суперпользователь или обходит RLS';
  END IF;
  SELECT count(*) INTO rls_tables FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
   WHERE s.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity;
  IF rls_tables = 0 THEN
    RAISE EXCEPTION 'ни у одной таблицы не включён RLS';
  END IF;
  -- Политика есть, а RLS выключен — политика не действует.
  FOR r IN SELECT DISTINCT p.tablename AS relname FROM pg_policies p
             JOIN pg_class c ON c.relname = p.tablename
             JOIN pg_namespace s ON s.oid = c.relnamespace AND s.nspname = p.schemaname
            WHERE p.schemaname = 'public' AND NOT c.relrowsecurity LOOP
    RAISE EXCEPTION 'у % есть политика, но RLS выключен', r.relname;
  END LOOP;
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
            WHERE s.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity LOOP
    IF NOT has_table_privilege('app_user', format('public.%I', r.relname), 'SELECT') THEN
      RAISE EXCEPTION 'у app_user нет прав на %', r.relname;
    END IF;
  END LOOP;
  -- Без выбранной гостиницы app_user не видит ничего.
  SET LOCAL ROLE app_user;
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace s ON s.oid = c.relnamespace
            WHERE s.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity LOOP
    EXECUTE format('SELECT count(*) FROM public.%I', r.relname) INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION 'app_user без гостиницы видит % строк в %', n, r.relname;
    END IF;
  END LOOP;
  RESET ROLE;
  RAISE NOTICE 'изоляция в порядке: RLS у % таблиц, app_user без гостиницы видит 0 строк', rls_tables;
END
$$;
SQL

echo "Готово за $(( $(date +%s) - started )) с. Проверьте вход в кабинет и последние брони."
