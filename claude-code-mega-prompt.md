# 🏨 Мега-промпт для Claude Code: реализация PMS-системы (аналог TravelLine WebPMS)

> **Как использовать:**
> 1. Создай пустую папку для проекта (например `~/projects/karshotel-pms`).
> 2. Открой её в Claude Code (`claude` или VS Code расширение).
> 3. Убедись, что `ui-ux-pro-max-skill` установлен (`uipro init --ai claude` или `/plugin install ui-ux-pro-max@ui-ux-pro-max-skill`).
> 4. Скопируй сначала **БУТСТРАП-ПРОМПТ** (см. ниже) — он создаст структуру и документацию.
> 5. Затем по одному копируй промпты для **Фазы 0 → Фазы 17** в порядке очередности.
> 6. После каждой фазы говори `git commit -am "phase X complete"` и переходи к следующей.

---

## 🎯 БУТСТРАП-ПРОМПТ (запусти первым)

```
Ты — senior fullstack-разработчик, специализирующийся на SaaS-системах для hospitality. Мы строим продукт KarsHotel PMS — облачную систему управления отелями (Property Management System), полный аналог TravelLine: WebPMS, для российского и СНГ-рынка.

ОБЯЗАТЕЛЬНОЕ ПРАВИЛО ПО UI/UX:
Для каждого экрана, компонента и любой работы с визуальной частью ты ОБЯЗАН использовать установленный skill `ui-ux-pro-max-skill`. Перед написанием любого UI-кода вызывай design system generator:

  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "hotel PMS dashboard" --design-system --persist -p "KarsHotel"

и сохраняй результат в design-system/MASTER.md. Для специфичных страниц генерируй overrides:

  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "hotel rack chart calendar" --design-system --persist -p "KarsHotel" --page "rack-chart"
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "hotel booking engine widget" --design-system --persist -p "KarsHotel" --page "booking-engine"
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "hotel finance dashboard" --design-system --persist -p "KarsHotel" --page "finance"
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "hotel reports analytics ADR RevPAR" --design-system --persist -p "KarsHotel" --page "reports"
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "hotel channel manager OTA" --design-system --persist -p "KarsHotel" --page "channels"
  python3 .claude/skills/ui-ux-pro-max/scripts/search.py "hotel housekeeping mobile checklist" --design-system --persist -p "KarsHotel" --page "housekeeping"

ПЕРЕД написанием любого UI-компонента читай design-system/MASTER.md и соответствующий override из design-system/pages/*. Используй только указанные там цвета, шрифты, эффекты и паттерны. Проверяй pre-delivery checklist (no emojis as icons → используй lucide-react, cursor-pointer на кликабельных, hover transitions 150-300ms, контраст 4.5:1+, focus states видимы, prefers-reduced-motion, responsive 375/768/1024/1440).

КЛЮЧЕВЫЕ ТРЕБОВАНИЯ К ПРОДУКТУ:
- Полный аналог TravelLine WebPMS, все модули включая финансы и отчёты.
- БЕЗ кассового модуля (54-ФЗ), но с интерфейсом IFiscalReceiptPrinter, чтобы потом подключить.
- Многоязычность (русский основной, английский второй).
- Multi-tenant SaaS архитектура.
- Stack: Node.js 20 LTS + NestJS 10, Next.js 15 App Router, PostgreSQL 16, Prisma 5, Redis 7, BullMQ, Socket.IO, TailwindCSS, shadcn/ui, TanStack Query, TanStack Virtual, dnd-kit, react-hook-form, zod, date-fns, Pino, OpenTelemetry, Vitest, Playwright.

ЗАДАЧА БУТСТРАПА:
1. Создай корневую структуру проекта (Turborepo + pnpm):
   - apps/api (NestJS REST + WebSocket)
   - apps/web (Next.js админка, шахматка, настройки, отчёты)
   - apps/booking (Next.js публичный Booking Engine виджет)
   - apps/worker (NestJS standalone — BullMQ воркеры)
   - packages/db (Prisma schema, миграции, seeds)
   - packages/shared (zod-схемы, DTO, типы, утилиты дат, константы)
   - packages/ui (shadcn/ui компоненты, общие пресеты)
   - packages/channels (коннекторы каналов: OTA XML, Booking.com B.XML, Ostrovok, etc.)
   - packages/eslint-config
   - packages/tsconfig

2. Создай docker-compose.yml с сервисами: postgres:16, redis:7, minio (S3-compatible), mailhog (smtp dev). Все секреты — через .env.example.

3. Создай корневой README.md с описанием продукта и инструкциями.

4. Создай /docs:
   - PRD.md → скопируй сюда полный анализ TravelLine WebPMS, который я даю ниже (раздел «АРХИТЕКТУРНЫЙ КОНТЕКСТ»).
   - ARCHITECTURE.md → высокоуровневая архитектура.
   - DATABASE.md → схема БД.
   - ROADMAP.md → 17 фаз.
   - DESIGN.md → ссылка на design-system/MASTER.md, правила использования ui-ux-pro-max-skill.
   - CHANGELOG.md → пустой шаблон.

5. Сразу запусти ui-ux-pro-max design system generator (команды выше) и сохрани результат в design-system/.

6. Настрой GitHub Actions: lint → typecheck → unit tests → build.

7. Настрой Husky pre-commit (lint-staged + prettier + eslint).

8. Создай .env.example, .gitignore, .editorconfig.

9. Не пиши код модулей — только структуру. Конкретные модули будем делать на следующих фазах.

ДО НАЧАЛА КОДА:
- Прочитай и осмысли весь раздел «АРХИТЕКТУРНЫЙ КОНТЕКСТ» ниже.
- Создай /docs/PRD.md и положи туда этот контекст.
- Запусти design system generator и положи результаты в design-system/.
- Сделай git init, добавь .gitignore, сделай первый коммит "chore: bootstrap monorepo".

ПОСЛЕ ЗАВЕРШЕНИЯ БУТСТРАПА:
- Покажи мне дерево созданных файлов.
- Покажи design-system/MASTER.md.
- Жди мой следующий промпт (Фаза 0).

═══════════════════════════════════════════════════════════
АРХИТЕКТУРНЫЙ КОНТЕКСТ (положи в /docs/PRD.md)
═══════════════════════════════════════════════════════════

# KarsHotel PMS — Product Requirements Document

## Что мы делаем
Облачная Property Management System (PMS) для отелей, гостиниц, апартаментов, хостелов, баз отдыха. Полный аналог TravelLine: WebPMS (https://travelline.ru/products/webpms/). Целевая аудитория: средства размещения 5-200+ номеров в РФ, СНГ.

## Модули (по аналогии с TL: WebPMS)
1. Шахматка (rack chart) — главный экран: сетка дни × номера, drag-and-drop, real-time, режимы суточный/почасовой, групповые брони.
2. Управление номерным фондом — категории (RoomType), физические номера (Room), удобства (Amenity), фото, типы кроватей.
3. Тарифы и цены — RatePlan (питание, политика отмены/оплаты), Rate (по дате/категории/occupancy), occupancy pricing, LOS pricing.
4. Ограничения — Closed, CTA (closed to arrival), CTD (closed to departure), MinLOS, MaxLOS, MinLosArrival, MaxLosArrival, MinAdvance, MaxAdvance, Stop Sell.
5. Доступность (Inventory) — total/sold/blocked/oversell по (room_type, date).
6. Бронирования — Reservation + RoomStay (для групп), статусы DRAFT→BOOKED→CONFIRMED→CHECKED_IN→CHECKED_OUT→{NO_SHOW|CANCELLED}.
7. Гости — профили, объединение дублей, паспорт, лояльность, история.
8. Компании — клиенты и агенты (юр.лица), реквизиты, корпоративные тарифы.
9. Финансы — Folio (общий + индивидуальные), Charge (ROOM/SERVICE/EARLY_CHECKIN/LATE_CHECKOUT/TOURIST_TAX/VAT/ADJUSTMENT/REFUND), Payment (CASH/CARD/BANK/DEPOSIT/CHANNEL_PREPAID/LINK), Deposit, статьи доходов/расходов, кассы и смены.
10. Регистрация (миграционный учёт) — анкеты для МВД, заглушка интеграции с ЕПГУ.
11. Check-in / Check-out / Night Audit — ежедневный закрывающий процесс.
12. Housekeeping — статусы номеров (DIRTY/CLEAN/INSPECTED/OOO/OOS), задачи уборки, мобильный экран для горничных.
13. Доп. услуги — питание (BB/HB/FB/AI с правилами разбиения), трансфер, спа, парковка.
14. Отчёты — 25+ отчётов: Заезды, Выезды, Занятые номера, Платежи, Депозит, Допуслуги, Питание, Сводная статистика, Журнал активности, Способы оплаты, Обслуживание номеров, 1-КСР, Доходность и загрузка (Occupancy/ADR/RevPAR/RevPAC/ALOS), Финансовый посуточный сравнительный, История и прогноз, Отчёт по отменам, Окно аннуляций, Календарь спроса, Эффективность менеджеров, Балансы бронирований, Доходность по тарифам, Теги.
15. Booking Engine — embeddable виджет для сайта отеля, прямые брони без комиссии.
16. Channel Manager — синхронизация с OTA: Ostrovok.ru, Bronevik.com, Яндекс Путешествия, OneTwoTrip, Суточно.ру, ТВИЛ, Booking.com B.XML (опционально для не-РФ рынков), универсальный OTA XML 2003B fallback.
17. Уведомления — email + SMS + push (шаблоны Handlebars, журнал отправок).
18. Публичное API — REST + OAuth2 client_credentials → JWT, по аналогии с TL: Partner API.
19. RBAC — роли OWNER, MANAGER, FRONT_DESK, HOUSEKEEPING, ACCOUNTANT, CHANNEL_MANAGER, READ_ONLY.
20. Audit log — журнал всех мутаций.

## Тарифные планы (как у TL)
- LITE — до 30 номеров: шахматка, базовый housekeeping, почасовые брони, 20 отчётов.
- STANDART — до 60 номеров: + универсальное API, миграционный учёт, эл. замки, Wi-Fi-модуль, финансовый учёт, 25 отчётов.
- PREMIUM — 61+ номеров: + расширенный housekeeping, 27 отчётов, интеграция с 1С/iiko/r_keeper.

## Метрики (формулы для отчётов)
- Occupancy = (Sold rooms / Available rooms) × 100%
- ADR = Total room revenue / Number of sold rooms
- RevPAR = Total room revenue / Total available rooms = ADR × Occupancy
- TRevPAR = (Rooms + F&B + Spa + Other) revenue / Available rooms
- GOPPAR = (Total revenue − Operating expenses) / Available rooms
- ALOS = Total room nights / Total bookings
- RevPAC = Total room revenue / Number of guests
- Cancellation rate, Booking pace, Net ADR (после комиссий OTA), RGI (RevPAR Index).

## Ключевые архитектурные решения
- Multi-tenancy через PostgreSQL Row-Level Security (RLS). На каждом запросе бэкенд делает SET LOCAL app.tenant_id, на всех таблицах политика USING (tenant_id = current_setting('app.tenant_id')::uuid). Композитные индексы с tenant_id первой колонкой. Отдельная роль app_migrator с BYPASSRLS для миграций.
- Защита от двойных бронирований: pessimistic SELECT FOR UPDATE на Inventory + pg_advisory_xact_lock(hash(tenant, room_type, date)) + optimistic versioning на Reservation для UI-конкуренции.
- Channel Manager надёжность: Outbox pattern, debounce 10 сек для агрегации burst-апдейтов, idempotency keys hash(channel, room_type, date, rate, version), exponential backoff с jitter, DLQ + Sentry-алерт после N=10 fails, safety buffer на отправку inventory, reservation pull раз в 30 сек для Booking.com, ≥12 месяцев availability вперёд.
- Шахматка производительная: один SQL с CTE возвращает {rooms, reservations} на окно ~60 дней; виртуализация @tanstack/react-virtual на строки и колонки; брони — absolute spans поверх CSS grid; drag через dnd-kit; Redis cache 30 сек; WS room-per-tenant с дельта-патчами.
- Гибкое ценообразование: PricingService.calculate() — чистая функция (rate_plan, room_type, dates, occupancy, guest?) → итоговая стоимость + breakdown. 30+ unit-тестов.
- Финансы: каждая ночь roomstay → BullMQ задача roomNightCharge. Питание BB → начисление в день выезда; HB/FB/AI разбивай на компоненты. Депозит — спец. счёт гостя для переносов предоплаты.
- Night audit: BullMQ cron 00:30 локального времени → auto-checkout не-выехавших как NO_SHOW по политике, post pending charges, пересчёт OccupancyStatsDaily, daily-отчёты, business date rollover.
- Кэширование: availability:{tenant}:{from}:{to} TTL 60с, rate:{tenant}:{ratePlan}:{roomType}:{date}:{occ} TTL 5мин, rack:{tenant}:{from}:{to} TTL 30с.
- Audit log: каждая мутация → AuditLog (entity, action, JSON diff, userId, ip, ua).

## Стандарты
- OTA XML 2003B — стандартный протокол OpenTravel Alliance.
- Booking.com Connectivity API — B.XML, delta-only через roomRateAvailability, ≥12 мес availability, reservations pull ≤30 сек.
- HTNG нормы.
- 152-ФЗ (ПДн).

## Что НЕ делаем в MVP
- 54-ФЗ (фискальные кассы) — заглушаем интерфейсом IFiscalReceiptPrinter.
- 1С — интерфейс IAccountingExport, реализация позже.
- ИИ-чат / HotelGPT — позже.
- Native mobile — пока responsive PWA достаточно.
- Loyalty с уровнями — базовая модель, расширение позже.
- Price optimizer (ML) — позже.

## Ожидаемое время до GA: 12 месяцев (17 фаз по 1-3 спринта).
```

