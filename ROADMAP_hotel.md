# Дорожная карта: Гостиница (PMS)

Пошаговый план реализации сервиса. Задачи идут в правильной последовательности — от фундамента к итогам. У каждой есть описание, подзадачи и критерий приёмки. Этот файл — для работы по чек-листам; статусы тех же задач живут в приложении-задачнике (`npm run start:all` в этом репо).

**Всего: 52 задачи — ✅ 35 готово · 🟡 9 в работе · ⬜ 8 в бэклоге.**

> Статусы сверены с фактическим кодом (`backend/src`, `frontend/src`, `prisma/schema.prisma`) на 2026-05-26.

---

## Доступ и роли (фундамент)
_Задачи 1–5_

### 1. Вход сотрудника отеля — ✅ Готово
*База.* Единая учётка email + пароль; пользователь привязан к одному отелю, JWT access + refresh.

**Подзадачи:**
- [x] Эндпоинты `/auth/register-tenant`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/me`
- [x] Проверка `tenant.isActive` и `user.isActive` при логине
- [x] Refresh-токен в БД с хешированием и ротацией
- [x] JWT несёт `userId`, `tid` (tenantId), `role`, `permissions[]`

---

### 2. Настройка доступов — ✅ Готово
*База.* Главный администратор отеля управляет правами своей команды.

**Подзадачи:**
- [x] Реестр разрешений PMS (`SYSTEM_PERMISSIONS`) — 25 кодов в `auth.constants.ts`
- [x] **API управления командой** — `GET /tenant/users`, `POST /tenant/users` (инвайт), `PATCH /tenant/users/:id`, `DELETE /tenant/users/:id`
- [x] **Экран «Команда»** — таблица сотрудников, кнопка «Пригласить», смена роли, деактивация

---

### 3. Собрать роль — 🟡 В работе
*База.* Роль — именованный набор разрешений; OWNER, MANAGER, FRONT_DESK, HOUSEKEEPING, ACCOUNTANT, CHANNEL_MANAGER, READ_ONLY.

**Подзадачи:**
- [x] Модели `Role` / `Permission` / `RolePermission` в Prisma-схеме
- [x] Пресеты ролей: `DEFAULT_ROLE_PERMISSIONS` сидится при регистрации отеля
- [ ] **Конструктор роли** — экран «Роли»: создание не-системной роли, проставление чекбоксов permissions, переименование, удаление

---

### 4. Выдать доступ человеку — 🟡 В работе
*База.* Пользователь привязывается к отелю с конкретной ролью.

**Подзадачи:**
- [x] Скоуп по отелю — `User.tenantId` присутствует, JWT несёт `tid`
- [x] Смена роли через `PATCH /tenant/users/:id` + UI в экране «Команда»
- [ ] **Модель Grant / назначение** — для сетей отелей и временных назначений нужен явный grant с возможным сроком действия (`validFrom`, `validTo`)
- [ ] **История назначений** — кнопка «История» в карточке сотрудника

---

### 5. Проверка прав на каждом шаге — ✅ Готово
*База.* `can(user, permission)` перед каждой операцией.

**Подзадачи:**
- [x] **`PermissionsGuard`** — глобальный APP_GUARD в `backend/src/common/guards/`
- [x] **Декоратор `@RequirePermissions(...)`** — на всех контроллерах
- [x] Все эндпоинты защищены нужными правами
- [x] Ошибка при отказе — 403 с кодом `PERMISSION_DENIED`

---

## Роли сотрудников отеля
_Задачи 6–9_

### 6. Администратор отеля — ✅ Готово
**Подзадачи:**
- [x] Пресет OWNER = весь `SYSTEM_PERMISSIONS` (25 прав)
- [x] Пресет MANAGER = всё, кроме `user.delete`

---

### 7. Портье / ресепшн — ✅ Готово
**Подзадачи:**
- [x] Пресет роли FRONT_DESK
- [x] Права: `reservation.{read,create,update,checkin,checkout}`, `guest.{read,update}`, `folio.{read,update}`, `payment.create`, `cashregister.open`, `hk.task.read`

---

### 8. Горничная / хаускипинг — ✅ Готово
**Подзадачи:**
- [x] Пресет роли HOUSEKEEPING
- [x] Права: `room.read`, `hk.task.{read,update}`

---

### 9. Бухгалтер — ✅ Готово
**Подзадачи:**
- [x] Пресет роли ACCOUNTANT
- [x] Права: `folio.read`, `payment.{create,refund}`, `cashregister.open`, `report.view.{operations,finance}`, `report.export`

---

## Настройка отеля
_Задачи 10–18_

### 10. Профиль отеля — 🟡 В работе
**Подзадачи:**
- [x] Модель отеля (`Tenant`) с текстовыми полями адреса и контактов
- [x] Экран профиля (Settings → «Основная информация»)
- [ ] **Геопривязка** — `Tenant.latitude` / `Tenant.longitude`, мини-карта в Settings

---

### 11. Категории номеров — ✅ Готово
**Подзадачи:**
- [x] Модель `RoomType` (baseOccupancy, maxOccupancy, extraBeds, basePrice, photos JSON)
- [x] CRUD `/room-types`
- [x] Экран «Категории» (`RoomTypeFormModal.jsx`)

---

### 12. Номера (фонд) — ✅ Готово
**Подзадачи:**
- [x] Модель `Room` (number, floor, capacity, status, isActive, roomTypeId)
- [x] CRUD `/rooms` + `PATCH /rooms/:id/status`
- [x] Экран «Номера»

---

### 13. Параметры номера — ✅ Готово
**Подзадачи:**
- [x] Поля `floor`, `bedType`, `view`, `notes` на модели `Room`
- [x] Фильтрация в списке номеров

---

### 14. Тарифы и цены — 🟡 В работе
**Подзадачи:**
- [x] Модель `RatePlan` с наследованием через `parentRatePlanId`
- [x] Модель `Rate` (дата × категория × план × occupancy)
- [x] `PricingService` — расчёт итоговой цены с учётом модификаторов
- [x] Редактор цен по категориям (`RateCalendar` + `FillRatesModal`)
- [ ] **Корпоративный тариф** — `CorporateContract { airline, ratePlanId, validFrom, validTo, discountPercent }`

---

### 15. Питание — 🟡 В работе
**Подзадачи:**
- [x] Флаг «включено» через `RatePlan.mealPlan` (BB/HB/FB/AI)
- [ ] **Модель питания** — `MealService { tenantId, code, name, type, timeFrom, timeTo, price, isActive }`
- [ ] **Экран настройки** — Settings → «Питание»

---

### 16. Доп. услуги — ⬜ В бэклоге
**Подзадачи:**
- [ ] Модель `AncillaryService { tenantId, code, name, unit, price, isActive }`
- [ ] CRUD + экран Settings → «Доп. услуги»
- [ ] Привязка к броне как позиция в фолио (`BookingAncillary`)

---

### 17. Правила заезда/выезда — ✅ Готово
**Подзадачи:**
- [x] Поля `checkInTime`, `checkOutTime`, `cancellationHours` на модели `Tenant`
- [x] Экран Settings → «Политики заезда»
- [x] Расчётный час используется в `AvailabilityService`

---

### 18. Квоты — ⬜ В бэклоге
**Подзадачи:**
- [ ] Модель `Quota { tenantId, roomTypeId, date, channel?, totalRooms }`
- [ ] Учёт в `AvailabilityService.check()`
- [ ] UI-календарь квот

---

## Доступность
_Задачи 19–20_

### 19. Календарь номеров — ✅ Готово
**Подзадачи:**
- [x] Модель `Inventory` (дата × roomType)
- [x] Заполнение `bookedRooms` из активных броней
- [x] Отметка ремонта через `Room.status = OUT_OF_ORDER`
- [x] Lazy-creation: fallback на физический счёт

---

### 20. Расчёт доступности — ✅ Готово
**Подзадачи:**
- [x] `AvailabilityService.check(roomTypeId, checkIn, checkOut)` и `checkAll()`
- [x] Учёт `Restriction` (rate-plan-specific + catch-all)
- [x] Redis-кэш с TTL 60 с

---

## Источники броней и API
_Задачи 21–29_

### 21. Диспетчер Карс — ⬜ В бэклоге
**Подзадачи:**
- [ ] Эндпоинты приёма — `GET /external/availability`, `POST /external/verify`, `POST /external/book`, `POST /external/cancel`
- [ ] Авторизация — модель `ApiKey { tenantId, name, hash, scopes, isActive }`
- [ ] Rate-limit, IP-allowlist
- [ ] Аудит входящих запросов

---

### 22. Каналы (TravelLine) — ⬜ В бэклоге
**Подзадачи:**
- [ ] Worker `channels/travelline.sync`
- [ ] Маппинг внешних room_type_external_id ↔ внутренний roomTypeId
- [ ] Push stop-sell
- [ ] Reconciliation

---

### 23. Отдать доступность (API) — 🟡 В работе
**Подзадачи:**
- [x] Эндпоинт проверки доступности (`/availability/check`)
- [x] Ответ по категориям
- [ ] **Версионирование** — `/api/v1/availability`, OpenAPI
- [ ] **API-ключ аутентификация** — отдельный guard по `ApiKey`

---

### 24. Принять намерение (verify) — ⬜ В бэклоге
**Подзадачи:**
- [ ] Модель `Hold { id, tenantId, roomTypeId, checkIn, checkOut, quantity, token, expiresAt, status }`
- [ ] Эндпоинт `POST /external/verify`
- [ ] TTL 5–15 минут — фоновый job
- [ ] Учёт в доступности

---

### 25. Подтвердить бронь (book) — 🟡 В работе
**Подзадачи:**
- [x] Внутренний эндпоинт `POST /reservations`
- [ ] `POST /external/book` с токеном
- [ ] Идемпотентность — заголовок `Idempotency-Key`

---

### 26. Отмена / изменение (API) — ✅ Готово
**Подзадачи:**
- [x] `POST /reservations/:id/cancel` — с указанием `reason`, запись в AuditLog
- [x] Кнопка «Отменить» в форме брони
- [ ] **`POST /reservations/:id/amend`** — изменение дат/категории с пересчётом цены *(опциональное расширение)*
- [ ] **Штраф при отмене** — расчёт из `CancellationPolicy` в ответе *(опциональное расширение)*

---

### 27. Бронь вручную — ✅ Готово
**Подзадачи:**
- [x] Форма ручной брони (`BookingForm.jsx`)
- [x] Валидация дат, авто-назначение `placeNumber`, проверка пересечений

---

### 28. Бронь в системе отеля — ✅ Готово
**Подзадачи:**
- [x] Модель `Reservation` (статусы, источник `BookingSource`, optimistic-locking)
- [x] Сбор броней через `TimelineService`
- [x] Статусы: `NEW / CONFIRMED / CHECKED_IN / CHECKED_OUT / CANCELLED / NO_SHOW`

---

### 29. События наружу — 🟡 В работе
**Подзадачи:**
- [x] Внутренний broadcast через Socket.IO (`/timeline` namespace)
- [ ] Модель `WebhookSubscription`
- [ ] Доставка с retry/backoff (Bull), HMAC-SHA256
- [ ] Events: `reservation.created/updated/cancelled`, `inventory.updated`

---

## Шахматка
_Задачи 30–34_

### 30. Шахматка (номера × даты) — ✅ Готово
**Подзадачи:**
- [x] Сетка номера × даты (`Timeline.jsx`)
- [x] Виртуализация строк
- [x] Реалтайм через Socket.IO + Redis cache 30 s

---

### 31. Назначить конкретный номер — ✅ Готово
**Подзадачи:**
- [x] Drag-and-drop брони в номер
- [x] Запись `roomId` + `placeNumber` на бронь
- [x] Обновление `Inventory` и broadcast

---

### 32. Проверка пересечений — ✅ Готово
**Подзадачи:**
- [x] Алгоритм проверки + 409 `BOOKING_CONFLICT`
- [x] Авто-подбор `placeNumber`

---

### 33. Переселить — ✅ Готово
**Подзадачи:**
- [x] `PATCH /reservations/:id` с новым `roomId`
- [x] `POST /reservations/swap` для атомарной перестановки

---

### 34. Ранний заезд / поздний выезд — ⬜ В бэклоге
**Подзадачи:**
- [ ] Поля `Reservation.actualCheckInTime`, `Reservation.actualCheckOutTime`
- [ ] Логика надбавок в `PricingService`
- [ ] Настройка в Settings

---

## Стойка и проживание
_Задачи 35–40_

### 35. Заезды на сегодня — ✅ Готово
**Подзадачи:**
- [x] `GET /reservations/arrivals?date=YYYY-MM-DD`
- [x] Экран «Заезды» — вкладка в Bookings с поиском и кнопкой «Заселить»

---

### 36. Заезд (check-in) — ✅ Готово
**Подзадачи:**
- [x] `POST /reservations/:id/check-in` — валидация статуса, `actualCheckInTime=now()`
- [x] Лог в `AuditLog`

---

### 37. Проживание — ✅ Готово
**Подзадачи:**
- [x] Статус `CHECKED_IN`, отображение на шахматке

---

### 38. Выезды на сегодня — ✅ Готово
**Подзадачи:**
- [x] `GET /reservations/departures?date=YYYY-MM-DD`
- [x] Экран «Выезды» — вкладка в Bookings с финальной суммой и кнопкой «Выселить»

---

### 39. Выезд (check-out) — ✅ Готово
**Подзадачи:**
- [x] `POST /reservations/:id/check-out` — проверка фолио, `Room.status → DIRTY`
- [x] Авто-создание `HousekeepingTask` на уборку
- [x] Лог в `AuditLog`

---

### 40. Неявка — ✅ Готово
**Подзадачи:**
- [x] `POST /reservations/:id/no-show` — отдельное действие, запись в аудит
- [x] Кнопка «No-show» в форме брони
- [ ] **Cron автоматической разметки** — в 23:59 переводит confirmed-брони в `NO_SHOW` *(опциональное расширение)*

---

## Хаускипинг
_Задачи 41–45_

### 41. Номер грязный — ✅ Готово
**Подзадачи:**
- [x] Статус `RoomStatus.DIRTY`
- [x] Отображение в разделе «Уборка»

---

### 42. Уборка — ✅ Готово
**Подзадачи:**
- [x] Статус `CLEANING` на модели `Room`
- [x] Завершение через `PATCH /rooms/:id/status`
- [x] Назначение через `HousekeepingTask.assigneeId` + вкладка «Задачи» в разделе «Уборка»

---

### 43. Готов к заселению — ✅ Готово
**Подзадачи:**
- [x] Статусы `CLEAN` / `INSPECTED` / `READY`
- [x] Возврат в доступность

---

### 44. Ремонт / блокировка — ✅ Готово
**Подзадачи:**
- [x] `Room.status = OUT_OF_ORDER` или `OUT_OF_SERVICE`
- [x] Учёт в `Inventory.blockedRooms`

---

### 45. Задачи горничным — ✅ Готово
**Подзадачи:**
- [x] Модель `HousekeepingTask { id, tenantId, roomId, type, assigneeId?, status, createdFromReservationId?, completedAt? }`
- [x] Auto-create при выезде — из `POST /reservations/:id/check-out`
- [x] Создание вручную — кнопка «+ Задача» для грязных номеров в UI
- [x] Назначение исполнителю — dropdown в вкладке «Задачи»
- [x] Статусы: `PENDING → IN_PROGRESS → DONE`, завершение → `Room.status = CLEAN`

---

## Деньги и отчёты
_Задачи 46–50_

### 46. Эффективные сутки — ⬜ В бэклоге
**Подзадачи:**
- [ ] Функция `calcEffectiveNights(checkIn, checkOut, actualIn, actualOut, hotelPolicy)`
- [ ] Правила частичных суток в Settings
- [ ] Unit-тесты

---

### 47. Счёт гостя (фолио) — 🟡 В работе
**Подзадачи:**
- [x] Модели `Folio` и `FolioCharge` в Prisma + API (`GET/POST /reservations/:id/folio/charges`)
- [x] Модель `Payment` + API (`POST /reservations/:id/folio/payments`)
- [x] Вкладка «Счёт» в форме брони — список позиций, итог, кнопка «Принять оплату»
- [x] Блок выезда при ненулевом балансе
- [ ] **Авто-начисление ночей** — при check-in создавать `FolioCharge` с типом `ROOM` за каждую ночь
- [ ] **Ручное добавление позиции** — форма «Добавить позицию» в вкладке Счёт (описание, кол-во, цена)

---

### 48. Оплата / депозит — 🟡 В работе
**Подзадачи:**
- [x] Модель `Payment` (PAYMENT/DEPOSIT/REFUND, CASH/CARD/BANK)
- [x] `Folio.balance` = Σ charges − Σ payments
- [x] Кнопка «Принять оплату» (наличные, полная сумма) в вкладке Счёт
- [ ] **Форма частичной оплаты** — ввод суммы + выбор метода (наличные/карта/перевод)
- [ ] **Кассовая смена** — открытие/закрытие, X- и Z-отчёт

---

### 49. Отчёт по гостинице — 🟡 В работе
**Подзадачи:**
- [x] Расчёт KPI на фронте: occupancy %, ADR, RevPAR, общая выручка
- [x] Группировка по категориям
- [ ] **Backend-модуль `reports/`** — `GET /reports/occupancy`, `GET /reports/revenue`, `GET /reports/guests`
- [ ] Проверка прав — `report.view.operations` / `report.view.finance`

---

### 50. Выгрузка (Excel) — 🟡 В работе
**Подзадачи:**
- [x] Кнопка «Экспорт» в UI (CSV-выгрузка)
- [ ] **Генерация XLSX на бэке** — `exceljs`, эндпоинт `GET /reports/:type/export.xlsx`
- [ ] Шаблон XLSX — шапка отеля, период, итоговая строка

---

## Прочее (аудит, общий слой)
_Задачи 51–52_

### 51. Журнал действий — 🟡 В работе
**Подзадачи:**
- [x] Модель `AuditLog { id, tenantId, userId, entity, entityId, action, diff, createdAt }`
- [x] Запись при мутациях номеров и тарифов
- [x] Запись при check-in, check-out, cancel, no-show
- [ ] **Покрытие всех мутаций** — `RatePlansService`, `RestrictionsService`
- [ ] **diff** — JSON-патч `{ before, after }` в `AuditLog.diff`
- [ ] **Вкладка «История»** в карточке брони

---

### 52. Общий слой — 🟡 В работе
**Подзадачи:**
- [x] Аутентификация (JWT) — auth-модуль с access/refresh и super-admin impersonate
- [ ] **Уведомления** — email (SendGrid/SMTP), шаблоны подтверждения брони / отмены
- [ ] **Файлы** — S3/MinIO: загрузка логотипа и фото категорий, presigned URL
- [ ] **Чаты** — внутренний обмен между сменами (приоритет низкий)

---

## Сводка по приёмке

| Категория | Готово | Осталось |
|---|---|---|
| Доступ и роли (1–5) | Логин, команда, PermissionsGuard | Конструктор ролей, история назначений |
| Роли (6–9) | Пресеты + реальная проверка | — |
| Настройка (10–18) | Категории, номера, тарифы, политики | Гео, авиатариф, питание, доп.услуги, квоты |
| Доступность (19–20) | Полностью | — |
| API источников (21–29) | Внутренние брони, действия, аудит | Внешние endpoints, verify/hold/book, webhooks |
| Шахматка (30–33) | Полностью | — |
| Шахматка (34) | — | Ранний/поздний заезд |
| Стойка (35–40) | Полностью | Cron auto-no-show (опционально) |
| Хаускипинг (41–45) | Полностью | — |
| Деньги (46–50) | Фолио, оплаты, KPI, CSV | Авто-ночи, ручное добавление позиции, XLSX |
| Аудит/общий слой (51–52) | Auth, AuditLog частично | Полное покрытие аудитом, уведомления, файлы |

---

_Статусы сверены с фактическим кодом (`backend/src`, `frontend/src`, `prisma/schema.prisma`) на 2026-05-26._
