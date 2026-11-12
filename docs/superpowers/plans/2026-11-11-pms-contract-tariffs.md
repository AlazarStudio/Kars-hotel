# Корпоративный тариф ПМС из реестра договоров Авии — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Корпоративный тариф ПМС берёт цены из реестра договоров Авии, а
гостиница видит договоры даже без ценового приложения.

**Architecture:** Авиа дополняет существующую синхронизацию зеркала списком
договоров; ПМС хранит его в `partner_contract` и считает цену
корпоративного тарифа из уже приезжающих сеток `partner_contract_price.fill`
на лету — своих строк цен у такого тарифа нет.

**Tech Stack:** NestJS 10 + Prisma 5 (ПМС, `backend/`), Vite + React 18 (ПМС,
`frontend/`), NestJS 11 + Prisma 7 (Авиа, `apps/core-api`,
`libs/identity`).

Спека: [2026-11-11-pms-contract-tariffs-design.md](../specs/2026-11-11-pms-contract-tariffs-design.md).

## Правила работы с планом

- Ветки не переключать: ПМС — `codex/mussa` в `C:/dev/Kars-hotel`, Авиа —
  `codex/mussa` в `C:/dev/kars-avia-v3`.
- **Коммит — только по прямому слову Мусы.** Шаги «Коммит» в плане — заготовка
  команды с явным списком путей; выполнять её после слова.
- **Миграцию к базе применять только по слову Мусы.** `prisma generate` и сборка
  миграцию не применяют.
- Сервисы не запускать, браузер не открывать, в Авии не трогать
  `next-env.d.ts` и `docker-compose.dev.yml` в ПМС.
- Порядок выпуска: сперва ПМС, потом Авиа (у ПМС `forbidNonWhitelisted` — новое
  поле в старом ПМС дало бы 400 на всей синхронизации).

## Карта файлов

| Файл | Действие | Зачем |
| --- | --- | --- |
| `backend/prisma/schema.prisma` | изменить | модель `PartnerContract` и обратные связи |
| `backend/prisma/migrations/20261111120000_partner_contract/migration.sql` | создать | таблица `partner_contract` + RLS |
| `backend/src/modules/connectivity/dto/connect-contract-prices.dto.ts` | изменить | `ConnectContractSummaryDto`, поле `contracts` |
| `backend/src/modules/connectivity/contract-registry.ts` | создать | чистое преобразование присланного списка в строки |
| `backend/src/modules/connectivity/contract-registry.spec.ts` | создать | тест преобразования |
| `backend/src/modules/connectivity/connectivity.service.ts` | изменить | приём `contracts` в синхронизации |
| `backend/src/modules/connectivity/connectivity.controller.ts` | изменить | передать `dto.contracts` |
| `backend/src/modules/contracts/contract-price.ts` | создать | правило «цена договора на ночь» |
| `backend/src/modules/contracts/contract-price.spec.ts` | создать | тесты правила |
| `backend/src/modules/contracts/contract-list.ts` | создать | слияние «реестр ∪ приложения» |
| `backend/src/modules/contracts/contract-list.spec.ts` | создать | тесты слияния |
| `backend/src/modules/contracts/contracts.service.ts` | создать | чтение документов, срез тарифа, цена |
| `backend/src/modules/contracts/contracts.controller.ts` | создать | `GET /contracts` |
| `backend/src/modules/contracts/contracts.module.ts` | создать | модуль |
| `backend/src/app.module.ts` | изменить | регистрация модуля |
| `backend/src/modules/inventory/availability.service.ts` | изменить | цена корпоративного тарифа в `priceByPlan` |
| `backend/src/modules/pricing/pricing.service.ts` | изменить | цена корпоративного тарифа в `quote` |
| `backend/src/modules/rate-plans/operator-tariff-status.ts` | изменить | `applies` = есть цена договора |
| `backend/src/modules/rate-plans/operator-tariff-status.spec.ts` | изменить | новые правила статуса |
| `backend/src/modules/rate-plans/rate-plans.service.ts` | изменить | `withOperatorStatus`, цены договора для экрана |
| `backend/src/modules/rate-plans/rate-plans.controller.ts` | изменить | `GET /rate-plans/:id/contract-prices` |
| `libs/identity/src/lib/management/contract-price-mirror.service.ts` (Авиа) | изменить | список договоров в наборе |
| `libs/identity/src/lib/management/contract-price-mirror.spec.ts` (Авиа) | изменить | тест списка |
| `libs/hotel-contract/src/lib/client.ts` (Авиа) | изменить | тип `ContractSummaryPush` |
| `apps/core-api/src/app/hotel/kars-hotel-pms.client.ts` (Авиа) | изменить | отправка `contracts` |
| `frontend/src/api/contracts.js` | создать | клиент двух ручек |
| `frontend/src/hooks/api/useContracts.js` | создать | хуки |
| `frontend/src/Components/HotelPMS/components/Tariffs/ContractPricesTab.jsx` | создать | подтаб «Цены договора» |
| `frontend/src/Components/HotelPMS/components/Tariffs/ContractCalendar.jsx` | создать | подтаб «Календарь» договора |
| `frontend/src/Components/HotelPMS/components/Tariffs/Tariffs.jsx` | изменить | плашки нет, мастер, панель тарифа, блок договоров |
| `frontend/src/Components/HotelPMS/components/Tariffs/Tariffs.module.css` | изменить | стили новых блоков |
| `frontend/src/Components/HotelPMS/components/Tariffs/corporateTariff.js` | изменить | убрать раскладку цен |

---

## Фаза 1. ПМС: приём реестра договоров

### Task 1: Таблица `partner_contract`

**Files:**
- Modify: `backend/prisma/schema.prisma` (модель `PartnerContract` после
  `PartnerContractPrice` на строке 357; обратные связи на строках 125 и 480)
- Create: `backend/prisma/migrations/20261111120000_partner_contract/migration.sql`

- [ ] **Step 1: Модель Prisma**

После `model PartnerContractPrice { … }` (строка 357) вставить:

```prisma
/// Договор оператора со списком приложений — реестр Авии (11.11.2026).
///
/// До этого гостиница знала о договоре только по приложению с ценами: у
/// «Апартаментов сети Карс Авиа» 27 договоров и ни одного приложения, и в
/// кабинете было пусто. Теперь договор живёт сам по себе, а приложение к нему —
/// отдельная строка `partner_contract_price`.
model PartnerContract {
  id          String    @id @default(uuid()) @db.Uuid
  tenantId    String    @map("tenant_id") @db.Uuid
  tenant      Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  /// Чей реестр: синхронизация партнёра трогает только свои договоры.
  partnerId   String    @map("partner_id") @db.Uuid
  partner     Partner   @relation(fields: [partnerId], references: [id], onDelete: Cascade)
  /// Номер договора — тот же, что в документах цен (`hotelContract.number`).
  number      String
  /// Юрлицо партнёра, подписавшее договор, — снимок кода и названия.
  accountCode String?   @map("account_code")
  accountName String?   @map("account_name")
  /// Срок договора, как в реестре.
  validFrom   DateTime? @map("valid_from")
  validTo     DateTime? @map("valid_to")
  /// Рабочий договор гостиницы (у Авии `isPrimary`).
  isPrimary   Boolean   @default(false) @map("is_primary")
  /// ACTIVE | ARCHIVED: скрытые не присылаются вовсе.
  state       String    @default("ACTIVE")
  /// Какие услуги есть по договору: ACCOMMODATION, MEAL.
  services    String[]
  /// Сколько приложений пришло в наборе; 0 — цен нет.
  sheetsCount Int       @default(0) @map("sheets_count")
  receivedAt  DateTime  @default(now()) @map("received_at")

  @@unique([tenantId, partnerId, number], map: "partner_contract_key")
  @@index([tenantId])
  @@map("partner_contract")
}
```

- [ ] **Step 2: Обратные связи**

В `model Tenant` рядом с `contractPrices  PartnerContractPrice[]`
(строка 125) добавить:

```prisma
  contracts       PartnerContract[]
```

В `model Partner` рядом с `contractPrices PartnerContractPrice[]`
(строка 480) добавить:

```prisma
  contracts       PartnerContract[]
```

- [ ] **Step 3: Миграция руками**

Создать `backend/prisma/migrations/20261111120000_partner_contract/migration.sql`:

```sql
-- 11.11.2026 · Реестр договоров оператора: договор существует и тогда, когда
-- ценового приложения к нему ещё нет.
--
-- До этого гостиница знала о договоре только по приложению: у «Апартаментов
-- сети Карс Авиа» 27 договоров и ни одного приложения — в кабинете пусто, и
-- завести тариф не с чем. Список приходит набором в той же синхронизации, что
-- и цены: присланное заменяет прежнее, чего в наборе нет — того нет.
CREATE TABLE "partner_contract" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id"    UUID NOT NULL REFERENCES "tenant"("id") ON DELETE CASCADE,
  "partner_id"   UUID NOT NULL REFERENCES "partner"("id") ON DELETE CASCADE,
  "number"       TEXT NOT NULL,
  "account_code" TEXT,
  "account_name" TEXT,
  "valid_from"   TIMESTAMP(3),
  "valid_to"     TIMESTAMP(3),
  "is_primary"   BOOLEAN NOT NULL DEFAULT false,
  "state"        TEXT NOT NULL DEFAULT 'ACTIVE',
  "services"     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "sheets_count" INTEGER NOT NULL DEFAULT 0,
  "received_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "partner_contract_key"
  ON "partner_contract" ("tenant_id", "partner_id", "number");
CREATE INDEX "partner_contract_tenant_idx" ON "partner_contract" ("tenant_id");

-- Изоляция арендаторов — как у цен: договор с оператором у каждой гостиницы
-- свой, и подглядывать в чужой она не должна.
ALTER TABLE "partner_contract" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "partner_contract" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "partner_contract";
CREATE POLICY tenant_isolation ON "partner_contract"
  AS PERMISSIVE FOR ALL
  TO app_user
  USING (
    tenant_id IS NOT NULL
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  )
  WITH CHECK (
    tenant_id IS NOT NULL
    AND tenant_id = current_setting('app.tenant_id', true)::uuid
  );
```

- [ ] **Step 4: Клиент Prisma и сборка**

```bash
cd C:/dev/Kars-hotel/backend
pnpm exec prisma generate
pnpm run build
```
Ожидается: `Generated Prisma Client` и успешная сборка `nest build`.
База не меняется — миграция только написана.

- [ ] **Step 5: Коммит (по слову Мусы)**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/20261111120000_partner_contract/migration.sql
git commit -m "feat(pms): partner contract registry table"
```

---

### Task 2: Синхронизация принимает `contracts`

**Files:**
- Modify: `backend/src/modules/connectivity/dto/connect-contract-prices.dto.ts:264-270`
- Create: `backend/src/modules/connectivity/contract-registry.ts`
- Create: `backend/src/modules/connectivity/contract-registry.spec.ts`
- Modify: `backend/src/modules/connectivity/connectivity.service.ts:1118-1175`
- Modify: `backend/src/modules/connectivity/connectivity.controller.ts:343-349`

- [ ] **Step 1: Написать падающий тест преобразования**

`backend/src/modules/connectivity/contract-registry.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { contractRows } from './contract-registry';

/* Реестр договоров: что гостиница увидит и что отклонится.
 *
 * Договор без приложения — обычное дело (у «Апартаментов» 27 таких), поэтому
 * проверяется не «отправилось», а как список лёг в строки: номера уникальны,
 * сроки и юрлицо — снимком, пустой номер — ошибка, а не тихая строка. */

const ONE = {
  number: '205',
  account: { code: 'ani', name: 'Ани Групп Аэро' },
  signedAt: '2025-11-10T00:00:00.000Z',
  expiresAt: null,
  isPrimary: true,
  state: 'ACTIVE' as const,
  services: ['ACCOMMODATION' as const],
  sheets: 1,
};

describe('contractRows — присланный реестр в строки таблицы', () => {
  it('снимает номер и юрлицо, сроки переводит в даты', () => {
    const [row] = contractRows([ONE], 't1', 'p1');
    expect(row).toMatchObject({
      tenantId: 't1',
      partnerId: 'p1',
      number: '205',
      accountCode: 'ani',
      accountName: 'Ани Групп Аэро',
      isPrimary: true,
      state: 'ACTIVE',
      services: ['ACCOMMODATION'],
      sheetsCount: 1,
    });
    expect(row.validFrom).toEqual(new Date('2025-11-10T00:00:00.000Z'));
    expect(row.validTo).toBeNull();
  });

  it('договор без цен — законная строка', () => {
    const [row] = contractRows([{ ...ONE, sheets: 0, services: [] }], 't1', 'p1');
    expect(row.sheetsCount).toBe(0);
    expect(row.services).toEqual([]);
  });

  it('пустой номер — отказ, а не строка без имени', () => {
    expect(() => contractRows([{ ...ONE, number: '  ' }], 't1', 'p1')).toThrow(
      BadRequestException,
    );
  });

  it('один номер дважды — отказ: ключ таблицы уникален', () => {
    expect(() => contractRows([ONE, ONE], 't1', 'p1')).toThrow(BadRequestException);
  });

  it('пустой набор — пустой результат, а не отказ', () => {
    expect(contractRows([], 't1', 'p1')).toEqual([]);
  });
});
```

- [ ] **Step 2: Прогнать — должен упасть**

```bash
cd C:/dev/Kars-hotel/backend
pnpm exec jest src/modules/connectivity/contract-registry.spec.ts
```
Ожидается: FAIL — `Cannot find module './contract-registry'`.

- [ ] **Step 3: Написать преобразование**

`backend/src/modules/connectivity/contract-registry.ts`:

```ts
import { BadRequestException } from '@nestjs/common';

/* РЕЕСТР ДОГОВОРОВ В СТРОКИ ТАБЛИЦЫ (11.11.2026).
 *
 * Партнёр присылает договоры набором, как и цены. Строка здесь — только
 * снимок для показа и ключ, по которому тариф находит документы; правок нет.
 * Пустой номер и повтор номера отклоняются на входе: ключ таблицы уникален, и
 * упасть на нём транзакцией позже значит не сказать, что именно не так. */
export interface ContractSummaryInput {
  number: string;
  account?: { code: string; name: string } | null;
  signedAt?: string | null;
  expiresAt?: string | null;
  isPrimary: boolean;
  state: 'ACTIVE' | 'ARCHIVED';
  services: ('ACCOMMODATION' | 'MEAL')[];
  sheets: number;
}

export interface PartnerContractRow {
  tenantId: string;
  partnerId: string;
  number: string;
  accountCode: string | null;
  accountName: string | null;
  validFrom: Date | null;
  validTo: Date | null;
  isPrimary: boolean;
  state: string;
  services: string[];
  sheetsCount: number;
  receivedAt: Date;
}

