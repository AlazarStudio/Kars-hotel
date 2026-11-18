# Кластер базы PMS (Patroni, три узла)

Схема и решения — `docs/superpowers/specs/2026-11-18-pms-replica-tw-hotel-design.md`.

| Узел | Адрес `wgk` | Роль |
|---|---|---|
| `pms-vk` — vk-hotel 213.219.213.66 | 10.77.0.4 | лидер, PMS работает здесь |
| `pms-tw` — tw-hotel 129.101.107.53 | 10.77.0.5 | синхронная реплика, может стать лидером |
| `pms-local` — офис `karsavia-local` | 10.77.0.3 | асинхронная реплика, `nofailover` |

Порты (только на адресах `wgk` и 127.0.0.1): PostgreSQL `5442`, Patroni REST
`8018`, etcd `2479/2480`.

## Что уже работает (18.11.2026)

- **Кластер переведён 18.11.2026, 14:24–14:29 UTC**, простой PMS ~2 мин
  (14:24:20–14:26:20). `pms-vk` — Leader, `pms-tw` — Sync Standby, `pms-local` —
  Replica, отставание 0. Число строк во всех 38 таблицах до и после совпало.
  Контейнер `kars-hotel-patroni` на всех трёх, данные — том `kars-hotel-pg`
  (`pg16/`), конфиг — `/etc/kars-hotel-patroni/patroni.yml` (на офисе — том
  `kars-hotel-patroni-conf`), секреты — `/etc/kars-hotel-patroni/secrets.env` на
  vk-hotel и tw-hotel. Копия до перевода — `/root/kars_hotel-before-patroni.dump`.
  Старый том `kars-hotel_pgdata` оставлен как был на 14:24 — **не запускать на нём
  postgres**: это база-двойник без записей после перевода.
- `patronictl` в образе — `/opt/patroni/bin/patronictl -c /etc/patroni/patroni.yml`.
  `psql` по TCP требует пароль; без пароля — через сокет внутри контейнера
  (`psql -h /var/run/postgresql -p 5442 -U postgres`).
- `--validate-config` в сети bridge зависает — запускать с `--network host`.
- etcd PMS: контейнер `kars-hotel-etcd` (образ `kars-hotel-etcd:v3.6.16`, тот же
  etcd, что у Авии), сеть хоста, данные `/var/lib/kars-hotel-etcd`, имена
  `etcd-pms-vk/-tw/-local`, токен `kars-hotel-etcd`. Проверка:
  `docker exec kars-hotel-etcd etcdctl --endpoints http://127.0.0.1:2479 endpoint health --cluster`
- Образ Patroni `kars-hotel-patroni:16.15-4.1.5` (`patroni/Dockerfile`) — на всех трёх.
- `haproxy:3.2-alpine` скачан на vk-hotel.

## Файлы

- `patroni/patroni.yml.template` + `patroni/render.sh` — patroni.yml узла:
  `sh render.sh pms-vk secrets.env > patroni.yml`. Секреты в репозиторий не
  кладутся. `secrets.env` одинаков на трёх узлах: `PATRONI_PASSWORD`,
  `SUPERUSER_PASSWORD` (= `POSTGRES_PASSWORD` из `.env` PMS — Patroni ходит под
  ним), `REPLICATOR_PASSWORD`, `REWINDER_PASSWORD`.
- `haproxy.cfg` и `../docker-compose.cluster.yml` — на vk-hotel сервис
  `postgres` становится HAProxy к лидеру; `api` и `backup` не меняются.

**С момента перевода каждый выпуск PMS на vk-hotel — с
`-f docker-compose.cluster.yml` ПОСЛЕДНИМ.** Без него compose поднимет старую
одиночную базу из тома `pgdata`, и PMS разойдётся с кластером.

## Перевод базы под Patroni

Простой PMS ~5 минут (база 59 МБ, каталог 131 МБ). Время согласовать с Ренатом
и владельцем. Пароли в чат и в журналы не выводить.

### Заранее (без простоя)

1. **Секреты** на vk-hotel: `/etc/kars-hotel-patroni/secrets.env` (root, 600),
   три новых пароля `openssl rand -hex 24`, `SUPERUSER_PASSWORD` — из
   `~/Kars-hotel/.env`. Тот же файл — на tw-hotel (`/etc/kars-hotel-patroni/`);
   на офис — во временный файл в домашнем каталоге, удалить после шага 2.
2. **patroni.yml** узла рядом с секретами, владелец `70:70` (пользователь
   postgres в Alpine), права 600:
   - vk-hotel, tw-hotel: `/etc/kars-hotel-patroni/patroni.yml`;
   - офис (нет sudo): том `kars-hotel-patroni-conf`, файл пишется
     контейнером образа Patroni с `--user root`.