---

## 📦 ФАЗА 0: Инициализация инфраструктуры

```
Фаза 0: Инициализация проекта.

Контекст: проект только что забутстраплен, теперь нужно настроить базовую инфраструктуру и проверить, что всё работает.

Задачи:
1. Установи pnpm-workspace.yaml и turbo.json с pipeline: lint, typecheck, test, build, dev.
2. В apps/api:
   - NestJS 10 с TypeScript strict mode.
   - Подключи: @nestjs/config, @nestjs/swagger, nestjs-zod, @nestjs/throttler, helmet, pino, pino-http, nestjs-pino, @nestjs/jwt, @nestjs/passport, passport-jwt, bcrypt, class-validator, class-transformer.
   - Базовый AppModule с HealthController (GET /health → {status: ok, db: ok, redis: ok}).
   - Swagger на /api/docs.
   - Pino логи в pretty формате для dev.
3. В apps/web:
   - Next.js 15 App Router + React 19 + TypeScript strict.
   - TailwindCSS 3.4 (configured per design-system/MASTER.md цветовая палитра).
   - shadcn/ui init с базовыми компонентами (button, input, dialog, dropdown-menu, table, card, tabs, sheet, toast).
   - TanStack Query v5 setup с DevTools (только dev).
   - Zustand storage.
   - next-intl с локалями ru (default) и en.
   - Auth.js (next-auth) с credentials provider, который ходит в apps/api.
   - Заглушка главной /dashboard и /login.
4. В apps/booking — пустой Next.js, только главная заглушка.
5. В apps/worker — NestJS standalone application с BullMQModule, готовый принимать задачи.
6. В packages/db:
   - Prisma 5 + @prisma/client.
   - prisma/schema.prisma с datasource (postgresql) и generator client.
   - prisma/migrations пусто.
   - prisma/seed.ts — заглушка.
7. В packages/shared:
   - zod-схемы общие (DateRangeSchema, PaginationSchema, IdSchema).
   - Утилиты дат (parseISODate, formatDate, addDays, eachDayOfInterval — обёртка над date-fns с таймзонами).
   - Константы (RESERVATION_STATUSES, ROOM_STATUSES, MEAL_PLANS, PAYMENT_METHODS, CHARGE_TYPES).
8. В packages/ui — экспорт shadcn/ui компонентов + 1-2 общих (PageHeader, EmptyState).
9. Настрой Vitest для unit-тестов во всех apps/packages.
10. Настрой Playwright в e2e/ (отдельная папка в корне).
11. Создай docker-compose.dev.yml с healthchecks для postgres/redis/minio/mailhog.
12. Создай Makefile с командами: make up / make down / make migrate / make seed / make test / make lint / make typecheck.
13. Проверка: pnpm install → pnpm dev должен поднять api на :3001, web на :3000, booking на :3002, worker в фоне; GET http://localhost:3001/health возвращает ok.

ПРЕЖДЕ ЧЕМ КОДИТЬ:
- Прочитай design-system/MASTER.md.
- Подбери из shadcn/ui минимальный набор компонентов, который ляжет на наш design system.

ПОСЛЕ ЗАВЕРШЕНИЯ:
- Покажи скриншот /login и /dashboard (заглушки, но в наших цветах).
- Git commit: "feat(infra): phase 0 — initialize monorepo, docker, base apps".
```

---

## 🔐 ФАЗА 1: Auth + Multi-tenancy + RBAC

```
Фаза 1: Аутентификация, multi-tenancy через PostgreSQL Row-Level Security, ролевая модель доступа.

КРИТИЧЕСКИ ВАЖНО: это фундамент безопасности. Любая ошибка здесь = утечка данных между отелями. Пиши тесты ДО кода (TDD) для cross-tenant isolation.

Задачи:
1. Prisma модели:
   - Tenant (id UUID, slug unique, name, timezone default 'Europe/Moscow', currency default 'RUB', vatPayer bool, touristTax bool, plan enum LITE|STANDART|PREMIUM, createdAt).
   - User (id, tenantId, email, passwordHash, fullName, roleId, isActive, lastLoginAt, @@unique([tenantId, email])).
   - Role (id, tenantId, code enum, name, @@unique([tenantId, code])). Предустановленные роли: OWNER, MANAGER, FRONT_DESK, HOUSEKEEPING, ACCOUNTANT, CHANNEL_MANAGER, READ_ONLY.
   - Permission (id, code) — справочник прав действий (reservation.create, reservation.update, reservation.cancel, rate.update, report.view.finance, и т.д.).
   - RolePermission (roleId, permissionId).
   - RefreshToken (id, userId, tokenHash, expiresAt, revokedAt, ip, ua) — в Redis или таблице.
   - AuditLog (id, tenantId, userId, entity, entityId, action, diff JSON, ip, ua, createdAt).

2. RLS-миграция:
   - Создай роль app_user без BYPASSRLS и роль app_migrator с BYPASSRLS.
   - На все tenant-таблицы (кроме Tenant): ENABLE ROW LEVEL SECURITY + FORCE ROW LEVEL SECURITY + политика CREATE POLICY tenant_isolation ON "TableName" USING (tenant_id = current_setting('app.tenant_id', true)::uuid).
   - На таблицу Tenant: политика «видит только свой» через привязку к JWT.
   - DATABASE_URL для миграций использует app_migrator, для рантайма — app_user.

3. NestJS AuthModule:
   - POST /auth/register-tenant — создаёт Tenant + OWNER-юзера + дефолтные роли + дефолтный набор Permission. В транзакции.
   - POST /auth/login → returns access token (15 мин) + refresh token (7 дней, httpOnly cookie SameSite=Lax).
   - POST /auth/refresh → ротирует refresh, выпускает новый access.
   - POST /auth/logout → revoke refresh.
   - GET /me → текущий user + tenant.
   - Все остальные endpoints за JwtAuthGuard.

4. TenantContextMiddleware:
   - Извлекает tenantId из JWT.
   - На каждом запросе открывает Prisma-транзакцию с SET LOCAL app.tenant_id = '<uuid>'.
   - Использует AsyncLocalStorage для проброса контекста.
   - Если tenant_id не установлен → fail-safe: запросы возвращают 0 строк (RLS политика).

5. RBAC:
   - CASL (@casl/ability + @casl/prisma).
   - PoliciesGuard + @CheckPolicies() декоратор.
   - AbilityFactory строит ability для user на основе его роли и permissions.
   - Пример: @CheckPolicies((ab) => ab.can('update', 'Reservation')).

6. UsersModule:
   - CRUD пользователей (только OWNER+MANAGER).
   - Назначение ролей.
   - Инвайт по email (заглушка отправки в mailhog).

7. Frontend:
   - /register — форма создания tenant (название отеля, email, пароль, таймзона, валюта).
   - /login — email + пароль.
   - /dashboard — заглушка с приветствием и shadcn/ui sidebar (по design-system).
   - /settings/users — CRUD пользователей, список ролей.
   - Auth.js custom Credentials provider, который зовёт apps/api/auth/login.
   - Session-cookie с tenantId, userId, roles в JWT-payload.

8. ТЕСТЫ (КРИТИЧНО, ПИШИ ПЕРВЫМИ):
   - Unit: AuthService.login, AuthService.refresh, AuthService.register.
   - Integration: создай 2 tenant'а с одинаковыми email — запрос юзера из tenant A не возвращает юзера tenant B.
   - E2E: создай 2 tenants → создай Room в tenant A → залогинься в tenant B → запрос /rooms возвращает пустой массив (НЕ ошибку, а именно пустой — RLS работает прозрачно).
   - E2E: попытка прямого SQL без SET LOCAL app.tenant_id возвращает 0 строк.
   - E2E: попытка передать tenantId в теле запроса игнорируется (берётся только из JWT).
   - Load: 1000 RPS на /me с разными tokens → p95 < 50ms.

ПЕРЕД UI:
- python3 .claude/skills/ui-ux-pro-max/scripts/search.py "auth login signup SaaS" --design-system --persist -p "KarsHotel" --page "auth"
- Прочитай результат, следуй стилю.

ПОСЛЕ ЗАВЕРШЕНИЯ:
- Запусти все тесты, покажи зелёный отчёт.
- Покажи скриншоты /register, /login, /dashboard, /settings/users.
- Git commit: "feat(auth): phase 1 — multi-tenancy via RLS, JWT auth, RBAC via CASL".
```