export function contractRows(
  input: ContractSummaryInput[],
  tenantId: string,
  partnerId: string,
): PartnerContractRow[] {
  const seen = new Set<string>();
  const now = new Date();
  return input.map((c) => {
    const number = c.number.trim();
    if (!number) throw new BadRequestException('Номер договора пуст');
    if (seen.has(number)) {
      throw new BadRequestException(`Договор «${number}» в наборе дважды`);
    }
    seen.add(number);
    return {
      tenantId,
      partnerId,
      number,
      accountCode: c.account?.code?.trim() || null,
      accountName: c.account?.name?.trim() || null,
      validFrom: c.signedAt ? new Date(c.signedAt) : null,
      validTo: c.expiresAt ? new Date(c.expiresAt) : null,
      isPrimary: c.isPrimary,
      state: c.state,
      services: [...new Set(c.services)],
      sheetsCount: c.sheets,
      receivedAt: now,
    };
  });
}
```

- [ ] **Step 4: Прогнать — должен пройти**

```bash
cd C:/dev/Kars-hotel/backend
pnpm exec jest src/modules/connectivity/contract-registry.spec.ts
```
Ожидается: PASS, 5 тестов.

- [ ] **Step 5: DTO**

В `connect-contract-prices.dto.ts` перед классом
`ConnectContractPricesSyncDto` (строка 264) добавить:

```ts
/**
 * Договор реестра оператора — в том числе без ценового приложения.
 *
 * Гостиница должна видеть договор, даже если приложение к нему ещё не пришло:
 * у «Апартаментов сети Карс Авиа» 27 таких, и пустой кабинет читается как
 * «договоров нет». Скрытые договоры не присылаются вовсе; архивные — со
 * `state: 'ARCHIVED'`: он отработал, и по нему считались брони.
 */
export class ConnectContractSummaryDto {
  @ApiProperty({ example: '205' })
  @IsString()
  @Length(1, 120)
  number!: string;

