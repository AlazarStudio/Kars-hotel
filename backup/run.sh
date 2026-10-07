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
RECIPIENT="${BACKUP_AGE_RECIPIENT:-}"
RCLONE_FLAGS="--no-check-dest --s3-no-check-bucket --s3-no-head --retries 3"

offsite_db() {
  if [ -z "$REMOTE" ]; then
    log "ОШИБКА: внешней копии нет — BACKUP_REMOTE не задан"
    return 1
  fi
  if [ -z "$RECIPIENT" ]; then
    log "ОШИБКА: BACKUP_AGE_RECIPIENT не задан — без шифрования наружу не отправляем"
    return 1
  fi
  enc="$DIR/.offsite.$$.age"
  if age -r "$RECIPIENT" -o "$enc" "$1" && rclone copyto $RCLONE_FLAGS "$enc" "$REMOTE/db/$(basename "$1").age" 2>>"$DIR/.rclone.log"; then
    rm -f "$enc"
    log "внешняя копия: db/$(basename "$1").age"
    return 0
  fi
  rm -f "$enc"
  log "ОШИБКА: копия наружу не ушла (подробности — $DIR/.rclone.log)"
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

backup_once() {
  stamp="$(date -u '+%Y-%m-%d_%H%M')"
  target="$DIR/pms-$stamp.dump"
  part="$target.part"

  log "дамп базы $PGDATABASE → $(basename "$target")"
  if ! pg_dump -Fc -f "$part"; then
    log "ОШИБКА: pg_dump не отработал, вчерашние копии не тронуты"
    rm -f "$part"
    return 1
  fi

  if ! pg_restore --list "$part" >/dev/null 2>&1; then
    log "ОШИБКА: архив не читается — копия негодна и удалена"
    rm -f "$part"
    return 1
  fi

  mv "$part" "$target"
  size=$(du -h "$target" | cut -f1)
  log "готово: $(basename "$target"), $size"

  # Наружу — только целая копия; не ушло — сбой всей копии (сигнал /fail).
  offsite_db "$target" || return 1

  # Чистка — только теперь, когда свежая копия заведомо цела.
  removed=$(find "$DIR" -name 'pms-*.dump' -type f -mtime "+$KEEP" -print -delete | wc -l)
  [ "$removed" -gt 0 ] && log "удалено старых копий: $removed"
  return 0
}

log "служба копирования запущена: ежедневно в $HOUR:00 UTC, хранить $KEEP дн."

# Копия при СТАРТЕ, если за сегодня её ещё нет: сервер могли перезагрузить в
# час копирования, и ждать сутки ради этого незачем.
if ! ls "$DIR"/pms-"$(date -u '+%Y-%m-%d')"_*.dump >/dev/null 2>&1; then
  if backup_once; then ping ""; else ping /fail; fi
fi

while true; do
  now_h=$(date -u '+%-H')
  now_m=$(date -u '+%-M')
  # Секунд до ближайшего HOUR:00 по UTC.
  wait_s=$(( ((HOUR - now_h + 24) % 24) * 3600 - now_m * 60 ))
  [ "$wait_s" -le 0 ] && wait_s=$(( wait_s + 86400 ))
  log "следующая копия через $((wait_s / 3600)) ч $(((wait_s % 3600) / 60)) мин"
  sleep "$wait_s"
  if backup_once; then ping ""; else ping /fail; fi
done
