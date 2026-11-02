#!/bin/sh
# Суточная резервная копия базы Kars Hotel PMS.
#
# Копия, которую ни разу не разворачивали, — не копия, а надежда. Поэтому здесь
# три правила, и каждое закрывает свой способ проснуться без данных:
#
#  1. ПИШЕМ ВО ВРЕМЕННОЕ ИМЯ, переименовываем только после успеха. Оборвался
#     дамп на середине — файл останется с суффиксом `.part` и не притворится
#     готовым. Иначе в каталоге лежал бы обрезанный файл под нормальным именем,
#     и это выяснилось бы в день восстановления.
#  2. ПРОВЕРЯЕМ ЧИТАЕМОСТЬ: `pg_restore --list` разбирает оглавление архива.
#     Это не полное восстановление, но ловит обрыв и порчу — то есть ровно то,
#     что превращает копию в пустой файл нужного размера.
#  3. СТАРЫЕ УДАЛЯЕМ ТОЛЬКО ПОСЛЕ УСПЕХА новой. Чистка впереди дампа однажды
#     снесёт вчерашнее ради сегодняшнего, которое не получилось.
#
# Формат `custom` (-Fc), а не текстовый: он сжат, и из него можно поднять
# отдельную таблицу, не разбирая весь файл руками.
set -eu

DIR=/backups
# Умолчания из окружения; с 02.11.2026 их перекрывают настройки из админки
# Kars Avia (таблица backup_config, load_config ниже).
KEEP="${BACKUP_KEEP_DAYS:-14}"
HOUR="${BACKUP_AT_HOUR:-3}"

log() { echo "[$(date -u '+%Y-%m-%d %H:%M:%S')] $*"; }

# ВНЕШНЯЯ КОПИЯ (152-ФЗ, Р-14; план 12.4). Копии в томе той же машины гибнут
# вместе с ней. Поэтому каждая удачная копия уходит наружу — зашифрованной:
#  · `age` ОТКРЫТЫМ ключом (BACKUP_AGE_RECIPIENT, age1…): закрытого на сервере
#    нет — свою же внешнюю копию он расшифровать не может;
#  · `rclone` в S3-совместимое хранилище в РФ у ДРУГОГО провайдера
#    (BACKUP_REMOTE, например `offsite:kars-hotel`). Ключ сервера — ТОЛЬКО НА
#    ЗАПИСЬ: ни чтения, ни списка, ни удаления. Отсюда `--no-check-dest
#    --s3-no-check-bucket --s3-no-head`: rclone по умолчанию сперва спрашивает
#    HeadObject — с таким ключом это 403 (поймано пробой 07.10.2026).
#  · Срок держит правило бакета (db/ старше 62 дней удаляется): удалить ключом
#    «только на запись» нельзя.
# Без BACKUP_REMOTE внешней копии нет — это ошибка в журнал и сигнал /fail.
REMOTE="${BACKUP_REMOTE:-}"
ENV_RECIPIENT="${BACKUP_AGE_RECIPIENT:-}"
RECIPIENT="$ENV_RECIPIENT"
RCLONE_FLAGS="--no-check-dest --s3-no-check-bucket --s3-no-head --retries 3"

# Итог направления — в журнал копий (backup_runs), коды читает экран Авии.
offsite_db() {
  OFFSITE_STATE=OFF
  if [ -z "$REMOTE" ]; then
    log "ОШИБКА: внешней копии нет — BACKUP_REMOTE не задан"
    return 1
  fi
  OFFSITE_STATE=NO_KEY
  if [ -z "$RECIPIENT" ]; then
    log "ОШИБКА: BACKUP_AGE_RECIPIENT не задан — без шифрования наружу не отправляем"
    return 1
  fi
  OFFSITE_STATE=FAILED
  enc="$DIR/.offsite.$$.age"
  if age -r "$RECIPIENT" -o "$enc" "$1" && rclone copyto $RCLONE_FLAGS "$enc" "$REMOTE/db/$(basename "$1").age" 2>>"$DIR/.rclone.log"; then
    rm -f "$enc"
    OFFSITE_STATE=SENT
    log "внешняя копия: db/$(basename "$1").age"
    return 0
  fi
  rm -f "$enc"
  log "ОШИБКА: копия наружу не ушла (подробности — $DIR/.rclone.log)"
  return 1
}

