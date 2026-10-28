# Номерной фонд пачкой — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** гостиница заводит номера одной категории пачкой («с номера N, столько-то штук») и удаляет несколько номеров разом — «в архив», как одиночное удаление.

**Architecture:** сервер — доработка готового `POST /rooms/bulk` (удалённые номера отдельным списком, договорный блок) и новая `POST /rooms/archive-many` (одна транзакция, частичный результат, одна запись журнала). Фронт — переключатель «Один номер / Несколько» в `RoomFormModal.jsx`, режим выбора на сетке `Rooms.jsx` (хук `useRoomSelection`, нижняя строка `SelectionBar`), тексты и диапазон — чистые функции `room-range.js`.

**Tech Stack:** NestJS 10 + Prisma 5.22 + class-validator, jest (бэкенд); Vite + React 18 + TanStack Query, `node --test` (фронт).

**Спека:** `docs/superpowers/specs/2026-10-28-rooms-bulk-design.md`.

---

## Правила для исполнителя

- Репозиторий `C:\dev\Kars-hotel`, ветка `feature/rooms-bulk` (уже создана, на ней лежит спека). Не пушить.
- **Браузер не открывать, ни в какие системы не входить, пароли не вводить, серверы не запускать.** Живой прогон на стенде — владелец.
- Коммитить только свои файлы: `git commit -- <пути>`; чужой индекс не трогать.
- Тексты коммитов — по-английски, `type(scope): summary`, последней строкой `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Комментарии в коде — по-русски, как у соседей: зачем, а не что.
- Кириллицу в файлах искать инструментом `Grep` (ripgrep), а не `grep` из Git Bash — тот её молча не находит.
- Новые серверные тесты проверять МУТАЦИЕЙ: сломать поведение, убедиться, что тест падает, вернуть.

## Карта файлов

| Файл | Что |
|---|---|
| `backend/src/modules/rooms/dto/create-many-rooms.dto.ts` | + `partnerHold` |
| `backend/src/modules/rooms/dto/archive-many-rooms.dto.ts` | новый: `{ ids }`, 1–200 UUID |
| `backend/src/modules/rooms/rooms.service.ts` | `createMany` — `skippedArchived`, `partnerHold`; новый `archiveMany` |
| `backend/src/modules/rooms/rooms.controller.ts` | `POST /rooms/archive-many` |
| `backend/src/modules/rooms/room-create-many.spec.ts` | новый |
| `backend/src/modules/rooms/room-archive-many.spec.ts` | новый |
| `frontend/src/Components/HotelPMS/components/Rooms/room-range.js` | новый: склонение, диапазон, предпросмотр, тексты итогов |
| `frontend/src/Components/HotelPMS/components/Rooms/room-range.test.mjs` | новый |
| `frontend/src/api/rooms.js` | + `createRooms`, `archiveRooms` |
| `frontend/src/hooks/api/useRooms.js` | + `useCreateRooms`, `useArchiveRooms` |
| `frontend/src/Components/HotelPMS/shared/Form.module.css` | + `.segmented`, `.segment`, `.segmentActive`, `.notice` |
| `frontend/src/Components/HotelPMS/components/Rooms/RoomFormModal.jsx` | режим «Несколько» |
| `frontend/src/Components/HotelPMS/components/Rooms/useRoomSelection.js` | новый: хук выбора |
| `frontend/src/Components/HotelPMS/components/Rooms/SelectionBar.jsx` | новый: нижняя строка выбора |
| `frontend/src/Components/HotelPMS/components/Rooms/Rooms.module.css` | + стили выбора |
| `frontend/src/Components/HotelPMS/components/Rooms/Rooms.jsx` | пачка в окне, режим выбора, подтверждение пачки |

---

## Часть 1. Добавление пачкой

### Task 1: сервер — удалённые номера отдельно, договорный блок пачки

**Files:**
- Modify: `backend/src/modules/rooms/dto/create-many-rooms.dto.ts`
- Modify: `backend/src/modules/rooms/rooms.service.ts` (метод `createMany`, ~строки 144–214)
- Create: `backend/src/modules/rooms/room-create-many.spec.ts`

- [ ] **Step 1: Написать падающий тест**

Создать `backend/src/modules/rooms/room-create-many.spec.ts`:

```ts
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { TenantContext } from '../../common/context/tenant-context';
import { RoomsService } from './rooms.service';
import { CreateManyRoomsDto } from './dto/create-many-rooms.dto';

/* Пачка номеров (Д2; интерфейс — 28.10.2026). Сформулировано отрицанием:
 * удалённый номер НЕ сливается в итоге с номерами фонда, договорный блок
 * пачки НЕ теряется. */

const ROOM_TYPE = '7d9f4c2e-1b3a-4c5d-8e6f-0a1b2c3d4e5f';

function setup(existing: { number: string; archivedAt: Date | null }[] = []) {
  const tx = {
    roomType: { findUnique: jest.fn(async () => ({ id: ROOM_TYPE })) },
    room: {
      findMany: jest.fn(async () => existing),
      create: jest.fn(async ({ data }: { data: { number: string } }) => ({ id: `id-${data.number}`, ...data })),
    },
  };
  const prisma = {
    forTenant: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    writeAuditLog: jest.fn(async () => undefined),
  };
  const svc = Object.create(RoomsService.prototype) as RoomsService;
  Object.assign(svc, { prisma });
  return { svc, tx, prisma };
}

const dto = (extra: Partial<CreateManyRoomsDto> = {}) =>
  ({ roomTypeId: ROOM_TYPE, startNumber: 101, count: 5, ...extra }) as CreateManyRoomsDto;

