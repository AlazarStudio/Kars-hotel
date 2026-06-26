# Plan D: Folio & Payments

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a guest billing system: each reservation gets a Folio with charge lines (room nights, extras, penalties). Staff can record cash/card payments. Check-out is blocked if balance > 0.

**Architecture:** New Prisma models `Folio`, `FolioCharge`, `Payment`. A `FolioService` handles all billing logic. `ReservationsService.checkOut()` calls `folio.assertZeroBalance()`. Frontend adds a "Счёт" tab to the booking detail card.

**Tech Stack:** NestJS module `folio`, Prisma migrations, React Query.

**Depends on:** Plan B (check-out must call folio balance check).

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Modify | `backend/prisma/schema.prisma` | Add `Folio`, `FolioCharge`, `Payment` models |
| Modify | `backend/prisma/migrations/` | New migration |
| Create | `backend/src/modules/folio/folio.service.ts` | Billing logic |
| Create | `backend/src/modules/folio/folio.controller.ts` | REST endpoints |
| Create | `backend/src/modules/folio/folio.module.ts` | NestJS module |
| Create | `backend/src/modules/folio/dto/folio.dto.ts` | DTOs |
| Modify | `backend/src/app.module.ts` | Register FolioModule |
| Modify | `backend/src/modules/reservations/reservations.service.ts` | Call folio balance check in checkOut |
| Create | `frontend/src/api/folio.js` | API client |
| Create | `frontend/src/hooks/api/useFolio.js` | React Query hooks |
| Modify | `frontend/src/Components/HotelPMS/components/Timeline/BookingForm.jsx` | Add "Счёт" tab |

---

## Task 1: Add Folio models to Prisma schema

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: Add enums and models at the end of the schema**

```prisma
// ─── Phase L — Folio & Payments ──────────────────────────────────────────────

enum FolioStatus {
  OPEN
  CLOSED
  SETTLED
}

enum FolioChargeType {
  ROOM          // Ночи проживания
  MEAL          // Питание
  ANCILLARY     // Доп. услуга
  PENALTY       // Штраф (отмена/no-show)
  MANUAL        // Ручная корректировка
}

enum PaymentMethod {
  CASH
  CARD
  BANK_TRANSFER
  OTA_PASSTHRU   // OTA собрала и перечислит
}

enum PaymentType {
  PAYMENT
  DEPOSIT
  REFUND
}

/// One billing account per reservation. Balance = Σcharges − Σpayments.
model Folio {
  id            String      @id @default(uuid()) @db.Uuid
  tenantId      String      @map("tenant_id") @db.Uuid
  reservationId String      @unique @map("reservation_id") @db.Uuid
  status        FolioStatus @default(OPEN)
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt

  charges  FolioCharge[]
  payments Payment[]

  @@index([tenantId])
  @@index([reservationId])
  @@map("folio")
}

/// Individual charge line on a folio (room night, meal, extra, penalty).
model FolioCharge {
  id          String          @id @default(uuid()) @db.Uuid
  tenantId    String          @map("tenant_id") @db.Uuid
  folioId     String          @map("folio_id") @db.Uuid
  folio       Folio           @relation(fields: [folioId], references: [id], onDelete: Cascade)
  type        FolioChargeType
  description String
  quantity    Decimal         @default(1) @db.Decimal(8, 2)
  unitPrice   Decimal         @map("unit_price") @db.Decimal(12, 2)
  total       Decimal         @db.Decimal(12, 2)
  addedAt     DateTime        @default(now()) @map("added_at")
  addedBy     String?         @map("added_by") @db.Uuid

  @@index([tenantId])
  @@index([folioId])
  @@map("folio_charge")
}

/// Cash/card/transfer payment recorded against a folio.
model Payment {
  id          String        @id @default(uuid()) @db.Uuid
  tenantId    String        @map("tenant_id") @db.Uuid
  folioId     String        @map("folio_id") @db.Uuid
  folio       Folio         @relation(fields: [folioId], references: [id], onDelete: Cascade)
  type        PaymentType   @default(PAYMENT)
  method      PaymentMethod @default(CASH)
  amount      Decimal       @db.Decimal(12, 2)
  note        String?
  receivedAt  DateTime      @default(now()) @map("received_at")
  receivedBy  String?       @map("received_by") @db.Uuid

  @@index([tenantId])
  @@index([folioId])
  @@map("payment")
}
```