  @ApiPropertyOptional({ type: ConnectDirectoryRefDto, description: 'Юрлицо Карс, подписавшее договор' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ConnectDirectoryRefDto)
  account?: ConnectDirectoryRefDto | null;

  @ApiPropertyOptional({ example: '2025-11-10T00:00:00.000Z' })
  @IsOptional()
  @IsISO8601()
  signedAt?: string | null;

  @ApiPropertyOptional({ example: null, description: 'null — бессрочно' })
  @IsOptional()
  @IsISO8601()
  expiresAt?: string | null;

  @ApiProperty({ example: false, description: 'Рабочий договор гостиницы' })
  @IsBoolean()
  isPrimary!: boolean;

  @ApiProperty({ enum: ['ACTIVE', 'ARCHIVED'] })
  @IsIn(['ACTIVE', 'ARCHIVED'])
  state!: 'ACTIVE' | 'ARCHIVED';

  @ApiProperty({ type: [String], enum: ['ACCOMMODATION', 'MEAL'] })
  @IsArray()
  @ArrayMaxSize(2)
  @IsIn(['ACCOMMODATION', 'MEAL'], { each: true })
  services!: ('ACCOMMODATION' | 'MEAL')[];

  @ApiProperty({ example: 3, description: 'Сколько приложений пришло; 0 — цен нет' })
  @IsInt()
  @Min(0)
  sheets!: number;
}
```

В `ConnectContractPricesSyncDto` после `documents`:

```ts
  /* Реестр договоров (11.11.2026). Поле НЕОБЯЗАТЕЛЬНОЕ: старая Авиа его не
     присылает, и тогда список договоров в ПМС не трогается — иначе первый же
     sync старой версией стёр бы реестр. */
  @ApiPropertyOptional({ type: [ConnectContractSummaryDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2000)
  @ValidateNested({ each: true })
  @Type(() => ConnectContractSummaryDto)
  contracts?: ConnectContractSummaryDto[];
```

В импорт из `class-validator` (строки 4-18) добавить `IsIn` уже есть — сверить,
что `IsBoolean`, `IsInt`, `Min`, `ArrayMaxSize` присутствуют (они есть).

- [ ] **Step 6: Сервис синхронизации**

В `connectivity.service.ts` заменить сигнатуру (строка 1118) и конец метода
(строки 1172-1174):

```ts
  async syncContractPrices(
    slug: string,
    documents: ConnectContractPricesDto[],
    partnerId: string,
    contracts?: ConnectContractSummaryDto[],
  ) {
```

и вместо

```ts
      return { kept: incoming.size, removed: stale.length };
```

```ts
      /* Реестр договоров — тем же набором и в одной транзакции с ценами: между
         удалением лишнего и записью нового кабинет не должен показывать
         полупустую картину. Поля нет (старая Авиа) — реестр не трогаем вовсе. */
      let contractsKept: number | null = null;
      if (contracts !== undefined) {
        const rows = contractRows(contracts, tenant.id, partnerId);
        await tx.partnerContract.deleteMany({ where: { tenantId: tenant.id, partnerId } });
        if (rows.length) await tx.partnerContract.createMany({ data: rows });
        contractsKept = rows.length;
      }

      return { kept: incoming.size, removed: stale.length, contracts: contractsKept };
```

В импорты сервиса добавить:

```ts
import { ConnectContractSummaryDto } from './dto/connect-contract-prices.dto';
import { contractRows } from './contract-registry';
```

- [ ] **Step 7: Контроллер**

`connectivity.controller.ts:348` — передать список:

```ts
    return this.connectivity.syncContractPrices(
      slug,
      dto.documents,
      req.partner!.partnerId,
      dto.contracts,
    );
```

- [ ] **Step 8: Сборка и тесты**

```bash
cd C:/dev/Kars-hotel/backend
pnpm run build
pnpm exec jest src/modules/connectivity/contract-registry.spec.ts
```
Ожидается: сборка без ошибок, тесты PASS.

- [ ] **Step 9: Коммит (по слову Мусы)**

```bash
git add backend/src/modules/connectivity/dto/connect-contract-prices.dto.ts backend/src/modules/connectivity/contract-registry.ts backend/src/modules/connectivity/contract-registry.spec.ts backend/src/modules/connectivity/connectivity.service.ts backend/src/modules/connectivity/connectivity.controller.ts
git commit -m "feat(pms): sync accepts the contract registry"
```

---

### Task 3: Список договоров для кабинета

**Files:**
- Create: `backend/src/modules/contracts/contract-list.ts`
- Create: `backend/src/modules/contracts/contract-list.spec.ts`
- Create: `backend/src/modules/contracts/contracts.service.ts` (пока только `list()`)
- Create: `backend/src/modules/contracts/contracts.controller.ts`
- Create: `backend/src/modules/contracts/contracts.module.ts`
- Modify: `backend/src/app.module.ts:32-33,65`

- [ ] **Step 1: Падающий тест слияния**

`backend/src/modules/contracts/contract-list.spec.ts`:

```ts
import { mergeContractList } from './contract-list';

/* «Реестр ∪ приложения»: гостиница не должна терять договор, о котором знает
 * только по ценам, и должна видеть договор, у которого цен ещё нет. */

const reg = (over: Record<string, unknown> = {}) => ({
  partnerId: 'p1',
  number: '205',
  accountCode: 'ani',
  accountName: 'Ани Групп Аэро',
  validFrom: new Date('2025-11-10T00:00:00.000Z'),
  validTo: null,
  isPrimary: true,
  state: 'ACTIVE',
  services: ['ACCOMMODATION'],
  sheetsCount: 1,
  receivedAt: new Date('2026-11-10T10:00:00.000Z'),
  ...over,
});

const doc = (over: Record<string, unknown> = {}) => ({
  partnerId: 'p1',
  contractNumber: '205',
  accountCode: 'ani',
  accountName: 'Ани Групп Аэро',
  service: 'ACCOMMODATION',
  receivedAt: new Date('2026-11-10T10:00:00.000Z'),
  ...over,
});

describe('mergeContractList', () => {
  it('договор без приложения виден: цен нет, но договор есть', () => {
    const [row] = mergeContractList([reg({ sheetsCount: 0 })], []);
    expect(row).toMatchObject({ number: '205', documents: 0, hasPrices: false });
    expect(row.services).toEqual(['ACCOMMODATION']);
  });

  it('договор, известный только по приложению, тоже виден (старая Авиа)', () => {
    const [row] = mergeContractList([], [doc()]);
    expect(row).toMatchObject({
      number: '205',
      documents: 1,
      hasPrices: true,
      state: 'ACTIVE',
      isPrimary: false,
    });
  });

  it('приложения обеих услуг считаются и складываются в набор услуг', () => {
    const [row] = mergeContractList(
      [reg({ services: [] })],
      [doc(), doc({ service: 'MEAL' }), doc({ service: 'ACCOMMODATION' })],
    );
    expect(row.documents).toBe(3);
    expect(row.services).toEqual(['ACCOMMODATION', 'MEAL']);
  });

  it('срок и юрлицо берутся из реестра, если приложение молчит', () => {
    const [row] = mergeContractList(
      [reg({ accountCode: null, accountName: null })],
      [doc({ accountCode: 'kars', accountName: 'Карс Авиа' })],
    );
    expect(row.account).toEqual({ code: 'kars', name: 'Карс Авиа' });
    expect(row.signedAt).toBe('2025-11-10T00:00:00.000Z');
  });

  it('порядок: рабочий договор выше, затем по номеру', () => {
    const rows = mergeContractList(
      [reg({ number: '100', isPrimary: false }), reg({ number: '205', isPrimary: true })],
      [],
    );
    expect(rows.map((r) => r.number)).toEqual(['205', '100']);
  });
});
```

- [ ] **Step 2: Прогнать — упадёт**

```bash
cd C:/dev/Kars-hotel/backend
pnpm exec jest src/modules/contracts/contract-list.spec.ts
```
Ожидается: FAIL — модуля нет.

- [ ] **Step 3: Написать слияние**

`backend/src/modules/contracts/contract-list.ts`:

```ts
/* ДОГОВОРЫ ГОСТИНИЦЫ ДЛЯ КАБИНЕТА (11.11.2026).
 *
 * Два источника: реестр (пришёл списком от партнёра) и приложения с ценами
 * (приходили и раньше). Ни один не главнее: у старой Авии реестра нет вовсе,
 * а у нового договора может не быть приложения. Терять договор из-за того,
 * что о нём знает только один источник, гостиница не должна — по этой
 * строке она заводит тариф. */
export interface RegistryContractRow {
  partnerId: string;
  number: string;
  accountCode: string | null;
  accountName: string | null;
  validFrom: Date | null;
  validTo: Date | null;
  isPrimary: boolean;
  state: string;
  services: string[];
  sheetsCount: number;
  receivedAt: Date;
}

export interface ContractPriceDocRow {
  partnerId: string;
  contractNumber: string;
  accountCode: string | null;
  accountName: string | null;
  service: string;
  receivedAt: Date;
}

export interface ContractView {
  partnerId: string;
  number: string;
  account: { code: string; name: string } | null;
  signedAt: string | null;
  expiresAt: string | null;
  isPrimary: boolean;
  state: string;
  services: string[];
  /** Сколько приложений в зеркале. */
  documents: number;
  /** Есть ли цены: без них тариф заводится, но не работает. */
  hasPrices: boolean;
  receivedAt: string | null;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function mergeContractList(
  registry: RegistryContractRow[],
  docs: ContractPriceDocRow[],
): ContractView[] {
  const map = new Map<string, ContractView>();
  const key = (partnerId: string, number: string) => `${partnerId}|${number}`;

  for (const r of registry) {
    map.set(key(r.partnerId, r.number), {
      partnerId: r.partnerId,
      number: r.number,
      account: r.accountCode
        ? { code: r.accountCode, name: r.accountName ?? r.accountCode }
        : null,
      signedAt: iso(r.validFrom),
      expiresAt: iso(r.validTo),
      isPrimary: r.isPrimary,
      state: r.state,
      services: [...r.services],
      documents: 0,
      hasPrices: false,
      receivedAt: null,
    });
  }

  for (const d of docs) {
    const k = key(d.partnerId, d.contractNumber);
    const row =
      map.get(k) ??
      {
        partnerId: d.partnerId,
        number: d.contractNumber,
        account: null,
        signedAt: null,
        expiresAt: null,
        isPrimary: false,
        state: 'ACTIVE',
        services: [],
        documents: 0,
        hasPrices: false,
        receivedAt: null,
      };
    row.documents += 1;
    row.hasPrices = true;
    if (!row.services.includes(d.service)) row.services.push(d.service);
    if (!row.account && d.accountCode) {
      row.account = { code: d.accountCode, name: d.accountName ?? d.accountCode };
    }
    const at = d.receivedAt.toISOString();
    if (!row.receivedAt || at > row.receivedAt) row.receivedAt = at;
    map.set(k, row);
  }

  return [...map.values()]
    .map((r) => ({ ...r, services: [...r.services].sort() }))
    .sort(
      (a, b) =>
        Number(b.isPrimary) - Number(a.isPrimary) ||
        a.number.localeCompare(b.number, 'ru', { numeric: true }),
    );
}
```

- [ ] **Step 4: Прогнать — пройдёт**

```bash
cd C:/dev/Kars-hotel/backend
pnpm exec jest src/modules/contracts/contract-list.spec.ts
```
Ожидается: PASS, 5 тестов.

- [ ] **Step 5: Сервис, контроллер, модуль**

`backend/src/modules/contracts/contracts.service.ts` (пока только список; цена
появится в Task 5-6):

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { mergeContractList } from './contract-list';

/**
 * Договоры партнёров у этой гостиницы: реестр и приложения в одном списке.
 * Только чтение — договор ведётся в реестре Авии, здесь его снимок.
 */
@Injectable()
export class ContractsService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const [registry, docs] = await this.prisma.forTenant((tx) =>
      Promise.all([
        tx.partnerContract.findMany(),
        tx.partnerContractPrice.findMany({
          select: {
            partnerId: true,
            contractNumber: true,
            accountCode: true,
            accountName: true,
            service: true,
            receivedAt: true,
          },
        }),
      ]),
    );
    return mergeContractList(registry, docs);
  }
}
```

`backend/src/modules/contracts/contracts.controller.ts`:

```ts
import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ContractsService } from './contracts.service';

/* Договоры партнёров. Читает тот же, кто читает тарифы: это их источник цен. */
@ApiTags('contracts')
@ApiBearerAuth()
@Controller('contracts')
export class ContractsController {
  constructor(private readonly service: ContractsService) {}

  @Get()
  @RequirePermissions('rate.read')
  @ApiOperation({ summary: 'Partners contracts of this hotel (registry and price applications)' })
  list() {
    return this.service.list();
  }
}
```

`backend/src/modules/contracts/contracts.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ContractsController } from './contracts.controller';
import { ContractsService } from './contracts.service';

@Module({
  controllers: [ContractsController],
  providers: [ContractsService],
  exports: [ContractsService],
})
export class ContractsModule {}
```

- [ ] **Step 6: Регистрация в приложении**

`app.module.ts`: импорт рядом с `RatePlansModule` (строка 19):

```ts
import { ContractsModule } from './modules/contracts/contracts.module';
```
и в `imports` после `RatePlansModule` (строка 52):

```ts
    ContractsModule,
```

- [ ] **Step 7: Сборка**

```bash
cd C:/dev/Kars-hotel/backend
pnpm run build
```
Ожидается: успешная сборка.

- [ ] **Step 8: Коммит (по слову Мусы)**

```bash
git add backend/src/modules/contracts backend/src/app.module.ts
git commit -m "feat(pms): contracts list for the hotel cabinet"
```

---

## Фаза 2. ПМС: цена из договора

### Task 4: Правило «цена договора на ночь»

**Files:**
- Create: `backend/src/modules/contracts/contract-price.ts`
- Create: `backend/src/modules/contracts/contract-price.spec.ts`

- [ ] **Step 1: Падающий тест правила**

`backend/src/modules/contracts/contract-price.spec.ts`:

```ts
import {
  ContractPriceDoc,
  TariffSlice,
  contractNightPrice,
  contractHasPriceOn,
  contractVatRate,
  contractNightPrices,
  contractNightRub,
} from './contract-price';

/* ПРАВИЛО ЦЕНЫ КОРПОРАТИВНОГО ТАРИФА (11.11.2026).
 *
 * Цена не считается в ПМС своим правилом: берутся готовые сетки Авии
 * (`fill` документа). Проверяется ровно то, на чём гостиницу посчитают:
 * срез, период ДС, число гостей и честное «нет цены». */

const slice = (over: Partial<TariffSlice> = {}): TariffSlice => ({
  partnerId: 'p1',
  contractNumber: '205',
  accountCode: 'ani',
  customerCode: null,
  guestKind: null,
  mealPlan: 'BB',
  ...over,
});

const doc = (over: Partial<ContractPriceDoc> = {}): ContractPriceDoc => ({
  partnerId: 'p1',
  contractNumber: '205',
  amendmentNumber: null,
  service: 'ACCOMMODATION',
  validFrom: '2025-11-10T00:00:00.000Z',
  validTo: null,
  vatRate: 20,
  accountCode: 'ani',
  fill: [
    {
      from: '2025-11-10',
      slices: [
        {
          customer: null,
          guestKind: null,
          mealPlan: 'BB',
          cells: [
            { categoryId: 'rt1', occupancy: 1, price: 300000 },
            { categoryId: 'rt1', occupancy: 2, price: 460000 },
          ],
        },
      ],
    },
  ],
  ...over,
});

describe('contractNightPrice', () => {
  it('берёт ячейку среза: категория и число гостей', () => {
    expect(contractNightPrice([doc()], slice(), 'rt1', 2, '2026-03-01')).toBe(460000);
  });

  it('дата раньше первой сетки — цены нет', () => {
    expect(contractNightPrice([doc()], slice(), 'rt1', 1, '2025-11-09')).toBeNull();
  });

  it('новая ДС перекрывает цену со своей даты', () => {
    const second = doc({ amendmentNumber: '2', fill: [{ from: '2026-01-01', slices: [{ customer: null, guestKind: null, mealPlan: 'BB', cells: [{ categoryId: 'rt1', occupancy: 1, price: 320000 }] }] }] });
    expect(contractNightPrice([doc(), second], slice(), 'rt1', 1, '2025-12-31')).toBe(300000);
    expect(contractNightPrice([doc(), second], slice(), 'rt1', 1, '2026-01-01')).toBe(320000);
  });

  it('срез чужой авиакомпании не подставляется, а «для любой» — да', () => {
    const own = doc({ fill: [{ from: '2025-11-10', slices: [
      { customer: 's7', guestKind: null, mealPlan: 'BB', cells: [{ categoryId: 'rt1', occupancy: 1, price: 250000 }] },
      { customer: null, guestKind: null, mealPlan: 'BB', cells: [{ categoryId: 'rt1', occupancy: 1, price: 300000 }] },
    ] }] });
    expect(contractNightPrice([own], slice({ customerCode: 'cosmos' }), 'rt1', 1, '2026-03-01')).toBe(300000);
  });

  it('точный срез авиакомпании главнее общего', () => {
    const own = doc({ fill: [{ from: '2025-11-10', slices: [
      { customer: 'cosmos', guestKind: null, mealPlan: 'BB', cells: [{ categoryId: 'rt1', occupancy: 1, price: 210000 }] },
      { customer: null, guestKind: null, mealPlan: 'BB', cells: [{ categoryId: 'rt1', occupancy: 1, price: 300000 }] },
    ] }] });
    expect(contractNightPrice([own], slice({ customerCode: 'cosmos' }), 'rt1', 1, '2026-03-01')).toBe(210000);
  });

  it('питания нет в договоре — цены нет, общее питание не подставляется', () => {
    expect(contractNightPrice([doc()], slice({ mealPlan: 'HB' }), 'rt1', 1, '2026-03-01')).toBeNull();
  });

  it('вида брони нет в договоре — цены нет', () => {
    expect(contractNightPrice([doc()], slice({ guestKind: 'CREW' }), 'rt1', 1, '2026-03-01')).toBeNull();
  });

  it('чужое юрлицо не считает', () => {
    expect(contractNightPrice([doc({ accountCode: 'kars' })], slice(), 'rt1', 1, '2026-03-01')).toBeNull();
  });

  it('гостей больше, чем есть в сетке — цены нет', () => {
    expect(contractNightPrice([doc()], slice(), 'rt1', 3, '2026-03-01')).toBeNull();
  });

  it('документ без сетки — цены нет (Авиа не собрала)', () => {
    expect(contractNightPrice([doc({ fill: null })], slice(), 'rt1', 1, '2026-03-01')).toBeNull();
  });

  it('чужой договор не считается', () => {
    expect(contractNightPrice([doc({ contractNumber: '999' })], slice(), 'rt1', 1, '2026-03-01')).toBeNull();
  });
});

describe('contractHasPriceOn', () => {
  it('есть хотя бы одна цена на день', () => {
    expect(contractHasPriceOn([doc()], slice(), '2026-03-01')).toBe(true);
    expect(contractHasPriceOn([doc()], slice(), '2025-01-01')).toBe(false);
  });
});

describe('contractVatRate', () => {
  it('НДС — из действующего документа', () => {
    const second = doc({ amendmentNumber: '2', vatRate: 10, fill: [{ from: '2026-01-01', slices: [] }] });
    expect(contractVatRate([doc(), second], slice(), '2025-12-01')).toBe(20);
    expect(contractVatRate([doc(), second], slice(), '2026-02-01')).toBe(10);
  });
});

describe('contractNightPrices', () => {
  it('по ночам проживания: дни вне договора остаются пустыми', () => {
    const prices = contractNightPrices([doc()], slice(), 'rt1', 1, ['2025-11-09', '2025-11-10', '2025-11-11']);
    expect([...prices.entries()]).toEqual([['2025-11-10', 300000], ['2025-11-11', 300000]]);
  });
});

describe('contractNightRub', () => {
  it('копейки Авии → рубли ПМС', () => {
    expect(contractNightRub([doc()], slice(), 'rt1', 1, '2026-03-01')).toBe('3000.00');
    expect(contractNightRub([doc()], slice(), 'rt1', 2, '2026-03-01')).toBe('4600.00');
  });

  it('цены нет — null, а не ноль', () => {
    expect(contractNightRub([doc()], slice(), 'rt1', 3, '2026-03-01')).toBeNull();
  });
});
```

- [ ] **Step 2: Прогнать — упадёт**

```bash
cd C:/dev/Kars-hotel/backend
pnpm exec jest src/modules/contracts/contract-price.spec.ts
```
Ожидается: FAIL — модуля нет.

- [ ] **Step 3: Написать правило**

`backend/src/modules/contracts/contract-price.ts`:

```ts
/* ЦЕНА КОРПОРАТИВНОГО ТАРИФА — ИЗ ДОГОВОРА, А НЕ ИЗ ЕГО ПОЛЕЙ (11.11.2026).
 *
 * Реестр договоров Авии — мастер цен: там уже обговорённые с гостиницей
 * цифры, и спорить с ними в ПМС нечем. Поэтому у тарифа оператора своих строк
 * цен нет, а цена ночи берётся из сетки `fill`, которую Авиа посчитала СВОИМ
 * подбором. Своё правило здесь разошлось бы с её сверкой тихо — и разошлось бы
 * в деньгах.
 *
 * Правило ровно в объёме сетки: срез (авиакомпания × вид брони × питание),
 * период (последняя сетка, начавшаяся не позже дня) и ячейка (категория ×
 * гости). Всё остальное — честное «цены нет»: подставить общую цену вместо
 * отсутствующей значит пообещать цифру, которой в договоре не было. */
export interface FillCell {
  categoryId: string;
  occupancy: number;
  price: number;
}

export interface FillSlice {
  customer: string | null;
  guestKind: 'CREW' | 'DISRUPTION' | null;
  mealPlan: string;
  cells: FillCell[];
}

export interface FillGrid {
  /** День, с которого сетка действует (YYYY-MM-DD). */
  from: string;
  slices: FillSlice[];
}

/** Документ договора в объёме, который нужен правилу цены. */
export interface ContractPriceDoc {
  partnerId: string;
  contractNumber: string;
  amendmentNumber: string | null;
  service: string;
  validFrom: string;
  validTo: string | null;
  vatRate: number | null;
  accountCode: string | null;
  fill: FillGrid[] | null;
}

/** Срез, который воплощает тариф. */
export interface TariffSlice {
  partnerId: string;
  contractNumber: string | null;
  /** Код юрлица из справочника партнёра; null — любое. */
  accountCode: string | null;
  /** Код авиакомпании из справочника партнёра; null — любая. */
  customerCode: string | null;
  guestKind: 'CREW' | 'DISRUPTION' | null;
  mealPlan: string;
}

const day10 = (v: string) => String(v).slice(0, 10);

/** Документы этого договора: свой партнёр, услуга проживания, своё юрлицо. */
function ownDocs(docs: ContractPriceDoc[], slice: TariffSlice): ContractPriceDoc[] {
  if (!slice.contractNumber) return [];
  return docs.filter(
    (d) =>
      d.service === 'ACCOMMODATION' &&
      d.partnerId === slice.partnerId &&
      d.contractNumber === slice.contractNumber &&
      (!slice.accountCode || !d.accountCode || d.accountCode === slice.accountCode),
  );
}

/** Последняя сетка, начавшаяся не позже дня, и её документ. */
function gridAt(
  docs: ContractPriceDoc[],
  slice: TariffSlice,
  day: string,
): { grid: FillGrid; doc: ContractPriceDoc } | null {
  const d = day10(day);
  let best: { grid: FillGrid; doc: ContractPriceDoc; from: string } | null = null;
  for (const doc of ownDocs(docs, slice)) {
    for (const grid of doc.fill ?? []) {
      const from = day10(grid.from);
      if (from <= d && (!best || from > best.from)) best = { grid, doc, from };
    }
  }
  return best ? { grid: best.grid, doc: best.doc } : null;
}

/* Срез сетки: авиакомпания — точная, иначе «для любой» (так её и посчитает
   Авиа); вид брони и питание — только точные. Нет среза — цены нет. */
function pickSlice(grid: FillGrid, slice: TariffSlice): FillSlice | null {
  const kind = slice.guestKind ?? null;
  const forCustomer = (customer: string | null) =>
    grid.slices.find(
      (s) =>
        (s.customer ?? null) === customer &&
        (s.guestKind ?? null) === kind &&
        s.mealPlan === slice.mealPlan,
    ) ?? null;
  return forCustomer(slice.customerCode ?? null) ?? (slice.customerCode ? forCustomer(null) : null);
}

/** Цена ночи в копейках; null — цены нет. */
export function contractNightPrice(
  docs: ContractPriceDoc[],
  slice: TariffSlice,
  roomTypeId: string,
  guests: number,
  day: string,
): number | null {
  const at = gridAt(docs, slice, day);
  if (!at) return null;
  const own = pickSlice(at.grid, slice);
  if (!own) return null;
  const cell = own.cells.find((c) => c.categoryId === roomTypeId && c.occupancy === guests);
  return cell ? cell.price : null;
}

/** Есть ли на день хоть одна цена этого среза — для состояния тарифа. */
export function contractHasPriceOn(
  docs: ContractPriceDoc[],
  slice: TariffSlice,
  day: string,
): boolean {
  const at = gridAt(docs, slice, day);
  if (!at) return false;
  const own = pickSlice(at.grid, slice);
  return !!own && own.cells.length > 0;
}

/** НДС договора на день: ставка документа, который дал цены. */
export function contractVatRate(
  docs: ContractPriceDoc[],
  slice: TariffSlice,
  day: string,
): number | null {
  return gridAt(docs, slice, day)?.doc.vatRate ?? null;
}

/** Цены по ночам проживания; дни без цены в набор не попадают. */
export function contractNightPrices(
  docs: ContractPriceDoc[],
  slice: TariffSlice,
  roomTypeId: string,
  guests: number,
  days: string[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const day of days) {
    const price = contractNightPrice(docs, slice, roomTypeId, guests, day);
    if (price != null) out.set(day10(day), price);
  }
  return out;
}

/* Цены Авии — КОПЕЙКИ, цены ПМС — РУБЛИ. Переводятся здесь, на границе и один
   раз: две конвертации в разных местах разошлись бы в сто раз. */
export function kopecksToRub(price: number): string {
  return (price / 100).toFixed(2);
}

/** Цена договора на ночь в рублях; null — цены нет. */
export function contractNightRub(
  docs: ContractPriceDoc[],
  slice: TariffSlice,
  roomTypeId: string,
  guests: number,
  day: string,
): string | null {
  const price = contractNightPrice(docs, slice, roomTypeId, guests, day);
  return price == null ? null : kopecksToRub(price);
}

```

- [ ] **Step 4: Прогнать — пройдёт**

```bash
cd C:/dev/Kars-hotel/backend
pnpm exec jest src/modules/contracts/contract-price.spec.ts
```
Ожидается: PASS, 16 тестов.

- [ ] **Step 5: Коммит (по слову Мусы)**

```bash
git add backend/src/modules/contracts/contract-price.ts backend/src/modules/contracts/contract-price.spec.ts
git commit -m "feat(pms): contract price rule for corporate tariffs"
```

---

### Task 5: Срез тарифа и чтение документов

**Files:**
- Create: `backend/src/modules/contracts/slice.ts`
- Create: `backend/src/modules/contracts/slice.spec.ts`
- Modify: `backend/src/modules/contracts/contracts.service.ts`
- Modify: `backend/src/modules/contracts/contracts.module.ts`

- [ ] **Step 1: Падающий тест среза**

`backend/src/modules/contracts/slice.spec.ts`:

```ts
import { sliceFromPlan } from './slice';

/* Срез тарифа: условия тарифа ПМС → коды договора.
 *
 * Авиакомпания хранится у нас ссылкой на справочник партнёра, а в договоре —
 * кодом. Справочник не знает код (запись выключили) — считать нечем, и это
 * не «любая авиакомпания»: иначе тариф молча считался бы по общим ценам. */

const plan = {
  partnerId: 'p1',
  operatorContract: '205',
  partnerAccountId: 'a1',
  partnerCustomerId: 'c1',
  guestKind: null,
  mealPlan: 'BB',
};

describe('sliceFromPlan', () => {
  it('собирает срез кодами договора', () => {
    expect(sliceFromPlan(plan, 'ani', 'cosmos')).toEqual({
      slice: {
        partnerId: 'p1',
        contractNumber: '205',
        accountCode: 'ani',
        customerCode: 'cosmos',
        guestKind: null,
        mealPlan: 'BB',
      },
      unknownCustomer: false,
    });
  });

  it('без договора тарифа не считаем', () => {
    expect(sliceFromPlan({ ...plan, operatorContract: null }, 'ani', 'cosmos')).toEqual({
      slice: null,
      unknownCustomer: false,
    });
  });

  it('авиакомпании нет в справочнике — цены нет, а не «любая»', () => {
    expect(sliceFromPlan(plan, 'ani', null)).toEqual({
      slice: null,
      unknownCustomer: true,
    });
  });

  it('тариф «для любой авиакомпании» — законный срез', () => {
    const r = sliceFromPlan({ ...plan, partnerCustomerId: null }, 'ani', null);
    expect(r.slice?.customerCode).toBeNull();
    expect(r.unknownCustomer).toBe(false);
  });
});
```

- [ ] **Step 2: Прогнать — упадёт**

```bash
cd C:/dev/Kars-hotel/backend
pnpm exec jest src/modules/contracts/slice.spec.ts
```
Ожидается: FAIL — модуля нет.

- [ ] **Step 3: Написать срез**

`backend/src/modules/contracts/slice.ts`:

```ts
import { TariffSlice } from './contract-price';

/** Условия тарифа в объёме, который нужен срезу. */
export interface PlanSliceSource {
  partnerId: string | null;
  operatorContract: string | null;
  partnerAccountId: string | null;
  partnerCustomerId: string | null;
  guestKind: 'CREW' | 'DISRUPTION' | null;
  mealPlan: string;
}

export interface SliceResolution {
  slice: TariffSlice | null;
  /** Ссылка на авиакомпанию есть, а кода в справочнике нет — цены не будет. */
  unknownCustomer: boolean;
}

/** Срез тарифа — кодами справочника партнёра, как их называет договор. */
export function sliceFromPlan(
  plan: PlanSliceSource,
  accountCode: string | null,
  customerCode: string | null,
): SliceResolution {
  if (!plan.partnerId || !plan.operatorContract) {
    return { slice: null, unknownCustomer: false };
  }
  if (plan.partnerCustomerId && !customerCode) {
    return { slice: null, unknownCustomer: true };
  }
  return {
    slice: {
      partnerId: plan.partnerId,
      contractNumber: plan.operatorContract,
      accountCode,
      customerCode,
      guestKind: plan.guestKind,
      mealPlan: plan.mealPlan,
    },
    unknownCustomer: false,
  };
}
```

- [ ] **Step 4: Прогнать — пройдёт**

```bash
cd C:/dev/Kars-hotel/backend
pnpm exec jest src/modules/contracts/slice.spec.ts
```
Ожидается: PASS, 4 теста.

- [ ] **Step 5: Дописать сервис**

Заменить `backend/src/modules/contracts/contracts.service.ts` целиком:

```ts
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { mergeContractList } from './contract-list';
import {
  ContractPriceDoc,
  FillGrid,
  contractHasPriceOn,
  contractNightRub,
  contractVatRate,
} from './contract-price';
import { PlanSliceSource, SliceResolution, sliceFromPlan } from './slice';

/* То, что нужно от базы этому сервису: и внутри транзакции вызывающего, и в
   своей. Вложенная транзакция Prisma — второй BEGIN на соединении, и он
   виснет, поэтому `run` не открывает новую, когда её уже открыли. */
type Db = Pick<
  PrismaService,
  'partnerContract' | 'partnerContractPrice' | 'partnerAccount' | 'partnerCustomer'
>;

@Injectable()
export class ContractsService {
  constructor(private readonly prisma: PrismaService) {}

  private run<T>(
    tx: Prisma.TransactionClient | undefined,
    fn: (db: Db) => Promise<T>,
  ): Promise<T> {
    return tx ? fn(tx as unknown as Db) : this.prisma.forTenant((t) => fn(t as unknown as Db));
  }

  /** Договоры партнёров у гостиницы: реестр и приложения в одном списке. */
  async list() {
    const [registry, docs] = await this.prisma.forTenant((tx) =>
      Promise.all([
        tx.partnerContract.findMany(),
        tx.partnerContractPrice.findMany({
          select: {
            partnerId: true,
            contractNumber: true,
            accountCode: true,
            accountName: true,
            service: true,
            receivedAt: true,
          },
        }),
      ]),
    );
    return mergeContractList(registry, docs);
  }

  /** Документы партнёра в объёме правила цены (сетки, сроки, НДС, юрлицо). */
  async docsFor(
    partnerId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<ContractPriceDoc[]> {
    const rows = await this.run(tx, (db) =>
      db.partnerContractPrice.findMany({
        where: { partnerId },
        select: {
          partnerId: true,
          contractNumber: true,
          amendmentNumber: true,
          service: true,
          validFrom: true,
          validTo: true,
          vatRate: true,
          accountCode: true,
          fill: true,
        },
      }),
    );
    return rows.map((r) => ({
      partnerId: r.partnerId,
      contractNumber: r.contractNumber,
      amendmentNumber: r.amendmentNumber,
      service: r.service,
      validFrom: r.validFrom.toISOString(),
      validTo: r.validTo?.toISOString() ?? null,
      vatRate: r.vatRate == null ? null : Number(r.vatRate),
      accountCode: r.accountCode,
      fill: (r.fill as unknown as FillGrid[] | null) ?? null,
    }));
  }

  /** Срез тарифа: условия ПМС → коды справочника партнёра. */
  async sliceOf(
    plan: PlanSliceSource,
    tx?: Prisma.TransactionClient,
  ): Promise<SliceResolution> {
    if (!plan.partnerId || !plan.operatorContract) {
      return { slice: null, unknownCustomer: false };
    }
    const [account, customer] = await this.run(tx, (db) =>
      Promise.all([
        plan.partnerAccountId
          ? db.partnerAccount.findUnique({
              where: { id: plan.partnerAccountId },
              select: { code: true },
            })
          : Promise.resolve(null),
        plan.partnerCustomerId
          ? db.partnerCustomer.findUnique({
              where: { id: plan.partnerCustomerId },
              select: { code: true },
            })
          : Promise.resolve(null),
      ]),
    );
    return sliceFromPlan(plan, account?.code ?? null, customer?.code ?? null);
  }

  /** Цена договора на ночь в рублях; null — цены нет. */
  async nightRub(
    plan: PlanSliceSource,
    roomTypeId: string,
    guests: number,
    day: string,
    tx?: Prisma.TransactionClient,
  ): Promise<string | null> {
    const { slice } = await this.sliceOf(plan, tx);
    if (!slice) return null;
    const docs = await this.docsFor(slice.partnerId, tx);
    return contractNightRub(docs, slice, roomTypeId, guests, day);
  }

  /** Состояние цен тарифов на день: есть ли цена и каков НДС договора. */
  async priceStates(
    plans: Array<PlanSliceSource & { id: string }>,
    day: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Map<string, { hasPrice: boolean; unknownCustomer: boolean; vatRate: number | null }>> {
    const out = new Map<
      string,
      { hasPrice: boolean; unknownCustomer: boolean; vatRate: number | null }
    >();
    const byPartner = new Map<string, ContractPriceDoc[]>();
    for (const plan of plans) {
      const { slice, unknownCustomer } = await this.sliceOf(plan, tx);
      if (!slice) {
        out.set(plan.id, { hasPrice: false, unknownCustomer, vatRate: null });
        continue;
      }
      if (!byPartner.has(slice.partnerId)) {
        byPartner.set(slice.partnerId, await this.docsFor(slice.partnerId, tx));
      }
      const docs = byPartner.get(slice.partnerId) as ContractPriceDoc[];
      out.set(plan.id, {
        hasPrice: contractHasPriceOn(docs, slice, day),
        unknownCustomer: false,
        vatRate: contractVatRate(docs, slice, day),
      });
    }
    return out;
  }
}
```

`contracts.module.ts` уже экспортирует `ContractsService` — править не нужно;
`PrismaModule` глобальный, отдельного импорта не требуется.

- [ ] **Step 6: Прогнать тесты и сборку**

```bash
cd C:/dev/Kars-hotel/backend
pnpm exec jest src/modules/contracts
pnpm run build
```
Ожидается: PASS (все спеки модуля), сборка без ошибок.

- [ ] **Step 7: Коммит (по слову Мусы)**

```bash
git add backend/src/modules/contracts
git commit -m "feat(pms): contract slice and price lookup for a tariff"
```

---

### Task 6: Цена корпоративного тарифа на витрине

**Files:**
- Modify: `backend/src/modules/inventory/availability.service.ts:390-560`
- Modify: `backend/src/modules/inventory/inventory.module.ts`

- [ ] **Step 1: Подключить модуль договоров**

В `backend/src/modules/inventory/inventory.module.ts` добавить в `imports`:

```ts
    ContractsModule,
```
и импорт `import { ContractsModule } from '../contracts/contracts.module';`.

В `availability.service.ts` — импорты:

```ts
import { ContractsService } from '../contracts/contracts.service';
import { ContractPriceDoc, TariffSlice, contractNightRub } from '../contracts/contract-price';
```
и в конструктор `private readonly contracts: ContractsService` (последним параметром).

- [ ] **Step 2: Выбрать договор в запросе тарифов**

В `priceByPlan` в `select` запроса `tx.ratePlan.findMany`
(строки 420-430) добавить `operatorContract: true,`.

- [ ] **Step 3: Срезы договоров перед обходом тарифов**

Сразу после проверки `if (!ratePlans.length) return []` (строка 432) вставить:

```ts
      /* Корпоративный тариф считает по договору, а не по своим строкам
         (11.11.2026): сетки цен приезжают в зеркале договора. Грузим документы
         один раз на партнёра — их единицы. */
      const contractByPlan = new Map<
        string,
        { slice: TariffSlice; docs: ContractPriceDoc[] }
      >();
      const docsByPartner = new Map<string, ContractPriceDoc[]>();
      for (const plan of ratePlans) {
        if (plan.partnerId == null) continue;
        const { slice } = await this.contracts.sliceOf(plan, tx);
        if (!slice) continue;
        if (!docsByPartner.has(slice.partnerId)) {
          docsByPartner.set(
            slice.partnerId,
            await this.contracts.docsFor(slice.partnerId, tx),
          );
        }
        contractByPlan.set(plan.id, {
          slice,
          docs: docsByPartner.get(slice.partnerId) as ContractPriceDoc[],
        });
      }
```

- [ ] **Step 4: Цена ночи**

Заменить расчёт `eff` (строки 522-526) на:

```ts
          const corp = contractByPlan.get(plan.id);
          /* У тарифа партнёра своих цен нет вовсе: договор или ничего.
             Подставить сюда «свои» строки значило бы вернуть копию, от
             которой и уходили. */
          const eff: Prisma.Decimal | null = isPartnerPlan
            ? corp && guests
              ? (() => {
                  const rub = contractNightRub(
                    corp.docs,
                    corp.slice,
                    roomTypeId,
                    guests,
                    day,
                  );
                  return rub == null ? null : new Prisma.Decimal(rub);
                })()
              : null
            : daily ??
              baseline.resolve(plan.id, roomTypeId, day, guests) ??
              baseFallback;
```

- [ ] **Step 5: Сброс кэша цен при синхронизации договоров**

В `connectivity.service.ts` в конструктор добавить
`private readonly redis: RedisService` (импорт
`import { RedisService } from '../../common/redis/redis.service';`,
`import { InventoryService } from '../inventory/inventory.service';`), а в
`syncContractPrices` после `await this.prisma.admin.$transaction(...)` сохранить
результат в переменную `const result`, затем:

```ts
    /* Цены тарифов кэшируются на минуту; после синхронизации договора кэш
       обязан умереть, иначе гостиница и оператор минуту видят старую цену. */
    if (contracts !== undefined) {
      await InventoryService.dropPriceCache(this.redis, tenant.id);
    }
    return result;
```

Проверить, что `ConnectivityModule` может получить `RedisService` (модуль
`RedisModule` глобальный — да, как в `RatePlansModule`).

Кэш ответа, о котором говорит спека, — это уже существующий кэш
`priceByPlan` в Redis: договорные цены попадают в него вместе с ценами
тарифов, и сброс здесь закрывает тот самый пункт. Отдельного кэша
документов не заводим: у гостиницы их единицы.

- [ ] **Step 6: Сборка и тесты**

```bash
cd C:/dev/Kars-hotel/backend
pnpm run build
pnpm exec jest src/modules/contracts
```
Ожидается: PASS.

- [ ] **Step 7: Коммит (по слову Мусы)**

```bash
git add backend/src/modules/inventory backend/src/modules/connectivity/connectivity.service.ts
git commit -m "feat(pms): availability prices corporate tariffs from the contract"
```

---

### Task 7: Цена корпоративного тарифа в расчёте стоимости

**Files:**
- Modify: `backend/src/modules/pricing/pricing.service.ts:26-171`
- Modify: `backend/src/modules/pricing/pricing.module.ts`

- [ ] **Step 1: Подключить модуль договоров**

В `pricing.module.ts`:

```ts
    ContractsModule,
```
и импорт `import { ContractsModule } from '../contracts/contracts.module';`.

В `pricing.service.ts`:

```ts
import { ContractsService } from '../contracts/contracts.service';
import { contractNightRub } from '../contracts/contract-price';
```
и `private readonly contracts: ContractsService` в конструктор.

- [ ] **Step 2: Корпоративный тариф — только цены договора**

В `quote` в `select` запроса `tx.ratePlan.findUnique` (строки 44-53)
добавить `forOperator: true,` и `operatorContract: true,`,
`partnerId: true,`, `partnerAccountId: true,`,
`partnerCustomerId: true,`, `guestKind: true,`,
`mealPlan: true,`.

Перед `return calculatePricing({` (строка 151) вставить:

```ts
      /* Корпоративный тариф не берёт свои строки цен: его цена — договор
         (11.11.2026). Считаем ночи и подменяем fallback; строки цен для такого
         тарифа не читаем вовсе. */
      const days: string[] = [];
      for (
        let d = startOfUTC(input.arrival);
        d < startOfUTC(input.departure);
        d = new Date(d.getTime() + 86_400_000)
      ) {
        days.push(d.toISOString().slice(0, 10));
      }
      const corporateRub = new Map<string, string>();
      if (ratePlan.forOperator) {
        for (const day of days) {
          const rub = await this.contracts.nightRub(
            ratePlan,
            input.roomTypeId,
            input.occupancy,
            day,
          );
          if (rub != null) corporateRub.set(day, rub);
        }
      }
```

и в вызове `calculatePricing` заменить `fallback`:

```ts
        fallback: (planId, date) => {
          if (ratePlan.forOperator) {
            const rub = corporateRub.get(isoDay(date));
            return rub == null ? null : new Prisma.Decimal(rub);
          }
          return resolver.resolve(planId, input.roomTypeId, isoDay(date), input.occupancy);
        },
```

и `rates` — для корпоративного тарифа пустой набор:

```ts
        rates: ratePlan.forOperator ? makeMapLookup([]) : rates,
```

- [ ] **Step 3: Сборка**

```bash
cd C:/dev/Kars-hotel/backend
pnpm run build
```
Ожидается: успешная сборка. Тип `ratePlan` теперь шире — сверить, что
`calculatePricing` принимает `RatePlanLike` (лишние поля допустимы).

- [ ] **Step 4: Коммит (по слову Мусы)**

```bash
git add backend/src/modules/pricing
git commit -m "feat(pms): quote prices corporate tariffs from the contract"
```

---

### Task 8: Статус «есть цена договора» и ручка цен для экрана

**Files:**
- Modify: `backend/src/modules/rate-plans/operator-tariff-status.ts:192-245`
- Modify: `backend/src/modules/rate-plans/operator-tariff-status.spec.ts` (переписать)
- Modify: `backend/src/modules/rate-plans/rate-plans.service.ts`
- Modify: `backend/src/modules/rate-plans/rate-plans.controller.ts`
- Modify: `backend/src/modules/rate-plans/rate-plans.module.ts`

- [ ] **Step 1: Новый статус**

Заменить в `operator-tariff-status.ts` блок от
`export interface TariffStatus` (строка 192) до конца файла:

```ts
export interface TariffStatus {
  state: OperatorTariffState;
  /** Одной фразой — что сейчас с тарифом и почему. */
  reason: string;
  /** Применяется ли тариф к заявкам оператора. */
  applies: boolean;
}

/* СТАТУС СЧИТАЕТСЯ ПО НАЛИЧИЮ ЦЕНЫ ДОГОВОРА (11.11.2026).
 *
 * Прежний статус был вердиктом человека: гостиница вводила свои ставки, а
 * оператор сверял их с договором. Цены теперь приходят из договора, сверять
 * нечего — значит и подтверждать нечего: тариф работает, когда по его срезу
 * есть цена договора на сегодня. Вердикт остаётся в базе как история и на
 * ответ не влияет. */
export function operatorTariffStatus(
  plan: ReviewedPlan,
  docs: ContractPriceDoc[],
  /** Есть ли цена договора на сегодня по срезу тарифа. */
  hasPrice: boolean,
): TariffStatus {
  const mine = docsOfContract(docs, plan.operatorContract, plan.partnerId);

  if (!plan.operatorContract) {
    return { state: 'DRAFT', reason: 'Не указан договор — не с чем сверять', applies: false };
  }
  if (!mine.length) {
    return {
      state: 'DRAFT',
      reason: `Оператор ещё не прислал цены по договору ${plan.operatorContract}`,
      applies: false,
    };
  }
  if (!hasPrice) {
    return { state: 'DRAFT', reason: 'Цены договора на сегодня нет', applies: false };
  }
  return { state: 'CONFIRMED', reason: 'Цены из договора', applies: true };
}
```

- [ ] **Step 2: Переписать спек статуса**

Файл `backend/src/modules/rate-plans/operator-tariff-status.spec.ts` меняется
только в одном месте: блок `describe('состояние корпоративного тарифа', …)`
(строки 124-205) заменяется целиком. Тесты отпечатка и названия документов
(строки 63-122 и 207-225) остаются как есть: `tariffFingerprint` и
`documentsLabel` не менялись.

Новый блок (хелперы `doc`, `shape`, `fp` уже есть в файле):

```ts
describe('состояние корпоративного тарифа', () => {
  const tariffPlan = (over: Record<string, unknown> = {}) => ({
    ...shape,
    partnerId: 'p1',
    operatorContract: '18',
    reviewVerdict: null,
    reviewFingerprint: null,
    ...over,
  });

  it('цена договора есть — применяется, вердикт человека не нужен', () => {
    const s = operatorTariffStatus(tariffPlan() as never, [doc()], true);
    expect(s.state).toBe('CONFIRMED');
    expect(s.applies).toBe(true);
    expect(s.reason).toBe('Цены из договора');
  });

  it('без договора говорит, чего не хватает', () => {
    const s = operatorTariffStatus(
      tariffPlan({ operatorContract: null }) as never,
      [doc()],
      true,
    );
    expect(s.applies).toBe(false);
    expect(s.reason).toContain('Не указан договор');
  });

  it('договор есть, а цен от оператора нет — так и сказано', () => {
    const s = operatorTariffStatus(tariffPlan() as never, [], true);
    expect(s.applies).toBe(false);
    expect(s.reason).toContain('ещё не прислал цены');
  });

  it('приложение есть, а цены на сегодня нет — не применяется', () => {
    const s = operatorTariffStatus(tariffPlan() as never, [doc()], false);
    expect(s.applies).toBe(false);
    expect(s.reason).toContain('на сегодня');
  });

  it('чужой договор не считается', () => {
    const s = operatorTariffStatus(
      tariffPlan({ operatorContract: '9' }) as never,
      [doc()],
      true,
    );
    expect(s.applies).toBe(false);
  });

  /* Вердикт остаётся в базе как история и на применение не влияет: именно
     этот случай ломал 7 гостиниц — «подтверждено», а цен нет. */
  it('старое «подтверждено» без цены договора не применяет тариф', () => {
    const s = operatorTariffStatus(
      tariffPlan({ reviewVerdict: 'CONFIRMED', reviewFingerprint: fp([doc()]) }) as never,
      [doc()],
      false,
    );
    expect(s.applies).toBe(false);
  });
});
```

- [ ] **Step 3: Прогнать статус**

```bash
cd C:/dev/Kars-hotel/backend
pnpm exec jest src/modules/rate-plans/operator-tariff-status.spec.ts
```
Ожидается: PASS, 6 тестов.

- [ ] **Step 4: Сервис тарифов — статус и цены для экрана**

В `rate-plans.service.ts`:

1) импорт `ContractsService` и `contractNightRub`,
`contractVatRate`; в конструктор — `private readonly contracts: ContractsService`.

2) `withOperatorStatus` (строки 633-659):

```ts
  private async withOperatorStatus<
    T extends { id: string; forOperator: boolean } & PlanSliceSource,
  >(plans: T[]): Promise<
    (T & { operatorStatus: TariffStatus | null; fingerprint: string | null })[]
  > {
    const corporate = plans.filter((p) => p.forOperator);
    if (!corporate.length) {
      return plans.map((p) => ({ ...p, operatorStatus: null, fingerprint: null }));
    }
    const today = new Date().toISOString().slice(0, 10);
    const [docs, states] = await Promise.all([
      this.contractDocs(),
      this.contracts.priceStates(corporate, today),
    ]);
    return plans.map((p) => {
      if (!p.forOperator) return { ...p, operatorStatus: null, fingerprint: null };
      const plan = p as unknown as ReviewedPlan;
      /* Цен тарифа больше нет — отпечаток держится на договоре и условиях,
         поэтому новая ДС его меняет, а правка несуществующих строк — нет. */
      const mine = docsOfContract(docs, plan.operatorContract, plan.partnerId);
      const fingerprint = tariffFingerprint({ docs: mine, plan, prices: [] });
      const state = states.get(p.id);
      return {
        ...p,
        fingerprint,
        operatorStatus: operatorTariffStatus(
          plan,
          docs,
          state?.hasPrice === true,
        ),
      };
    });
  }
```

Импорт типов: `PlanSliceSource` из `../contracts/slice`,
`ReviewedPlan`, `TariffStatus` — уже импортированы в файле.

3) В `list()` и `get()` `findMany`/`findUnique` уже возвращают поле
`operatorContract` — добавить в `include` ничего не нужно, но проверить, что
`mealPlan`, `guestKind`, `partnerAccountId`,
`partnerCustomerId` присутствуют в выборке (без `select` — присутствуют).

4) Новая ручка цен договора:

```ts
  /* Цены договора для экрана корпоративного тарифа (11.11.2026): периоды ДС и
     сетка по категориям и числу гостей. Считается тем же правилом, что и
     расчёт брони, — иначе экран и счёт разошлись бы молча. */
  async contractPrices(id: string, from?: string, to?: string) {
    const plan = await this.prisma.forTenant((tx) =>
      tx.ratePlan.findUnique({ where: { id } }),
    );
    if (!plan) throw new NotFoundException('Тариф не найден');
    if (!plan.forOperator) {
      throw new BadRequestException('Это не корпоративный тариф оператора');
    }

    const roomTypes = await this.prisma.forTenant((tx) =>
      tx.roomType.findMany({
        where: { isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, maxOccupancy: true },
      }),
    );
    const { slice, unknownCustomer } = await this.contracts.sliceOf(plan);

    const today = new Date().toISOString().slice(0, 10);
    const dayFrom = from ?? today;
    const dayTo = to ?? dayFrom;
    const days: string[] = [];
    for (
      let d = new Date(`${dayFrom}T00:00:00.000Z`);
      d <= new Date(`${dayTo}T00:00:00.000Z`) && days.length < 120;
      d = new Date(d.getTime() + 86_400_000)
    ) {
      days.push(d.toISOString().slice(0, 10));
    }

    const categories = roomTypes.map((rt) => ({
      categoryId: rt.id,
      name: rt.name,
      capacity: rt.maxOccupancy,
    }));
    if (!slice) {
      return {
        contractNumber: plan.operatorContract,
        unknownCustomer,
        periods: [] as string[],
        categories,
        nights: [] as { day: string; prices: { categoryId: string; occupancy: number; price: string }[] }[],
        vatRate: null as number | null,
      };
    }

    const docs = await this.contracts.docsFor(slice.partnerId);
    const periods = [
      ...new Set(
        docs
          .filter(
            (d) =>
              d.service === 'ACCOMMODATION' &&
              d.contractNumber === slice.contractNumber,
          )
          .flatMap((d) => (d.fill ?? []).map((g) => String(g.from).slice(0, 10))),
      ),
    ].sort();

    const nights = days
      .map((day) => ({
        day,
        prices: roomTypes.flatMap((rt) => {
          const rows: { categoryId: string; occupancy: number; price: string }[] = [];
          for (let g = 1; g <= Math.max(1, rt.maxOccupancy ?? 1); g++) {
            const rub = contractNightRub(docs, slice, rt.id, g, day);
            if (rub != null) rows.push({ categoryId: rt.id, occupancy: g, price: rub });
          }
          return rows;
        }),
      }))
      .filter((n) => n.prices.length > 0);

    return {
      contractNumber: plan.operatorContract,
      unknownCustomer: false,
      periods,
      categories,
      nights,
      vatRate: contractVatRate(docs, slice, today),
    };
  }
```

Импорты: `BadRequestException` уже есть, `contractNightRub` и
`contractVatRate` — добавить.

5) Запись вердикта Авии (`applyOperatorReview`, строки 344-403) остаётся
рабочей, но ни на что не влияет. Две правки:

- убрать отказ `Нет ценового приложения договора` (строки 362-369): решение
  относится к условиям среза, а не к наличию приложения, и старая Авиа не
  должна получать 409 там, где раньше проходила;
- отпечаток считать так же, как в `withOperatorStatus`: `docs: mine`,
  `prices: []`. Иначе две стороны посчитают его по разным входам и сверка
  будет падать на пустом месте.

```ts
    const mine = docsOfContract(await this.contractDocs(), plan.operatorContract, plan.partnerId);
    const fingerprint = tariffFingerprint({ docs: mine, plan, prices: [] });
```

- [ ] **Step 5: Контроллер**

В `rate-plans.controller.ts` после `operatorTariff()` (строка 28) и ДО
`@Get(':id')`:

```ts
  @Get(':id/contract-prices')
  @RequirePermissions('rate.read')
  @ApiOperation({ summary: 'Contract prices of a corporate tariff (read-only)' })
  contractPrices(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.contractPrices(id, from, to);
  }
```
Добавить `Query` в импорт из `@nestjs/common`.

- [ ] **Step 6: Модуль тарифов**

В `rate-plans.module.ts` — `ContractsModule` в `imports` и импорт модуля.

- [ ] **Step 7: Сборка и тесты**

```bash
cd C:/dev/Kars-hotel/backend
pnpm run build
pnpm exec jest src/modules/rate-plans
```
Ожидается: PASS, сборка без ошибок.