# КОПИЯ БАЗЫ ПИСЬМОМ (решение владельца 23.10.2026) — на отдельный адрес
# BACKUP_MAIL_TO, через SMTP из .env сервера PMS. Только дамп базы: файлы
# хранилища (гигабайты) в письмо не помещаются.
#  · Вложение шифруется тем же открытым ключом age (BACKUP_AGE_RECIPIENT), что и
#    внешняя копия: в дампе паспорта и телефоны, а почтовый ящик — ещё одно
#    место, откуда их можно унести. Нет ключа — письмо не уходит (ошибка).
#  · В теме и тексте — только дата и размер, никаких данных из базы.
#  · Адрес не задан — письма нет, и это не ошибка: канал необязательный.
ENV_MAIL_TO="${BACKUP_MAIL_TO:-}"
MAIL_TO="$ENV_MAIL_TO"

# Адрес из `Имя <addr>` — для конверта SMTP нужен голый адрес.
bare_addr() { printf '%s' "$1" | sed 's/.*<\([^>]*\)>.*/\1/'; }

mail_db() {
  MAIL_STATE=OFF
  [ -n "$MAIL_TO" ] || return 0
  MAIL_STATE=NO_KEY
  if [ -z "$RECIPIENT" ]; then
    log "ОШИБКА: BACKUP_AGE_RECIPIENT не задан — без шифрования копию письмом не отправляем"
    return 1
  fi
  MAIL_STATE=NO_SMTP
  if [ -z "${SMTP_HOST:-}" ]; then
    log "ОШИБКА: копия письмом не ушла — SMTP_HOST не задан"
    return 1
  fi
  from="${MAIL_FROM:-${SMTP_USER:-}}"
  if [ -z "$from" ]; then
    log "ОШИБКА: копия письмом не ушла — не задан отправитель (MAIL_FROM)"
    return 1
  fi
  MAIL_STATE=FAILED
  name="$(basename "$1").age"
  enc="$DIR/.mail.$$.age"
  msg="$DIR/.mail.$$.eml"
  if ! age -r "$RECIPIENT" -o "$enc" "$1"; then
    rm -f "$enc"
    log "ОШИБКА: копия письмом не ушла — не зашифровалась"
    return 1
  fi
  boundary="kars-backup-$$"
  subject="Kars Hotel PMS: копия базы $(basename "$1" .dump | sed 's/^pms-//')"
  {
    printf 'From: %s\n' "$from"
    # Голый адрес: имя по-русски в заголовке потребовало бы кодировки RFC 2047.
    printf 'To: %s\n' "$(bare_addr "$MAIL_TO")"
    printf 'Subject: =?UTF-8?B?%s?=\n' "$(printf '%s' "$subject" | base64 | tr -d '\n')"
    printf 'Date: %s\n' "$(date -R)"
    printf 'MIME-Version: 1.0\n'
    printf 'Content-Type: multipart/mixed; boundary="%s"\n\n' "$boundary"
    printf -- '--%s\nContent-Type: text/plain; charset=utf-8\nContent-Transfer-Encoding: 8bit\n\n' "$boundary"
    printf 'Суточная копия базы Kars Hotel PMS: %s, %s.\n\n' "$name" "$(du -h "$enc" | cut -f1)"
    printf 'Вложение зашифровано ключом age. Расшифровать закрытым ключом:\n'
    printf '  age -d -i <файл ключа> -o %s %s\n' "$(basename "$1")" "$name"
    printf 'Восстановление — backup/restore.sh в репозитории.\n\n'
    printf -- '--%s\nContent-Type: application/octet-stream; name="%s"\n' "$boundary" "$name"
    printf 'Content-Disposition: attachment; filename="%s"\nContent-Transfer-Encoding: base64\n\n' "$name"
    base64 < "$enc"
    printf -- '\n--%s--\n' "$boundary"
  } > "$msg"
  rm -f "$enc"

  # 465 — сразу TLS (SMTP_SECURE=true, как в core-api); иначе STARTTLS, если
  # сервер его предлагает (ловушка Mailpit — без TLS).
  if [ "${SMTP_SECURE:-}" = "true" ]; then
    url="smtps://$SMTP_HOST:${SMTP_PORT:-465}"
    tls=""
  else
    url="smtp://$SMTP_HOST:${SMTP_PORT:-587}"
    tls="--ssl"
  fi
  # Пароль — через файл настроек curl, не в командной строке: её видно в ps.
  cfg="$DIR/.mail.$$.cfg"
  if [ -n "${SMTP_USER:-}" ]; then
    # В кавычках файла настроек curl обратная черта и кавычка экранируются.
    cred="$(printf '%s:%s' "$SMTP_USER" "${SMTP_PASS:-}" | sed 's/[\\"]/\\&/g')"
    ( umask 077; printf 'user = "%s"\n' "$cred" > "$cfg" )
  else
    : > "$cfg"
  fi
  if curl -sS --max-time 300 $tls -K "$cfg" --url "$url" \
       --mail-from "$(bare_addr "$from")" --mail-rcpt "$(bare_addr "$MAIL_TO")" \
       --crlf --upload-file "$msg" 2>>"$DIR/.mail.log"; then
    rm -f "$msg" "$cfg"
    MAIL_STATE=SENT
    log "копия базы письмом: $name → $MAIL_TO"
    return 0
  fi
  rm -f "$msg" "$cfg"
  log "ОШИБКА: копия письмом не ушла (подробности — $DIR/.mail.log)"
  return 1
}