- [ ] **Step 2: Run migration**

```bash
cd backend && npx prisma migrate dev --name add_folio_payment
```

Expected: migration created and applied, Prisma client regenerated.

- [ ] **Step 3: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat(folio): add Folio, FolioCharge, Payment Prisma models"
```

---

## Task 2: Create `FolioService`

**Files:**
- Create: `backend/src/modules/folio/folio.service.ts`

- [ ] **Step 1: Write the service**

```typescript
// backend/src/modules/folio/folio.service.ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/context/tenant-context';
import { AddChargeDto, AddPaymentDto } from './dto/folio.dto';

@Injectable()
export class FolioService {
  constructor(private readonly prisma: PrismaService) {}

  /** Get or create the folio for a reservation. Auto-creates on first access. */
  async getOrCreate(reservationId: string) {
    const tenantId = TenantContext.getTenantIdOrThrow();

    let folio = await this.prisma.admin.folio.findUnique({
      where: { reservationId },
      include: {
        charges: { orderBy: { addedAt: 'asc' } },
        payments: { orderBy: { receivedAt: 'asc' } },
      },
    });

    if (!folio) {
      folio = await this.prisma.admin.folio.create({
        data: { tenantId, reservationId },
        include: {
          charges: true,
          payments: true,
        },
      });
    }

    return this.withBalance(folio);
  }

  async addCharge(reservationId: string, dto: AddChargeDto, userId: string) {
    const tenantId = TenantContext.getTenantIdOrThrow();
    const folio = await this.getOrCreateRaw(reservationId, tenantId);

    const total = Number(dto.quantity) * Number(dto.unitPrice);

    const charge = await this.prisma.admin.folioCharge.create({
      data: {
        tenantId,
        folioId: folio.id,
        type: dto.type,
        description: dto.description,
        quantity: dto.quantity,
        unitPrice: dto.unitPrice,
        total,
        addedBy: userId,
      },
    });

    return charge;
  }

  async addPayment(reservationId: string, dto: AddPaymentDto, userId: string) {
    const tenantId = TenantContext.getTenantIdOrThrow();
    const folio = await this.getOrCreateRaw(reservationId, tenantId);

    const payment = await this.prisma.admin.payment.create({
      data: {
        tenantId,
        folioId: folio.id,
        type: dto.type ?? 'PAYMENT',
        method: dto.method,
        amount: dto.amount,
        note: dto.note ?? null,
        receivedBy: userId,
      },
    });

    return payment;
  }

  async deleteCharge(chargeId: string) {
    const tenantId = TenantContext.getTenantIdOrThrow();
    const charge = await this.prisma.admin.folioCharge.findFirst({
      where: { id: chargeId, tenantId },
    });
    if (!charge) throw new NotFoundException('Charge not found');
    await this.prisma.admin.folioCharge.delete({ where: { id: chargeId } });
    return { deleted: true };
  }