describe('Пачка номеров', () => {
  beforeEach(() => jest.spyOn(TenantContext, 'getTenantIdOrThrow').mockReturnValue('t1'));
  afterEach(() => jest.restoreAllMocks());

  it('удалённый номер НЕ попадает в «уже есть в фонде» — он в отдельном списке', async () => {
    const { svc, tx } = setup([
      { number: '102', archivedAt: null },
      { number: '104', archivedAt: new Date('2026-10-25') },
    ]);
    const r = await svc.createMany(dto());
    expect(r.skipped).toEqual(['102']);
    expect(r.skippedArchived).toEqual(['104']);
    expect(r.created).toBe(3);
    expect(tx.room.create.mock.calls.map(([a]) => a.data.number)).toEqual(['101', '103', '105']);
  });

  it('журнал пачки — одна запись, в ней оба списка пропущенных', async () => {
    const { svc, prisma } = setup([{ number: '104', archivedAt: new Date() }]);
    await svc.createMany(dto());
    expect(prisma.writeAuditLog).toHaveBeenCalledTimes(1);
    expect(prisma.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'create_many',
        diff: { before: {}, after: expect.objectContaining({ skipped: [], skippedArchived: ['104'] }) },
      }),
    );
  });

  it('договорный блок пачки НЕ теряется; не прислан — NONE', async () => {
    const quota = setup();
    await quota.svc.createMany(dto({ count: 1, partnerHold: 'QUOTA' }));
    expect(quota.tx.room.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ partnerHold: 'QUOTA' }) }),
    );
    const none = setup();
    await none.svc.createMany(dto({ count: 1 }));
    expect(none.tx.room.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ partnerHold: 'NONE' }) }),
    );
  });

  it('чужое значение договорного блока НЕ принимается', () => {
    const errs = validateSync(plainToInstance(CreateManyRoomsDto, { ...dto(), partnerHold: 'ALL' }));
    expect(errs.map((e) => e.property)).toContain('partnerHold');
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd /c/dev/Kars-hotel/backend && npx jest src/modules/rooms/room-create-many`
Expected: FAIL — `skippedArchived` undefined, `partnerHold` не в `data`, ошибки валидации `partnerHold` нет (ts-jest может упасть раньше на типе `partnerHold` в `Partial<CreateManyRoomsDto>` — это тоже ожидаемый провал).

- [ ] **Step 3: Договорный блок в DTO**

В `backend/src/modules/rooms/dto/create-many-rooms.dto.ts`:

импорт — добавить `RoomPartnerHold`:

```ts
import { BedType, RoomPartnerHold, RoomStatus, RoomView } from '@prisma/client';
```

после поля `status` (перед `isActive`) вставить:

```ts
  /* Договорный блок пачки (28.10.2026): поле стоит в той же форме, что у
     одного номера, и должно действовать на все номера пачки. */
  @ApiPropertyOptional({ enum: RoomPartnerHold, default: RoomPartnerHold.NONE })
  @IsOptional()
  @IsEnum(RoomPartnerHold)
  partnerHold?: RoomPartnerHold;
```

- [ ] **Step 4: Удалённые отдельно и договорный блок в `createMany`**

В `backend/src/modules/rooms/rooms.service.ts`, метод `createMany`, заменить блок от `const existing = …` до `if (!toCreate.length) { … }` включительно на:

```ts
    const existing = await this.prisma.forTenant((tx) =>
      tx.room.findMany({
        where: { number: { in: numbers } },
        select: { number: true, archivedAt: true },
      }),
    );
    const taken = new Set(existing.map((r) => r.number));
    /* Удалённые — отдельным списком (28.10.2026): номер в архиве в фонде не
       виден, и «уже есть» про него ставит в тупик — как и в одиночном create,
       где подсказываем восстановить. */
    const archived = new Set(existing.filter((r) => r.archivedAt).map((r) => r.number));
    const skipped = numbers.filter((n) => taken.has(n) && !archived.has(n));
    const skippedArchived = numbers.filter((n) => archived.has(n));

    if (taken.size && dto.skipExisting === false) {
      throw new ConflictException(`Уже существуют номера: ${[...skipped, ...skippedArchived].join(', ')}`);
    }
    const toCreate = numbers.filter((n) => !taken.has(n));
    if (!toCreate.length) {
      return { created: 0, skipped, skippedArchived, rooms: [] as unknown[] };
    }
```

В `tx.room.create({ data: { … } })` того же метода после строки `capacity: dto.capacity ?? 1,` добавить:

```ts
              partnerHold: dto.partnerHold ?? 'NONE',
```

В записи журнала `create_many` заменить `after`:

```ts
        after: { created: toCreate, skipped, skippedArchived, roomTypeId: dto.roomTypeId },
```

Последнюю строку метода заменить:

```ts
    return { created: rooms.length, skipped, skippedArchived, rooms };
```

- [ ] **Step 5: Тест проходит**

Run: `cd /c/dev/Kars-hotel/backend && npx jest src/modules/rooms/room-create-many`
Expected: PASS, 4 tests.

- [ ] **Step 6: Мутация**

Временно заменить в `createMany` строку `const skipped = numbers.filter((n) => taken.has(n) && !archived.has(n));` на `const skipped = numbers.filter((n) => taken.has(n));`.
Run: `npx jest src/modules/rooms/room-create-many`
Expected: FAIL в тесте «удалённый номер НЕ попадает…». Вернуть строку, прогнать снова — PASS.

- [ ] **Step 7: Весь модуль номеров зелёный**

Run: `cd /c/dev/Kars-hotel/backend && npx jest src/modules/rooms`
Expected: PASS (все спеки модуля).

Коммит — после Task 4, одной фичей.

---

### Task 2: фронт — диапазон, предпросмотр и итог пачки (`room-range.js`)

**Files:**
- Create: `frontend/src/Components/HotelPMS/components/Rooms/room-range.js`
- Create: `frontend/src/Components/HotelPMS/components/Rooms/room-range.test.mjs`

- [ ] **Step 1: Написать падающий тест**

Создать `frontend/src/Components/HotelPMS/components/Rooms/room-range.test.mjs`:

```js
/* ПАЧКА НОМЕРОВ — диапазон, предпросмотр, тексты итогов (28.10.2026).
 *
 * Запуск: `npm test` (встроенный `node --test`, без зависимостей). */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSummary,
  numberList,
  plural,
  rangeNumbers,
  rangePreview,
  validateRange,
} from './room-range.js';

test('склонение: 1 номер, 2 номера, 5 номеров, 11 номеров, 21 номер', () => {
  const f = (n) => plural(n, 'номер', 'номера', 'номеров');
  assert.deepEqual(
    [1, 2, 5, 11, 21, 112].map(f),
    ['номер', 'номера', 'номеров', 'номеров', 'номер', 'номеров'],
  );
});

test('диапазон собирается как на сервере: префикс + число + суффикс', () => {
  assert.deepEqual(rangeNumbers({ start: '101', count: '3', prefix: 'А-', suffix: 'б' }), [
    'А-101б',
    'А-102б',
    'А-103б',
  ]);
  assert.deepEqual(rangeNumbers({ start: 0, count: 2 }), ['0', '1']);
});

test('неверный диапазон НЕ проходит: пусто, дробь, минус, 0 и больше 200 штук', () => {
  assert.deepEqual(validateRange({ start: '101', count: '40' }), {});
  assert.deepEqual(validateRange({ start: '0', count: '200' }), {});
  for (const start of ['', '1.5', '-1', 'abc']) {
    assert.ok(validateRange({ start, count: '1' }).start, `start=${start}`);
  }
  for (const count of ['', '0', '201', '2.5']) {
    assert.ok(validateRange({ start: '1', count }).count, `count=${count}`);
  }
});

test('предпросмотр: до 6 номеров — все, больше — первые два, «…» и последний', () => {
  assert.equal(rangePreview(['101']), 'Будет создан: №101 (1 номер)');
  assert.equal(
    rangePreview(['1', '2', '3', '4', '5', '6']),
    'Будут созданы: №1, №2, №3, №4, №5, №6 (6 номеров)',
  );
  assert.equal(
    rangePreview(rangeNumbers({ start: 101, count: 40 })),
    'Будут созданы: №101, №102 … №140 (40 номеров)',
  );
});

test('перечень номеров: больше 10 — «и ещё K»', () => {
  assert.equal(numberList(['1', '2']), '№1, №2');
  assert.equal(
    numberList(rangeNumbers({ start: 1, count: 12 })),
    '№1, №2, №3, №4, №5, №6, №7, №8, №9, №10 и ещё 2',
  );
});

test('итог пачки: всё создано — null, окно можно закрыть', () => {
  assert.equal(createSummary({ created: 40, skipped: [], skippedArchived: [] }, 40), null);
});

test('итог пачки: удалённые названы отдельно, с подсказкой восстановить', () => {
  assert.equal(
    createSummary({ created: 37, skipped: ['101', '102'], skippedArchived: ['105'] }, 40),
    'Создано 37 из 40. Уже есть в фонде: №101, №102. В удалённых: №105 — восстановите его в блоке «Удалённые номера» внизу страницы.',
  );
  assert.equal(
    createSummary({ created: 0, skipped: [], skippedArchived: ['1', '2'] }, 2),
    'Ничего не создано. В удалённых: №1, №2 — восстановите их в блоке «Удалённые номера» внизу страницы.',
  );
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd /c/dev/Kars-hotel/frontend && npm test`
Expected: FAIL — `Cannot find module …/room-range.js`.

- [ ] **Step 3: Реализация**

Создать `frontend/src/Components/HotelPMS/components/Rooms/room-range.js`:

```js
/* Пачка номеров (28.10.2026): диапазон, предпросмотр и тексты итогов.
 * Чистые функции без React — проверяются `npm test` (room-range.test.mjs). */

/** Склонение по числу: 1 номер, 2 номера, 5 номеров. */
export function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

const roomsWord = (n) => `${n} ${plural(n, 'номер', 'номера', 'номеров')}`;

/** Тот же предел, что на сервере (CreateManyRoomsDto, @Max(200)). */
export const MAX_ROOMS = 200;

/** Ошибки полей диапазона; пустой объект — диапазон верный. */
export function validateRange({ start, count }) {
  const e = {};
  const s = Number(start);
  const c = Number(count);
  if (String(start).trim() === '' || !Number.isInteger(s) || s < 0) e.start = 'Целое число от 0';
  if (String(count).trim() === '' || !Number.isInteger(c) || c < 1 || c > MAX_ROOMS) {
    e.count = `От 1 до ${MAX_ROOMS}`;
  }
  return e;
}

/** Номера диапазона — так же, как их собирает сервер: префикс + число + суффикс. */
export function rangeNumbers({ start, count, prefix = '', suffix = '' }) {
  const s = Number(start);
  return Array.from({ length: Number(count) }, (_, i) => `${prefix}${s + i}${suffix}`);
}

/** Перечень номеров: до `max` штук, дальше — «и ещё K». */
export function numberList(numbers, max = 10) {
  const shown = numbers
    .slice(0, max)
    .map((n) => `№${n}`)
    .join(', ');
  const rest = numbers.length - max;
  return rest > 0 ? `${shown} и ещё ${rest}` : shown;
}

/**
 * «Будут созданы: №101, №102 … №140 (40 номеров)». До 6 номеров перечисляем
 * все: ошибку в поле «Сколько» видно до нажатия «Создать».
 */
export function rangePreview(numbers) {
  const n = numbers.length;
  const list =
    n <= 6
      ? numbers.map((x) => `№${x}`).join(', ')
      : `№${numbers[0]}, №${numbers[1]} … №${numbers[n - 1]}`;
  return `${n === 1 ? 'Будет создан' : 'Будут созданы'}: ${list} (${roomsWord(n)})`;
}

/**
 * Итог создания пачки; null — создано всё, окно можно закрыть. Удалённые
 * называем отдельно: номер в архиве в фонде не виден, и без подсказки его
 * ищут там, где его нет.
 */
export function createSummary({ created, skipped = [], skippedArchived = [] }, requested) {
  if (!skipped.length && !skippedArchived.length) return null;
  const parts = [created ? `Создано ${created} из ${requested}.` : 'Ничего не создано.'];
  if (skipped.length) parts.push(`Уже есть в фонде: ${numberList(skipped)}.`);
  if (skippedArchived.length) {
    const it = skippedArchived.length === 1 ? 'его' : 'их';
    parts.push(
      `В удалённых: ${numberList(skippedArchived)} — восстановите ${it} в блоке «Удалённые номера» внизу страницы.`,
    );
  }
  return parts.join(' ');
}
```

- [ ] **Step 4: Тест проходит**

Run: `cd /c/dev/Kars-hotel/frontend && npm test`
Expected: PASS — все тесты, включая 7 новых.

---

### Task 3: фронт — запрос и хук пачки

**Files:**
- Modify: `frontend/src/api/rooms.js`
- Modify: `frontend/src/hooks/api/useRooms.js`

- [ ] **Step 1: Запрос**

В конец `frontend/src/api/rooms.js` добавить:

```js
/* Пачка номеров одной категории (28.10.2026): «с номера N, столько-то штук».
   Ответ: created, skipped (есть в фонде), skippedArchived (в удалённых). */
export async function createRooms(payload) {
  const { data } = await api.post('/rooms/bulk', payload);
  return data;
}
```

- [ ] **Step 2: Хук**

В `frontend/src/hooks/api/useRooms.js` сразу после `useCreateRoom` добавить:

```js
export function useCreateRooms() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.createRooms,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ['roomTypes'] });
    },
  });
}
```

---

### Task 4: фронт — режим «Несколько» в окне номера

**Files:**
- Modify: `frontend/src/Components/HotelPMS/shared/Form.module.css`
- Modify: `frontend/src/Components/HotelPMS/components/Rooms/RoomFormModal.jsx`
- Modify: `frontend/src/Components/HotelPMS/components/Rooms/Rooms.jsx`

- [ ] **Step 1: Стили переключателя и итога**

В конец `frontend/src/Components/HotelPMS/shared/Form.module.css` добавить:

```css
/* Переключатель «одно из двух» в форме (28.10.2026: «Один номер / Несколько»). */
.segmented {
  display: inline-flex;
  border: 1px solid #D1D5DB;
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 14px;
}