3. **Роли** в живой базе (под `postgres`, в базе `postgres`):
   ```sql
   CREATE ROLE replicator WITH REPLICATION LOGIN PASSWORD '…';
   CREATE ROLE rewinder WITH LOGIN PASSWORD '…';
   GRANT EXECUTE ON FUNCTION pg_catalog.pg_ls_dir(text, boolean, boolean) TO rewinder;
   GRANT EXECUTE ON FUNCTION pg_catalog.pg_stat_file(text, boolean) TO rewinder;
   GRANT EXECUTE ON FUNCTION pg_catalog.pg_read_binary_file(text) TO rewinder;
   GRANT EXECUTE ON FUNCTION pg_catalog.pg_read_binary_file(text, bigint, bigint, boolean) TO rewinder;
   ```
   SQL — файлом через `psql -f`, не `-c` с паролем в командной строке.
4. **Файлы кластера** в `~/Kars-hotel` на vk-hotel: `cluster/haproxy.cfg`,
   `docker-compose.cluster.yml`. Проверка без запуска:
   `docker compose -f docker-compose.yml -f docker-compose.override.yml -f ~/pms-releases/<выпуск>/images.yml -f docker-compose.cluster.yml config postgres`.

### В окне (простой)

Ниже `DC` = `sudo docker compose -f docker-compose.yml -f docker-compose.override.yml -f ~/pms-releases/<выпуск>/images.yml`.

5. Копия: `DC exec -T postgres pg_dump -U postgres -Fc kars_hotel | sudo tee /root/kars_hotel-before-patroni.dump >/dev/null`,
   проверка `pg_restore -l`; прежние `/root/*.dump` после проверки удалить
   (правило «только последняя»). Число строк в ключевых таблицах — записать.
6. `DC stop api backup` (Caddy и web остаются — покажут ошибку API, не пустоту),
   затем `DC stop postgres` — чистая остановка.
7. Каталог базы — в новый том, старый том `kars-hotel_pgdata` НЕ трогать (откат):
   ```sh
   docker volume create kars-hotel-pg
   docker run --rm -v kars-hotel_pgdata:/from:ro -v kars-hotel-pg:/to \
     --user root --entrypoint sh kars-hotel-patroni:16.15-4.1.5 \
     -c 'cp -a /from /to/pg16 && chown -R 70:70 /to && chmod 700 /to/pg16'
   ```
8. Patroni `pms-vk`:
   ```sh
   docker run -d --name kars-hotel-patroni --network host --restart unless-stopped \
     -v kars-hotel-pg:/var/lib/postgresql/data \
     -v /etc/kars-hotel-patroni/patroni.yml:/etc/patroni/patroni.yml:ro \
     kars-hotel-patroni:16.15-4.1.5
   ```
   Ждать в `docker exec kars-hotel-patroni patronictl -c /etc/patroni/patroni.yml list`
   строку `pms-vk | Leader | running`. Patroni берёт существующий каталог
   (ключ `initialize` в etcd пуст), свой `postgresql.conf` пишет поверх, старый
   сохраняет как `postgresql.base.conf`. Если стоит `Pending restart`
   (`shared_buffers`) — `patronictl restart kars-hotel pms-vk --force`.
9. `DC -f docker-compose.cluster.yml up -d --no-build` — `postgres`
   пересоздаётся HAProxy, поднимаются `api` и `backup`. Проверить: вход в
   кабинет на `hotel.karsavia.ru`, шахматка открывается, из Авии «Управлять в
   Hotel PMS»; журнал `api` без ошибок Prisma.
10. Копия после, `pg_restore -l`, сверка числа строк с шагом 5.

**Откат в окне** (до записи новых данных): `docker rm -f kars-hotel-patroni`,
`DC up -d --no-build` без кластерного файла — PMS снова на томе `pgdata`.
После того как в кластер пошла запись, откат — только восстановлением копии.

### После окна (без простоя)

11. **Только когда `pms-vk` — Leader:** та же команда шага 8 на tw-hotel
    (`pms-tw`), затем на офисе (`pms-local`, конфиг из тома
    `kars-hotel-patroni-conf`). Реплики сами делают `pg_basebackup` (~131 МБ).
    Ошибочный запуск раньше лидера не страшен: `bootstrap.method: no_initdb`
    не даст создать пустую базу.
12. `patronictl list`: `pms-tw` — Sync Standby, `pms-local` — Replica, отставание 0.
13. Внести в журнал выпусков PMS правило про `-f docker-compose.cluster.yml`.