  /**
   * Called by checkOut. Throws 409 if balance > 0.
   */
  async assertZeroBalance(reservationId: string): Promise<void> {
    const tenantId = TenantContext.getTenantIdOrThrow();
    const folio = await this.prisma.admin.folio.findUnique({
      where: { reservationId },
      include: {
        charges: { select: { total: true } },
        payments: { select: { amount: true, type: true } },
      },
    });
    if (!folio) return; // No folio = nothing charged = balance is 0

    const totalCharged = folio.charges.reduce((s, c) => s + Number(c.total), 0);
    const totalPaid = folio.payments.reduce((s, p) => {
      return p.type === 'REFUND' ? s - Number(p.amount) : s + Number(p.amount);
    }, 0);
    const balance = totalCharged - totalPaid;

    if (balance > 0.01) {
      throw new ConflictException(
        `Cannot check out: outstanding balance of ${balance.toFixed(2)} must be settled first`,
      );
    }
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private async getOrCreateRaw(reservationId: string, tenantId: string) {
    const existing = await this.prisma.admin.folio.findUnique({ where: { reservationId } });
    if (existing) return existing;
    return this.prisma.admin.folio.create({ data: { tenantId, reservationId } });
  }

  private withBalance(folio: {
    id: string;
    reservationId: string;
    status: string;
    charges: { total: number | string }[];
    payments: { amount: number | string; type: string }[];
    createdAt: Date;
    updatedAt: Date;
  }) {
    const totalCharged = folio.charges.reduce((s, c) => s + Number(c.total), 0);
    const totalPaid = folio.payments.reduce((s, p) => {
      return p.type === 'REFUND' ? s - Number(p.amount) : s + Number(p.amount);
    }, 0);
    const balance = totalCharged - totalPaid;
    return { ...folio, totalCharged, totalPaid, balance };
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/modules/folio/folio.service.ts
git commit -m "feat(folio): add FolioService with getOrCreate, addCharge, addPayment, assertZeroBalance"
```

---

## Task 3: Create DTOs, Controller, Module

**Files:**
- Create: `backend/src/modules/folio/dto/folio.dto.ts`
- Create: `backend/src/modules/folio/folio.controller.ts`
- Create: `backend/src/modules/folio/folio.module.ts`

- [ ] **Step 1: Write DTOs**

```typescript
// backend/src/modules/folio/dto/folio.dto.ts
import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AddChargeDto {
  @ApiProperty({ enum: ['ROOM', 'MEAL', 'ANCILLARY', 'PENALTY', 'MANUAL'] })
  @IsEnum(['ROOM', 'MEAL', 'ANCILLARY', 'PENALTY', 'MANUAL'])
  type: string;

  @ApiProperty({ example: 'Проживание 2 ночи' })
  @IsString()
  @IsNotEmpty()
  description: string;

  @ApiProperty({ example: 2 })
  @IsNumber()
  @Min(0.01)
  quantity: number;

  @ApiProperty({ example: 5000 })
  @IsNumber()
  @Min(0)
  unitPrice: number;
}

export class AddPaymentDto {
  @ApiProperty({ enum: ['CASH', 'CARD', 'BANK_TRANSFER', 'OTA_PASSTHRU'] })
  @IsEnum(['CASH', 'CARD', 'BANK_TRANSFER', 'OTA_PASSTHRU'])
  method: string;

  @ApiProperty({ example: 10000 })
  @IsNumber()
  @Min(0.01)
  amount: number;

  @ApiPropertyOptional({ enum: ['PAYMENT', 'DEPOSIT', 'REFUND'] })
  @IsOptional()
  @IsEnum(['PAYMENT', 'DEPOSIT', 'REFUND'])
  type?: string;

  @ApiPropertyOptional({ example: 'Наличные на стойке' })
  @IsOptional()
  @IsString()
  note?: string;
}
```

- [ ] **Step 2: Write Controller**

```typescript
// backend/src/modules/folio/folio.controller.ts
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FolioService } from './folio.service';
import { AddChargeDto, AddPaymentDto } from './dto/folio.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedRequestUser } from '../auth/strategies/jwt.strategy';

@ApiBearerAuth()
@ApiTags('Folio')
@Controller('reservations/:reservationId/folio')
export class FolioController {
  constructor(private readonly folioService: FolioService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('folio.read')
  @ApiOperation({ summary: 'Get folio for a reservation (creates if missing)' })
  get(@Param('reservationId') reservationId: string) {
    return this.folioService.getOrCreate(reservationId);
  }

  @Post('charges')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('folio.update')
  @ApiOperation({ summary: 'Add a charge line to the folio' })
  addCharge(
    @Param('reservationId') reservationId: string,
    @Body() dto: AddChargeDto,
    @CurrentUser() user: AuthenticatedRequestUser,
  ) {
    return this.folioService.addCharge(reservationId, dto, user.userId);
  }

  @Delete('charges/:chargeId')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('folio.update')
  @ApiOperation({ summary: 'Remove a charge line' })
  deleteCharge(@Param('chargeId') chargeId: string) {
    return this.folioService.deleteCharge(chargeId);
  }

  @Post('payments')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('payment.create')
  @ApiOperation({ summary: 'Record a payment against the folio' })
  addPayment(
    @Param('reservationId') reservationId: string,
    @Body() dto: AddPaymentDto,
    @CurrentUser() user: AuthenticatedRequestUser,
  ) {
    return this.folioService.addPayment(reservationId, dto, user.userId);
  }
}
```

- [ ] **Step 3: Write Module**

```typescript
// backend/src/modules/folio/folio.module.ts
import { Module } from '@nestjs/common';
import { FolioService } from './folio.service';
import { FolioController } from './folio.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [FolioController],
  providers: [FolioService],
  exports: [FolioService],
})
export class FolioModule {}
```

- [ ] **Step 4: Register in `app.module.ts`**

```typescript
// In app.module.ts imports array, add:
import { FolioModule } from './modules/folio/folio.module';
// Add to imports: [..., FolioModule]
```

- [ ] **Step 5: Build to verify**

```bash
cd backend && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/folio/
git commit -m "feat(folio): add FolioController, FolioModule, DTOs + register in AppModule"
```

---

## Task 4: Integrate `assertZeroBalance` into `checkOut`

**Files:**
- Modify: `backend/src/modules/reservations/reservations.service.ts`
- Modify: `backend/src/modules/reservations/reservations.module.ts`

- [ ] **Step 1: Inject `FolioService` into `ReservationsService`**

In `reservations.module.ts`, add `FolioModule` to imports:
```typescript
imports: [TimelineModule, FolioModule],
```

In `reservations.service.ts` constructor, add:
```typescript
constructor(
  private readonly prisma: PrismaService,
  private readonly timelineService: TimelineService,
  private readonly timelineGateway: TimelineGateway,
  private readonly folioService: FolioService,  // ← add
) {}
```

- [ ] **Step 2: Add balance check to `checkOut()`**

At the beginning of `checkOut()`, before the forTenant transaction, add:
```typescript
// Assert folio is settled before allowing check-out
await this.folioService.assertZeroBalance(id);
```

- [ ] **Step 3: Build and commit**

```bash
cd backend && npx tsc --noEmit 2>&1 | head -30
git add backend/src/modules/reservations/ backend/src/modules/folio/
git commit -m "feat(folio): block check-out when folio balance > 0"
```

---

## Task 5: Add `folio.*` and `payment.*` permissions

**Files:**
- Modify: `backend/src/modules/auth/auth.constants.ts`

- [ ] **Step 1: Verify `folio.read`, `folio.update`, `payment.create`, `payment.refund` exist**

```bash
grep -E "folio\.|payment\." backend/src/modules/auth/auth.constants.ts
```

If missing, add to `SYSTEM_PERMISSIONS` and ensure they are in FRONT_DESK and ACCOUNTANT role defaults.

- [ ] **Step 2: Commit if changed**

```bash
git add backend/src/modules/auth/auth.constants.ts
git commit -m "feat(folio): ensure folio.* and payment.* permissions in auth.constants"
```

---

## Task 6: Frontend — "Счёт" tab in BookingForm

**Files:**
- Create: `frontend/src/api/folio.js`
- Create: `frontend/src/hooks/api/useFolio.js`
- Modify: `frontend/src/Components/HotelPMS/components/Timeline/BookingForm.jsx`

- [ ] **Step 1: Create API client**

```javascript
// frontend/src/api/folio.js
import client from './client';

const base = (reservationId) => `/reservations/${reservationId}/folio`;

export const getFolio = (reservationId) =>
  client.get(base(reservationId)).then((r) => r.data);

export const addCharge = (reservationId, data) =>
  client.post(`${base(reservationId)}/charges`, data).then((r) => r.data);

export const deleteCharge = (reservationId, chargeId) =>
  client.delete(`${base(reservationId)}/charges/${chargeId}`).then((r) => r.data);

export const addPayment = (reservationId, data) =>
  client.post(`${base(reservationId)}/payments`, data).then((r) => r.data);
```

- [ ] **Step 2: Create hook**

```javascript
// frontend/src/hooks/api/useFolio.js
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addCharge, addPayment, deleteCharge, getFolio } from '../../api/folio';