.segment {
  padding: 7px 14px;
  font-size: 13px;
  font-weight: 600;
  background: #fff;
  color: #6B7280;
  border: none;
  cursor: pointer;
  font-family: inherit;
}

.segment + .segment { border-left: 1px solid #D1D5DB; }

.segmentActive {
  background: #1E88E5;
  color: #fff;
}

/* Итог, требующий внимания, но не ошибка: пачка создалась или удалилась
   не целиком (28.10.2026). */
.notice {
  padding: 10px 12px;
  background: #FFFBEB;
  border: 1px solid #FDE68A;
  border-radius: 8px;
  color: #92400E;
  font-size: 13px;
  line-height: 1.5;
}
```

- [ ] **Step 2: Импорт, пустые значения, состояние**

В `RoomFormModal.jsx` после импорта `status-config` добавить:

```js
import { MAX_ROOMS, createSummary, rangeNumbers, rangePreview, validateRange } from './room-range';
```

В `EMPTY` после `notes: '',` добавить:

```js
  // Пачка (28.10.2026): «с номера N, столько-то штук», префикс и суффикс.
  start: '',
  count: '',
  prefix: '',
  suffix: '',
```

В JSDoc-комментарии над компонентом после строки `onSubmit` добавить:

```js
 *   onSubmitMany: (payload) => Promise<{ created, skipped, skippedArchived }>  (пачка, только при создании)
```

Сигнатуру заменить:

```js
export default function RoomFormModal({ open, editing, roomTypes, defaultRoomTypeId, onClose, onSubmit, onSubmitMany, onDelete }) {
```

После `const [busy, setBusy] = useState(false);` добавить:

```js
  /* «Несколько» — те же поля, но вместо номера диапазон. Итог пачки, если
     что-то пропущено, остаётся в окне: иначе человек не узнает, что №105
     лежит в удалённых. */
  const [mode, setMode] = useState('one');
  const [result, setResult] = useState(null);
```

В `useEffect` после `setServerError(null);` добавить:

```js
      setMode('one');
      setResult(null);
```

После `const set = (k, v) => …;` добавить:

```js
  const many = !editing && mode === 'many';
  const rangeOk = many && Object.keys(validateRange(values)).length === 0;
  const preview = rangeOk
    ? rangePreview(
        rangeNumbers({
          start: values.start,
          count: values.count,
          prefix: values.prefix.trim(),
          suffix: values.suffix.trim(),
        }),
      )
    : null;
```

- [ ] **Step 3: Проверка и отправка**

`validate` заменить целиком:

```js
  const validate = () => {
    const e = {};
    if (!values.roomTypeId) e.roomTypeId = 'Выберите категорию';
    if (many) Object.assign(e, validateRange(values));
    else {
      if (!values.number || values.number.trim().length === 0) e.number = 'Обязательно';
      // Тот же предел, что на сервере (CreateRoomDto): номер бывает и адресом квартиры.
      if (values.number && values.number.length > 100) e.number = 'Максимум 100 символов';
    }
    const beds = BEDS.map(([k]) => Number(values[k]));
    if (beds.some((n) => !Number.isInteger(n) || n < 0 || n > 20)) e.beds = 'Целое число от 0 до 20';
    else if (beds[0] + beds[1] + beds[2] === 0) e.beds = 'Укажите хотя бы одну кровать или диван';
    setErrors(e);
    return Object.keys(e).length === 0;
  };
```

`handleSubmit` заменить целиком:

```js
  const handleSubmit = async (ev) => {
    ev.preventDefault();
    if (!validate()) return;
    setBusy(true);
    setServerError(null);
    // Поля, общие для одного номера и пачки.
    const common = {
      roomTypeId: values.roomTypeId,
      floor: Number(values.floor),
      capacity: Number(values.capacity) || 1,
      singleBeds: Number(values.singleBeds),
      doubleBeds: Number(values.doubleBeds),
      sofas: Number(values.sofas),
      extraBeds: Number(values.extraBeds),
      view: values.view,
      status: values.status,
      partnerHold: values.partnerHold,
      notes: values.notes?.trim() || undefined,
    };
    try {
      if (many) {
        const count = Number(values.count);
        const res = await onSubmitMany({
          ...common,
          startNumber: Number(values.start),
          count,
          prefix: values.prefix.trim() || undefined,
          suffix: values.suffix.trim() || undefined,
        });
        const summary = createSummary(res, count);
        if (summary) setResult(summary);
        else onClose?.();
      } else {
        await onSubmit({ ...common, number: values.number.trim() });
        onClose?.();
      }
    } catch (e) {
      const msg = e?.response?.data?.message || e?.message || 'Не удалось сохранить';
      setServerError(Array.isArray(msg) ? msg.join(', ') : msg);
    } finally {
      setBusy(false);
    }
  };
```

- [ ] **Step 4: Заголовок, подвал, итог**

В `<Modal …>` заменить `title` и `footer`:

```jsx
      title={editing ? `Номер №${editing.number}` : many ? 'Новые номера' : 'Новый номер'}
      onClose={busy ? undefined : onClose}
      footer={
        result ? (
          <button type="button" className={formClasses.btnPrimary} onClick={onClose}>
            Готово
          </button>
        ) : (
          <>
            {editing && onDelete && (
              <button type="button" className={formClasses.btnDangerGhost} onClick={onDelete} disabled={busy}>
                Удалить номер
              </button>
            )}
            <button type="button" className={formClasses.btnSecondary} onClick={onClose} disabled={busy}>
              Отмена
            </button>
            <button type="submit" form="room-form" className={formClasses.btnPrimary} disabled={busy}>
              {busy ? 'Сохраняем…' : many ? 'Создать номера' : 'Сохранить'}
            </button>
          </>
        )
      }
```

Тело: строку `<form id="room-form" onSubmit={handleSubmit} noValidate>` заменить на

```jsx
      {result ? (
        <div className={formClasses.notice}>{result}</div>
      ) : (
      <form id="room-form" onSubmit={handleSubmit} noValidate>
```

а закрывающий `</form>` (перед `</Modal>`) — на

```jsx
      </form>
      )}
```

- [ ] **Step 5: Переключатель и поля диапазона**

Сразу после `{serverError && <div className={formClasses.alert}>{serverError}</div>}` вставить:

```jsx
        {!editing && (
          <div className={formClasses.segmented} role="group" aria-label="Сколько номеров">
            {[
              ['one', 'Один номер'],
              ['many', 'Несколько'],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`${formClasses.segment} ${mode === key ? formClasses.segmentActive : ''}`}
                aria-pressed={mode === key}
                onClick={() => {
                  setMode(key);
                  setErrors({});
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
```

Обёртку первой строки формы `<div className={formClasses.row}>` (категория + номер) заменить на `<div className={many ? undefined : formClasses.row}>`, а блок поля «Номер» (`<div className={formClasses.field}>` с `<label …>Номер</label>` … до его закрывающего `</div>`) обернуть в `{!many && ( … )}`.

Сразу после закрывающего `</div>` этой строки вставить:

```jsx
        {/* Пачка: «с номера N, столько-то штук» — так человек говорит вслух, и
            в этом нельзя ошибиться границей (CreateManyRoomsDto). */}
        {many && (
          <>
            <div className={formClasses.row4}>
              <div className={formClasses.field}>
                <label className={formClasses.label}>С номера</label>
                <input
                  className={formClasses.input}
                  type="number"
                  min={0}
                  value={values.start}
                  onChange={(e) => set('start', e.target.value)}
                  aria-invalid={errors.start ? 'true' : 'false'}
                  placeholder="101"
                />
              </div>
              <div className={formClasses.field}>
                <label className={formClasses.label}>Сколько</label>
                <input
                  className={formClasses.input}
                  type="number"
                  min={1}
                  max={MAX_ROOMS}
                  value={values.count}
                  onChange={(e) => set('count', e.target.value)}
                  aria-invalid={errors.count ? 'true' : 'false'}
                  placeholder="40"
                />
              </div>
              <div className={formClasses.field}>
                <label className={formClasses.label}>Префикс</label>
                <input
                  className={formClasses.input}
                  type="text"
                  maxLength={8}
                  value={values.prefix}
                  onChange={(e) => set('prefix', e.target.value)}
                  placeholder="А-"
                />
              </div>
              <div className={formClasses.field}>
                <label className={formClasses.label}>Суффикс</label>
                <input
                  className={formClasses.input}
                  type="text"
                  maxLength={8}
                  value={values.suffix}
                  onChange={(e) => set('suffix', e.target.value)}
                  placeholder="б"
                />
              </div>
            </div>
            {(errors.start || errors.count) && (
              <div className={formClasses.fieldError}>
                {[errors.start && `С номера: ${errors.start}`, errors.count && `Сколько: ${errors.count}`]
                  .filter(Boolean)
                  .join('. ')}
              </div>
            )}
            {preview && <div className={formClasses.hint}>{preview}</div>}
          </>
        )}
```

- [ ] **Step 6: Подключить пачку в `Rooms.jsx`**

В импорт из `'../../../../hooks/api/useRooms'` добавить `useCreateRooms`. После `const createRoom = useCreateRoom();` добавить:

```js
  const createRooms = useCreateRooms();
```

В `<RoomFormModal …>` после `onSubmit={…}` добавить проп:

```jsx
        onSubmitMany={(payload) => createRooms.mutateAsync(payload)}
```

- [ ] **Step 7: Проверки фронта и бэкенда**

Run:
```bash
cd /c/dev/Kars-hotel/frontend && npm run lint && npm test && npm run build
```
Expected: lint без предупреждений, тесты PASS, сборка без ошибок.

Run:
```bash
cd /c/dev/Kars-hotel/backend && npx prettier --write src/modules/rooms && npx jest src/modules/rooms && npm run build
```
Expected: PASS, `nest build` без ошибок.

- [ ] **Step 8: Коммит «добавление пачкой»**

```bash
cd /c/dev/Kars-hotel && git add backend/src/modules/rooms/dto/create-many-rooms.dto.ts backend/src/modules/rooms/rooms.service.ts backend/src/modules/rooms/room-create-many.spec.ts frontend/src/Components/HotelPMS/components/Rooms/room-range.js frontend/src/Components/HotelPMS/components/Rooms/room-range.test.mjs frontend/src/api/rooms.js frontend/src/hooks/api/useRooms.js frontend/src/Components/HotelPMS/shared/Form.module.css frontend/src/Components/HotelPMS/components/Rooms/RoomFormModal.jsx frontend/src/Components/HotelPMS/components/Rooms/Rooms.jsx
git commit -F - -- backend/src/modules/rooms/dto/create-many-rooms.dto.ts backend/src/modules/rooms/rooms.service.ts backend/src/modules/rooms/room-create-many.spec.ts frontend/src/Components/HotelPMS/components/Rooms/room-range.js frontend/src/Components/HotelPMS/components/Rooms/room-range.test.mjs frontend/src/api/rooms.js frontend/src/hooks/api/useRooms.js frontend/src/Components/HotelPMS/shared/Form.module.css frontend/src/Components/HotelPMS/components/Rooms/RoomFormModal.jsx frontend/src/Components/HotelPMS/components/Rooms/Rooms.jsx <<'EOF'
feat(rooms): add rooms in bulk from the add-room modal

The add-room modal gets a "one room / several" switch on top of the
existing POST /rooms/bulk: start number, count, prefix and suffix with a
live preview of the numbers. Numbers that already exist are skipped;
archived ones are now reported separately with a hint to restore them,
and the partner hold from the form applies to the whole batch.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

`prettier --write` мог переформатировать соседние файлы модуля — если в `git status` есть изменения в других файлах `src/modules/rooms`, вернуть их (`git checkout -- <файл>`), они не наши.

---

## Часть 2. Удаление пачкой

### Task 5: сервер — `POST /rooms/archive-many`

**Files:**
- Create: `backend/src/modules/rooms/dto/archive-many-rooms.dto.ts`
- Modify: `backend/src/modules/rooms/rooms.service.ts` (новый метод после `archive`)
- Modify: `backend/src/modules/rooms/rooms.controller.ts`
- Create: `backend/src/modules/rooms/room-archive-many.spec.ts`

- [ ] **Step 1: Написать падающий тест**

Создать `backend/src/modules/rooms/room-archive-many.spec.ts`:

```ts
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { TenantContext } from '../../common/context/tenant-context';
import { RoomsService } from './rooms.service';
import { ArchiveManyRoomsDto } from './dto/archive-many-rooms.dto';

/* Удаление «в архив» пачкой (28.10.2026). Правило то же, что у одного номера
 * (room-archive.spec.ts), и сформулировано отрицанием: номер с действующей
 * бронью НЕ удаляется, строка НЕ стирается, на пачку НЕ пишется по записи
 * журнала на номер, удалённый раньше НЕ правится повторно. */

type Room = { id: string; number: string; archivedAt: Date | null };

function setup(rooms: Room[], live: Record<string, number> = {}) {
  const tx = {
    room: {
      findMany: jest.fn(async () => rooms),
      updateMany: jest.fn(async () => ({ count: 0 })),
      delete: jest.fn(),
    },
    reservation: {
      groupBy: jest.fn(async () =>
        Object.entries(live).map(([roomId, n]) => ({ roomId, _count: { _all: n } })),
      ),
    },
  };
  const prisma = {
    forTenant: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    writeAuditLog: jest.fn(async () => undefined),
  };
  const svc = Object.create(RoomsService.prototype) as RoomsService;
  Object.assign(svc, { prisma });
  return { svc, tx, prisma };
}

const room = (id: string, number: string, archivedAt: Date | null = null): Room => ({ id, number, archivedAt });

describe('Удаление номеров «в архив» пачкой', () => {
  beforeEach(() => {
    jest.spyOn(TenantContext, 'getTenantIdOrThrow').mockReturnValue('t1');
    jest.spyOn(TenantContext, 'get').mockReturnValue({ tenantId: 't1', userId: 'u-disp' } as never);
  });
  afterEach(() => jest.restoreAllMocks());

  it('номер с действующей бронью НЕ удаляется, остальные удаляются, строки НЕ стираются', async () => {
    const { svc, tx } = setup([room('r1', '101'), room('r2', '105'), room('r3', '106')], { r2: 2 });
    const r = await svc.archiveMany(['r1', 'r2', 'r3']);
    expect(tx.room.delete).not.toHaveBeenCalled();
    expect(tx.room.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['r1', 'r3'] }, archivedAt: null },
      data: { isActive: false, archivedAt: expect.any(Date), archivedBy: 'u-disp' },
    });
    expect(r.archived).toEqual([
      { id: 'r1', number: '101' },
      { id: 'r3', number: '106' },
    ]);
    expect(r.blocked).toEqual([{ id: 'r2', number: '105', liveReservations: 2 }]);
  });

  it('действующие брони — только новые, подтверждённые и с гостем', async () => {
    const { svc, tx } = setup([room('r1', '101')]);
    await svc.archiveMany(['r1']);
    expect(tx.reservation.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { roomId: { in: ['r1'] }, status: { in: ['NEW', 'CONFIRMED', 'CHECKED_IN'] } },
      }),
    );
  });

  it('на пачку НЕ пишется по записи на номер — одна archive_many со списком номеров', async () => {
    const { svc, prisma } = setup([room('r1', '101'), room('r2', '102'), room('r3', '103')]);
    await svc.archiveMany(['r1', 'r2', 'r3']);
    expect(prisma.writeAuditLog).toHaveBeenCalledTimes(1);
    expect(prisma.writeAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        entity: 'room',
        action: 'archive_many',
        diff: { before: {}, after: { archived: ['101', '102', '103'], blocked: [] } },
      }),
    );
  });

  it('удалённый раньше НЕ правится повторно и НЕ попадает в журнал, но в ответе он среди удалённых', async () => {
    const { svc, tx, prisma } = setup([room('r1', '101', new Date('2026-10-25'))]);
    const r = await svc.archiveMany(['r1']);
    expect(tx.room.updateMany).not.toHaveBeenCalled();
    expect(prisma.writeAuditLog).not.toHaveBeenCalled();
    expect(r.archived).toEqual([{ id: 'r1', number: '101' }]);
  });

  it('повторы id НЕ удваиваются; чужой или несуществующий — в notFound', async () => {
    const { svc, tx } = setup([room('r1', '101')]);
    const r = await svc.archiveMany(['r1', 'r1', 'x']);
    expect(tx.room.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['r1', 'x'] } } }),
    );
    expect(r.notFound).toEqual(['x']);
  });
});

describe('ArchiveManyRoomsDto', () => {
  const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
  const errs = (ids: unknown) => validateSync(plainToInstance(ArchiveManyRoomsDto, { ids }));

  it('от 1 до 200 UUID — можно', () => {
    expect(errs([uuid(1)])).toEqual([]);
    expect(errs(Array.from({ length: 200 }, (_, i) => uuid(i)))).toEqual([]);
  });

  it('пусто, больше 200 и не-UUID НЕ принимаются', () => {
    expect(errs([])).not.toEqual([]);
    expect(errs(Array.from({ length: 201 }, (_, i) => uuid(i)))).not.toEqual([]);
    expect(errs(['101'])).not.toEqual([]);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd /c/dev/Kars-hotel/backend && npx jest src/modules/rooms/room-archive-many`
Expected: FAIL — нет модуля `./dto/archive-many-rooms.dto`.

- [ ] **Step 3: DTO**

Создать `backend/src/modules/rooms/dto/archive-many-rooms.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsUUID } from 'class-validator';

/**
 * Удаление номеров «в архив» пачкой (28.10.2026) — номера, отмеченные
 * галочками в «Номерном фонде». Предел тот же, что у создания пачкой.
 */
export class ArchiveManyRoomsDto {
  @ApiProperty({ type: [String], description: 'id номеров, от 1 до 200' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @IsUUID('all', { each: true })
  ids!: string[];
}
```

- [ ] **Step 4: Метод `archiveMany`**

В `backend/src/modules/rooms/rooms.service.ts` сразу после метода `archive` (перед JSDoc `restore`) вставить:

```ts
  /**
   * Удаление «в архив» пачкой (28.10.2026). Правило то же, что у `archive`:
   * номер с действующей бронью не трогаем. Отличий два:
   * - результат частичный: удаляем, что можно, остальное называем с числом
   *   броней — падать целиком из-за двух номеров значило бы заставить снимать
   *   с них галочки и пробовать снова;
   * - запись журнала одна на пачку: журнал гостиницы виден оператору в её
   *   истории, и сорок строк «номер удалён» вытеснили бы из неё всё прочее.
   *   Кто и когда удалил каждый номер, записано в нём самом.
   * Удалённый раньше номер не правится и в журнал не идёт, но в ответе он
   * среди удалённых: повтор безвреден, как у одного номера.
   */
  async archiveMany(ids: string[]) {
    const tenantId = TenantContext.getTenantIdOrThrow();
    const actor = TenantContext.get()?.userId || null;
    const unique = [...new Set(ids)];
    const result = await this.prisma.forTenant(async (tx) => {
      const rooms = await tx.room.findMany({
        where: { id: { in: unique } },
        select: { id: true, number: true, archivedAt: true },
      });
      const live = await tx.reservation.groupBy({
        by: ['roomId'],
        where: { roomId: { in: rooms.map((r) => r.id) }, status: { in: LIVE_RESERVATION_STATUSES } },
        _count: { _all: true },
      });
      const liveByRoom = new Map(live.map((g) => [g.roomId, g._count._all]));
      const fresh = rooms.filter((r) => !r.archivedAt && !liveByRoom.has(r.id));
      if (fresh.length) {
        await tx.room.updateMany({
          where: { id: { in: fresh.map((r) => r.id) }, archivedAt: null },
          data: { isActive: false, archivedAt: new Date(), archivedBy: actor },
        });
      }
      const found = new Set(rooms.map((r) => r.id));
      return {
        fresh: fresh.map((r) => r.number),
        archived: rooms
          .filter((r) => r.archivedAt || !liveByRoom.has(r.id))
          .map(({ id, number }) => ({ id, number })),
        blocked: rooms
          .filter((r) => !r.archivedAt && liveByRoom.has(r.id))
          .map((r) => ({ id: r.id, number: r.number, liveReservations: liveByRoom.get(r.id) ?? 0 })),
        notFound: unique.filter((id) => !found.has(id)),
      };
    });
    if (result.fresh.length) {
      await this.prisma.writeAuditLog({
        tenantId,
        entity: 'room',
        action: 'archive_many',
        diff: {
          before: {},
          after: { archived: result.fresh, blocked: result.blocked.map((r) => r.number) },
        },
      });
    }
    const { archived, blocked, notFound } = result;
    return { archived, blocked, notFound };
  }
```

Если `tsc` / ts-jest ругается на типы `groupBy` (у Prisma бывает «orderBy required»), добавить в вызов `orderBy: { roomId: 'asc' }` — на результат это не влияет.

- [ ] **Step 5: Ручка**

В `backend/src/modules/rooms/rooms.controller.ts` после импорта `CreateManyRoomsDto` добавить:

```ts
import { ArchiveManyRoomsDto } from './dto/archive-many-rooms.dto';
```

Сразу после метода `restore` (перед комментарием про физическое удаление) вставить:

```ts
  /* Удаление «в архив» пачкой (28.10.2026): номера, отмеченные в «Номерном
     фонде», одним запросом. Номера с действующими бронями не удаляются —
     ответ называет их отдельно. Право — то же, что у одного номера. */
  @Post('archive-many')
  @RequirePermissions('room.update')
  @ApiOperation({ summary: 'Удалить в архив несколько номеров (без стирания данных)' })
  archiveMany(@Body() dto: ArchiveManyRoomsDto) {
    return this.service.archiveMany(dto.ids);
  }
```

- [ ] **Step 6: Тест проходит**

Run: `cd /c/dev/Kars-hotel/backend && npx jest src/modules/rooms/room-archive-many`
Expected: PASS, 7 tests.

- [ ] **Step 7: Мутации**

1. В `archiveMany` заменить `const fresh = rooms.filter((r) => !r.archivedAt && !liveByRoom.has(r.id));` на `const fresh = rooms.filter((r) => !r.archivedAt);`.
   Run: `npx jest src/modules/rooms/room-archive-many` → FAIL в «номер с действующей бронью НЕ удаляется…». Вернуть.
2. Заменить `if (result.fresh.length) {` на `if (true) {`.
   Run: `npx jest src/modules/rooms/room-archive-many` → FAIL в «удалённый раньше НЕ правится повторно…». Вернуть.

После обеих — PASS.

- [ ] **Step 8: Модуль и сборка**

Run:
```bash
cd /c/dev/Kars-hotel/backend && npx prettier --write src/modules/rooms && npx jest src/modules/rooms && npm run build
```
Expected: PASS, `nest build` без ошибок.

---

### Task 6: фронт — итог удаления, запрос и хук

**Files:**
- Modify: `frontend/src/Components/HotelPMS/components/Rooms/room-range.js`
- Modify: `frontend/src/Components/HotelPMS/components/Rooms/room-range.test.mjs`
- Modify: `frontend/src/api/rooms.js`
- Modify: `frontend/src/hooks/api/useRooms.js`

- [ ] **Step 1: Написать падающий тест**

В `room-range.test.mjs` в импорт добавить `archiveSummary`, в конец файла добавить:

```js
test('итог удаления: всё удалено — null; с бронями — номер и число броней', () => {
  assert.equal(archiveSummary({ archived: [{ id: 'a', number: '101' }], blocked: [] }), null);
  assert.equal(
    archiveSummary({
      archived: Array.from({ length: 38 }, (_, i) => ({ id: `r${i}`, number: String(i) })),
      blocked: [
        { id: 'x', number: '105', liveReservations: 2 },
        { id: 'y', number: '112', liveReservations: 1 },
      ],
    }),
    'Удалено 38 из 40. Не удалены: №105 — 2 действующие брони, №112 — 1 действующая бронь. Перенесите брони на другие номера и удалите их.',
  );
  assert.equal(
    archiveSummary({ archived: [], blocked: [{ id: 'x', number: '105', liveReservations: 5 }] }),
    'Ничего не удалено. Не удалён: №105 — 5 действующих броней. Перенесите брони на другие номера и удалите его.',
  );
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd /c/dev/Kars-hotel/frontend && npm test`
Expected: FAIL — `archiveSummary` не экспортируется.

- [ ] **Step 3: Реализация**

В конец `room-range.js` добавить:

```js
/**
 * Итог удаления пачкой; null — удалено всё, режим выбора можно закрыть.
 * Номер с действующей бронью назван с числом броней: переносить их придётся
 * руками, и человеку нужно знать, сколько.
 */
export function archiveSummary({ archived = [], blocked = [] }) {
  if (!blocked.length) return null;
  const total = archived.length + blocked.length;
  const head = archived.length ? `Удалено ${archived.length} из ${total}.` : 'Ничего не удалено.';
  const list = blocked
    .map(
      (r) =>
        `№${r.number} — ${r.liveReservations} ${plural(
          r.liveReservations,
          'действующая бронь',
          'действующие брони',
          'действующих броней',
        )}`,
    )
    .join(', ');
  const one = blocked.length === 1;
  return `${head} ${one ? 'Не удалён' : 'Не удалены'}: ${list}. Перенесите брони на другие номера и удалите ${one ? 'его' : 'их'}.`;
}
```

- [ ] **Step 4: Тест проходит**

Run: `cd /c/dev/Kars-hotel/frontend && npm test`
Expected: PASS.

- [ ] **Step 5: Запрос и хук**

В конец `frontend/src/api/rooms.js` добавить:

```js
/* Удаление «в архив» пачкой (28.10.2026). Ответ по каждому номеру:
   archived (удалены), blocked (есть действующие брони), notFound. */
export async function archiveRooms(ids) {
  const { data } = await api.post('/rooms/archive-many', { ids });
  return data;
}
```

В `frontend/src/hooks/api/useRooms.js` сразу после `useArchiveRoom` добавить:

```js
export function useArchiveRooms() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.archiveRooms,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY });
      qc.invalidateQueries({ queryKey: ['roomTypes'] });
    },
  });
}
```

---

### Task 7: фронт — хук выбора и нижняя строка

**Files:**
- Create: `frontend/src/Components/HotelPMS/components/Rooms/useRoomSelection.js`
- Create: `frontend/src/Components/HotelPMS/components/Rooms/SelectionBar.jsx`
- Modify: `frontend/src/Components/HotelPMS/components/Rooms/Rooms.module.css`

- [ ] **Step 1: Хук выбора**

Создать `useRoomSelection.js`:

```js
import { useCallback, useState } from 'react';

/* Выбор номеров для удаления пачкой (28.10.2026). Набор id — как выбор
   гостиниц в админ-панели (AdminPanel.jsx, FeaturesSection). */
export function useRoomSelection() {
  const [active, setActive] = useState(false);
  const [selected, setSelected] = useState(() => new Set());

  const start = useCallback(() => setActive(true), []);

  const stop = useCallback(() => {
    setActive(false);
    setSelected(new Set());
  }, []);

  const toggle = useCallback((id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /** Отметить (on=true) или снять (on=false) сразу несколько: категорию, итог удаления. */
  const setMany = useCallback((ids, on) => {
    setSelected((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
      return next;
    });
  }, []);

  return { active, selected, start, stop, toggle, setMany };
}
```

- [ ] **Step 2: Нижняя строка**

Создать `SelectionBar.jsx`:

```jsx
import classes from './Rooms.module.css';
import formClasses from '../../shared/Form.module.css';

/* Нижняя строка режима выбора (28.10.2026): сколько отмечено, удалить, выйти.
   Под ней — итог прошлого удаления, если что-то не удалилось: номера с
   бронями остаются отмеченными, и итог объясняет почему. */
export default function SelectionBar({ count, result, onDelete, onCancel }) {
  return (
    <div className={classes.selectionBar}>
      <div className={classes.selectionRow}>
        <span className={classes.selectionCount}>Выбрано: {count}</span>
        <div className={classes.headerActions}>
          <button type="button" className={classes.btnGhost} onClick={onCancel}>
            Отмена
          </button>
          <button type="button" className={formClasses.btnDanger} onClick={onDelete} disabled={count === 0}>
            Удалить выбранные
          </button>
        </div>
      </div>
      {result && <div className={formClasses.notice}>{result}</div>}
    </div>
  );
}
```

- [ ] **Step 3: Стили**

В `Rooms.module.css` перед блоком `/* ── Удалённые номера (архив, 25.10.2026) …` вставить:

```css
/* ── Выбор номеров для удаления пачкой (28.10.2026) ──────────────────────
   Галочка — в правом верхнем углу карточки; номеру оставлено место, чтобы
   длинный номер-адрес не уходил под неё. */
.roomCardSelecting .roomNumber { padding-right: 22px; }

.roomCardSelected {
  border-color: #1E88E5;
  box-shadow: 0 0 0 1px #1E88E5;
  background: #F5FAFF;
}

.roomCheck {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: #1E88E5;
  cursor: pointer;
}

.catSelect {
  background: transparent;
  border: none;
  padding: 0;
  color: #1E88E5;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
}

.selectionBar {
  position: sticky;
  bottom: 0;
  z-index: 5;
  margin-top: 16px;
  padding: 12px 16px;
  background: #fff;
  border: 1px solid #E5E7EB;
  border-radius: 10px;
  box-shadow: 0 -4px 12px rgba(15, 31, 63, 0.06);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.selectionRow {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.selectionCount {
  font-size: 14px;
  font-weight: 600;
  color: #0F1F3F;
}
```

---

### Task 8: фронт — режим выбора в `Rooms.jsx`

**Files:**
- Modify: `frontend/src/Components/HotelPMS/components/Rooms/Rooms.jsx`

- [ ] **Step 1: Импорты, хуки, состояние**

После `import ConfirmDialog from '../../shared/ConfirmDialog';` добавить:

```js
import SelectionBar from './SelectionBar';
import { useRoomSelection } from './useRoomSelection';
import { archiveSummary, numberList, plural } from './room-range';
```

В импорт из `'../../../../hooks/api/useRooms'` добавить `useArchiveRooms`.

После `const restoreRoom = useRestoreRoom();` добавить:

```js
  const archiveRooms = useArchiveRooms();
  const selection = useRoomSelection();
  const [archiveResult, setArchiveResult] = useState(null);
```

После `const rooms = roomsQ.data ?? [];` добавить:

```js
  /* Считаем только номера, видимые в фонде: удалённый в другой вкладке из
     выбора выпадает сам. */
  const selectedRooms = rooms.filter((r) => selection.selected.has(r.id));
  const stopSelection = () => {
    selection.stop();
    setArchiveResult(null);
  };

  /* Удаление пачкой: удалённые и пропавшие снимаются с выбора, номера с
     бронями остаются отмеченными — их удаляют снова после переноса броней. */
  const archiveSelected = async (targets) => {
    const res = await archiveRooms.mutateAsync(targets.map((r) => r.id));
    selection.setMany([...res.archived.map((r) => r.id), ...res.notFound], false);
    const summary = archiveSummary(res);
    if (summary) setArchiveResult(summary);
    else stopSelection();
  };
```

- [ ] **Step 2: Шапка страницы**

Содержимое `<div className={classes.headerActions}>` в основной сетке (не в заставке «пусто») заменить на:

```jsx
          {selection.active ? (
            <button type="button" className={classes.btnGhost} onClick={stopSelection}>
              Отменить выбор
            </button>
          ) : (
            <>
              {rooms.length > 0 && (
                <button type="button" className={classes.btnGhost} onClick={selection.start}>
                  Выбрать
                </button>
              )}
              {/* прежние кнопки «Категория» и «Добавить номер» — без изменений */}
            </>
          )}
```

Комментарий-заглушку `{/* прежние кнопки … */}` заменить двумя существующими кнопками `Категория` и `Добавить номер`, перенесёнными как есть.

- [ ] **Step 3: Шапка категории**

Внутри `roomTypes.map((cat) => { … })` после `const readyCount = …;` добавить:

```js
        const catIds = catRooms.map((r) => r.id);
        const allCatSelected = catIds.length > 0 && catIds.every((id) => selection.selected.has(id));
```

В `<div className={classes.catRight}>` оставить `catPrice` как есть, а две кнопки (`Изменить категорию`, `Удалить категорию`) обернуть так:

```jsx
                {selection.active ? (
                  catIds.length > 0 && (
                    <button
                      type="button"
                      className={classes.catSelect}
                      onClick={() => selection.setMany(catIds, !allCatSelected)}
                    >
                      {allCatSelected ? 'Снять все' : 'Выбрать все в категории'}
                    </button>
                  )
                ) : (
                  <>
                    {/* прежние кнопки «Изменить категорию» и «Удалить категорию» — без изменений */}
                  </>
                )}
```

Комментарий-заглушку заменить двумя существующими `<button … className={classes.iconBtn}>`, перенесёнными как есть.

- [ ] **Step 4: Карточка номера**

В `catRooms.map((room) => { … })` после `const cfg = …;` добавить:

```js
                const isSelected = selection.selected.has(room.id);
```

Открывающий `<div key={room.id} className={classes.roomCard} onClick={…}>` заменить на:

```jsx
                  <div
                    key={room.id}
                    className={[
                      classes.roomCard,
                      selection.active && classes.roomCardSelecting,
                      isSelected && classes.roomCardSelected,
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() =>
                      selection.active
                        ? selection.toggle(room.id)
                        : setRoomModal({ open: true, editing: room, defaultRoomTypeId: undefined })
                    }
                  >
                    {/* Настоящая галочка, а не нарисованная: её состояние пишет
                        журнал действий (lib/journal.js), а клавиатура до неё
                        дотягивается. */}
                    {selection.active && (
                      <input
                        type="checkbox"
                        className={classes.roomCheck}
                        checked={isSelected}
                        onChange={() => selection.toggle(room.id)}
                        onClick={(e) => e.stopPropagation()}
                        aria-label={`№${room.number}`}
                      />
                    )}
```

У значка уборки (`<div className={classes.hkBadge} …>`) заменить `onClick` и `title`:

```jsx
                      onClick={selection.active ? undefined : (e) => openHkMenu(e, room.id)}
                      title={selection.active ? undefined : 'Изменить статус уборки'}
```

Кнопку `addRoomCard` («+» в сетке) обернуть в `{!selection.active && ( … )}`.

- [ ] **Step 5: Нижняя строка**

Сразу после закрывающего `})}` цикла `roomTypes.map` (перед комментарием `{/* ── status dropdown …`) вставить:

```jsx
      {selection.active && (
        <SelectionBar
          count={selectedRooms.length}
          result={archiveResult}
          onCancel={stopSelection}
          onDelete={() => setConfirm({ type: 'rooms', target: selectedRooms })}
        />
      )}
```

- [ ] **Step 6: Подтверждение пачки**

Комментарий у `useState(null)` для `confirm` заменить на `// { type: 'room'|'roomType'|'rooms', target, name }`.

`<ConfirmDialog …>` заменить целиком:

```jsx
      <ConfirmDialog
        open={!!confirm}
        title={confirmTitle(confirm)}
        message={confirmMessage(confirm)}
        confirmLabel="Удалить"
        danger
        onClose={() => setConfirm(null)}
        onConfirm={async () => {
          if (confirm?.type === 'roomType') await deleteRT.mutateAsync(confirm.target.id);
          else if (confirm?.type === 'room') await archiveRoom.mutateAsync(confirm.target.id);
          else if (confirm?.type === 'rooms') await archiveSelected(confirm.target);
        }}
      />
```

Перед `export default Rooms;` добавить (тексты категории и одного номера — прежние, перенесены дословно):

```js
/* Тексты подтверждения удаления: категория, один номер, пачка номеров. */
function confirmTitle(confirm) {
  if (confirm?.type === 'roomType') return 'Удалить категорию?';
  if (confirm?.type === 'rooms') {
    const n = confirm.target.length;
    return `Удалить ${n} ${plural(n, 'номер', 'номера', 'номеров')}?`;
  }
  return 'Удалить номер?';
}

function confirmMessage(confirm) {
  if (confirm?.type === 'roomType') {
    return `Категория «${confirm?.name}» пропадёт из номерного фонда и продажи. Если в ней есть номера — удаление не пройдёт (удалённые номера не мешают). Восстановите любой её номер из «Удалённых номеров» — категория вернётся вместе с ним.`;
  }
  if (confirm?.type === 'rooms') {
    const one = confirm.target.length === 1;
    const list = numberList(confirm.target.map((r) => r.number));
    return one
      ? `${list} пропадёт из номерного фонда, шахматки и продажи. Брони и история сохранятся — номер можно восстановить в разделе «Удалённые номера» внизу страницы. Номер с действующими бронями не удалится — после удаления назовём его.`
      : `${list} пропадут из номерного фонда, шахматки и продажи. Брони и история сохранятся — номера можно восстановить в разделе «Удалённые номера» внизу страницы. Номера с действующими бронями не удалятся — после удаления назовём их.`;
  }
  return `Номер №${confirm?.name} пропадёт из номерного фонда, шахматки и продажи. Брони и история сохранятся — номер можно восстановить в разделе «Удалённые номера» внизу страницы. Номер с действующими бронями удалить нельзя: сначала перенесите их на другой номер.`;
}
```

Перед заменой сверить прежние тексты категории и номера с текущим `Rooms.jsx` — они должны совпасть символ в символ.

- [ ] **Step 7: Проверки**

Run:
```bash
cd /c/dev/Kars-hotel/frontend && npm run lint && npm test && npm run build
```
Expected: lint без предупреждений, тесты PASS, сборка без ошибок.

Run:
```bash
cd /c/dev/Kars-hotel/frontend && grep -c "selection.active" src/Components/HotelPMS/components/Rooms/Rooms.jsx
```
Expected: не меньше 7 (шапка, категория, карточка ×3, «+», нижняя строка).

- [ ] **Step 8: Коммит «удаление пачкой»**

```bash
cd /c/dev/Kars-hotel && git add backend/src/modules/rooms/dto/archive-many-rooms.dto.ts backend/src/modules/rooms/rooms.service.ts backend/src/modules/rooms/rooms.controller.ts backend/src/modules/rooms/room-archive-many.spec.ts frontend/src/Components/HotelPMS/components/Rooms/room-range.js frontend/src/Components/HotelPMS/components/Rooms/room-range.test.mjs frontend/src/api/rooms.js frontend/src/hooks/api/useRooms.js frontend/src/Components/HotelPMS/components/Rooms/useRoomSelection.js frontend/src/Components/HotelPMS/components/Rooms/SelectionBar.jsx frontend/src/Components/HotelPMS/components/Rooms/Rooms.module.css frontend/src/Components/HotelPMS/components/Rooms/Rooms.jsx
git commit -F - -- backend/src/modules/rooms/dto/archive-many-rooms.dto.ts backend/src/modules/rooms/rooms.service.ts backend/src/modules/rooms/rooms.controller.ts backend/src/modules/rooms/room-archive-many.spec.ts frontend/src/Components/HotelPMS/components/Rooms/room-range.js frontend/src/Components/HotelPMS/components/Rooms/room-range.test.mjs frontend/src/api/rooms.js frontend/src/hooks/api/useRooms.js frontend/src/Components/HotelPMS/components/Rooms/useRoomSelection.js frontend/src/Components/HotelPMS/components/Rooms/SelectionBar.jsx frontend/src/Components/HotelPMS/components/Rooms/Rooms.module.css frontend/src/Components/HotelPMS/components/Rooms/Rooms.jsx <<'EOF'
feat(rooms): delete several rooms at once from the room grid

A "Select" mode on the room grid: tick rooms or a whole category, then
delete them in one go. Deletion archives, like the single delete. The
new POST /rooms/archive-many archives what it can in one transaction,
names rooms with live bookings and keeps them ticked, and writes one
audit entry per batch so the hotel history seen by the operator is not
flooded.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Task 9: итоговая проверка

- [ ] **Step 1: Бэкенд целиком**

Run: `cd /c/dev/Kars-hotel/backend && npx jest && npm run build`
Expected: все спеки PASS, сборка без ошибок.

- [ ] **Step 2: Фронт целиком**

Run: `cd /c/dev/Kars-hotel/frontend && npm run lint && npm test && npm run build`
Expected: всё зелёное.

- [ ] **Step 3: Чистое дерево и история**

Run: `cd /c/dev/Kars-hotel && git status --short && git log --oneline main..HEAD`
Expected: пустой статус; три коммита — спека, «add rooms in bulk», «delete several rooms at once».

- [ ] **Step 4: Передать владельцу на стенд** — что смотреть:
  - «Добавить номер» → «Несколько», «С 101, 40 штук»: предпросмотр, создание, итог с пропусками (заранее удалить один номер из диапазона и завести один вручную);
  - «Выбрать» → отметить категорию, удалить; номер с действующей бронью остаётся отмеченным, итог называет его; в «Удалённых номерах» появились остальные;
  - журнал гостиницы: одна запись на пачку, а не по одной на номер.
