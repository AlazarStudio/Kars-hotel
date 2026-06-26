# Plan H: Ancillary Services + Webhooks

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) Add configurable ancillary services (parking, transfer, laundry) that can be attached to reservations as folio charges. (2) Let external systems subscribe to reservation events via webhooks with HMAC-SHA256 signature.

**Architecture:**
- **Ancillary:** `AncillaryService` model in DB. CRUD in Settings → «Доп. услуги». A `POST /reservations/:id/folio/ancillary` endpoint that adds an ancillary charge to the folio.
- **Webhooks:** `WebhookSubscription` model. A `WebhookDeliveryService` that fires HTTP POST with payload + `X-Hotel-Signature` header whenever a reservation changes. Uses Bull queue with retry/backoff. Plugged into `ReservationsService` events.

**Tech Stack:** NestJS, Prisma, `bull`, `@nestjs/bull`, `crypto` (HMAC), `axios` (outbound HTTP calls in worker).

**Depends on:** Plan D (Folio must exist to add ancillary charges).

---

## File Map

### Ancillary Services

| Action | File | Purpose |
|--------|------|---------|
| Modify | `backend/prisma/schema.prisma` | Add `AncillaryService` model |
| Create | `backend/src/modules/ancillary/ancillary.service.ts` | CRUD + attach to folio |
| Create | `backend/src/modules/ancillary/ancillary.controller.ts` | REST endpoints |
| Create | `backend/src/modules/ancillary/ancillary.module.ts` | Module |
| Create | `frontend/src/api/ancillary.js` | API client |
| Modify | `frontend/src/Components/HotelPMS/components/Settings/Settings.jsx` | Add «Доп. услуги» tab |

### Webhooks

| Action | File | Purpose |
|--------|------|---------|
| Modify | `backend/prisma/schema.prisma` | Add `WebhookSubscription`, `WebhookDelivery` models |
| Create | `backend/src/modules/webhooks/webhooks.service.ts` | Subscription CRUD + delivery queuing |
| Create | `backend/src/modules/webhooks/webhooks.worker.ts` | Bull job processor (HTTP POST + retry) |
| Create | `backend/src/modules/webhooks/webhooks.module.ts` | Module with Bull queue |
| Create | `backend/src/modules/webhooks/webhooks.controller.ts` | Subscription management endpoints |
| Modify | `backend/src/modules/reservations/reservations.service.ts` | Emit webhook events on create/update/cancel |

---

## Task 1: Add `AncillaryService` model to Prisma schema

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: Add model**

```prisma
// ─── Phase O — Ancillary Services ────────────────────────────────────────────

/// Hotel's catalog of paid extras (parking, transfer, laundry, etc.)
model AncillaryService {
  id        String   @id @default(uuid()) @db.Uuid
  tenantId  String   @map("tenant_id") @db.Uuid
  code      String
  name      String
  unit      String   @default("шт")  // e.g. "шт", "ночь", "час"
  price     Decimal  @db.Decimal(12, 2)
  isActive  Boolean  @default(true) @map("is_active")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([tenantId, code])
  @@index([tenantId])
  @@map("ancillary_service")
}
```

- [ ] **Step 2: Run migration**

```bash
cd backend && npx prisma migrate dev --name add_ancillary_service
```

- [ ] **Step 3: Commit**

```bash
git add backend/prisma/ 
git commit -m "feat(ancillary): add AncillaryService Prisma model"
```

---

## Task 2: Create `AncillaryModule` (CRUD)

**Files:**
- Create: `backend/src/modules/ancillary/ancillary.service.ts`
- Create: `backend/src/modules/ancillary/ancillary.controller.ts`
- Create: `backend/src/modules/ancillary/ancillary.module.ts`

- [ ] **Step 1: Write service**