export function useFolio(reservationId) {
  return useQuery({
    queryKey: ['folio', reservationId],
    queryFn: () => getFolio(reservationId),
    enabled: !!reservationId,
  });
}

export function useAddCharge(reservationId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => addCharge(reservationId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['folio', reservationId] }),
  });
}

export function useAddPayment(reservationId) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data) => addPayment(reservationId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['folio', reservationId] }),
  });
}
```

- [ ] **Step 3: Add "Счёт" tab to `BookingForm.jsx`**

Read the current `BookingForm.jsx`. Add a tab "Счёт" alongside any existing tabs (or create a tab bar if none exists). The tab content:

```jsx
// FolioTab component inline or separate:
function FolioTab({ reservationId }) {
  const { data: folio, isLoading } = useFolio(reservationId);
  const addChargeMutation = useAddCharge(reservationId);
  const addPaymentMutation = useAddPayment(reservationId);

  if (isLoading) return <div>Загрузка счёта...</div>;

  return (
    <div className="space-y-4">
      {/* Charges table */}
      <div>
        <h3 className="font-medium mb-2">Начисления</h3>
        <table className="w-full text-sm">
          <thead><tr>
            <th className="text-left">Описание</th>
            <th className="text-right">Кол-во</th>
            <th className="text-right">Цена</th>
            <th className="text-right">Итого</th>
          </tr></thead>
          <tbody>
            {folio?.charges?.map((c) => (
              <tr key={c.id}>
                <td>{c.description}</td>
                <td className="text-right">{c.quantity}</td>
                <td className="text-right">{Number(c.unitPrice).toLocaleString('ru-RU')} ₽</td>
                <td className="text-right">{Number(c.total).toLocaleString('ru-RU')} ₽</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Payments */}
      <div>
        <h3 className="font-medium mb-2">Оплаты</h3>
        {folio?.payments?.map((p) => (
          <div key={p.id} className="flex justify-between text-sm">
            <span>{p.method} — {p.type}</span>
            <span>{Number(p.amount).toLocaleString('ru-RU')} ₽</span>
          </div>
        ))}
      </div>

      {/* Balance summary */}
      <div className="border-t pt-3 space-y-1 text-sm">
        <div className="flex justify-between"><span>Начислено:</span><span>{Number(folio?.totalCharged ?? 0).toLocaleString('ru-RU')} ₽</span></div>
        <div className="flex justify-between"><span>Оплачено:</span><span>{Number(folio?.totalPaid ?? 0).toLocaleString('ru-RU')} ₽</span></div>
        <div className={`flex justify-between font-bold ${Number(folio?.balance) > 0 ? 'text-red-600' : 'text-green-600'}`}>
          <span>Остаток:</span><span>{Number(folio?.balance ?? 0).toLocaleString('ru-RU')} ₽</span>
        </div>
      </div>

      {/* Quick payment button */}
      {Number(folio?.balance) > 0 && (
        <button
          onClick={() => addPaymentMutation.mutate({ method: 'CASH', amount: folio.balance })}
          className="w-full py-2 bg-green-600 text-white rounded-lg text-sm"
        >
          Принять оплату {Number(folio?.balance).toLocaleString('ru-RU')} ₽ (наличные)
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/folio.js \
        frontend/src/hooks/api/useFolio.js \
        frontend/src/Components/HotelPMS/components/Timeline/BookingForm.jsx
git commit -m "feat(folio): add Счёт tab to booking form with charges and payment recording"
```

---

## Self-Review Checklist

- [x] Spec coverage: Tasks 47 and 48 fully covered — Folio, FolioCharge, Payment models + API + frontend tab
- [x] `assertZeroBalance` blocks check-out when balance > 0
- [x] Auto-creates folio on first access (no manual "open folio" step needed)
- [x] Refunds handled via `PaymentType.REFUND` (negative impact on balance)
- [x] Prisma migration included as a required step
- [x] `@RequirePermissions` on all endpoints