- [ ] **Step 8: Коммит (по слову Мусы)**

```bash
git add backend/src/modules/rate-plans
git commit -m "feat(pms): corporate tariff status from contract prices"
```

---

## Фаза 3. Авиа

### Task 9: Список договоров в наборе синхронизации

**Files:**
- Modify: `C:/dev/kars-avia-v3/libs/hotel-contract/src/lib/client.ts:203-206,385+`
- Modify: `C:/dev/kars-avia-v3/libs/identity/src/lib/management/contract-price-mirror.service.ts:69-121,157-228`
- Modify: `C:/dev/kars-avia-v3/libs/identity/src/lib/management/contract-price-mirror.spec.ts`
- Modify: `C:/dev/kars-avia-v3/apps/core-api/src/app/hotel/kars-hotel-pms.client.ts:407-424`

- [ ] **Step 1: Тип в контракте**

В `libs/hotel-contract/src/lib/client.ts` после
`export interface ContractPricesPush { … }` (конец интерфейса) добавить:

```ts
/**
 * Договор реестра для PMS (11.11.2026) — в том числе без ценового приложения.
 *
 * Гостиница должна видеть договор, даже если приложение не пришло: у
 * «Апартаментов сети Карс Авиа» 27 таких, и пустой кабинет читается как
 * «договоров нет». Скрытые договоры не отправляются вовсе.
 */
export interface ContractSummaryPush {
  number: string;
  /** Наше юрлицо, подписавшее договор, — кодом из справочника партнёра. */
  account: { code: string; name: string } | null;
  signedAt: string | null;
  expiresAt: string | null;
  /** Рабочий договор гостиницы. */
  isPrimary: boolean;
  /** ARCHIVED — отработал; скрытые не приходят вовсе. */
  state: 'ACTIVE' | 'ARCHIVED';
  services: ('ACCOMMODATION' | 'MEAL')[];
  /** Сколько приложений этого договора в наборе; 0 — цен нет. */
  sheets: number;
}
```

И в интерфейсе клиента (строки 203-206):

```ts
  syncContractPrices?(
    hotelId: string,
    documents: ContractPricesPush[],
    contracts?: ContractSummaryPush[],
  ): Promise<void>;
```

- [ ] **Step 2: Отправка**

`apps/core-api/src/app/hotel/kars-hotel-pms.client.ts`:

```ts
  async syncContractPrices(
    hotelId: string,
    documents: ContractPricesPush[],
    contracts?: ContractSummaryPush[],
  ): Promise<void> {
    try {
      await this.request<unknown>(
        `/hotels/${encodeURIComponent(hotelId)}/contract-prices/sync`,
        { method: 'PUT', body: { documents, ...(contracts ? { contracts } : {}) } },
      );
    } catch (e) {
      const status = e instanceof HttpException ? e.getStatus() : 0;
      if (status === 404) {
        this.logger.warn(`contract-prices sync: hotel ${hotelId} not found in PMS (404)`);
        throw new NotFoundException(Tx.gostinicaNeNaydenaVPms({ hotelId }));
      }
      throw e;
    }
  }
```
Импорт `ContractSummaryPush` — в строку импорта типов из
`@kars-avia/hotel-contract`.

- [ ] **Step 3: Список договоров из реестра**

В `contract-price-mirror.service.ts`:

1) импорт `type ContractSummaryPush`.

2) `sync` (строки 69-77) — считать список до отправки:

```ts
  async sync(hotelId: string | null | undefined): Promise<void> {
    if (!hotelId || !this.hotel?.syncContractPrices) return;
    try {
      const documents = await this.documentsFor(hotelId);
      await this.hotel.syncContractPrices(
        hotelId,
        documents,
        await this.contractsFor(hotelId, documents),
      );
    } catch (e) {
      this.log.warn(Tx.zerkaloCenHotelidNe({ hotelId, e: String(e) }));
    }
  }
```

3) `syncAll` (строка 102) и `syncOne` (строка 116) — так же передать
третий аргумент. В `syncAll` документы считаются один раз: заменить тело цикла на

```ts
      const documents = await this.documentsFor(hotelId);
      await this.hotel.syncContractPrices(
        hotelId,
        documents,
        await this.contractsFor(hotelId, documents),
      );
```

4) Новый метод — после `documentsFor`:

```ts
  /* Список договоров реестра (11.11.2026).
   *
   * Документы с ценами есть только у договора с приложением; у «Апартаментов
   * сети Карс Авиа» 27 договоров и ни одного приложения — без этого списка
   * гостиница не знает даже номера. Скрытые не отправляются (для нас их нет),
   * архивные — со state ARCHIVED: он отработал, по нему считались брони.
   *
   * Номер договора в реестре не уникален (две записи одного номера бывают
   * после переноса) — дубли склеиваются по номеру, остаётся позднейший по
   * `signedAt`: уникальный ключ в PMS иначе не даст синхронизировать ничего. */
  private async contractsFor(
    hotelId: string,
    documents: ContractPricesPush[],
  ): Promise<ContractSummaryPush[]> {
    const rows = await this.prisma.hotelContract.findMany({
      where: { hiddenAt: null, ...contractCoversHotel(hotelId) },
      select: {
        number: true,
        signedAt: true,
        expiresAt: true,
        isPrimary: true,
        archivedAt: true,
        karsCompany: { select: { id: true, name: true } },
      },
    });

    const byNumber = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const prev = byNumber.get(row.number);
      if (
        !prev ||
        (row.signedAt ?? new Date(0)) > (prev.signedAt ?? new Date(0))
      ) {
        byNumber.set(row.number, row);
      }
    }

    return [...byNumber.values()]
      .map((c) => {
        const mine = documents.filter((d) => d.contractNumber === c.number);
        return {
          number: c.number,
          account: c.karsCompany
            ? { code: c.karsCompany.id, name: c.karsCompany.name }
            : null,
          signedAt: c.signedAt?.toISOString() ?? null,
          expiresAt: c.expiresAt?.toISOString() ?? null,
          isPrimary: c.isPrimary,
          state: (c.archivedAt ? 'ARCHIVED' : 'ACTIVE') as 'ACTIVE' | 'ARCHIVED',
          services: [
            ...new Set(mine.map((d) => d.service)),
          ] as ('ACCOMMODATION' | 'MEAL')[],
          sheets: mine.length,
        };
      })
      .sort((a, b) => a.number.localeCompare(b.number, 'ru', { numeric: true }));
  }
```