# ТРЕВОГА О ПРОПУЩЕННОЙ КОПИИ (план 12.4) — «пульс» во внешний монитор
# (BACKUP_PING_URL, протокол healthchecks: успех — адрес, сбой — адрес/fail).
# Монитор тревожит, если сигнал пришёл с /fail ИЛИ не пришёл вовсе: второе
# ловит и упавшую службу, и мёртвый сервер целиком. Данных сигнал не несёт.
ping() {
  [ -n "${BACKUP_PING_URL:-}" ] || return 0
  wget -q -T 15 -O /dev/null "${BACKUP_PING_URL%/}$1" 2>/dev/null || log "сигнал в монитор не ушёл ($1)"
}

# ЖУРНАЛ И НАСТРОЙКИ — В БАЗЕ (02.11.2026, после аварии Beget). Копии PMS
# лежали только на её же сервере, и узнать, делаются ли они вообще, можно было
# только зайдя на сервер. Теперь:
#  · настройки (час, частота, срок, адрес письма, открытый ключ) — из
#    backup_config, их правит админка Kars Avia (/api/connect/v1/backups);
#    не читается база — работаем на прежних;
#  · каждую минуту служба отмечается (agent_seen_at): молчание службы видно в
#    админке Авии и само становится тревогой (оповещения рассылает Авиа);
#  · каждая копия — строка backup_runs: что получилось и куда ушло.
# Пишутся только время, имя файла, размер и коды — никаких данных из базы.
q() { psql -At -q -v ON_ERROR_STOP=1 -c "$1" 2>>"$DIR/.journal.log"; }
NOW_SQL="(now() at time zone 'utc')"
VERSION=2

load_config() {
  row=$(q "select at_hour, every_hours, keep_days, coalesce(mail_to, ''), coalesce(age_recipient, ''), (run_requested_at is not null) from backup_config where id = 1") || return 1
  [ -n "$row" ] || return 1
  IFS='|' read -r HOUR EVERY KEEP db_mail db_age REQUESTED <<EOF
$row
EOF
  MAIL_TO="${db_mail:-$ENV_MAIL_TO}"
  RECIPIENT="${db_age:-$ENV_RECIPIENT}"
}

# «1|<следующее окно>» — пора делать копию по расписанию (в текущем окне ещё
# не было ни одной). Окна — от at_hour каждые every_hours (делитель 24).
schedule_state() {
  q "with s as (
       select date_trunc('day', $NOW_SQL) + make_interval(hours => at_hour) as base, every_hours as e
       from backup_config where id = 1),
     w as (
       select base + make_interval(hours => (floor(extract(epoch from ($NOW_SQL - base)) / 3600 / e) * e)::int) as t, e from s)
     select (not exists (select 1 from backup_runs r where r.started_at >= w.t))::int,
            to_char(w.t + make_interval(hours => w.e), 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"')
     from w"
}

flag() { if [ -n "$1" ]; then echo true; else echo false; fi; }

heartbeat() {
  info="{\"version\":$VERSION,\"nextAt\":\"$1\",\"hasAge\":$(flag "$RECIPIENT"),\"hasRemote\":$(flag "$REMOTE"),\"hasSmtp\":$(flag "${SMTP_HOST:-}"),\"files\":false}"
  q "update backup_config set agent_seen_at = $NOW_SQL, agent_info = '$info'::jsonb where id = 1" || true
}