---

## 🛏️ ФАЗА 2: Управление номерным фондом

```
Фаза 2: Категории номеров, физические номера, удобства, фото.

Задачи:
1. Prisma модели:
   - RoomType (id, tenantId, code unique по tenant, name, description, baseOccupancy, maxOccupancy, extraBeds, photos JSON-массив с URL и порядком, sortOrder, isActive, createdAt, updatedAt).
   - Room (id, tenantId, roomTypeId, number unique по tenant, floor, bedType enum SINGLE|DOUBLE|TWIN|KING|QUEEN|SOFA, view enum, isActive, status enum DIRTY|CLEAN|INSPECTED|OUT_OF_ORDER|OUT_OF_SERVICE default CLEAN, notes).
   - Amenity (id, tenantId, code, name, icon, category enum BATHROOM|TECH|COMFORT|FOOD|VIEW|OTHER).
   - RoomTypeAmenity (roomTypeId, amenityId) — m2m.
   - RoomAmenity (roomId, amenityId) — m2m для override на конкретный номер.

2. NestJS RoomTypesModule + RoomsModule + AmenitiesModule:
   - CRUD endpoints.
   - При создании RoomType — создавай Inventory заранее на 365 дней вперёд (BullMQ job auto-seed-inventory).
   - При деактивации Room (isActive=false) — проверь, что у него нет будущих броней.
   - Загрузка фото в S3 (MinIO в dev): presigned URL для прямой загрузки с фронта, потом подтверждение PUT /room-types/:id/photos с URL.

3. Frontend:
   - /settings/room-types — список + drawer создания/редактирования.
   - /settings/rooms — таблица номеров с фильтром по категории/этажу/статусу.
   - /settings/amenities — справочник удобств с иконками из lucide-react.
   - Загрузка фото — drag-and-drop через react-dropzone + сортировка через dnd-kit.

4. Seed:
   - В packages/db/prisma/seed.ts добавь функцию seedDemoHotel(): создаёт tenant «Demo Hotel», 4 категории (Standart Single, Standart Double, Deluxe King, Suite), 30 номеров с распределением, 20 удобств.

5. Тесты:
   - Unit: валидация уникальности code/number по tenant.
   - Integration: создание RoomType триггерит создание Inventory на 365 дней.
   - E2E: создал категорию → добавил 5 номеров → удалил категорию → ошибка «есть привязанные номера».

ПЕРЕД UI:
- Прочитай design-system/pages/rack-chart.md (если есть) — таблицы в админке должны быть в едином стиле.
- Используй lucide-react для иконок (НЕ emoji).

ПОСЛЕ ЗАВЕРШЕНИЯ:
- Скриншоты страниц.
- Запусти seed → покажи список созданных категорий.
- Git commit: "feat(rooms): phase 2 — room types, rooms, amenities".
```

---

## 💰 ФАЗА 3: Тарифы, цены, ограничения

```
Фаза 3: RatePlans, Rates, Restrictions, политики отмены и оплаты.

Задачи:
1. Prisma модели:
   - CancellationPolicy (id, tenantId, code, name, freeCancelHoursBefore, penaltyPercent, penaltyNights, nonRefundable bool).
   - PaymentPolicy (id, tenantId, code, name, prepaymentPercent, prepaymentAmount, prepaymentDeadlineHours, paymentOnArrival bool).
   - RatePlan (id, tenantId, code unique, name, description, mealPlan enum NONE|BB|HB|FB|AI, cancelPolicyId, paymentPolicyId, isClosed, source enum DIRECT|CHANNEL|RACK|ALL, occupancyPricing bool, losPricing bool, parentRatePlanId nullable, priceModifierType enum ABSOLUTE|PERCENT, priceModifierValue, sortOrder, isActive).
   - Rate (id, tenantId, ratePlanId, roomTypeId, date Date, occupancy int, price Decimal(12,2), currency default RUB, @@unique([tenantId, ratePlanId, roomTypeId, date, occupancy])).
   - LosDiscount (id, ratePlanId, minNights, maxNights, discountPercent) — для LOS pricing.
   - Restriction (id, tenantId, ratePlanId nullable, roomTypeId, date, closed bool, cta bool, ctd bool, minLos, maxLos, minLosArrival, maxLosArrival, minAdvance, maxAdvance, stopSell, @@unique([tenantId, ratePlanId, roomTypeId, date])).
   - SeasonalRule (id, tenantId, ratePlanId, roomTypeId nullable, fromDate, toDate, daysOfWeek bit-mask, priceModifier Decimal). Опционально, для сезонных надбавок.

2. NestJS PricingModule:
   - PricingService.calculate(input: {tenantId, roomTypeId, ratePlanId, arrival, departure, occupancy, guestId?, promoCode?}) → returns {totalPrice, breakdown: {nights: [{date, basePrice, occupancyMod, losDisc, loyaltyDisc, promoDisc, total}], extras: [], taxes: []}}.
   - Алгоритм:
     1. eachDayOfInterval(arrival, departure-1).
     2. Для каждой ночи: Rate.findFirst({tenantId, ratePlanId, roomTypeId, date, occupancy: ≤baseOccupancy}).
     3. Если RatePlan.parentRatePlanId — применить modifier поверх parent rate.
     4. Если RatePlan.occupancyPricing — взять Rate под точный occupancy; если нет точного — взять ближайший снизу.
     5. Применить LosDiscount по nights count.
     6. Применить loyalty (если guestId дан и есть active card).
     7. Применить promoCode.
     8. SeasonalRule mods.
     9. Tourist tax (если tenant.touristTax) + VAT (если tenant.vatPayer).
   - 30+ unit-тестов: разные occupancy, LOS, parent/child, sezons, edge cases (departure = arrival → 0).

3. NestJS RestrictionsModule:
   - CRUD ограничений с batch endpoints (set restrictions for date range).
   - RestrictionsService.check(input: {tenantId, ratePlanId, roomTypeId, arrival, departure}) → returns {allowed: bool, violations: [{rule: 'MIN_LOS', detail: '3 nights required'}]}.

4. Frontend:
   - /settings/rate-plans — список + создание (визард: «Шаг 1: Основное → Шаг 2: Питание → Шаг 3: Политики → Шаг 4: Цены»).
   - /settings/rate-plans/:id/rates — месячный календарь (категория × дата), inline-редактирование цен, кнопки «Скопировать неделю», «Массовое изменение» (диапазон + % или абсолютная сумма), «Применить шаблон» (сезоны).
   - /settings/rate-plans/:id/restrictions — тот же календарь, но с чекбоксами CTA/CTD/Closed и полями MinLOS/MaxLOS.
   - /settings/policies — отдельные страницы для CancellationPolicy и PaymentPolicy.

5. Тесты:
   - 30+ unit-тестов на PricingService.
   - 15+ unit-тестов на RestrictionsService.
   - E2E: создал rate plan → задал цены на месяц → запросил quote → проверил breakdown.

ПЕРЕД UI:
- python3 .claude/skills/ui-ux-pro-max/scripts/search.py "rate calendar grid pricing" --design-system --persist -p "KarsHotel" --page "rates"
- Календарь должен быть похож на TL: WebPMS — компактная сетка с inline-редактированием.

ПОСЛЕ ЗАВЕРШЕНИЯ:
- Скриншоты страниц.
- Покажи отчёт по тестам PricingService (минимум 30 кейсов).
- Git commit: "feat(rates): phase 3 — rate plans, rates, restrictions, pricing service".
```

---

## 📅 ФАЗА 4: Inventory и доступность