- [ ] **Step 4: Тест зеркала**

В `contract-price-mirror.spec.ts`: расширить `stub` — теперь читается ещё
`prisma.hotelContract.findMany`:

```ts
function stub(sheets: unknown[], contracts: unknown[] = []) {
  const calls: { where?: unknown; sent?: unknown[]; contracts?: unknown[]; hotelId?: string } = {};
  const prisma = {
    priceSheet: {
      findMany: (args: { where?: unknown }) => {
        calls.where = args?.where;
        return Promise.resolve(sheets);
      },
    },
    hotelContract: {
      findMany: () => Promise.resolve(contracts),
    },
  } as unknown as PrismaService;
  const hotel = {
    syncContractPrices: (hotelId: string, documents: unknown[], list: unknown[]) => {
      calls.hotelId = hotelId;
      calls.sent = documents;
      calls.contracts = list;
      return Promise.resolve();
    },
  } as unknown as HotelContractClient;
  return { service: new ContractPriceMirrorService(prisma, hotel), calls };
}
```

Добавить тесты:

```ts
  it('договор без приложения уезжает в списке: цен нет, договор есть', async () => {
    const { service, calls } = stub([], [
      {
        number: '27/2026',
        signedAt: new Date('2026-01-10T00:00:00.000Z'),
        expiresAt: null,
        isPrimary: false,
        archivedAt: null,
        karsCompany: { id: 'ani', name: 'Ани Групп Аэро' },
      },
    ]);
    await service.sync('apartments');
    expect(calls.contracts).toEqual([
      {
        number: '27/2026',
        account: { code: 'ani', name: 'Ани Групп Аэро' },
        signedAt: '2026-01-10T00:00:00.000Z',
        expiresAt: null,
        isPrimary: false,
        state: 'ACTIVE',
        services: [],
        sheets: 0,
      },
    ]);
  });

  it('два приложения одного договора — один пункт списка с числом 2', async () => {
    const { service, calls } = stub([
      { ...SHEET, service: 'ACCOMMODATION', hotelContract: { number: '18' } },
      { ...SHEET, service: 'MEAL', hotelContract: { number: '18' } },
    ], [
      {
        number: '18',
        signedAt: null,
        expiresAt: null,
        isPrimary: true,
        archivedAt: null,
        karsCompany: null,
      },
    ]);
    await service.sync('evropa');
    expect(calls.contracts).toEqual([
      expect.objectContaining({
        number: '18',
        sheets: 2,
        services: ['ACCOMMODATION', 'MEAL'],
        state: 'ACTIVE',
        account: null,
      }),
    ]);
  });

  it('архивный договор — со state ARCHIVED', async () => {
    const { service, calls } = stub([], [
      {
        number: '18',
        signedAt: null,
        expiresAt: null,
        isPrimary: false,
        archivedAt: new Date('2026-02-01T00:00:00.000Z'),
        karsCompany: null,
      },
    ]);
    await service.sync('evropa');
    expect((calls.contracts as { state: string }[])[0].state).toBe('ARCHIVED');
  });

  it('дубли номера склеиваются: остаётся позднейший по подписанию', async () => {
    const { service, calls } = stub([], [
      { number: '18', signedAt: new Date('2024-01-01T00:00:00.000Z'), expiresAt: null, isPrimary: false, archivedAt: null, karsCompany: null },
      { number: '18', signedAt: new Date('2026-01-01T00:00:00.000Z'), expiresAt: null, isPrimary: true, archivedAt: null, karsCompany: null },
    ]);
    await service.sync('evropa');
    expect(calls.contracts).toHaveLength(1);
    expect((calls.contracts as { isPrimary: boolean }[])[0].isPrimary).toBe(true);
  });
```

- [ ] **Step 5: Прогнать тесты Авии**

```bash
cd C:/dev/kars-avia-v3
pnpm exec jest -c libs/identity/jest.config.cts contract-price-mirror
```
Ожидается: PASS, все тесты зеркала (прежние и четыре новых).

- [ ] **Step 6: Типы**

```bash
cd C:/dev/kars-avia-v3/libs/identity
pnpm exec tsc --build tsconfig.json --emitDeclarationOnly
```
Ожидается: без ошибок.

- [ ] **Step 7: Коммит (по слову Мусы)**

```bash
git add libs/hotel-contract/src/lib/client.ts libs/identity/src/lib/management/contract-price-mirror.service.ts libs/identity/src/lib/management/contract-price-mirror.spec.ts apps/core-api/src/app/hotel/kars-hotel-pms.client.ts
git commit -m "feat(avia): contract registry travels with the price mirror"
```

---

## Фаза 4. Фронтенд

### Task 10: Срезы договора в списке (бэкенд)

Мастеру нужен список срезов, которые в договоре реально есть: предлагать
питание, которого в договоре нет, значит завести заведомо пустой тариф.

**Files:**
- Modify: `backend/src/modules/contracts/contract-list.ts`
- Modify: `backend/src/modules/contracts/contract-list.spec.ts`
- Modify: `backend/src/modules/contracts/contracts.service.ts`

- [ ] **Step 1: Тест срезов**

В `contract-list.spec.ts` добавить:

```ts
  it('срезы договора собираются из сеток и не повторяются', () => {
    const fill = [
      {
        from: '2026-01-01',
        slices: [
          { customer: null, guestKind: null, mealPlan: 'BB', cells: [] },
          { customer: 'cosmos', guestKind: 'CREW', mealPlan: 'BB', cells: [] },
        ],
      },
      {
        from: '2026-06-01',
        slices: [
          { customer: null, guestKind: null, mealPlan: 'BB', cells: [] },
          { customer: null, guestKind: null, mealPlan: 'HB', cells: [] },
        ],
      },
    ];
    const [row] = mergeContractList([reg({ sheetsCount: 2 })], [doc({ fill })]);
    expect(row.slices).toEqual([
      { customer: null, guestKind: null, mealPlan: 'BB' },
      { customer: null, guestKind: null, mealPlan: 'HB' },
      { customer: 'cosmos', guestKind: 'CREW', mealPlan: 'BB' },
    ]);
  });

  it('без сеток срезов нет, а не пустой срез', () => {
    const [row] = mergeContractList([reg()], [doc()]);
    expect(row.slices).toEqual([]);
  });
```
и в хелпер `doc` добавить `fill: null` в объект по умолчанию.

- [ ] **Step 2: Прогнать — упадёт**

```bash
cd C:/dev/Kars-hotel/backend
pnpm exec jest src/modules/contracts/contract-list.spec.ts
```
Ожидается: FAIL — поля `slices` нет.

- [ ] **Step 3: Собрать срезы**

В `contract-list.ts`:

```ts
/** Срез договора так, как его называет реестр: код авиакомпании, вид брони, питание. */
export interface SliceKey {
  customer: string | null;
  guestKind: 'CREW' | 'DISRUPTION' | null;
  mealPlan: string;
}

const sliceKey = (s: SliceKey) => [s.customer, s.guestKind, s.mealPlan].join('|');

const bySlice = (a: SliceKey, b: SliceKey) =>
  Number(!!a.customer) - Number(!!b.customer) ||
  a.mealPlan.localeCompare(b.mealPlan) ||
  (a.guestKind ?? '').localeCompare(b.guestKind ?? '');

/** Срезы из сеток документа: то, подо что гостиница может завести тариф. */
function slicesOf(fill: unknown): SliceKey[] {
  const grids = Array.isArray(fill) ? (fill as { slices?: unknown[] }[]) : [];
  const out = new Map<string, SliceKey>();
  for (const grid of grids) {
    for (const raw of grid.slices ?? []) {
      const s = raw as Partial<SliceKey>;
      if (!s || typeof s.mealPlan !== 'string') continue;
      const key: SliceKey = {
        customer: s.customer ?? null,
        guestKind: s.guestKind ?? null,
        mealPlan: s.mealPlan,
      };
      out.set(sliceKey(key), key);
    }
  }
  return [...out.values()].sort(bySlice);
}
```

В `ContractView` добавить `slices: SliceKey[];`, в
`ContractPriceDocRow` — `fill: unknown;`. В `mergeContractList`:
в объекте строки из реестра и в объекте `map.get(k) ?? { … }` добавить
`slices: []`; в цикле по документам — 

```ts
    for (const s of slicesOf(d.fill)) {
      if (!row.slices.some((x) => sliceKey(x) === sliceKey(s))) row.slices.push(s);
    }
```
и перед `return` — `row.slices.sort(bySlice)` в `.map` вместе с сортировкой
услуг.

- [ ] **Step 4: Сервис — прочитать сетки**

В `contracts.service.ts` в `list()` в `select` документов добавить
`fill: true,`.

- [ ] **Step 5: Прогнать**

```bash
cd C:/dev/Kars-hotel/backend
pnpm exec jest src/modules/contracts/contract-list.spec.ts
pnpm run build
```
Ожидается: PASS, сборка без ошибок.

- [ ] **Step 6: Коммит (по слову Мусы)**

```bash
git add backend/src/modules/contracts
git commit -m "feat(pms): contract slices in the cabinet list"
```

---

### Task 11: Клиенты API и хуки (фронт)

**Files:**
- Create: `frontend/src/api/contracts.js`
- Create: `frontend/src/hooks/api/useContracts.js`

- [ ] **Step 1: Клиент**

`frontend/src/api/contracts.js`:

```js
import { api } from './client';

/* Договоры партнёров и цены договора (11.11.2026).
 *
 * Реестр договоров ведёт Авиа; ПМС только читает. Цены корпоративного тарифа
 * считает сервер тем же правилом, что и расчёт брони, — экран показывает
 * ровно то, по чему посчитают. */

/** Договоры гостиницы: реестр и приложения. Договор без цен тоже в списке. */
export async function listContracts() {
  const { data } = await api.get('/contracts');
  return data;
}

/** Цены договора для корпоративного тарифа на период. */
export async function fetchContractPrices(planId, from, to) {
  const url = '/rate-plans/' + encodeURIComponent(planId) + '/contract-prices';
  const { data } = await api.get(url, { params: { from, to } });
  return data;
}
```

- [ ] **Step 2: Хуки**

`frontend/src/hooks/api/useContracts.js`:

```js
import { useQuery } from '@tanstack/react-query';
import { fetchContractPrices, listContracts } from '../../api/contracts';

/* Договоры приходят из Авии и меняются при её синхронизации — держим
   недолго, чтобы новая ДС появлялась без перезагрузки страницы. */
export function useContracts() {
  return useQuery({ queryKey: ['contracts'], queryFn: listContracts, staleTime: 60_000 });
}

/** Цены договора для тарифа. Без периода — сервер отдаёт сегодняшний день. */
export function useContractPrices(planId, from, to, enabled = true) {
  return useQuery({
    queryKey: ['contract-prices', planId, from ?? null, to ?? null],
    queryFn: () => fetchContractPrices(planId, from, to),
    enabled: enabled && !!planId,
    staleTime: 60_000,
  });
}
```

- [ ] **Step 3: Проверка**

```bash
cd C:/dev/Kars-hotel/frontend
pnpm run lint
```
Ожидается: без предупреждений (файлы пока нигде не используются — это нормально
до Task 12-13).

- [ ] **Step 4: Коммит (по слову Мусы)**

```bash
git add frontend/src/api/contracts.js frontend/src/hooks/api/useContracts.js
git commit -m "feat(pms): contracts api client and hooks"
```

---

### Task 12: Подтабы корпоративного тарифа

**Files:**
- Create: `frontend/src/Components/HotelPMS/components/Tariffs/ContractPricesTab.jsx`
- Create: `frontend/src/Components/HotelPMS/components/Tariffs/ContractCalendar.jsx`
- Modify: `frontend/src/Components/HotelPMS/components/Tariffs/Tariffs.module.css`

- [ ] **Step 1: Таблица цен договора**

`ContractPricesTab.jsx`:

```jsx
import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { ru } from 'date-fns/locale';
import classes from './Tariffs.module.css';
import Select from '../../shared/Select';
import { useContractPrices } from '../../../../hooks/api/useContracts';

/**
 * «Цены договора» — единственное, что видит гостиница у корпоративного тарифа
 * по деньгам. Ввода здесь нет и быть не может: цены ведёт реестр договоров
 * Авии, а ПМС берёт их оттуда.
 */

const fmtRub = (v) => Number(v).toLocaleString('ru-RU');
const fmtDay = (d) =>
  d ? format(parseISO(String(d).slice(0, 10)), 'd MMM yyyy', { locale: ru }) : '—';
const occLabel = (n) => (n === 1 ? '1 гость' : n + ' гостя');

export default function ContractPricesTab({ plan }) {
  const [period, setPeriod] = useState(null);
  const { data, isLoading, isError } = useContractPrices(plan.id, period ?? undefined, period ?? undefined);

  const cellPrice = useMemo(() => {
    const map = new Map();
    for (const c of data?.nights?.[0]?.prices ?? []) {
      map.set(c.categoryId + '|' + c.occupancy, c.price);
    }
    return map;
  }, [data]);

  if (isLoading) {
    return <div className={classes.sectionHint}>Загрузка цен договора…</div>;
  }
  if (isError) {
    return (
      <div className={classes.emptyHint}>
        Не удалось загрузить цены договора — попробуйте обновить страницу.
      </div>
    );
  }
  if (data?.unknownCustomer) {
    return (
      <div className={classes.emptyHint}>
        Авиакомпания этого тарифа не найдена в справочнике партнёра — посчитать
        нечем. Обратитесь к диспетчеру Kars Avia.
      </div>
    );
  }
  if (!data?.periods?.length) {
    return (
      <div className={classes.emptyHint}>
        Цен по договору {data?.contractNumber ?? ''} ещё нет — Авиа не прислала
        ценовое приложение. Когда пришлёт, тариф заработает сам.
      </div>
    );
  }

  const shown = period ?? data.periods[0];
  const categories = data.categories ?? [];
  const maxCapacity = Math.max(1, ...categories.map((c) => c.capacity ?? 1));
  const guests = Array.from({ length: maxCapacity }, (_, i) => i + 1);

  return (
    <div>
      <div className={classes.sectionHint}>
        Так вас посчитает партнёр. Цены ведутся в его реестре договоров и здесь
        только показываются; в тарифе их не вводят.
      </div>

      <div className={classes.contractPricesHead}>
        <Select
          className={classes.contractPeriodSelect}
          value={shown}
          onChange={(e) => setPeriod(e.target.value)}
        >
          {data.periods.map((p) => (
            <option key={p} value={p}>
              {'Действует с ' + fmtDay(p)}
            </option>
          ))}
        </Select>
        {data.vatRate != null ? (
          <span className={classes.rowChip}>{'НДС ' + Number(data.vatRate) + '%'}</span>
        ) : (
          <span className={classes.rowChip}>без НДС</span>
        )}
      </div>

      <table className={classes.occTable}>
        <thead>
          <tr>
            <th>Категория</th>
            {guests.map((o) => (
              <th key={o}>{occLabel(o)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {categories.map((cat) => (
            <tr key={cat.categoryId}>
              <td>
                <div className={classes.stdName}>{cat.name}</div>
                <div className={classes.stdMeta}>до {cat.capacity ?? '?'} чел.</div>
              </td>
              {guests.map((o) => {
                const price =
                  o <= (cat.capacity ?? 1)
                    ? cellPrice.get(cat.categoryId + '|' + o)
                    : null;
                return (
                  <td key={o}>
                    {price != null ? (
                      fmtRub(price) + ' ₽'
                    ) : (
                      <span className={classes.calNoPrice}>—</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {data.nights?.[0] && data.nights[0].day !== shown ? (
        <div className={classes.fieldHint}>
          Цены показаны на {fmtDay(data.nights[0].day)} — ближайший день периода,
          за который в договоре есть цифры.
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Календарь договора**

`ContractCalendar.jsx`:

```jsx
import { Fragment, useMemo, useState } from 'react';
import { addDays, format, parseISO, subDays } from 'date-fns';
import { ru } from 'date-fns/locale';
import classes from './Tariffs.module.css';
import { useContractPrices } from '../../../../hooks/api/useContracts';

