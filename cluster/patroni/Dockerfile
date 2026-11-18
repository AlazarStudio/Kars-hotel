# Patroni для базы Kars Hotel PMS (кластер из трёх узлов, с 18.11.2026).
#
# База — ТОТ ЖЕ postgres:16-alpine (16.15), на котором PMS работает сейчас, а не
# Debian, как у Авии: база создана с en_US.utf8 под musl, и под glibc порядок
# сортировки строк другой — индексы по тексту молча оказались бы испорчены.
# Все три узла кластера обязаны работать на одном и том же образе.
#
# Patroni — та же версия, что у Авии (4.1.5), хранилище состояния — etcd v3.
FROM postgres:16.15-alpine

RUN apk add --no-cache python3 \
 && python3 -m venv /opt/patroni \
 && /opt/patroni/bin/pip install --no-cache-dir 'patroni[etcd3]==4.1.5' 'psycopg[binary]' \
 && /opt/patroni/bin/patroni --version

USER postgres
ENTRYPOINT ["/opt/patroni/bin/patroni", "/etc/patroni/patroni.yml"]