```
Фаза 4: Управление инвентарём номеров и расчёт доступности с учётом ограничений.

Задачи:
1. Prisma:
   - Inventory (id, tenantId, roomTypeId, date Date, total int, sold int default 0, blocked int default 0, oversell int default 0, @@unique([tenantId, roomTypeId, date]), CHECK (sold + blocked <= total + oversell)).
   - InventoryBlock (id, tenantId, roomTypeId, fromDate, toDate, reason, count, createdById) — для ручных блокировок.

2. NestJS InventoryModule + AvailabilityModule:
   - InventoryService.recompute(roomTypeId, date) — пересчитывает sold из активных Reservation+RoomStay.
   - AvailabilityService.check(input: {tenantId, roomTypeId, arrival, departure, ratePlanId?, occupancy}) → returns {available: int per day, totalAvailable: min by day, restrictions: [...], canBook: bool, reason: string?}.
   - AvailabilityService.search(input: {tenantId, arrival, departure, adults, children}) → returns [{roomType, ratePlans: [{ratePlan, price, restrictions}], availableCount}].
   - При создании/отмене брони — Inventory.sold пересчитывается в той же транзакции с SELECT FOR UPDATE.

3. Кэширование:
   - Redis ключ availability:{tenantId}:{roomTypeId}:{date} TTL 60 сек.
   - Инвалидация при изменении Inventory, Reservation, Restriction.

4. Frontend:
   - /availability — heatmap: дни × категории, цвет ячейки по % доступности (зелёный → жёлтый → красный).
   - Tooltip: total/sold/blocked/oversell + кнопка «Заблокировать N номеров».
   - Drawer «Заблокировать» — диапазон дат, причина, количество.

5. Тесты:
   - Unit: AvailabilityService под разные кейсы — категория закрыта, CTA на день заезда, MinLOS не выполнен, точно заполнено.
   - Concurrency: 100 одновременных createReservation на последний номер → создаётся ровно 1.

ПЕРЕД UI:
- Heatmap должен быть в палитре design-system (не использовать стандартный «помидорный» зелёный/красный, а через цвета MASTER.md).

ПОСЛЕ ЗАВЕРШЕНИЯ:
- Скриншоты heatmap.
- Конкурентный тест — покажи результат k6 на createReservation с 100 параллельными запросами.
- Git commit: "feat(inventory): phase 4 — inventory, availability service, blocks".
```

---

## ♟️ ФАЗА 5: ШАХМАТКА (3 спринта, ключевой модуль)

```
Фаза 5: Шахматка (rack chart). Главный экран всей PMS.

ЭТО САМЫЙ ВАЖНЫЙ И СЛОЖНЫЙ МОДУЛЬ. Делай в 3 итерации:
- Спринт 5.1: Read-only шахматка с виртуализацией и WS-обновлениями.
- Спринт 5.2: Drag-and-drop переноса, создание брони выделением мышью.
- Спринт 5.3: Режимы (суточный/почасовой), фильтры, строка «без номера», конфликт-детектор.

═══════ СПРИНТ 5.1: Read-only шахматка ═══════

1. NestJS RackModule:
   - GET /rack?from=YYYY-MM-DD&to=YYYY-MM-DD → один SQL с CTE:
     SELECT rooms (id, number, type, floor, status)
     LEFT JOIN RoomStay (через Reservation, в окне дат)
     возвращает {rooms: [], stays: [{id, roomId, arrival, departure, guestName, status, reservationId, color}], inventory: [{roomTypeId, date, sold, total, free}]}.
   - Redis cache 30 сек, key rack:{tenantId}:{from}:{to}.
   - Pagination не нужна — окно всегда ограничено датами; макс 90 дней × все номера.

2. NestJS RackGateway (Socket.IO):
   - On connect — auth через JWT, join room tenant:{id}:rack.
   - Emits: booking.created, booking.updated, booking.moved, booking.cancelled, inventory.changed, room.status.changed.
   - Payload — минимальный delta-patch для apply в TanStack Query cache.

3. Frontend /rack:
   - Layout: header с date-picker «диапазон» + переключателем 7/14/30/60 дней + кнопки [← →] для скролла.
   - Sidebar слева: список категорий с количеством номеров и кнопкой свернуть.
   - Главная зона: CSS Grid (cols = дни, rows = номера).
   - Виртуализация:
     - @tanstack/react-virtual для rows (номеров может быть 200+).
     - Колонок (дней) — обычно 30-60, виртуализация не критична, но опционально.
   - Брони — absolute-positioned divs с grid-column-start/end по индексам дат.
   - Цвета статусов:
     - BOOKED — жёлтый из палитры.
     - CONFIRMED — синий.
     - CHECKED_IN — зелёный.
     - CHECKED_OUT — серый.
     - CANCELLED / NO_SHOW — красный (полупрозрачный).
   - В каждой бронированной ячейке: имя гостя, число гостей (👥 → lucide UsersRound), статус оплаты (◯/●).
   - Hover на ячейку — Popover с краткой инфой.
   - Click на ячейку — открывает Drawer карточки брони (пока заглушка, реальная карточка в Фазе 6).
   - На пустой ячейке — hover показывает «+ Создать бронь» (пока заглушка).
   - Сверху таблицы — строка с количеством свободных по категории на каждый день (агрегация по Inventory).
   - Текущая дата — вертикальная синяя линия + жирный шрифт заголовка дня.
   - useRackSocket hook — подписка на WS, применение патчей к TanStack Query кешу через queryClient.setQueryData.

ПЕРЕД UI:
- python3 .claude/skills/ui-ux-pro-max/scripts/search.py "hotel rack chart calendar drag drop" --design-system --persist -p "KarsHotel" --page "rack-chart"
- Это главный экран — он должен выглядеть premium и быть удобным. Изучи скриншоты TL: WebPMS, Bnovo, Cloudbeds для inspiration.
- Используй стиль из MASTER.md: цвета, шрифт, отступы. Иконки — lucide-react.

Тесты спринта 5.1:
- Unit: rackQuery возвращает правильную форму данных.
- E2E (Playwright): открой /rack → должно быть видно 30 номеров и 14 дней; скролл вправо → подгружаются новые даты.
- Performance: при 200 номерах × 60 дней первый рендер < 1500ms, scroll FPS > 50.

═══════ СПРИНТ 5.2: Drag-and-drop, создание мышью ═══════

1. dnd-kit:
   - useDraggable на каждой брони.
   - useDroppable на пустых ячейках (room × date).
   - На drop → PATCH /reservations/:id/move с {roomId, arrival, departure} (даты не меняем, только roomId; для смены дат — открывается диалог).
   - Optimistic UI: сразу двигаем span в кеше, при 409 — откат с toast.

2. Конфликт-детектор:
   - Server-side в ReservationService.move(): проверка, что в новом номере на новых датах нет другой брони.
   - Если конфликт — 409 + список конфликтующих броней.
   - Client-side во время drag — show red outline на droppable, если по локальному кешу видно конфликт (для UX feedback).

3. Создание мышью:
   - mousedown на пустой ячейке → mousemove + mouseup → выделение диапазона дат в одной строке.
   - На mouseup открывается Drawer «Новая бронь» с предзаполненными roomId, arrival, departure.
   - Полноценная форма бронирования будет в Фазе 6, пока — заглушка с этими полями.

Тесты спринта 5.2:
- E2E: drag брони из одного номера в другой → API получил PATCH, шахматка обновилась.
- E2E: попытка drop на занятую ячейку → toast "Конфликт", откат.
- E2E: mousedown+drag+mouseup на пустых ячейках → открылся Drawer с правильными датами.

═══════ СПРИНТ 5.3: Режимы и фильтры ═══════

1. Toggle режим суточный / почасовой:
   - В суточном — оси по дням.
   - В почасовом — оси по часам (текущий день +/- N дней).

2. Фильтры в header:
   - По категории (multi-select).
   - По этажу.
   - По статусу номеров (показать только грязные).
   - Поиск по имени гостя / номеру брони (highlight в шахматке).

3. Строка «Без номера»:
   - Брони без assigned roomId отображаются в верхней служебной строке.
   - Drag из этой строки на любой свободный номер — assign.

4. Quick actions toolbar:
   - «Заехать» / «Выехать» / «Отменить» — действия на выбранную бронь.
   - Действия отправляются через API и обновляют шахматку.

Тесты спринта 5.3:
- E2E: переключение режимов работает, фильтры корректно сужают выдачу.
- E2E: переход брони из «Без номера» в свободный номер.
- Performance: 500 номеров × 30 дней рендерится с FPS > 30 при скролле.

ПОСЛЕ ВСЕХ 3 СПРИНТОВ:
- Скриншоты всех состояний.
- Видео-демо drag-and-drop.
- Performance отчёт (Lighthouse + Chrome DevTools Performance).
- Git commits: "feat(rack): phase 5.1 — read-only chart with WS", "feat(rack): phase 5.2 — DnD and mouse creation", "feat(rack): phase 5.3 — modes, filters, unassigned row".
```

---

## 📝 ФАЗА 6: Бронирования (3 спринта)