/**
 * «Календарь» корпоративного тарифа — только чтение: цена каждой ночи из
 * периодов договора. Полоса сверху показывает, с какого числа действует новая
 * ДС; ночь вне договора помечена «—» — тариф на неё не посчитается.
 */

const DOW_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const fmtRub = (v) => Number(v).toLocaleString('ru-RU');
const TODAY = (() => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
})();

export default function ContractCalendar({ plan }) {
  const [daysCount, setDaysCount] = useState(14);
  const [start, setStart] = useState(() => subDays(TODAY, 7));

  const days = useMemo(
    () => Array.from({ length: daysCount }, (_, i) => addDays(start, i)),
    [start, daysCount],
  );
  const dayStrs = useMemo(() => days.map((d) => format(d, 'yyyy-MM-dd')), [days]);
  const { data, isLoading } = useContractPrices(
    plan.id,
    dayStrs[0],
    dayStrs[dayStrs.length - 1],
  );

  const byDay = useMemo(() => {
    const map = new Map();
    for (const n of data?.nights ?? []) {
      const perCat = new Map();
      for (const p of n.prices) perCat.set(p.categoryId, p.price);
      map.set(n.day, perCat);
    }
    return map;
  }, [data]);

  const label =
    format(start, 'LLLL', { locale: ru }) + ' ' + format(start, 'yyyy');

  return (
    <div>
      <div className={classes.sectionHint}>
        Цена каждой ночи из договора. Полоса показывает, с какого числа действует
        новая ДС. Ночь вне договора тарифом не считается.
      </div>

      <div className={classes.calendarHeader}>
        <div className={classes.calMonth}>
          <button className={classes.calNavBtn} onClick={() => setStart((v) => subDays(v, 7))}>
            ‹
          </button>
          <span className={classes.calMonthLabel}>{label}</span>
          <button className={classes.calNavBtn} onClick={() => setStart((v) => addDays(v, 7))}>
            ›
          </button>
          <button className={classes.calTodayBtn} onClick={() => setStart(subDays(TODAY, 7))}>
            Сегодня
          </button>
          <div className={classes.calDaysToggle}>
            {[14, 30].map((n) => (
              <button
                key={n}
                className={[classes.calDaysToggleBtn, daysCount === n && classes.calDaysToggleActive]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => setDaysCount(n)}
              >
                {n} дн
              </button>
            ))}
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className={classes.sectionHint}>Загрузка…</div>
      ) : (
        <div className={classes.calendarScroll}>
          <div
            className={classes.calendarGrid}
            style={{ gridTemplateColumns: '168px repeat(' + dayStrs.length + ', minmax(46px, 1fr))' }}
          >
            <div className={classes.calCornerCell}>Категория</div>
            {dayStrs.map((d) => {
              const dow = parseISO(d).getDay();
              const isWe = dow === 0 || dow === 6;
              const isStart = (data?.periods ?? []).includes(d);
              return (
                <div
                  key={d}
                  className={[classes.calDayHeader, isWe && classes.calWeekend, isStart && classes.calToday]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <div className={classes.calDayNum}>{format(parseISO(d), 'd')}</div>
                  <div className={classes.calDow}>{DOW_SHORT[dow]}</div>
                </div>
              );
            })}
            {(data?.categories ?? []).map((cat) => (
              <Fragment key={cat.categoryId}>
                <div className={classes.calRowLabel}>
                  <div className={classes.calRoomTypeName}>{cat.name}</div>
                  <div className={classes.calRoomTypeMeta}>до {cat.capacity ?? '?'} чел.</div>
                </div>
                {dayStrs.map((d) => {
                  const price = byDay.get(d)?.get(cat.categoryId);
                  return (
                    <div
                      key={d}
                      className={[classes.calCell, classes.calCellRel].join(' ')}
                      title={price == null ? 'Вне договора' : undefined}
                    >
                      {price != null ? (
                        <span className={classes.cellStandard}>{fmtRub(price)}</span>
                      ) : (
                        <span className={classes.calNoPrice}>—</span>
                      )}
                    </div>
                  );
                })}
              </Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Стили**

В конец `Tariffs.module.css`:

```css
/* Цены договора: шапка с периодом и НДС. */
.contractPricesHead {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 12px 22px 8px;
  flex-wrap: wrap;
}
.contractPeriodSelect { width: auto; min-width: 200px; height: 32px; font-size: 13px; }
```

- [ ] **Step 4: Проверка**

```bash
cd C:/dev/Kars-hotel/frontend
pnpm run lint
```
Ожидается: без предупреждений.

- [ ] **Step 5: Коммит (по слову Мусы)**

```bash
git add frontend/src/Components/HotelPMS/components/Tariffs/ContractPricesTab.jsx frontend/src/Components/HotelPMS/components/Tariffs/ContractCalendar.jsx frontend/src/Components/HotelPMS/components/Tariffs/Tariffs.module.css
git commit -m "feat(pms): corporate tariff shows contract prices"
```

---

### Task 13: Мастер и экран тарифов

**Files:**
- Modify: `frontend/src/Components/HotelPMS/components/Tariffs/Tariffs.jsx`
- Modify: `frontend/src/Components/HotelPMS/components/Tariffs/corporateTariff.js`

Шаги — отдельные правки одного файла, порядок важен.

- [ ] **Step 1: Убрать плашку-инструкцию**

Удалить функцию `PartnerTariffGuide` (строки 1774-1802) и её вызов
`{partners.length > 0 && <PartnerTariffGuide />}` (строка 1948).

- [ ] **Step 2: Убрать баннер сверки и статусы**

Удалить `CorporateStatus` (строки 1464-1506) и её вызов (строка 1567).
В ярлыке тарифа (строки 1974-1981) убрать классы состояний — оставить имя
партнёра:

```jsx
                    {p.forOperator && (
                      <span className={classes.planTabCorp}>
                        {partners.find((x) => x.id === p.partnerId)?.name ?? 'Партнёр'}
                      </span>
                    )}
```
Из `corporateTariff.js` удалить `STATE_LABEL`.

- [ ] **Step 3: Шаги мастера**

Заменить `WIZARD_STEPS`/`WIZARD_HINTS` (строки 154-161) и
`WizardSteps` (163-176):

```js
const STEPS_OWN = ['Для кого', 'Питание', 'Цены', 'Сезоны', 'Проверка'];
const STEPS_CORP = ['Для кого', 'Договор', 'Срез', 'Проверка'];
const HINTS_OWN = [
  'Назовите тариф и скажите, для кого он.',
  'Что входит в тариф и платит ли гость за питание отдельно.',
  'Одна цена за номер или своя цена на каждое число гостей.',
  'Необязательно: другие цены на отдельные даты. Можно пропустить.',
  'Проверьте и закройте окно: всё уже сохранено.',
];
const HINTS_CORP = [
  'Назовите тариф. Он будет считаться по договору партнёра.',
  'Выберите договор из реестра Kars Avia — цены придут из него.',
  'Для кого этот срез: юрлицо, авиакомпания, вид брони, питание.',
  'Проверьте и создайте: цены уже посчитаны по договору.',
];
```

`WizardSteps` принимает `steps` и `hints`:

```jsx
function WizardSteps({ steps, hints, step }) {
  return (
    <div style={{ padding: '0 24px 8px' }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12.5 }}>
        {steps.map((s, i) => (
          <span
            key={s}
            style={{ fontWeight: i === step ? 700 : 400, color: i === step ? '#1B2A47' : '#8896AB' }}
          >
            {i + 1}. {s}
          </span>
        ))}
      </div>
      <div className={classes.fieldHint} style={{ marginTop: 6 }}>{hints[step]}</div>
    </div>
  );
}
```

- [ ] **Step 4: Форма — состояние, шаги, заготовка среза**

`RatePlanForm` получает `contracts` (список из реестра) и
`prefill`. Начало компонента:

```jsx
function RatePlanForm({ plan, prefill, allPlans, contracts, partners, roomTypes, onSave, onDelete, onClose, saving, error }) {
  const isNew = !plan?.id;
  const [step, setStep] = useState(prefill ? 2 : 0);
  const [form, setForm] = useState({
    code: plan?.code ?? '',
    name: plan?.name ?? '',
    description: plan?.description ?? '',
    mealPlan: prefill?.slice?.mealPlan ?? plan?.mealPlan ?? 'NONE',
    mealIncluded: plan?.mealIncluded ?? true,
    mealPerDayMode: plan?.mealPricePerDay != null,
    mealPriceBreakfast: plan?.mealPriceBreakfast ?? null,
    mealPriceLunch: plan?.mealPriceLunch ?? null,
    mealPriceDinner: plan?.mealPriceDinner ?? null,
    mealPricePerDay: plan?.mealPricePerDay ?? null,
    allInclusiveNote: plan?.allInclusiveNote ?? '',
    isActive: plan?.isActive ?? true,
    parentRatePlanId: plan?.parentRatePlanId ?? '',
    priceModifierType: plan?.priceModifierType ?? 'PERCENT',
    priceModifierValue: plan?.priceModifierValue ?? 0,
    forOperator: plan?.forOperator ?? Boolean(prefill),
    operatorContract: prefill?.contract?.number ?? plan?.operatorContract ?? '',
    partnerId: prefill?.contract?.partnerId ?? plan?.partnerId ?? '',
    partnerAccountId:
      prefill?.contract?.account
        ? (partners.find((p) => p.id === prefill.contract.partnerId)?.accounts ?? [])
            .find((a) => a.code === prefill.contract.account.code)?.id ?? ''
        : (plan?.partnerAccountId ?? ''),
    partnerCustomerId:
      prefill?.slice?.customer
        ? (partners.find((p) => p.id === prefill.contract.partnerId)?.customers ?? [])
            .find((c) => c.code === prefill.slice.customer)?.id ?? ''
        : (plan?.partnerCustomerId ?? ''),
    guestKind: prefill?.slice?.guestKind ?? plan?.guestKind ?? '',
    vatRate: plan?.vatRate != null ? String(Number(plan.vatRate)) : '',
    _autoCode: isNew,
  });
```

Дальше в теле:

```jsx
  const stepList = form.forOperator ? STEPS_CORP : STEPS_OWN;
  const hints = form.forOperator ? HINTS_CORP : HINTS_OWN;
  const chosenContract = contracts.find(
    (c) => c.number === form.operatorContract && (!form.partnerId || c.partnerId === form.partnerId),
  );
  const slices = chosenContract?.slices ?? [];
  const meals = [...new Set(slices.map((s) => s.mealPlan))];
  const customers = [...new Set(slices.map((s) => s.customer).filter(Boolean))];
  const kinds = [...new Set(slices.map((s) => s.guestKind).filter(Boolean))];
```

Шаг 1 корпоративного пути (после блока «Название/Код»):

```jsx
          {form.forOperator && step === 1 && (
            <div className={classes.formGroup} style={{ gridColumn: '1/-1' }}>
              <label>Договор с партнёром *</label>
              <Select
                className={classes.input}
                value={form.operatorContract}
                onChange={(e) => {
                  const c = contracts.find((x) => x.number === e.target.value);
                  setForm((f) => ({
                    ...f,
                    operatorContract: e.target.value,
                    partnerId: c?.partnerId ?? '',
                    partnerAccountId: '',
                    partnerCustomerId: '',
                    guestKind: '',
                  }));
                }}
              >
                <option value="">— выберите договор —</option>
                {contracts.map((c) => (
                  <option key={c.partnerId + '|' + c.number} value={c.number}>
                    {'Договор ' + c.number + (c.account ? ' · ' + c.account.name : '') + (c.hasPrices ? '' : ' — цен нет')}
                  </option>
                ))}
              </Select>
              <div className={classes.fieldHint}>
                {contracts.length
                  ? 'Цены тарифа берутся из этого договора. Меняется договор в реестре — меняется и тариф.'
                  : 'Договоры Kars Avia для вашей гостиницы ещё не пришли. Обратитесь к диспетчеру Kars Avia.'}
              </div>
            </div>
          )}
```

Шаг 2 корпоративного пути — срез (юрлицо берётся из договора, остальное — из
срезов договора):

```jsx
          {form.forOperator && step === 2 && (
            <>
              <div className={classes.formGroup}>
                <label>Юрлицо партнёра</label>
                <Select className={classes.input} value={form.partnerAccountId} onChange={(e) => set('partnerAccountId', e.target.value)}>
                  <option value="">— любое —</option>
                  {(partners.find((p) => p.id === form.partnerId)?.accounts ?? []).map((a) => (
                    <option key={a.id} value={a.id}>{a.name}{a.inn ? ' (ИНН ' + a.inn + ')' : ''}</option>
                  ))}
                </Select>
                <div className={classes.fieldHint}>Оставьте пустым, если договор подходит любому юрлицу партнёра.</div>
              </div>
              <div className={classes.formGroup}>
                <label>Авиакомпания</label>
                <Select className={classes.input} value={form.partnerCustomerId} onChange={(e) => set('partnerCustomerId', e.target.value)}>
                  <option value="">— любая —</option>
                  {(partners.find((p) => p.id === form.partnerId)?.customers ?? [])
                    .filter((c) => customers.length === 0 || customers.includes(c.code))
                    .map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  {customers
                    .filter((code) => !(partners.find((p) => p.id === form.partnerId)?.customers ?? []).some((c) => c.code === code))
                    .map((code) => <option key={code} value="">{code} (нет в справочнике)</option>)}
                </Select>
              </div>
              <div className={classes.formGroup}>
                <label>Вид брони</label>
                <Select className={classes.input} value={form.guestKind} onChange={(e) => set('guestKind', e.target.value)}>
                  <option value="">— любой —</option>
                  {Object.entries(GUEST_KIND_LABELS)
                    .filter(([k]) => kinds.length === 0 || kinds.includes(k))
                    .map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </div>
              <div className={classes.formGroup}>
                <label>Питание *</label>
                <Select className={classes.input} value={form.mealPlan} onChange={(e) => set('mealPlan', e.target.value)}>
                  {(meals.length ? meals : Object.keys(MEAL_PLAN_LABELS)).map((m) => (
                    <option key={m} value={m}>{MEAL_PLAN_LABELS[m] ?? m}</option>
                  ))}
                </Select>
                <div className={classes.fieldHint}>
                  Показано только то, что есть в договоре. Цена питания — из договора.
                </div>
              </div>
            </>
          )}
```

Шаг 3 корпоративного пути — проверка:

```jsx
          {form.forOperator && step === 3 && (
            <div className={classes.formGroup} style={{ gridColumn: '1/-1' }}>
              <div><b>{form.name}</b> · {form.code}</div>
              <div>Договор: {form.operatorContract}{chosenContract?.account ? ' · ' + chosenContract.account.name : ''}</div>
              <div>
                Авиакомпания:{' '}
                {(partners.find((p) => p.id === form.partnerId)?.customers ?? []).find((c) => c.id === form.partnerCustomerId)?.name ?? 'любая'}
              </div>
              <div>Вид брони: {form.guestKind ? GUEST_KIND_LABELS[form.guestKind] : 'любой'}</div>
              <div>Питание: {MEAL_PLAN_LABELS[form.mealPlan] ?? form.mealPlan}</div>
              <div className={classes.fieldHint}>
                Цены — из договора: {chosenContract?.hasPrices
                  ? 'они уже посчитаны и появятся в тарифе сразу.'
                  : 'приложения к договору ещё нет, тариф будет ждать цен.'}
              </div>
            </div>
          )}
```

- [ ] **Step 5: Подвал мастера и создание**

Заменить блок кнопок подвала `RatePlanForm` (строки 503-528) на:

```jsx
        <div className={classes.modalFooter}>
          {!isNew && step === 0 && (
            <button className={classes.btnDelete} onClick={() => onDelete(plan.id)}>Удалить</button>
          )}
          <div style={{ flex: 1 }} />
          <button className={classes.btnCancel} onClick={onClose}>Отмена</button>
          {step > 0 && (
            <button className={classes.btnCancel} onClick={() => setStep(step - 1)}>Назад</button>
          )}
          {step < stepList.length - 1 ? (
            <button
              className={classes.btnSave}
              disabled={!canNext || saving}
              onClick={async () => {
                /* Первый шаг своего тарифа — создание: без id не покажешь ни
                   цены, ни сезоны, а второго окна больше нет. */
                if (!form.forOperator && isNew && step === 1) {
                  const plan = await onSave(form);
                  if (plan) {
                    setCreated(plan);
                    setStep(2);
                  }
                  return;
                }
                setStep(step + 1);
              }}
            >
              Далее
            </button>
          ) : (
            <button
              className={classes.btnSave}
              disabled={saving || !canNext}
              onClick={() => (form.forOperator || !isNew ? onSave(form) : onClose())}
            >
              {saving
                ? 'Сохранение...'
                : isNew
                  ? (form.forOperator ? 'Создать тариф' : 'Готово')
                  : 'Сохранить'}
            </button>
          )}
        </div>
```
и рядом — правило пуска шага:

```jsx
  const canNext =
    step === 0
      ? Boolean(form.name && form.code)
      : form.forOperator && step === 1
        ? Boolean(form.operatorContract)
        : form.forOperator && step === 2
          ? Boolean(form.mealPlan)
          : true;
```

- [ ] **Step 6: Один процесс вместо двух окон**

Удалить `PlanWizard` (967-1008), состояние `wizardPlanId` и его
использование (1822-1823, 2016-2024). `handleSave` в `Tariffs`:

```jsx
  /* Один сборщик тела для всех путей: поля цен и питания уходят только у
     своего тарифа, у корпоративного их нет вовсе (цены — из договора). */
  const payloadOf = (form) => ({
    code: form.code,
    name: form.name,
    description: form.description || undefined,
    mealPlan: form.mealPlan,
    isActive: form.isActive,
    forOperator: form.forOperator,
    parentRatePlanId: form.forOperator ? null : (form.parentRatePlanId || undefined),
    priceModifierType: !form.forOperator && form.parentRatePlanId ? form.priceModifierType : undefined,
    priceModifierValue:
      !form.forOperator && form.parentRatePlanId ? (form.priceModifierValue ?? 0) : undefined,
    ...(form.forOperator
      ? {
          operatorContract: form.operatorContract || null,
          partnerId: form.partnerId || undefined,
          partnerAccountId: form.partnerAccountId || null,
          partnerCustomerId: form.partnerCustomerId || null,
          guestKind: form.guestKind || null,
        }
      : { operatorContract: null, ...mealPayload(form) }),
  });

  const handleSave = async (form) => {
    setFormError(null);
    try {
      if (formData?.id) {
        await updatePlan.mutateAsync({ id: formData.id, payload: payloadOf(form) });
        setShowForm(false);
      } else if (form.forOperator) {
        const created = await createPlan.mutateAsync(payloadOf(form));
        setShowForm(false);
        setSelectedPlanId(created.id);
        return created;
      } else {
        /* Свой тариф: он нужен, чтобы показать шаги «Цены» и «Сезоны» в этом же
           окне. Возвращаем его форме — она сама перейдёт к ним. */
        const created = await createPlan.mutateAsync(payloadOf(form));
        setSelectedPlanId(created.id);
        return created;
      }
    } catch (err) {
      const msg = err?.response?.data?.message;
      setFormError(Array.isArray(msg) ? msg.join(', ') : (msg ?? err.message ?? 'Ошибка'));
    }
  };
```
Шаги 2-4 своего тарифа — те же `StandardPrices` и `Seasons` в этом окне:

```jsx
        {!form.forOperator && created && step === 2 && (
          <div style={{ padding: '0 24px 16px' }}>
            <StandardPrices plan={created} roomTypes={roomTypes} />
          </div>
        )}
        {!form.forOperator && created && step === 3 && (
          <div style={{ padding: '0 24px 16px' }}>
            <Seasons plan={created} roomTypes={roomTypes} />
          </div>
        )}
```
`onSave` возвращает созданный тариф: `created` — состояние формы
(`const [created, setCreated] = useState(null)`), и после своего тарифа форма
делает `const plan = await onSave(form); setCreated(plan); setStep(2);`. В режиме
правки (`isNew === false`) степпер не показываем и шаг один — как раньше.

- [ ] **Step 7: Панель корпоративного тарифа**

В `PlanPanel` убрать `contractSheets`/`partners` из пропсов
`StandardPrices`/`Seasons` (они больше не заполняют по договору) и сделать
подтабы по типу тарифа:

```jsx
      <div className={classes.subTabs}>
        {plan.forOperator ? (
          <>
            <button className={[classes.subTab, tab === 'contract' && classes.subTabActive].filter(Boolean).join(' ')} onClick={() => setTab('contract')}>
              Цены договора
            </button>
            <button className={[classes.subTab, tab === 'calendar' && classes.subTabActive].filter(Boolean).join(' ')} onClick={() => setTab('calendar')}>
              Календарь
            </button>
          </>
        ) : (
          <>
            <button className={[classes.subTab, tab === 'standard' && classes.subTabActive].filter(Boolean).join(' ')} onClick={() => setTab('standard')}>
              Базовые цены
            </button>
            <button className={[classes.subTab, tab === 'seasons' && classes.subTabActive].filter(Boolean).join(' ')} onClick={() => setTab('seasons')}>
              Сезоны {seasonCount > 0 && <span className={classes.subTabBadge}>{seasonCount}</span>}
            </button>
            <button className={[classes.subTab, tab === 'calendar' && classes.subTabActive].filter(Boolean).join(' ')} onClick={() => setTab('calendar')}>
              Календарь
            </button>
          </>
        )}
      </div>
```
Рендер по табу:

```jsx
      {plan.forOperator && tab === 'contract' && <ContractPricesTab plan={plan} />}
      {plan.forOperator && tab === 'calendar' && <ContractCalendar plan={plan} />}
      {!plan.forOperator && tab === 'standard' && <StandardPrices plan={plan} roomTypes={roomTypes} />}
      {!plan.forOperator && tab === 'seasons' && <Seasons plan={plan} roomTypes={roomTypes} />}
      {!plan.forOperator && tab === 'calendar' && <RateCalendar plan={plan} roomTypes={roomTypes} />}
```
Начальный таб: `useEffect(() => { setTab(plan.forOperator ? 'contract' : 'standard'); }, [plan.id, plan.forOperator]);`

В `StandardPrices` и `Seasons` удалить кнопки «Заполнить по договору»,
«Сезоны по договору», блок `filled`-отчёта и `SkippedRows` вместе с
`planDocs`/`contractRows` (строки 613-640, 709-735, 744-755,
770-775, 817-841, 946-948).

- [ ] **Step 8: Блок «Цены по договору» из реестра**

Заменить `OperatorContractPrices` (1596-1698) на:

```jsx
function OperatorContractPrices({ contracts, plans, partners, onCreatePlan }) {
  const customerName = (partner, code) =>
    (partner?.customers ?? []).find((c) => c.code === code)?.name ?? code ?? 'Все авиакомпании';
  const sliceLabel = (partner, s) =>
    [
      customerName(partner, s.customer),
      s.guestKind ? GUEST_KIND_SHORT[s.guestKind] : null,
      MEAL_PLAN_SHORT[s.mealPlan] ?? s.mealPlan,
    ]
      .filter(Boolean)
      .join(' · ');

  return (
    <div className={classes.sectionCard}>
      <div className={classes.sectionTitle}>Цены по договору с партнёром</div>
      <div className={classes.emptyHint}>
        Договоры ведёт Kars Avia; цены берутся из её реестра и здесь только
        показываются. Тариф по договору цены не вводит — он их берёт.
      </div>
      {contracts.map((c) => {
        const partner = partners.find((p) => p.id === c.partnerId) ?? null;
        const sliceOfPlan = (s) =>
          planForSlice(
            plans,
            {
              account: c.account,
              customer: s.customer ? { code: s.customer, name: customerName(partner, s.customer) } : null,
              guestKind: s.guestKind,
              mealPlan: s.mealPlan,
            },
            partner,
            c.number,
          );
        return (
          <div key={c.partnerId + '|' + c.number} className={classes.contractGroup}>
            <div className={classes.contractGroupHead}>
              <b>Договор {c.number}</b>
              {c.account && <span>{c.account.name}</span>}
              <span>
                {c.signedAt ? 'с ' + fmtDay(c.signedAt) : ''}
                {c.expiresAt ? ' по ' + fmtDay(c.expiresAt) : ''}
              </span>
              <span>приложений: {c.documents}</span>
              {c.isPrimary && <span>рабочий</span>}
              {c.state === 'ARCHIVED' && <span>архив</span>}
            </div>
            {!c.hasPrices ? (
              <div className={classes.emptyHint}>
                Цен нет — приложение к договору ещё не пришло. Тариф завести можно:
                он начнёт работать, когда цены придут.
              </div>
            ) : (
              <ul className={classes.sliceList}>
                {c.slices.map((s) => {
                  const plan = sliceOfPlan(s);
                  return (
                    <li key={s.customer + '|' + s.guestKind + '|' + s.mealPlan}>
                      <span>{sliceLabel(partner, s)}</span>
                      {plan ? (
                        <span className={classes.sliceOk}>тариф «{plan.name}»</span>
                      ) : (
                        <button className={classes.btnGhost} onClick={() => onCreatePlan(c, s)}>
                          Завести тариф
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 9: Одна пустота вместо двух**

В `Tariffs` заменить открывающую часть блока тарифов (строки 1950-1960) и
вызов `OperatorContractPrices` (2007-2014). Ветку с тарифами (ярлыки и
`PlanPanel`, строки 1963-2005) оставить без изменений.

Вместо `plans.length === 0 ? … :` поставить:

```jsx
      {plans.length === 0 && (
        <div className={classes.emptyState}>
          <div className={classes.emptyIcon}>
            <svg width="40" height="40" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 11h.01M12 11h.01M15 11h.01M4 5h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7a2 2 0 012-2z" />
            </svg>
          </div>
          <div className={classes.emptyTitle}>Нет тарифных планов</div>
          <div className={classes.emptyText}>
            {contracts.length
              ? 'Договоры уже пришли — тариф по ним заводится кнопкой у среза ниже.'
              : 'Свои тарифы гостиница заводит сама. Корпоративные появятся, когда Kars Avia заведёт договор с вами.'}
          </div>
          <button className={classes.btnAdd} onClick={openNew}>Создать план</button>
        </div>
      )}
```

а `plans.length > 0`-ветку (ярлыки тарифов и `PlanPanel`) оставить как есть, без
`<>`-обёртки или в ней — как удобнее, содержимое не меняется.

Вместо вызова `OperatorContractPrices` (2007-2014):

```jsx
      {contracts.length > 0 && (
        <OperatorContractPrices
          contracts={contracts}
          plans={plans}
          partners={partners}
          onCreatePlan={openForSlice}
        />
      )}
```

`contracts` в `Tariffs` — из хука `useContracts()`; договоры,
пришедшие только приложениями, хук уже отдаёт (склейка на сервере). Заменить в
`Tariffs` (строки 1811-1816):

```js
  const { data: contracts = [] } = useContracts();
```

вместо `useOperatorContractPrices()` и мемо `contracts` по приложениям;
`useOperatorContractPrices` больше не используется — удалить импорт.

Кнопка формы получает `contracts={contracts}`.

- [ ] **Step 10: Убрать клиентскую раскладку цен**

В `corporateTariff.js` удалить `fillGrid`, `gridCells`,
`sliceCells`, `docsAt`, `contractPeriods`, `planDocs`,
`contractSlices`, `accommodationRows`, `matchContractRows`,
`rowMismatch`, `rowRoomTypes`, `rowLabel` и
`QUIET_REASONS` (вместе с `SkippedRows` в `Tariffs.jsx`).
Оставить: `priceKey`, `occupancyLabel`, `occupancyColumns`,
`pickOccupancy`, `partnerConditions`, `GUEST_KIND_LABELS`,
`GUEST_KIND_SHORT`, `MEAL_PLAN_SHORT`, `VAT_RATES`,
`planForSlice`, `sliceName` (если ещё используется).

- [ ] **Step 11: Проверка**

```bash
cd C:/dev/Kars-hotel/frontend
pnpm run lint
pnpm run build
```
Ожидается: без предупреждений, сборка проходит.

- [ ] **Step 12: Коммит (по слову Мусы)**

```bash
git add frontend/src/Components/HotelPMS/components/Tariffs
git commit -m "feat(pms): tariff wizard, contract prices screen and one empty state"
```

---

### Task 14: Проверка всего и уборка

- [ ] **Step 1: Бэкенд**

```bash
cd C:/dev/Kars-hotel/backend
pnpm exec prisma generate
pnpm run build
pnpm exec jest src/modules/contracts src/modules/rate-plans src/modules/connectivity
```
Ожидается: сборка без ошибок, целевые тесты PASS.

- [ ] **Step 2: Фронт**

```bash
cd C:/dev/Kars-hotel/frontend
pnpm run lint
pnpm run build
```
Ожидается: без предупреждений, сборка проходит.

- [ ] **Step 3: Авиа**

```bash
cd C:/dev/kars-avia-v3
pnpm exec jest -c libs/identity/jest.config.cts contract-price-mirror
cd libs/identity
pnpm exec tsc --build tsconfig.json --emitDeclarationOnly
```
Ожидается: PASS, типы без ошибок.

- [ ] **Step 4: Проверить, что чужие правки не тронуты**

```bash
cd C:/dev/Kars-hotel
git status --porcelain
```
Ожидается: в списке только файлы этой задачи; `docker-compose.dev.yml` остался
чужой правкой с начала работы (её не трогаем и не коммитим).

- [ ] **Step 5: Отдать Мусе на приёмку**

Что смотреть:
1. «Тарифы»: плашки нет; «Новый план» — мастер с этапами; договоры видны даже
   без цен; у среза есть «Завести тариф».
2. Корпоративный тариф: подтабы «Цены договора» и «Календарь», ввода нет.
3. Гостиница без договоров: один пустой экран, а не два блока.



