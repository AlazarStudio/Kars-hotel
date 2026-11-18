#!/bin/sh
# Собирает patroni.yml узла из шаблона и файла секретов.
#   sh render.sh <pms-vk|pms-tw|pms-local> <secrets.env> > patroni.yml
# secrets.env: PATRONI_PASSWORD, SUPERUSER_PASSWORD (= POSTGRES_PASSWORD из
# .env PMS), REPLICATOR_PASSWORD, REWINDER_PASSWORD. Одинаков на всех узлах.
set -eu
node=$1
. "$2"
case $node in
  pms-vk)    ip=10.77.0.4; tags='  nofailover: false' ;;
  pms-tw)    ip=10.77.0.5; tags='  nofailover: false' ;;
  # Офис — третий голос и асинхронная копия, лидером не становится (как pg-local).
  pms-local) ip=10.77.0.3; tags='  nofailover: true
  nosync: true' ;;
  *) echo "неизвестный узел: $node" >&2; exit 1 ;;
esac
for v in PATRONI_PASSWORD SUPERUSER_PASSWORD REPLICATOR_PASSWORD REWINDER_PASSWORD; do
  eval "val=\${$v:-}"
  [ -n "$val" ] || { echo "в $2 нет $v" >&2; exit 1; }
  case $val in *[\"\\@\|]*) echo "$v: недопустимые символы \" \\ @ |" >&2; exit 1 ;; esac
done
awk -v name="$node" -v ip="$ip" -v tags="$tags" \
    -v p="$PATRONI_PASSWORD" -v s="$SUPERUSER_PASSWORD" \
    -v r="$REPLICATOR_PASSWORD" -v w="$REWINDER_PASSWORD" '
  $0 == "@TAGS@" { print tags; next }
  { gsub(/@NAME@/, name); gsub(/@IP@/, ip); gsub(/@PATRONI_PASSWORD@/, p)
    gsub(/@SUPERUSER_PASSWORD@/, s); gsub(/@REPLICATOR_PASSWORD@/, r)
    gsub(/@REWINDER_PASSWORD@/, w); print }
' "$(dirname "$0")/patroni.yml.template"