```
Фаза 6: Полноценный CRUD бронирований, групповые и почасовые, статусы и переходы.

═══════ СПРИНТ 6.1: Базовый CRUD + concurrency ═══════

1. Prisma:
   - Reservation (id, tenantId, number unique по tenant, status enum, source string, channelId, externalId, arrival, departure, isHourly bool, guestId, companyClientId, companyAgentId, totalAmount, paidAmount, version int default 0, notes, tags string[], createdById, createdAt, updatedAt, cancelledAt, cancelReason).
   - RoomStay (id, tenantId, reservationId, roomTypeId, roomId nullable, ratePlanId, arrival, departure, adults, children, childrenAges int[], amount, checkedInAt, checkedOutAt).
   - ReservationHistory (id, tenantId, reservationId, snapshot JSON, action, userId, createdAt).
   - OutboxEvent (id, tenantId, eventType, payload JSON, status, attempts, scheduledFor, createdAt).

2. NestJS ReservationsModule:
   - POST /reservations — создание:
     1. Begin transaction with SERIALIZABLE isolation.
     2. SET LOCAL app.tenant_id.
     3. pg_advisory_xact_lock(hashtext(tenantId || '|' || roomTypeId || '|' || arrival)).
     4. SELECT FOR UPDATE Inventory ON (roomTypeId, date) для каждой ночи.
     5. AvailabilityService.check — если fail → 409.
     6. RestrictionsService.check — если fail → 422.
     7. PricingService.calculate.
     8. Создать Reservation + N RoomStays.
     9. Создать Folio + Charges.
     10. UPDATE Inventory.sold += 1 для каждой ночи каждой RoomStay.
     11. INSERT OutboxEvent('reservation.created', payload).
     12. INSERT AuditLog.
     13. INSERT ReservationHistory snapshot.
     14. COMMIT.
     15. После коммита: emit Socket.IO event tenant:{id}:rack → booking.created.
   - PATCH /reservations/:id — обновление (с version check). Аналогичная транзакция.
   - PATCH /reservations/:id/move — смена номера/дат.
   - DELETE /reservations/:id — отмена с применением политики отмены.
   - GET /reservations — фильтры (status, dateRange, source, channel, guest, company).
   - GET /reservations/:id — детали.

3. Concurrency тесты:
   - 100 параллельных createReservation на последний номер → 1 успешный + 99 с 409.
   - 10 параллельных UPDATE одной брони → 1 успешный + 9 с 409 version conflict.

═══════ СПРИНТ 6.2: UI карточка брони ═══════

Drawer «Бронирование #001234» с табами:
1. **Главное** — даты, категория, тариф, гости (adults/children), номер, итоговая сумма, статус, источник.
2. **Гости** — список GuestStay с возможностью добавить из существующих профилей или создать нового inline.
3. **Тариф и стоимость** — breakdown ночей с возможностью override цены на отдельную ночь (с записью в history).
4. **Услуги** — заглушка (полноценный модуль в Фазе 11).
5. **Платежи и счета** — заглушка (Фаза 8).
6. **Документы** — кнопки «Печать счёта», «Печать договора» (заглушки).
7. **История** — ReservationHistory snapshots с diff-просмотром.

Создание брони (большой диалог-визард):
- Шаг 1: даты + категория + occupancy.
- Шаг 2: тариф (показывает доступные тарифы с ценами).
- Шаг 3: гости (можно поиск по существующим).
- Шаг 4: контакты заказчика + источник + примечания.
- Шаг 5: подтверждение + опциональная предоплата.

═══════ СПРИНТ 6.3: Групповые и почасовые ═══════

1. Групповые брони:
   - Toggle «Group booking» при создании.
   - Можно добавить несколько RoomStay в одну Reservation (разные категории, разные тарифы, общий arrival/departure или individual).
   - Общий Folio для группы + индивидуальные Folio per RoomStay (опционально).
   - На шахматке группа подсвечивается одним цветом-«семьёй».

2. Почасовые брони:
   - isHourly=true → arrival/departure хранятся с TIME компонентом.
   - PricingService учитывает hourly_rate из RatePlan.
   - На шахматке (в hourly mode) — час-граничные ячейки.

3. Бронь на юр.лицо:
   - companyClientId или companyAgentId.
   - При выборе компании — реквизиты для счёта подставляются автоматически.
   - Заказчик и Агент — разные роли (Заказчик платит, Агент получает комиссию).

ПЕРЕД UI:
- python3 .claude/skills/ui-ux-pro-max/scripts/search.py "booking reservation form modal wizard" --design-system --persist -p "KarsHotel" --page "reservation"
- Drawer карточки брони должен помещать максимум информации без перегрузки — используй tabs.

Тесты:
- 50+ E2E сценариев: create → modify → cancel; group create with 5 rooms; hourly create; concurrency.
- Покрытие 80%+ на ReservationsService.

ПОСЛЕ ЗАВЕРШЕНИЯ:
- Скриншоты всех табов карточки.
- Видео-демо: создание группы на 5 номеров.
- Git commits фазы 6.
```

---

## 👤 ФАЗА 7: Гости и компании

```
Фаза 7: Профили гостей, компании, история, объединение дублей.

Задачи:
1. Prisma:
   - Guest (id, tenantId, firstName, lastName, middleName, dob, gender, citizenship, email, phone, addressBirth, address, languagePref, notes, totalNights int default 0, totalSpend Decimal default 0, isVip bool, isBlacklist bool, blacklistReason, createdAt).
   - GuestDocument (id, guestId, type enum PASSPORT_RU|PASSPORT_INTL|ID_CARD|DRIVING_LICENSE|OTHER, series, number, issuedBy, issuedAt, expiresAt, scanUrl).
   - GuestStay (id, guestId, roomStayId, isPrimary bool, checkedInAt, checkedOutAt).
   - LoyaltyCard (id, guestId, number, level enum BRONZE|SILVER|GOLD|PLATINUM, points int, validUntil, isActive).
   - LoyaltyLevel (id, tenantId, code, name, minNights, minSpend, discountPercent).
   - Company (id, tenantId, type enum CLIENT|AGENT|BOTH, name, legalName, inn, kpp, ogrn, address, bankAccount, bik, email, phone, contactPerson, commissionPercent, isActive, createdAt).
   - GuestMergeAudit (id, primaryGuestId, mergedGuestIds string[], mergedById, mergedAt, snapshot JSON).

2. NestJS GuestsModule:
   - CRUD.
   - POST /guests/search — full-text через pg_trgm (имя + телефон + email + документ).
   - POST /guests/:id/merge — объединение: в транзакции переносит все GuestStay, документы, лояльности в primary, помечает merged как deleted, пишет audit.
   - GET /guests/:id/history — все RoomStay с гостем + totals.

3. NestJS CompaniesModule:
   - CRUD клиентов и агентов.
   - GET /companies/:id/reservations — все брони от компании.
   - GET /companies/:id/agent-report — выручка от агента и комиссия за период.

4. NestJS LoyaltyModule:
   - CRUD LoyaltyLevel.
   - Auto-issue LoyaltyCard на N-ю ночь (configurable).
   - Auto-upgrade уровня при достижении порогов (BullMQ ежедневный job).

5. Frontend:
   - /guests — таблица с поиском (debounced 300ms), фильтры (VIP, blacklist).
   - /guests/:id — карточка профиля с табами: Основное, Документы, История проживания, Лояльность.
   - /guests/merge — мастер слияния дублей (выбор primary, preview).
   - /companies — список + создание.
   - /settings/loyalty — настройки уровней.

6. Тесты:
   - Unit: merge гостей с конфликтующими полями.
   - E2E: создать 3 одинаковых гостей → слить → проверить, что totalNights = сумма + история едина.

ПЕРЕД UI:
- python3 .claude/skills/ui-ux-pro-max/scripts/search.py "CRM customer profile contact card" --design-system --persist -p "KarsHotel" --page "guests"

ПОСЛЕ ЗАВЕРШЕНИЯ:
- Git commit: "feat(guests): phase 7 — guest profiles, companies, loyalty, merge".
```

---

## 💵 ФАЗА 8: Финансовый модуль (2 спринта)

```
Фаза 8: Folios, charges, payments, depositы, кассы и смены.

═══════ СПРИНТ 8.1: Folio, Charges, Payments ═══════

1. Prisma:
   - Folio (id, tenantId, reservationId, roomStayId nullable, type enum GROUP|INDIVIDUAL, balance Decimal default 0, status enum OPEN|CLOSED, closedAt, closedById).
   - Charge (id, tenantId, folioId, type enum ROOM|SERVICE|EARLY_CHECKIN|LATE_CHECKOUT|TOURIST_TAX|VAT|ADJUSTMENT|REFUND|EXTRA_BED|OTHER, amount Decimal, vatRate Decimal, vatAmount Decimal, description, date Date, isPosted bool default false, postedAt, createdById, createdAt).
   - Payment (id, tenantId, folioId, method enum CASH|CARD|BANK_TRANSFER|DEPOSIT|CHANNEL_PREPAID|LINK|OTHER, amount Decimal, isRefund bool default false, refundedPaymentId nullable, referenceNumber, description, registerId, shiftId, processedById, processedAt, createdAt).
   - Deposit (id, tenantId, guestId, balance Decimal default 0, currency default RUB).
   - DepositTransaction (id, depositId, type enum CREDIT|DEBIT, amount, source enum REFUND|PREPAYMENT|TOPUP, relatedPaymentId, description, createdAt).

2. NestJS FoliosModule:
   - При создании Reservation автоматически создаются Folio (общий + индивидуальные per RoomStay).
   - GET /folios/:id → balance, charges, payments, breakdown.
   - POST /folios/:id/close — закрытие при checkout.

3. NestJS ChargesModule:
   - POST /charges — ручное добавление начисления.
   - BullMQ recurring job roomNightCharge: ежедневно в 00:30 локального времени постит ROOM charge на in-house брони.
   - Питание: если RoomStay.ratePlan.mealPlan != NONE:
     - BB → начисление в день выезда (1 charge на ночь).
     - HB → 2 charges per night.
     - FB → 3 charges per night.
     - AI → 1 charge per day + drinks-tag.

4. NestJS PaymentsModule:
   - POST /payments — приём платежа.
   - POST /payments/:id/refund — возврат.
   - Метод DEPOSIT — списывает с Deposit + создаёт DepositTransaction(DEBIT).
   - Метод LINK — генерирует уникальный URL /pay/:token, ожидает webhook от провайдера (заглушка с MOCK_PAYMENT_PROVIDER в dev).

═══════ СПРИНТ 8.2: Кассы, смены, ручные операции ═══════

1. Prisma:
   - CashRegister (id, tenantId, name, isActive).
   - Shift (id, tenantId, registerId, cashierId, openedAt, closedAt nullable, openingFloat Decimal, closingFloat Decimal nullable, expectedCash Decimal nullable, actualCash Decimal nullable, discrepancy Decimal nullable, notes).
   - FinancialOperation (id, tenantId, type enum INCOME|EXPENSE, categoryId, amount, currency, description, date, paymentMethod, registerId, shiftId, attachments JSON, createdById, createdAt).
   - FinCategory (id, tenantId, type enum INCOME|EXPENSE, code, name, parentId, isActive).

2. NestJS CashRegistersModule + ShiftsModule:
   - Только зарегистрированные кассы могут принимать платежи методом CASH.
   - Открытие смены: POST /shifts/open {registerId, openingFloat}.
   - Закрытие: POST /shifts/:id/close {actualCash} → рассчитывает discrepancy.
   - Кассир видит только свою смену (RBAC).

3. NestJS FinancialOperationsModule:
   - CRUD ручных приходов/расходов вне броней (аренда, коммуналка, зарплата, прочие доходы).
   - Категории — справочник.

4. Frontend:
   - В карточке брони — таб «Платежи и счета»: список Charges и Payments, кнопки «Принять платёж», «Возврат», «Перенести в депозит».
   - /finance — дашборд: приход/расход за период, динамика ДДС (chart), top categories.
   - /finance/operations — таблица всех FinancialOperation + фильтры + экспорт.
   - /finance/cashregisters — список касс, статус «открыта/закрыта».
   - /finance/shifts — журнал смен с discrepancy.
   - /finance/categories — справочник статей.

5. Тесты:
   - Unit: расчёт breakdown питания.
   - Integration: открыть смену → принять 5 платежей CASH → закрыть → проверить expectedCash.
   - E2E: refund c методом DEPOSIT → проверить Deposit.balance += amount.

ПЕРЕД UI:
- python3 .claude/skills/ui-ux-pro-max/scripts/search.py "finance dashboard cashflow accounting" --design-system --persist -p "KarsHotel" --page "finance"
- Заложи интерфейс IFiscalReceiptPrinter в FinancialOperations модуле (метод printReceipt) — заглушка возвращает успех, реализация позже.

ПОСЛЕ ЗАВЕРШЕНИЯ:
- Скриншоты дашборда.
- Git commits фазы 8.
```

