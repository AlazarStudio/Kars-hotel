# Kars Hotel (PMS) — заметки для Claude

Отдельная **PMS-система для отелей** (Property Management System). Часть единого
продукта Kars Avia, но самостоятельный репозиторий.

Соседний репозиторий — **Kars Avia** (`D:\GitHub\Kars avia v3`): платформа
диспетчеров/авиакомпаний/трансфера. Этот проект общается с ним **только по
HTTP/REST**, через партнёрский connectivity-API. Никаких общих БД и общего кода.
Полная карта обоих проектов — в `D:\GitHub\Kars avia v3\PROJECTS.md`.

## Стек

- **Не monorepo** — раздельные `backend/` и `frontend/`.
- Бэкенд: NestJS + Prisma, PostgreSQL. Порт `:3001`, Swagger включён.
  - Схема Prisma: `backend/prisma/schema.prisma`.
- Фронтенд: Vite + React 18 + React Router + TanStack Query (`frontend/`).

## Запуск

- Инфраструктура (`docker-compose.dev.yml`, порты сдвинуты от Авиа, чтобы оба
  проекта поднимались одновременно):
  - PostgreSQL `kars-hotel-postgres` — `:5442`
  - Redis `kars-hotel-redis` — `:6380`
  - MinIO `kars-hotel-minio` — `:9000` (API) / `:9001` (консоль)
  - Mailhog `kars-hotel-mailhog` — SMTP `:1025` / UI `:8025`
- Backend: `cd backend && npm run start:dev`
- Frontend: `cd frontend && npm run dev`

## Проверка (build / lint)

- Backend: `cd backend && npm run build` (nest build). После правки `schema.prisma`
  сперва `npx prisma generate`, иначе Prisma-клиент будет рассинхронизирован.
- Frontend: `cd frontend && npm run lint` (eslint, `--max-warnings 0`),
  `npm run build` (vite build).

## Конвенции

- **Миграции пишутся руками** в
  `backend/prisma/migrations/<timestamp>_<name>/migration.sql`, с комментарием-
  объяснением (и бэкфиллом исторических данных, где нужно).
- **Не коммить и не пушь без явной просьбы.** Стиль коммита
  `type(scope): summary`, `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`.
- Не коммить артефакты сборки (`dist/`).
- Цены PMS отдаёт в **рублях**; в контракте с Авиа они в копейках (конвертация —
  на стороне Авиа).

## Связь с партнёром (Kars Avia)

- Партнёрский ключ выпускается **здесь**: хэшируется SHA-256, со скоупами и
  отзывом. В Авиа он живёт только в env и никогда не коммитится.
- Connectivity-API: `/api/connect/v1/...`, авторизация заголовком `X-Api-Key`.
- Брони, созданные партнёром, помечаются `channel_managed = true`: отель их видит,
  но **не может отменить из PMS** (бэкенд отдаёт 403; фронт скрывает кнопку
  отмены). Отозвать бронь может только сам партнёр через connectivity-API —
  единый источник правды для жизненного цикла брони.