run_open() {
  RUN_ID=$(q "insert into backup_runs (started_at, status, trigger) values ($NOW_SQL, 'RUNNING', '$1') returning id") || RUN_ID=""
}

# Пустое значение — NULL. Сюда попадают только коды и имя файла из даты.
sql_str() { if [ -n "$1" ]; then printf "'%s'" "$1"; else printf 'NULL'; fi; }

run_close() {
  [ -n "$RUN_ID" ] || return 0
  q "update backup_runs set status = '$1', finished_at = $NOW_SQL,
       file = $(sql_str "$RUN_FILE"), size_bytes = ${RUN_SIZE:-NULL},
       mail = $(sql_str "$MAIL_STATE"), offsite = $(sql_str "$OFFSITE_STATE"),
       error = $(sql_str "$RUN_ERROR")
     where id = '$RUN_ID'" || true
}

# Копия сделана, когда цел дамп на диске сервера; направления (письмо,
# внешнее хранилище) — отдельными отметками. Сигнал /fail в монитор — если не
# сработало хоть что-то, как и прежде.
backup_once() {
  stamp="$(date -u '+%Y-%m-%d_%H%M')"
  target="$DIR/pms-$stamp.dump"
  part="$target.part"
  RUN_FILE=""; RUN_SIZE=""; RUN_ERROR=""
  MAIL_STATE=""; OFFSITE_STATE=""
  run_open "$1"

  log "дамп базы $PGDATABASE → $(basename "$target")"
  if ! pg_dump -Fc -f "$part"; then
    log "ОШИБКА: pg_dump не отработал, вчерашние копии не тронуты"
    rm -f "$part"
    RUN_ERROR=DUMP_FAILED
    run_close FAILED
    return 1
  fi

  if ! pg_restore --list "$part" >/dev/null 2>&1; then
    log "ОШИБКА: архив не читается — копия негодна и удалена"
    rm -f "$part"
    RUN_ERROR=NOT_READABLE
    run_close FAILED
    return 1
  fi

  mv "$part" "$target"
  RUN_FILE="$(basename "$target")"
  RUN_SIZE=$(wc -c < "$target" | tr -d ' ')
  log "готово: $RUN_FILE, $(du -h "$target" | cut -f1)"

  ok=0
  mail_db "$target" || ok=1
  offsite_db "$target" || ok=1
  run_close OK

  # Чистка — только теперь, когда свежая копия заведомо цела (правило 3), и
  # от направлений не зависит: несданная внешняя копия не копит дампы.
  removed=$(find "$DIR" -name 'pms-*.dump' -type f -mtime "+$KEEP" -print -delete | wc -l)
  [ "$removed" -gt 0 ] && log "удалено старых копий: $removed"
  return "$ok"
}

run_and_signal() {
  if backup_once "$1"; then ping ""; else ping /fail; fi
}

log "служба копирования запущена (версия $VERSION)"
# Копия, оборванная остановкой контейнера, не должна навсегда висеть «идёт».
q "update backup_runs set status = 'FAILED', error = 'INTERRUPTED', finished_at = $NOW_SQL where status = 'RUNNING'" || true

# Раз в минуту: перечитать настройки, отметиться, проверить «сделать сейчас»
# и окно расписания. Не читается база — живём по расписанию из окружения
# (журнала тогда нет, но копия будет).
while true; do
  if load_config; then
    state=$(schedule_state) || state=""
    due="${state%%|*}"
    heartbeat "${state#*|}"
    if [ "$REQUESTED" = "t" ]; then
      q "update backup_config set run_requested_at = NULL where id = 1" || true
      log "копия по кнопке из админки Kars Avia"
      run_and_signal MANUAL
    elif [ "$due" = "1" ]; then
      run_and_signal SCHEDULE
    fi
  else
    # Одна попытка в сутки: упавший дамп не повторяется каждую минуту.
    today="$(date -u '+%Y-%m-%d')"
    if [ "$(date -u '+%-H')" -ge "$HOUR" ] && [ "${env_tried:-}" != "$today" ] \
       && ! ls "$DIR"/pms-"$today"_*.dump >/dev/null 2>&1; then
      env_tried="$today"
      log "настройки из базы не читаются — копия по расписанию из окружения"
      run_and_signal SCHEDULE
    fi
  fi
  sleep 60
done