---

## 🛂 ФАЗА 9: Check-in/out, миграционный учёт, night audit

```
Фаза 9: Заезд, выезд, ночной аудит, регистрация в МВД.

Задачи:
1. NestJS CheckinModule:
   - POST /reservations/:id/check-in {roomStayIds, documents per guest, registrationData}.
   - Валидация: arrival = today (или раньше), guests заполнены, документы есть.
   - Обновляет Reservation.status = CHECKED_IN, RoomStay.checkedInAt, GuestStay.checkedInAt, Room.status = OCCUPIED_DIRTY (или INSPECTED если стояло так).
   - Создаёт MigrationRecord для каждого иностранного гостя.
   - Опционально: вызов IElectronicLockService.issueKey (заглушка).

2. NestJS CheckoutModule:
   - POST /reservations/:id/check-out {roomStayIds, finalPaymentMethod?}.
   - Валидация: folio balance = 0 (или вызов force=true с записью в audit).
   - Закрывает folio, помечает Room.status = DIRTY, обновляет Guest.totalNights/totalSpend.

3. Prisma:
   - MigrationRecord (id, tenantId, guestId, roomStayId, registrationNumber, registeredAt, registeredById, status enum DRAFT|SUBMITTED|CONFIRMED|REJECTED, externalId, errorMessage, scanUrls JSON, createdAt).
   - Заглушка интеграции с ЕПГУ — IMigrationProvider интерфейс с реализацией MockMigrationProvider в dev.

4. NightAuditModule:
   - BullMQ repeatable cron '30 0 * * *' в local time каждого tenant'а.
   - Шаги:
     1. Auto checkout no-show: для всех Reservation со status=BOOKED|CONFIRMED где departure ≤ today AND checkedInAt is null → set status=NO_SHOW, apply no-show penalty по PaymentPolicy.
     2. Post pending charges: для всех in-house RoomStay → создать ROOM charge на сегодняшнюю ночь если ещё нет.
     3. Apply tourist tax, VAT.
     4. Расчёт OccupancyStatsDaily: для каждого RoomType посчитать sold/available/revenue → UPSERT в материализованную таблицу.
     5. Generate daily reports: послать email владельцу с occupancy/revenue.
     6. Rollover business date: tenant.businessDate = tomorrow.
     7. Audit log: night-audit-completed.

5. Frontend:
   - В карточке брони — кнопки «Заехать» (открывает модалку с формой документов и анкеты для МВД) и «Выехать» (модалка с финальным счётом).
   - /migration — журнал регистраций с фильтрами (status, gender, дата).
   - /night-audit — журнал автоматических аудитов с возможностью посмотреть детали и переиграть (admin only).

6. Тесты:
   - E2E: бронь → check-in → миграционная карта создалась → check-out → folio закрылся → Guest.totalNights += 1.
   - Unit: night audit на 50 mock-броней с разными статусами.

ПОСЛЕ ЗАВЕРШЕНИЯ:
- Git commits фазы 9.
```

---

## 🧹 ФАЗА 10: Housekeeping

```
Фаза 10: Управление уборкой и статусами номеров.

Задачи:
1. Prisma:
   - HousekeepingTask (id, tenantId, roomId, type enum CHECKOUT_CLEAN|STAYOVER_CLEAN|DEEP_CLEAN|INSPECTION|MAINTENANCE|TURNDOWN, status enum PENDING|IN_PROGRESS|COMPLETED|VERIFIED|SKIPPED, priority int, assignedToId nullable, scheduledFor Date, startedAt, completedAt, verifiedAt, verifiedById, notes, photos JSON).
   - HousekeepingShift (id, tenantId, userId, openedAt, closedAt, taskIds string[]).
   - HousekeepingChecklist (id, tenantId, type, name, items JSON-массив пунктов).

2. NestJS HousekeepingModule:
   - Авто-генерация задач:
     - При checkout → CHECKOUT_CLEAN на сегодня.
     - Для in-house брони — STAYOVER_CLEAN каждый день (configurable).
     - По расписанию — DEEP_CLEAN раз в N дней.
   - POST /housekeeping/tasks/:id/assign {userId}.
   - POST /housekeeping/tasks/:id/start.
   - POST /housekeeping/tasks/:id/complete {checklistResults, photos}.
   - POST /housekeeping/tasks/:id/verify (supervisor).
   - WS emit room.status.changed → шахматка обновляется.

3. Frontend:
   - /housekeeping — план уборки на сегодня (категории грязное/чистое/осмотрено/OOO), drag-and-drop назначения исполнителю.
   - /hk/my-tasks (PWA, mobile-first) — для горничных: список задач, чек-лист, кнопка «Начать» / «Завершить», фото-отчёт через camera input.
   - В шахматке — индикатор статуса номера слева от номера (цветная точка).

4. Тесты:
   - E2E: чекаут брони → задача CHECKOUT_CLEAN автогенерация → assign → mobile вид → complete → шахматка обновилась.

ПЕРЕД UI:
- python3 .claude/skills/ui-ux-pro-max/scripts/search.py "housekeeping mobile task list checklist" --design-system --persist -p "KarsHotel" --page "housekeeping"
- Mobile-first для /hk/my-tasks — тестируй на 375px.

ПОСЛЕ ЗАВЕРШЕНИЯ:
- Видео работы мобильного экрана для горничных.
- Git commits фазы 10.
```

---

## 🍳 ФАЗА 11: Доп. услуги

```
Фаза 11: Питание (BB/HB/FB/AI), трансфер, спа, парковка, прочее.

Задачи:
1. Prisma:
   - Service (id, tenantId, code, name, category enum MEAL|TRANSFER|SPA|PARKING|LAUNDRY|MINIBAR|OTHER, unitPrice Decimal, vatRate, isInclusive bool, billingMode enum PER_PERSON|PER_ROOM|PER_NIGHT|FLAT|HOURLY, sortOrder, isActive).
   - ReservationService (id, tenantId, reservationId, roomStayId nullable, serviceId, quantity, unitPrice, totalAmount, date, notes, createdById, createdAt).

2. NestJS ServicesModule:
   - CRUD справочника услуг.
   - POST /reservations/:id/services — добавить услугу к брони → создаёт ReservationService + Charge типа SERVICE.
   - Авто-добавление при бронировании: если RatePlan.mealPlan != NONE → автоматическая Service «Завтрак» / «Обед» / «Ужин» добавляется per night с правилами разбиения (см. Фаза 8).

3. Frontend:
   - /settings/services — справочник.
   - В карточке брони — таб «Услуги»: список с возможностью добавить inline.
   - В Booking Engine виджете (Фаза 13) — шаг «Услуги» с галочками.

4. Тесты:
   - E2E: добавил Service «Трансфер из аэропорта» → создался Charge → folio.balance увеличился.

ПОСЛЕ ЗАВЕРШЕНИЯ:
- Git commit: "feat(services): phase 11 — services, meals, extras".
```

---

## 📊 ФАЗА 12: Отчёты и аналитика (2 спринта)

```
Фаза 12: 25+ отчётов, аналог TL: WebPMS.

═══════ СПРИНТ 12.1: Real-time отчёты ═══════

1. Архитектура отчётов:
   - Base class Report с методами execute(filters): ReportResult и render(format: 'json'|'xlsx'|'pdf').
   - Endpoint GET /reports/:code?from=&to=&filters[]=... возвращает JSON; ?format=xlsx → стрим экселя через exceljs; ?format=pdf → puppeteer SSR.
   - Реестр отчётов: ReportsRegistry в коде, доступ по коду.

2. Real-time отчёты:
   - arrivals (Заезды на дату) — Reservation arrival = X, status BOOKED/CONFIRMED.
   - departures (Выезды).
   - in-house (Занятые номера).
   - guests-list (Список гостей с фильтрами).
   - payments (Платежи за период).
   - deposits (Депозит).
   - services-summary, services-detailed (Допуслуги).
   - meals-report (Отчёт по питанию).
   - activity-log (Журнал активности пользователей).
   - payment-methods (Способы оплаты).
   - housekeeping (Обслуживание номеров).
   - form-1-ksr (1-КСР — статистическая форма для Росстата).

═══════ СПРИНТ 12.2: Статистические отчёты ═══════

1. Материализованные данные:
   - PG Materialized View mv_occupancy_daily(tenant_id, date, room_type_id, rooms_total, rooms_sold, rooms_blocked, room_revenue, guests_count, adr, occupancy_pct).
   - REFRESH MATERIALIZED VIEW CONCURRENTLY mv_occupancy_daily — в night audit.

2. Статистические отчёты:
   - revenue-occupancy (Доходность и загрузка) → Occupancy, ADR, RevPAR, RevPAC, ALOS по дням, неделям, месяцам.
   - financial-daily-comparison (Финансовый посуточный сравнительный) — текущий месяц vs предыдущий vs YoY.
   - forecast (История и прогноз) — простой прогноз: avg occupancy LY + booking pace this year.
   - cancellations (Отчёт по отменам).
   - cancellation-window (Окно аннуляций) — среднее число дней между отменой и заездом.
   - demand-calendar (Календарь спроса) — heatmap по дням года.
   - demand-intensity (Оценка интенсивности спроса).
   - managers-performance (Эффективность менеджеров) — кто сколько броней создал и на какую сумму.
   - reservation-balances (Балансы бронирований).
   - rate-plans-profitability (Доходность по тарифам).
   - tags-report (Теги).

3. Frontend:
   - /reports — каталог: карточки отчётов по группам (Real-time, Финансы, Маркетинг, Эксплуатация).
   - /reports/:code — страница отчёта: фильтры наверху, таблица/график, кнопки Export XLSX/PDF.
   - Графики через recharts.
   - Поддержка сохранённых пресетов фильтров.

4. Тесты:
   - Unit для каждой формулы (Occupancy, ADR, RevPAR на эталонных входах из учебников).
   - Snapshot tests на XLSX рендеринг (структура листа).

ПЕРЕД UI:
- python3 .claude/skills/ui-ux-pro-max/scripts/search.py "analytics dashboard charts KPI" --design-system --persist -p "KarsHotel" --page "reports"

ПОСЛЕ ЗАВЕРШЕНИЯ:
- Покажи 5 самых важных отчётов (revenue-occupancy, arrivals, payments, demand-calendar, managers-performance) на демо-данных.
- Git commits фазы 12.
```