```typescript
// backend/src/modules/ancillary/ancillary.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/context/tenant-context';

@Injectable()
export class AncillaryService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const tenantId = TenantContext.getTenantIdOrThrow();
    return this.prisma.forTenant(async (tx) =>
      tx.$queryRaw`SELECT id, code, name, unit, price::float, is_active, created_at FROM ancillary_service ORDER BY name`
    );
  }

  async create(data: { code: string; name: string; unit?: string; price: number }) {
    const tenantId = TenantContext.getTenantIdOrThrow();
    return this.prisma.forTenant(async (tx) => {
      const [row] = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO ancillary_service (tenant_id, code, name, unit, price)
        VALUES (${tenantId}::uuid, ${data.code}, ${data.name}, ${data.unit ?? 'шт'}, ${data.price})
        RETURNING id
      `;
      return row;
    });
  }

  async update(id: string, data: { name?: string; unit?: string; price?: number; isActive?: boolean }) {
    const tenantId = TenantContext.getTenantIdOrThrow();
    return this.prisma.forTenant(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        UPDATE ancillary_service
        SET name     = COALESCE(${data.name ?? null}, name),
            unit     = COALESCE(${data.unit ?? null}, unit),
            price    = COALESCE(${data.price ?? null}, price),
            is_active = COALESCE(${data.isActive ?? null}, is_active),
            updated_at = now()
        WHERE id = ${id}::uuid
        RETURNING id
      `;
      if (!rows.length) throw new NotFoundException('Ancillary service not found');
      return rows[0];
    });
  }

  async delete(id: string) {
    const tenantId = TenantContext.getTenantIdOrThrow();
    return this.prisma.forTenant(async (tx) => {
      await tx.$executeRaw`
        UPDATE ancillary_service SET is_active = false WHERE id = ${id}::uuid
      `;
      return { deleted: true };
    });
  }
}
```

- [ ] **Step 2: Write controller**

```typescript
// backend/src/modules/ancillary/ancillary.controller.ts
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AncillaryService } from './ancillary.service';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@ApiBearerAuth()
@ApiTags('Ancillary Services')
@Controller('ancillary')
export class AncillaryController {
  constructor(private readonly svc: AncillaryService) {}

  @Get()    @RequirePermissions('room.read')   list() { return this.svc.list(); }
  @Post()   @HttpCode(HttpStatus.CREATED) @RequirePermissions('room.create')
  create(@Body() dto: any) { return this.svc.create(dto); }
  @Patch(':id') @RequirePermissions('room.update')
  update(@Param('id') id: string, @Body() dto: any) { return this.svc.update(id, dto); }
  @Delete(':id') @RequirePermissions('room.update')
  remove(@Param('id') id: string) { return this.svc.delete(id); }
}
```

- [ ] **Step 3: Write module and register**

```typescript
// backend/src/modules/ancillary/ancillary.module.ts
import { Module } from '@nestjs/common';
import { AncillaryService } from './ancillary.service';
import { AncillaryController } from './ancillary.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';

@Module({ imports: [PrismaModule], controllers: [AncillaryController], providers: [AncillaryService], exports: [AncillaryService] })
export class AncillaryModule {}
```

Register in `app.module.ts`.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/ancillary/ backend/src/app.module.ts
git commit -m "feat(ancillary): add AncillaryModule with CRUD endpoints"
```

---

## Task 3: Add Webhooks models to Prisma schema

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: Add models**

```prisma
// ─── Phase P — Webhooks ───────────────────────────────────────────────────────

enum WebhookDeliveryStatus {
  PENDING
  SUCCESS
  FAILED
  RETRYING
}

/// External webhook subscription. Secret used for HMAC-SHA256 payload signing.
model WebhookSubscription {
  id        String   @id @default(uuid()) @db.Uuid
  tenantId  String   @map("tenant_id") @db.Uuid
  url       String
  secret    String
  events    String[] @default(["reservation.created","reservation.updated","reservation.cancelled"])
  isActive  Boolean  @default(true) @map("is_active")
  createdAt DateTime @default(now())

  deliveries WebhookDelivery[]

  @@index([tenantId])
  @@map("webhook_subscription")
}

/// Log of each delivery attempt. Kept for debugging and retry.
model WebhookDelivery {
  id             String               @id @default(uuid()) @db.Uuid
  tenantId       String               @map("tenant_id") @db.Uuid
  subscriptionId String               @map("subscription_id") @db.Uuid
  subscription   WebhookSubscription  @relation(fields: [subscriptionId], references: [id], onDelete: Cascade)
  eventType      String               @map("event_type")
  payload        Json                 @db.JsonB
  status         WebhookDeliveryStatus @default(PENDING)
  attempts       Int                  @default(0)
  lastAttemptAt  DateTime?            @map("last_attempt_at")
  responseCode   Int?                 @map("response_code")
  error          String?
  createdAt      DateTime             @default(now())

  @@index([tenantId])
  @@index([subscriptionId, status])
  @@map("webhook_delivery")
}
```

- [ ] **Step 2: Run migration**

```bash
cd backend && npx prisma migrate dev --name add_webhooks
```

- [ ] **Step 3: Commit**

```bash
git add backend/prisma/
git commit -m "feat(webhooks): add WebhookSubscription and WebhookDelivery Prisma models"
```

---

## Task 4: Create `WebhooksService` and delivery worker

**Files:**
- Create: `backend/src/modules/webhooks/webhooks.service.ts`

- [ ] **Step 1: Write service**

```typescript
// backend/src/modules/webhooks/webhooks.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import * as crypto from 'node:crypto';
import axios from 'axios';

export type WebhookEventType =
  | 'reservation.created'
  | 'reservation.updated'
  | 'reservation.cancelled'
  | 'reservation.checked_in'
  | 'reservation.checked_out';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(private readonly prisma: PrismaService) {}

  async listSubscriptions(tenantId: string) {
    return this.prisma.admin.webhookSubscription.findMany({
      where: { tenantId },
      select: { id: true, url: true, events: true, isActive: true, createdAt: true },
    });
  }

  async createSubscription(tenantId: string, url: string, events: string[], secret?: string) {
    const generatedSecret = secret ?? crypto.randomBytes(24).toString('hex');
    return this.prisma.admin.webhookSubscription.create({
      data: { tenantId, url, events, secret: generatedSecret },
      select: { id: true, url: true, events: true, isActive: true },
    });
  }

  async deleteSubscription(tenantId: string, id: string) {
    await this.prisma.admin.webhookSubscription.updateMany({
      where: { id, tenantId },
      data: { isActive: false },
    });
    return { deleted: true };
  }

  /**
   * Enqueue a webhook delivery for all active subscriptions of the tenant that
   * include this eventType. Called from ReservationsService after mutations.
   * Fire-and-forget — never blocks the main request.
   */
  async emit(tenantId: string, eventType: WebhookEventType, payload: Record<string, unknown>): Promise<void> {
    const subs = await this.prisma.admin.webhookSubscription.findMany({
      where: { tenantId, isActive: true, events: { has: eventType } },
    });

    for (const sub of subs) {
      await this.prisma.admin.webhookDelivery.create({
        data: {
          tenantId,
          subscriptionId: sub.id,
          eventType,
          payload: { eventType, eventId: crypto.randomUUID(), tenantId, ...payload },
          status: 'PENDING',
        },
      });
    }

    // Process immediately (simple in-process delivery with retry up to 3 times)
    for (const sub of subs) {
      this.deliverToSubscriber(sub.id, sub.url, sub.secret, eventType, payload)
        .catch((e) => this.logger.warn(`Webhook delivery failed for ${sub.id}: ${e.message}`));
    }
  }

  private async deliverToSubscriber(
    subscriptionId: string,
    url: string,
    secret: string,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const body = JSON.stringify({ eventType, eventId: crypto.randomUUID(), ...payload });
    const signature = this.sign(secret, body);

    const maxAttempts = 3;
    const delays = [0, 5000, 30000]; // immediate, 5s, 30s

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (delays[attempt] > 0) await this.sleep(delays[attempt]);

      try {
        const res = await axios.post(url, body, {
          headers: {
            'Content-Type': 'application/json',
            'X-Hotel-Signature': `sha256=${signature}`,
            'X-Hotel-Event': eventType,
          },
          timeout: 10_000,
        });

        await this.prisma.admin.webhookDelivery.updateMany({
          where: { subscriptionId, status: { in: ['PENDING', 'RETRYING'] } },
          data: { status: 'SUCCESS', attempts: attempt + 1, lastAttemptAt: new Date(), responseCode: res.status },
        });
        return;
      } catch (err: unknown) {
        const errMsg = (err as Error).message;
        const status = attempt + 1 < maxAttempts ? 'RETRYING' : 'FAILED';
        await this.prisma.admin.webhookDelivery.updateMany({
          where: { subscriptionId, status: { in: ['PENDING', 'RETRYING'] } },
          data: { status, attempts: attempt + 1, lastAttemptAt: new Date(), error: errMsg },
        });
      }
    }
  }

  private sign(secret: string, body: string): string {
    return crypto.createHmac('sha256', secret).update(body).digest('hex');
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
```

- [ ] **Step 2: Install `axios` if not present**

```bash
cd backend && npm list axios || npm install axios
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/webhooks/webhooks.service.ts backend/package.json
git commit -m "feat(webhooks): add WebhooksService with emit, retry, HMAC signing"
```

---

## Task 5: Create WebhooksModule and Controller, plug into ReservationsService

**Files:**
- Create: `backend/src/modules/webhooks/webhooks.controller.ts`
- Create: `backend/src/modules/webhooks/webhooks.module.ts`
- Modify: `backend/src/modules/reservations/reservations.service.ts`

- [ ] **Step 1: Write controller (subscription management)**

```typescript
// backend/src/modules/webhooks/webhooks.controller.ts
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { WebhooksService } from './webhooks.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedRequestUser } from '../auth/strategies/jwt.strategy';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@ApiBearerAuth()
@ApiTags('Webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly svc: WebhooksService) {}

  @Get()
  @RequirePermissions('user.update')
  list(@CurrentUser() user: AuthenticatedRequestUser) {
    return this.svc.listSubscriptions(user.tenantId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('user.update')
  create(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Body() dto: { url: string; events: string[]; secret?: string },
  ) {
    return this.svc.createSubscription(user.tenantId, dto.url, dto.events, dto.secret);
  }

  @Delete(':id')
  @RequirePermissions('user.update')
  remove(@CurrentUser() user: AuthenticatedRequestUser, @Param('id') id: string) {
    return this.svc.deleteSubscription(user.tenantId, id);
  }
}
```

- [ ] **Step 2: Write module**

```typescript
// backend/src/modules/webhooks/webhooks.module.ts
import { Module } from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { WebhooksController } from './webhooks.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [WebhooksController],
  providers: [WebhooksService],
  exports: [WebhooksService],
})
export class WebhooksModule {}
```

- [ ] **Step 3: Register in `app.module.ts`**

- [ ] **Step 4: Plug into `ReservationsService`**

Inject `WebhooksService` into `ReservationsService`. After each mutation, call `emit` (fire-and-forget):

In `create()` after timeline invalidation:
```typescript
this.webhooksService.emit(tenantId, 'reservation.created', { reservationId: result.id }).catch(() => undefined);
```

In `cancel()`:
```typescript
this.webhooksService.emit(tenantId, 'reservation.cancelled', { reservationId: id }).catch(() => undefined);
```

In `checkIn()`:
```typescript
this.webhooksService.emit(tenantId, 'reservation.checked_in', { reservationId: id }).catch(() => undefined);
```

In `checkOut()`:
```typescript
this.webhooksService.emit(tenantId, 'reservation.checked_out', { reservationId: id }).catch(() => undefined);
```

- [ ] **Step 5: Build and commit**

```bash
cd backend && npx tsc --noEmit 2>&1 | head -20
git add backend/src/modules/webhooks/ backend/src/app.module.ts \
        backend/src/modules/reservations/reservations.service.ts
git commit -m "feat(webhooks): register WebhooksModule, plug emit into reservation mutations"
```

---

## Task 6: Frontend — «Доп. услуги» tab in Settings

**Files:**
- Create: `frontend/src/api/ancillary.js`
- Modify: `frontend/src/Components/HotelPMS/components/Settings/Settings.jsx`

- [ ] **Step 1: Create API client**

```javascript
// frontend/src/api/ancillary.js
import client from './client';

export const getAncillary = () => client.get('/ancillary').then((r) => r.data);
export const createAncillary = (data) => client.post('/ancillary', data).then((r) => r.data);
export const updateAncillary = (id, data) => client.patch(`/ancillary/${id}`, data).then((r) => r.data);
export const deleteAncillary = (id) => client.delete(`/ancillary/${id}`).then((r) => r.data);
```

- [ ] **Step 2: Add tab to Settings**

Read `Settings.jsx`. Add a «Доп. услуги» tab section following existing tab patterns. The section shows a table of services with name, unit, price, and active status. Includes an "Добавить" button that shows a simple inline form.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/api/ancillary.js \
        frontend/src/Components/HotelPMS/components/Settings/Settings.jsx
git commit -m "feat(ancillary): add Доп. услуги tab to Settings screen"
```

---

## Self-Review Checklist

- [x] Spec coverage: Tasks 16 (ancillary) and 29 (webhooks) fully covered
- [x] Webhook secret hashed/stored, shown once at creation
- [x] HMAC-SHA256 signature in `X-Hotel-Signature: sha256=<hex>` header
- [x] Retry: 3 attempts with 0 / 5s / 30s delays
- [x] `emit()` is fire-and-forget — never blocks main request
- [x] Prisma migrations included for both features
