# Отчёт и план реализации KarsHotel PMS

> Документ для изучения. Никакие действия не выполнены — это только анализ и предложения.
> Решения принимаешь ты, я выполняю пошагово после твоего подтверждения каждого шага.

---

## Часть 1. Что у нас сейчас есть

### 1.1 Файловая структура

```
D:\GitHub\kars-hotel\
├── frontend\                          (Vite + React 18, скопирован из kars-avia)
│   ├── src\
│   │   ├── main.jsx                  (минимальный entry с BrowserRouter)
│   │   ├── App.jsx                   (один Route → HotelPMS)
│   │   ├── index.css                 (reset + Google Fonts)
│   │   └── Components\HotelPMS\      (21 файл, всё на mock-данных)
│   │       ├── HotelPMS.jsx
│   │       ├── HotelPMS.module.css
│   │       ├── constants.js
│   │       ├── mockData\mock.js
│   │       └── components\
│   │           ├── Sidebar\
│   │           ├── Dashboard\
│   │           ├── Timeline\         (Шахматка — самый большой файл, 25KB)
│   │           ├── Bookings\
│   │           ├── Rooms\
│   │           ├── Housekeeping\
│   │           ├── Tariffs\
│   │           └── Reports\
│   ├── package.json                  (4 deps: react, react-dom, react-router-dom, date-fns)
│   ├── vite.config.js
│   ├── index.html
│   └── node_modules\                 (329 пакетов установлены)
├── backend\
│   └── README.md                     (заглушка — бэка нет вообще)
└── claude-code-mega-prompt.md        (твой ТЗ-документ)
```

### 1.2 Что умеет HotelPMS (фронт)

| Раздел | Что есть | На каких данных |
|---|---|---|
| **Sidebar** | Навигация между 7 разделами через локальный state, кнопка "Вернуться в KarsAvia" (артефакт от kars-avia) | mockHotel |
| **Dashboard** | KPI-карточки: занятость, заезды/выезды сегодня, статусы уборки | mockBookings + mockRooms |
| **Timeline (Шахматка)** | Грид дни×номера, выбор месяца, поиск по гостям, **самописный drag** через onMouseDown (НЕ @dnd-kit), выделение мышью → форма создания брони | mockBookings |
| **Bookings** | Список броней с фильтрами, форма создания/редактирования | mockBookings |
| **Rooms** | Таблица номеров, фильтр по этажу/категории/HK-статусу | mockRooms |
| **Housekeeping** | Группировка номеров по статусам уборки | mockRooms |
| **Tariffs** | Базовая таблица цен по категориям | mockTariffs |
| **Reports** | Несколько отчётов (использует recharts — но recharts НЕ в зависимостях, страница упадёт) | mockBookings |

### 1.3 Mock-данные

- **1 отель** ("Парковый", Москва, 3 звезды)
- **4 категории** номеров: Стандарт / Делюкс / Полулюкс / Люкс
- **21 номер** на 4 этажах
- **~30 броней** со статусами `new / confirmed / checked_in / checked_out / cancelled / no_show`
- **Поля брони:** id, roomId, guestName (просто строка, не отдельная сущность Guest), phone, email, checkIn, checkOut, status, adults, children, totalPrice, source (`direct/online/phone/ota/corporate`), notes
- **HK-статусы:** dirty / cleaning / checking / clean / ready

### 1.4 Чего нет в коде вообще

- Backend в любом виде (Node/Nest/что угодно)
- БД, миграции, ORM
- Auth, регистрация, пользователи, JWT, refresh-токены
- Multi-tenancy
- API (REST / GraphQL / WebSocket)
- Гость как отдельная сущность (сейчас только строка `guestName` в брони)
- Компании / юр.лица / агенты
- Folio / Charges / Payments / Deposit
- Тарифные планы как сущность (есть только массив цен по категории)
- Ограничения CTA / CTD / MinLOS / MaxLOS / Stop Sell
- Inventory как сущность
- Каналы (Booking.com, Ostrovok, Яндекс, etc.)
- Booking Engine (виджет для сайта отеля)
- Уведомления (email/sms/push)
- Тесты (ни unit, ни E2E)
- CI/CD, Docker, Husky, ESLint правила

---

## Часть 2. Что описывает мега-промпт

### 2.1 Стек