---

## 🌐 ФАЗА 13: Booking Engine (виджет для сайта отеля)

```
Фаза 13: Публичный модуль бронирования для встраивания на сайт отеля.

Задачи:
1. apps/booking — отдельный Next.js (server-rendered для SEO).
   - Маршруты:
     - /widget/:tenantSlug — полноценная страница бронирования.
     - /embed/:tenantSlug — iframe-version (минимальный layout).
   - JS-loader для встраивания: <script src="https://booking.karshotel.com/embed.js" data-tenant="slug"></script> → инжектит iframe или div.

2. Публичные endpoints в apps/api (без auth, но с rate-limit и captcha):
   - POST /public/search {tenantSlug, arrival, departure, adults, children, promoCode?} → доступные категории+тарифы.
   - POST /public/quote {tenantSlug, ratePlanId, roomTypeId, arrival, departure, adults, children, services[], promoCode?} → точная цена.
   - POST /public/bookings — создание брони (с captcha-token).
   - POST /public/payment-intents — генерация ссылки оплаты (через Mock provider).
   - GET /public/properties/:slug — публичная инфа об отеле (название, фото, описание, координаты).

3. UI шаги виджета:
   - Шаг 1: даты + гости + промокод.
   - Шаг 2: результаты — карточки категорий с фото, описанием, ценой от, доступными тарифами.
   - Шаг 3: выбор тарифа → услуги.
   - Шаг 4: контакты заказчика + специальные пожелания.
   - Шаг 5: подтверждение + способ оплаты.
   - Шаг 6: «Бронь #001234 создана» + email.

4. Мотиваторы:
   - «Осталось всего 2 номера этой категории».
   - «Цена выгоднее, чем на Ostrovok».
   - Социальные доказательства («23 человека смотрят этот отель сейчас» — если опционально включено).
   - Indicator скидки лояльности.

5. SEO:
   - Server-side рендер мета-тегов (название отеля, описание, OG-image).
   - schema.org/Hotel JSON-LD.
   - sitemap.xml.

6. Тесты:
   - E2E (Playwright): пройти весь флоу от поиска до подтверждения.
   - Lighthouse score ≥ 90 на Mobile.

ПЕРЕД UI:
- python3 .claude/skills/ui-ux-pro-max/scripts/search.py "hotel booking widget mobile" --design-system --persist -p "KarsHotel" --page "booking-engine"
- Это публичный лицо продукта — должно быть premium и trust-inducing.
- Mobile-first.

ПОСЛЕ ЗАВЕРШЕНИЯ:
- Скриншоты desktop + mobile.
- Demo iframe-embed на статичную HTML-страницу.
- Git commits фазы 13.
```

---

## 🔌 ФАЗА 14: Channel Manager (3 спринта)

```
Фаза 14: Менеджер каналов. САМАЯ СЛОЖНАЯ ФАЗА, не торопись.

═══════ СПРИНТ 14.1: Архитектура коннекторов ═══════

1. Prisma:
   - Channel (id, tenantId, code, name, type enum OTA_XML|BOOKING_BXML|EXPEDIA_EQC|AIRBNB_API|OSTROVOK_API|YANDEX_PUTESHESTVIYA|SUTOCHNO|CUSTOM_REST, hotelId string, credentials JSON encrypted, settings JSON, isActive, lastSyncAt).
   - ChannelMapping (id, channelId, kind enum ROOM_TYPE|RATE_PLAN, internalId, externalId, externalCode).
   - ChannelSyncJob (id, tenantId, channelId, eventType, payload JSON, status enum PENDING|IN_PROGRESS|SUCCESS|FAILED|DEAD_LETTER, attempts int, lastError, nextRetryAt, completedAt, createdAt).
   - ChannelReservation (id, tenantId, channelId, externalId unique per channel, reservationId nullable, rawPayload JSON, ackedAt, createdAt).

2. packages/channels:
   - interface IChannelConnector {
       pushAvailability(items: AvailabilityItem[]): Promise<AckResult>;
       pushRates(items: RateItem[]): Promise<AckResult>;
       pushRestrictions(items: RestrictionItem[]): Promise<AckResult>;
       pushContent(payload: ContentPayload): Promise<AckResult>;
       pullReservations(since: Date): Promise<ChannelReservationDTO[]>;
       ackReservation(externalId: string): Promise<void>;
     }
   - Базовый OtaXmlConnector (OTA 2003B) — универсальный fallback.
   - BookingBxmlConnector — Booking.com B.XML спецификация.
   - OstrovokRestConnector — заглушка, реальные creds приходят при сертификации.

3. ChannelManagerService:
   - registerChannel(tenantId, config) — создаёт Channel + ChannelMapping + проверяет creds через testConnection.
   - syncAvailability/Rates/Restrictions(channelId, range) — публикует OutboxEvent.

═══════ СПРИНТ 14.2: Outbox + надёжность ═══════

1. Outbox pattern:
   - При коммите бизнес-транзакции (Reservation create, Rate update, Restriction update, Inventory change) — INSERT OutboxEvent в той же транзакции.
   - apps/worker запускает OutboxPublisherWorker:
     - SELECT FOR UPDATE SKIP LOCKED от OutboxEvent WHERE status=PENDING LIMIT 100.
     - Группирует события за 10-секундное окно по (tenantId, channelId, kind).
     - Создаёт ChannelSyncJob.
     - Помещает в BullMQ queue 'channel-sync'.

2. ChannelSyncWorker:
   - Pulls job → определяет channel.type → инстанцирует connector → calls pushXxx.
   - Idempotency key: hash(channelId, kind, items.map(i => `${i.roomType}|${i.date}|${i.value}`).join(',')).
   - Если коннектор вернул success → job.status = SUCCESS.
   - Если timeout / 5xx → exponential backoff: 1s → 5s → 30s → 5min → 30min → DLQ после 10 attempts.
   - При DLQ → создаёт Sentry alert + помечает Channel.health = DEGRADED + UI-индикатор красный.

3. Reservation Pull:
   - Cron job ReservationsPullWorker каждые 30 секунд per active Booking.com channel.
   - GET /reservationsSummary?since=Channel.lastSyncAt → для каждой новой записи: создать Reservation в транзакции (с lock на Inventory) → ack.
   - Для push-каналов: POST webhook endpoint /webhooks/channels/:channelId с HMAC-signature verification.

4. Safety buffer:
   - В Channel.settings: { safetyBuffer: 1 } — при отправке availability отнимаем N от реального free count.

═══════ СПРИНТ 14.3: UI + первые интеграции ═══════

1. Frontend:
   - /channels — список каналов с health-индикаторами (зелёный/жёлтый/красный) и last-sync-at.
   - /channels/:id/setup — мастер: креды → testConnection → выбор маппингов категорий → выбор маппингов тарифов → активация.
   - /channels/:id/mappings — таблица маппингов с возможностью переназначить.
   - /channels/:id/queue — мониторинг очереди: pending / in_progress / success rate / DLQ. Кнопка «Перепроиграть DLQ event».
   - /channels/:id/logs — лог входящих и исходящих payload (для debug).

2. Первые интеграции:
   - **OTA XML 2003B coverage**: HotelAvailNotifRQ, HotelRateAmountNotifRQ, HotelRatePlanNotifRQ, HotelResNotifRQ, HotelResModifyNotifRQ. Контрактные тесты против фикстурных XML.
   - **Booking.com B.XML coverage** (опционально, требует certification): roomRateAvailability, reservationsSummary, ack endpoint. Sandbox тесты против supply-xml.booking.com/test/.
   - **OstrovokConnector** — заглушка с TODO.
   - Универсальный CustomRestConnector — для отелей, которым нужны кастомные интеграции (webhook IN, REST OUT).

3. Тесты:
   - Контрактные: фикстуры XML под каждый тип сообщения, snapshot tests.
   - Concurrency: 1000 событий в outbox → все доставлены, ни одно не потеряно, idempotency защищает от дубликатов.
   - Chaos: симуляция timeout, 500-ответа, 429-ответа — backoff срабатывает, DLQ после 10 неудач.

ПЕРЕД UI:
- python3 .claude/skills/ui-ux-pro-max/scripts/search.py "channel manager OTA integration monitoring" --design-system --persist -p "KarsHotel" --page "channels"
- Это monitoring UI — должен быть data-dense, но читаемый.

ПОСЛЕ ЗАВЕРШЕНИЯ:
- Покажи живой ARI-цикл: изменили Rate в UI → через 10 сек видно в OTA-stub-сервере.
- Git commits фазы 14.
```

---

## 📬 ФАЗА 15: Уведомления

```
Фаза 15: Email + SMS + Push уведомления.

Задачи:
1. Prisma:
   - NotificationTemplate (id, tenantId, code unique, channel enum EMAIL|SMS|PUSH, subject, body, variables string[], isActive).
   - NotificationLog (id, tenantId, templateCode, channel, recipient, subject, body, status enum PENDING|SENT|FAILED|BOUNCED, providerId, providerResponse JSON, sentAt, error).
   - NotificationSettings (per tenant) — какие события отправлять, кому, через какой канал.

2. NestJS NotificationsModule:
   - Базовый класс NotificationProvider с интерфейсом send.
   - EmailProvider (UniSender / SendGrid / SMTP — заглушка через nodemailer в mailhog).
   - SmsProvider (SMS.ru / UniSender SMS — заглушка).
   - PushProvider (web push / FCM — заглушка).
   - BullMQ queue 'notifications' для асинхронной отправки.

3. События триггеры:
   - reservation.created → email гостю (подтверждение брони) + email отелю.
   - reservation.modified → email гостю.
   - reservation.cancelled → email гостю.
   - arrival.tomorrow → ремайндер за 24ч.
   - payment.received → чек на email.
   - night-audit.completed → daily-сводка владельцу.

4. Шаблоны через Handlebars:
   - {{guest.firstName}}, {{reservation.number}}, {{property.name}}, {{breakdown}}.
   - Templates seed-ятся при создании tenant'а.

5. Frontend:
   - /settings/notifications — управление настройками и шаблонами.
   - Просмотр журнала отправок /notifications/log.
   - Тестовая отправка из UI.

ПОСЛЕ ЗАВЕРШЕНИЯ:
- Git commit: "feat(notifications): phase 15 — email/sms/push system".
```

---

## 🔓 ФАЗА 16: Публичное API и импорт/экспорт

```
Фаза 16: Публичное API в духе TL: Partner API, импорт/экспорт данных.

Задачи:
1. NestJS PublicApiModule:
   - Отдельный realm: префикс /api/public/v1/.
   - OAuth2 client_credentials → JWT (TTL 15 мин). Endpoint POST /api/public/auth/token.
   - Rate-limit: 3/сек, 15/мин, 300/час, заголовки x-ratelimit-remaining-second/-minute/-hour и retry-after при 429.
   - Endpoints (минимум):
     - GET /properties/:propertyId/reservations с фильтрами.
     - GET /properties/:propertyId/reservations/:id.
     - POST /properties/:propertyId/reservations.
     - PATCH /properties/:propertyId/reservations/:id.
     - DELETE /properties/:propertyId/reservations/:id.
     - POST /properties/:propertyId/reservations/:id/check-in.
     - POST /properties/:propertyId/reservations/:id/check-out.
     - POST /properties/:propertyId/reservations/:id/assign-rooms.
     - POST /properties/:propertyId/reservations/:id/process-payment.
     - POST /properties/:propertyId/reservations/:id/process-refund.
     - GET /properties/:propertyId/guests/:id.
     - PUT /properties/:propertyId/guests/:id/personal-document.
     - GET /properties/:propertyId/rooms.
     - GET /properties/:propertyId/availability.
     - GET /properties/:propertyId/quote.
   - OpenAPI v3 авто-генерация в /api/public/docs.

2. WebhookSubscriptions:
   - Prisma WebhookSubscription (id, tenantId, url, events string[], secret, isActive).
   - При событии в системе → publishWebhook → BullMQ queue 'webhooks'.
   - WebhookSender: POST на url с заголовком X-KarsHotel-Signature: hmac-sha256(secret, body).
   - Retry: 1m, 5m, 30m, 2h, 12h → DLQ.
   - UI: /settings/webhooks — CRUD + test delivery.

3. Импорт/экспорт:
   - Import wizard в /settings/import:
     - Step 1: выбрать тип (Reservations / Guests / Rates / Rooms).
     - Step 2: загрузить CSV/XLSX.
     - Step 3: маппинг колонок.
     - Step 4: dry-run preview + ошибки.
     - Step 5: apply.
   - Export по любому ресурсу — XLSX/CSV/JSON.

ПОСЛЕ ЗАВЕРШЕНИЯ:
- Покажи OpenAPI docs.
- Demo: импорт 50 исторических броней из CSV.
- Git commits фазы 16.
```

---

## ✅ ФАЗА 17: Тестирование, оптимизация, документация

```
Фаза 17: Финальная фаза — приведение продукта к production-ready.

Задачи:
1. Тестовое покрытие:
   - Unit: 80%+ на критичных модулях (Pricing, Availability, Reservation, Folio, ChannelSync, NightAudit).
   - Integration: 60%+.
   - E2E (Playwright): 50+ сценариев покрывающих user flows.
   - Coverage report через c8 / vitest --coverage.

2. Производительность:
   - k6 load tests:
     - 500 RPS на /rack — p95 < 800ms.
     - 100 RPS на createReservation — p95 < 1500ms, zero conflicts under load.
     - 1000 concurrent WebSocket clients.
   - DB tuning: EXPLAIN ANALYZE на top-50 queries, добавь индексы и партиционирование (Inventory/Rate по году).
   - Frontend: Lighthouse audit для каждой страницы → score ≥ 85.

3. Безопасность:
   - OWASP ZAP scan.
   - npm audit / pnpm audit → 0 high vulnerabilities.
   - Pen-test чеклист:
     - Cross-tenant isolation (RLS): попытка прямого доступа через ID другого tenant'а → 404 (НЕ 403, чтобы не утечь existence).
     - IDOR на все ресурсы.
     - SQLi через Prisma raw (запрещено в codebase).
     - XSS на всех input полях.
     - CSRF на mutation endpoints.
     - Rate-limit обходы.
     - JWT secrets ротация документирована.
     - Secrets не в коде (gitleaks check в CI).

4. Документация в Docusaurus:
   - /docs/getting-started — quickstart.
   - /docs/concepts — Reservation lifecycle, Folio, RatePlan, Restrictions, Channel Manager.
   - /docs/api — авто-генерация из OpenAPI.
   - /docs/integrations — Booking.com, Ostrovok, ...
   - /docs/admin-guide — для админов отеля.
   - /docs/user-guide — для front desk, housekeeping, accountant.
   - /docs/dev-guide — для разработчиков.

5. Production deploy:
   - Kubernetes manifests или docker-compose.prod.yml.
   - Sentry для error tracking.
   - Prometheus + Grafana дашборды:
     - HTTP latency p50/p95/p99.
     - DB connection pool utilization.
     - Redis hit rate.
     - BullMQ queue depth по каждой очереди.
     - WebSocket connected clients.
     - Channel Manager: success rate, DLQ size.
   - Alerts в Telegram через alertmanager.
   - Бэкапы: pgBackRest daily + WAL archiving в S3.

6. Onboarding flow:
   - При первой регистрации tenant'а — пошаговый wizard: «Добавьте категории → Добавьте номера → Установите цены → Готово, можно бронировать».

ПОСЛЕ ЗАВЕРШЕНИЯ:
- Покажи дашборд Grafana.
- Полный coverage report.
- Покажи Docusaurus build.
- Git commit: "chore: phase 17 — production hardening, docs, perf optimization".
- Создай v1.0.0 git tag.
```

---

## 🎁 БОНУС: Скрипт быстрого старта (запусти после бутстрапа)

```bash
# Положи это в Makefile или scripts/quick-start.sh

#!/bin/bash
set -e

echo "🏨 KarsHotel PMS — Quick Start"

# 1. Установка зависимостей
pnpm install

# 2. Запуск инфраструктуры
docker compose -f docker-compose.dev.yml up -d
sleep 5

# 3. Генерация design system через ui-ux-pro-max
mkdir -p design-system/pages
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "hotel PMS dashboard" --design-system --persist -p "KarsHotel"
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "hotel rack chart calendar drag drop" --design-system --persist -p "KarsHotel" --page "rack-chart"
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "hotel booking widget mobile" --design-system --persist -p "KarsHotel" --page "booking-engine"
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "finance dashboard cashflow accounting" --design-system --persist -p "KarsHotel" --page "finance"
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "analytics dashboard charts KPI" --design-system --persist -p "KarsHotel" --page "reports"
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "channel manager OTA integration monitoring" --design-system --persist -p "KarsHotel" --page "channels"
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "housekeeping mobile task list checklist" --design-system --persist -p "KarsHotel" --page "housekeeping"
python3 .claude/skills/ui-ux-pro-max/scripts/search.py "CRM customer profile contact card" --design-system --persist -p "KarsHotel" --page "guests"

# 4. Миграции БД
pnpm --filter @karshotel/db prisma migrate dev

# 5. Seed демо-данных
pnpm --filter @karshotel/db prisma db seed

# 6. Запуск всех приложений
pnpm dev

echo "✅ Готово!"
echo "→ Admin: http://localhost:3000"
echo "→ API: http://localhost:3001"
echo "→ Booking widget: http://localhost:3002"
echo "→ API docs: http://localhost:3001/api/docs"
```

---

## 📋 Контрольный список перед началом работы

- [ ] Создана пустая папка для проекта.
- [ ] Открыта в Claude Code.
- [ ] `ui-ux-pro-max-skill` установлен и проверен: `ls .claude/skills/ui-ux-pro-max/`.
- [ ] Python 3 установлен (для design system generator): `python3 --version`.
- [ ] Docker Desktop / Docker Engine запущен.
- [ ] pnpm установлен глобально: `npm i -g pnpm`.
- [ ] Git настроен (user.name, user.email).
- [ ] Запущен **БУТСТРАП-ПРОМПТ**.
- [ ] После завершения бутстрапа — запущена **ФАЗА 0**.
- [ ] Дальше по порядку: 1 → 2 → 3 → … → 17.

---

## 💡 Полезные команды Claude Code во время работы

| Цель | Команда |
|---|---|
| Перечитать дизайн-систему перед UI-задачей | `Прочитай design-system/MASTER.md и design-system/pages/[page].md` |
| Перегенерировать design system | `python3 .claude/skills/ui-ux-pro-max/scripts/search.py "..." --design-system --persist -p "KarsHotel" --page "..."` |
| Проверить cross-tenant изоляцию | `Запусти pnpm test:e2e -- cross-tenant` |
| Создать миграцию Prisma | `pnpm --filter @karshotel/db prisma migrate dev --name <description>` |
| Сгенерировать новый NestJS модуль | `cd apps/api && pnpm nest g resource <name> --no-spec --flat` |
| Откатить последнюю миграцию | `pnpm --filter @karshotel/db prisma migrate resolve --rolled-back <name>` |

---

## ⚠️ Важные напоминания

1. **Тесты пишем до кода для критичных модулей:** Pricing, Availability, Reservation, NightAudit, ChannelSync.
2. **Каждая UI-задача начинается с чтения design-system/** — никогда не придумывай свои цвета и шрифты.
3. **Никогда не используй emoji как иконки** — только lucide-react. Из дизайн-системы это первый пункт pre-delivery checklist.
4. **После каждой фазы — git commit + git tag** (например `git tag phase-5`).
5. **Каждые 2 фазы — обновляй /docs/CHANGELOG.md и /docs/ARCHITECTURE.md.**
6. **При любой работе с tenant-данными — проверяй, что RLS активен и tenantId автоматически инжектится.**
7. **Channel Manager — самая опасная часть.** Не торопись, тесть outbox и idempotency на каждом этапе.

---

Удачи, Алим! 🚀