| Слой | Технология |
|---|---|
| Языки | Node.js 20 LTS, TypeScript strict |
| Backend | NestJS 10 |
| Frontend (admin) | Next.js 15 App Router + React 19 |
| Frontend (booking widget) | Next.js 15 (SSR для SEO) |
| Worker | NestJS standalone + BullMQ |
| DB | PostgreSQL 16 + Prisma 5 |
| Cache/Queue | Redis 7 |
| Real-time | Socket.IO |
| UI | TailwindCSS 3.4 + shadcn/ui + lucide-react |
| Data layer | TanStack Query v5 + Zustand |
| DnD | @dnd-kit |
| Виртуализация | @tanstack/react-virtual |
| Формы | react-hook-form + zod |
| Auth | Auth.js (next-auth) + @nestjs/jwt + CASL |
| i18n | next-intl (ru default + en) |
| File storage | S3 (MinIO в dev) |
| Email | nodemailer (mailhog в dev) |
| Logs | Pino + nestjs-pino |
| Tests | Vitest + Playwright |
| Tracing | OpenTelemetry |
| Monorepo | Turborepo + pnpm workspaces |

### 2.2 Структура монорепо

```
apps/
├── api/        — NestJS REST + WebSocket
├── web/        — Next.js админка (шахматка, настройки, отчёты)
├── booking/    — Next.js публичный Booking Engine виджет
└── worker/     — NestJS standalone, BullMQ воркеры

packages/
├── db/             — Prisma schema, миграции, seeds
├── shared/         — zod-схемы, DTO, типы, утилиты дат, константы
├── ui/             — shadcn/ui компоненты, общие пресеты
├── channels/       — коннекторы каналов (OTA XML, Booking.com B.XML, Ostrovok)
├── eslint-config/
└── tsconfig/
```

### 2.3 17 фаз

| # | Фаза | Содержание |
|---|---|---|
| Bootstrap | Инициализация | Turborepo + docker-compose + /docs + design-system + GitHub Actions + Husky |
| 0 | Базовая инфраструктура | Подъём NestJS api, Next.js web, booking, worker; HealthController; shadcn/ui init; Prisma init |
| 1 | **Auth + Multi-tenancy + RBAC** | Tenant/User/Role/Permission/RefreshToken/AuditLog; PostgreSQL RLS политики; JWT auth; CASL для RBAC |
| 2 | Номерной фонд | RoomType, Room, Amenity, фото в S3 |
| 3 | Тарифы и цены | RatePlan, Rate, Restriction, CancellationPolicy, PaymentPolicy, PricingService с 30+ тестами |
| 4 | Inventory + Availability | Pessimistic locks, advisory locks, кэширование Redis 60с |
| 5 | **Шахматка** (3 спринта) | 5.1 read-only + WS, 5.2 DnD + создание мышью, 5.3 режимы/фильтры/конфликты |
| 6 | **Бронирования** (3 спринта) | 6.1 CRUD + concurrency, 6.2 UI карточка, 6.3 групповые + почасовые + юр.лица |
| 7 | Гости и компании | Guest, GuestDocument, LoyaltyCard, Company, merge дублей через pg_trgm |
| 8 | **Финансы** (2 спринта) | 8.1 Folio/Charge/Payment/Deposit, 8.2 CashRegister/Shift/FinancialOperation |
| 9 | Check-in/out + Night Audit | MigrationRecord (ЕПГУ заглушка), BullMQ cron 00:30 |
| 10 | Housekeeping | HousekeepingTask, mobile-first PWA для горничных |
| 11 | Доп. услуги | Service (BB/HB/FB/AI разбиение, трансфер, спа, парковка) |
| 12 | **Отчёты** (2 спринта) | 25+ отчётов: real-time + статистические + materialized views |
| 13 | Booking Engine | Отдельный Next.js, embeddable iframe + JS-loader, SEO |
| 14 | **Channel Manager** (3 спринта) | 14.1 архитектура коннекторов, 14.2 Outbox + надёжность, 14.3 UI + OTA XML/Booking.com |
| 15 | Уведомления | Email + SMS + Push через Handlebars + BullMQ |
| 16 | Public API + Import/Export | OAuth2 → JWT, Webhooks, CSV/XLSX import wizard |
| 17 | Production hardening | Coverage 80%+, k6 load tests, OWASP ZAP, Docusaurus, Grafana, deploy |

### 2.4 Особые требования промпта

- **Дизайн-система через `/ui-ux-pro-max`** — обязательна перед любым UI. Никаких "придуманных" цветов и шрифтов.
- **lucide-react для иконок** — никогда emoji.
- **Тесты до кода** для Pricing, Availability, Reservation, NightAudit, ChannelSync.
- **Multi-tenancy через PostgreSQL Row-Level Security** — `SET LOCAL app.tenant_id` на каждом запросе через AsyncLocalStorage.
- **Concurrency защита** — pessimistic locks + pg_advisory_xact_lock + optimistic versioning.
- **Channel Manager — Outbox pattern** с debounce 10с, idempotency keys, exponential backoff, DLQ после 10 fails.
- **Шахматка performance** — один SQL с CTE, виртуализация строк, абсолютные spans поверх CSS Grid, Redis cache 30с.
- **Night Audit** — BullMQ cron в локальной TZ tenant'а, auto-checkout no-show, post pending charges, refresh materialized views.

---

## Часть 3. Архитектурный gap

| Аспект | Промпт требует | Текущий код |
|---|---|---|
| Frontend | **Next.js 15 + React 19** | Vite + React 18 |
| Стили | **Tailwind + shadcn/ui** | CSS Modules + ручные SVG |
| State | **TanStack Query + Zustand** | useState с mock-массивами |
| DnD | **@dnd-kit** | самописный onMouseDown |
| Виртуализация | **@tanstack/react-virtual** | нет |
| Backend | **NestJS + Prisma + Postgres** | отсутствует полностью |
| Auth | **JWT + Auth.js + RLS** | нет |
| Multi-tenant | **PostgreSQL RLS** | single-tenant |
| Real-time | **Socket.IO + delta-patches** | нет |
| i18n | **next-intl ru+en** | русский хардкод |
| Monorepo | **Turborepo (4 apps + 5 packages)** | один пакет |
| Tests | **Vitest + Playwright** | нет тестов |
| Docker | **docker-compose dev** | нет |

**Вывод:** стек текущего фронта несовместим с прописанным в промпте. Существующий код может быть только **референсом** для UI-логики (особенно Timeline.jsx как baseline для шахматки на Фазе 5).

---

## Часть 4. Что можно переиспользовать из текущего фронта

| Артефакт | Куда переедет (НЕ копированием, а как референс) |
|---|---|
| Логика расчёта grid-позиций броней в Timeline.jsx | образец для @dnd-kit + react-virtual реализации на Фазе 5 |
| Структура mockData/mock.js (4 категории, 21 номер, ~30 броней) | основа для seedDemoHotel() в Фазе 2 |
| constants.js: BOOKING_STATUS/HK_STATUS/NAV_ITEMS + цвета | референс для дизайн-системы из /ui-ux-pro-max |
| UI-flow Bookings/Rooms/Housekeeping/Tariffs/Reports | wireframe для соответствующих страниц на Next.js |
| Структура Dashboard KPI (occupancy, arrivals, HK status) | baseline для /dashboard на Фазе 0 |

Всё остальное (CSS Modules, react-router, ручной DnD, локальный state) выбрасывается, т.к. на стек промпта не ложится.

---

## Часть 5. План реализации

### Решения, которые уже подтверждены

- **Вариант A** — строго по промпту (Turborepo с нуля). Текущий frontend становится референсом.
- **Глубина плана:** Bootstrap + Фаза 0 расписаны до файлов; фазы 1-17 — высокоуровневый roadmap.
- **ui-ux-pro-max-skill** установлен, будет вызываться через Skill tool перед каждым UI-блоком.

### Решения, которые НУЖНО подтвердить перед началом

1. **Что делать с текущими папками `frontend\` и `backend\`?**
   - Они мешают развернуть Turborepo в корне `D:\GitHub\kars-hotel\`.
   - Варианты:
     - (a) переименовать в `_legacy\frontend-vite\` и `_legacy\backend-stub\` (сохраняем как референс);
     - (b) удалить полностью (исходник в kars-avia остаётся, можно вернуть);
     - (c) создать Turborepo по другому пути (`D:\GitHub\kars-hotel-pms\`), а текущую папку оставить как-есть.
   - **Моя рекомендация:** (a) — `_legacy\` сохранит код для референса Фазы 5/6, корень освобождается.

2. **Git репозиторий**
   - Сейчас `D:\GitHub\kars-hotel\` — НЕ git репозиторий.
   - Промпт требует `git init` в bootstrap.
   - Подтверди, что инициализируем git здесь.

3. **Имя проекта в package.json и Prisma**
   - В промпте называется "KarsHotel PMS".
   - Подтверди или предложи другое.

4. **Docker Desktop запущен?**
   - Нужен для docker-compose с postgres/redis/minio/mailhog.

### Bootstrap — пошагово (что предлагаю делать после подтверждений)

> Каждый шаг я выполняю **только после твоего "ок" на этот шаг**.

**Шаг B.1: Подготовка корня**
- Перенос `frontend\` и `backend\` в `_legacy\` (или другая опция из вопроса 1).
- `git init` в `D:\GitHub\kars-hotel\`.
- Создать `.gitignore`, `.editorconfig`, `.prettierrc`.

**Шаг B.2: Корень монорепо**
- `package.json` (root) с workspaces.
- `pnpm-workspace.yaml`.
- `turbo.json` с pipeline lint/typecheck/test/build/dev.
- `tsconfig.base.json`.
- ESLint flat config или `.eslintrc.cjs`.

**Шаг B.3: Скелет apps/ и packages/**
- Создать пустые папки apps/{api,web,booking,worker} и packages/{db,shared,ui,channels,eslint-config,tsconfig}.
- В каждой — минимальный package.json для регистрации в workspace.

**Шаг B.4: Документация**
- `docs/PRD.md` — копия секции «АРХИТЕКТУРНЫЙ КОНТЕКСТ» из мега-промпта.
- `docs/ARCHITECTURE.md` — high-level схема (заглушка с TODO на этом этапе).
- `docs/DATABASE.md` — заглушка под ERD.
- `docs/ROADMAP.md` — список 17 фаз с дедлайнами.
- `docs/DESIGN.md` — правила использования /ui-ux-pro-max.
- `docs/CHANGELOG.md` — шаблон Keep a Changelog.
- `README.md` — описание проекта + quickstart.

**Шаг B.5: Дизайн-система через /ui-ux-pro-max**
- Вызов skill `/ui-ux-pro-max` с параметрами для генерации MASTER.md.
- Генерация overrides для 6 страниц (rack-chart, booking-engine, finance, reports, channels, housekeeping).
- Результат — в `design-system/MASTER.md` + `design-system/pages/*.md`.

**Шаг B.6: Docker-compose**
- `docker-compose.dev.yml` с сервисами: postgres:16, redis:7, minio, mailhog.
- Все с healthchecks.
- `.env.example` со всеми переменными.

**Шаг B.7: CI/CD**
- `.github/workflows/ci.yml` — pipeline lint → typecheck → test → build.
- `.husky/pre-commit` — lint-staged + prettier + eslint.

**Шаг B.8: Makefile**
- Команды: `up / down / migrate / seed / test / lint / typecheck`.

**Шаг B.9: Первый git commit**
- "chore: bootstrap monorepo".

### Фаза 0 — пошагово (после Bootstrap)

**Шаг 0.1: pnpm install и базовая верификация**
- `pnpm install` в корне.
- Проверка, что Turbo видит все workspace'ы.

**Шаг 0.2: apps/api (NestJS)**
- Инициализация NestJS 10 + TypeScript strict.
- Зависимости: `@nestjs/config @nestjs/swagger nestjs-zod @nestjs/throttler helmet pino pino-http nestjs-pino @nestjs/jwt @nestjs/passport passport-jwt bcrypt class-validator class-transformer`.
- AppModule + HealthController с `GET /health` → `{status: ok, db: ok, redis: ok}`.
- Swagger на `/api/docs`.
- Pino pretty-format для dev.
- Порт **3001**.

**Шаг 0.3: packages/db (Prisma)**
- Prisma 5 + @prisma/client.
- `prisma/schema.prisma` с datasource (`postgresql`) и generator client.
- Пустая папка `prisma/migrations`.
- Заглушка `prisma/seed.ts`.

**Шаг 0.4: packages/shared**
- zod-схемы: `DateRangeSchema`, `PaginationSchema`, `IdSchema`.
- Утилиты дат (обёртка над date-fns с TZ): `parseISODate`, `formatDate`, `addDays`, `eachDayOfInterval`.
- Константы: `RESERVATION_STATUSES`, `ROOM_STATUSES`, `MEAL_PLANS`, `PAYMENT_METHODS`, `CHARGE_TYPES`.

**Шаг 0.5: packages/ui**
- shadcn/ui init.
- Экспорт базовых компонентов + 1-2 общих (`PageHeader`, `EmptyState`).

**Шаг 0.6: apps/web (Next.js)**
- Next.js 15 App Router + React 19 + TypeScript strict.
- TailwindCSS 3.4 (config из `design-system/MASTER.md`).
- shadcn/ui компоненты: `button, input, dialog, dropdown-menu, table, card, tabs, sheet, toast`.
- TanStack Query v5 + DevTools (только dev).
- Zustand.
- next-intl с `ru` (default) и `en`.
- Auth.js (next-auth) с credentials provider (ходит в apps/api).
- Заглушки `/dashboard` и `/login`.
- Порт **3000**.

**Шаг 0.7: apps/booking**
- Пустой Next.js, только главная-заглушка.
- Порт **3002**.

**Шаг 0.8: apps/worker**
- NestJS standalone application с BullMQModule.
- Готов принимать задачи (пока без задач).

**Шаг 0.9: Vitest + Playwright**
- Vitest для unit-тестов во всех apps/packages.
- Playwright в корневой `e2e/`.

**Шаг 0.10: Запуск стека**
- `make up` — поднимает docker-compose.
- `pnpm dev` — поднимает api на :3001, web на :3000, booking на :3002, worker в фоне.
- Проверка: `GET http://localhost:3001/health` → 200.
- Проверка: `http://localhost:3000/login` отдаёт стилизованную заглушку в цветах из дизайн-системы.

**Шаг 0.11: Git commit**
- `feat(infra): phase 0 — initialize monorepo, docker, base apps`.

---

## Часть 6. Roadmap фаз 1-17 (высокоуровневый)

Каждая фаза = отдельный этап после моего "готово" по предыдущей. Перед началом каждой фазы — отдельный детальный план как для Bootstrap+Фаза 0.

| # | Фаза | Ключевые риски / точки внимания |
|---|---|---|
| 1 | Auth + Multi-tenancy + RBAC | **Самый опасный фундамент.** Ошибка в RLS = утечка между отелями. Тесты до кода. Прогнать cross-tenant E2E. |
| 2 | Номерной фонд | Простая. Загрузка фото через presigned URL в MinIO. |
| 3 | Тарифы + цены + ограничения | PricingService — чистая функция, 30+ unit-тестов на разные occupancy/LOS/parent-child/sezons. |
| 4 | Inventory + Availability | Concurrency: 100 параллельных createReservation на последний номер → ровно 1 успешный. |
| 5 | Шахматка (3 спринта) | **Главный экран.** Виртуализация, WS, DnD, режимы. Здесь референс из текущего Timeline.jsx будет полезен. |
| 6 | Бронирования (3 спринта) | SERIALIZABLE транзакции, version check, advisory locks. Outbox events для каналов. |
| 7 | Гости + компании | pg_trgm для поиска и merge дублей. |
| 8 | Финансы (2 спринта) | Folio/Charge/Payment/Deposit, кассовые смены. Интерфейс IFiscalReceiptPrinter (заглушка для 54-ФЗ). |
| 9 | Check-in/out + Night Audit | BullMQ cron в локальной TZ. MigrationRecord для МВД (ЕПГУ заглушка). |
| 10 | Housekeeping | Mobile-first PWA для горничных. Тест на 375px. |
| 11 | Доп. услуги | Питание BB/HB/FB/AI с правилами разбиения. |
| 12 | Отчёты (2 спринта) | Materialized views, REFRESH в night audit. exceljs для XLSX, puppeteer для PDF. |
| 13 | Booking Engine | SEO (SSR + schema.org/Hotel JSON-LD), embeddable iframe. Lighthouse Mobile ≥ 90. |
| 14 | **Channel Manager (3 спринта)** | Самая сложная фаза. Outbox + idempotency + DLQ + chaos-тесты. OTA XML 2003B + Booking.com B.XML. |
| 15 | Уведомления | Handlebars templates, BullMQ queue, журнал отправок. |
| 16 | Public API + import/export | OAuth2 client_credentials → JWT, rate-limit, OpenAPI v3, webhooks с HMAC. |
| 17 | Production hardening | k6 load tests, OWASP ZAP, Grafana, Docusaurus, Sentry, v1.0.0 tag. |

---

## Часть 7. Вопросы, которые жду от тебя

**Перед началом любых действий:**

1. **Папки `frontend\` и `backend\`** — переименовать в `_legacy\` / удалить / создать монорепо в другом месте?
2. **`git init`** в `D:\GitHub\kars-hotel\` — делать?
3. **Имя проекта** — "KarsHotel PMS" или своё?
4. **Docker Desktop** — запущен у тебя сейчас?
5. **Какой шаг Bootstrap я делаю первым после твоего "ок"?** (B.1, или ты хочешь увидеть какой-то конкретный файл/команду заранее перед B.1)

После твоих ответов — я делаю **только один шаг**, показываю результат, жду подтверждение, иду к следующему.
