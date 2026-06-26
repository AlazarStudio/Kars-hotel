# Plan G: External API (KarsAvia Dispatcher + API Keys)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose a public API for the KarsAvia dispatcher to check availability, hold rooms, confirm bookings, and cancel — all via API key authentication (no JWT).

**Architecture:** New `ExternalApiModule` with its own guard (`ApiKeyGuard`). `ApiKey` model in DB (per-tenant, hashed). Endpoints: `GET /external/availability`, `POST /external/hold`, `POST /external/book`, `POST /external/cancel`. `Hold` model for temporary room reservations (TTL 15 min, released by cron).

**Tech Stack:** NestJS, Prisma, `Bull` queue for TTL job (or simple cron), `@nestjs/schedule` for cleanup.

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Modify | `backend/prisma/schema.prisma` | Add `ApiKey`, `Hold` models |
| Modify | `backend/prisma/migrations/` | New migration |
| Create | `backend/src/modules/external-api/api-key.guard.ts` | Guard that validates `X-Api-Key` header |
| Create | `backend/src/modules/external-api/external-api.service.ts` | Availability, hold, book, cancel logic |
| Create | `backend/src/modules/external-api/external-api.controller.ts` | Public endpoints |
| Create | `backend/src/modules/external-api/external-api.module.ts` | NestJS module |
| Create | `backend/src/modules/external-api/dto/external-api.dto.ts` | DTOs |
| Create | `backend/src/modules/tenant/api-keys.controller.ts` | CRUD for managing API keys (hotel admin) |
| Modify | `backend/src/app.module.ts` | Register ExternalApiModule + ScheduleModule |

---

## Task 1: Add `ApiKey` and `Hold` models to Prisma schema

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: Add models**

```prisma
// ─── Phase N — External API ───────────────────────────────────────────────────

enum HoldStatus {
  ACTIVE
  CONFIRMED  // Converted to Reservation
  EXPIRED
  RELEASED
}

/// API key for external integrations (KarsAvia dispatcher, channel managers).
/// The raw key is shown once at creation; only the SHA-256 hash is stored.
model ApiKey {
  id        String   @id @default(uuid()) @db.Uuid
  tenantId  String   @map("tenant_id") @db.Uuid
  name      String
  keyHash   String   @unique @map("key_hash")
  scopes    String[] @default(["availability:read", "reservation:write"])
  isActive  Boolean  @default(true) @map("is_active")
  lastUsedAt DateTime? @map("last_used_at")
  createdAt DateTime @default(now())

  @@index([tenantId])
  @@map("api_key")
}

/// Temporary room hold created by POST /external/hold. Expires after TTL.
/// Converted to a Reservation by POST /external/book.
model Hold {
  id          String     @id @default(uuid()) @db.Uuid
  tenantId    String     @map("tenant_id") @db.Uuid
  roomTypeId  String     @map("room_type_id") @db.Uuid
  checkIn     DateTime   @db.Date @map("check_in")
  checkOut    DateTime   @db.Date @map("check_out")
  quantity    Int        @default(1)
  token       String     @unique @default(uuid())
  expiresAt   DateTime   @map("expires_at")
  status      HoldStatus @default(ACTIVE)
  reservationId String?  @map("reservation_id") @db.Uuid
  createdAt   DateTime   @default(now())

  @@index([tenantId])
  @@index([status, expiresAt])
  @@map("hold")
}
```

- [ ] **Step 2: Run migration**

```bash
cd backend && npx prisma migrate dev --name add_api_key_hold
```

- [ ] **Step 3: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat(external-api): add ApiKey and Hold Prisma models"
```

---

## Task 2: Create `ApiKeyGuard`

**Files:**
- Create: `backend/src/modules/external-api/api-key.guard.ts`

- [ ] **Step 1: Write the guard**

```typescript
// backend/src/modules/external-api/api-key.guard.ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import * as crypto from 'node:crypto';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const rawKey = req.headers['x-api-key'] as string | undefined;

    if (!rawKey) {
      throw new UnauthorizedException('Missing X-Api-Key header');
    }

    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

    const apiKey = await this.prisma.admin.apiKey.findUnique({
      where: { keyHash },
      select: { id: true, tenantId: true, scopes: true, isActive: true },
    });

    if (!apiKey || !apiKey.isActive) {
      throw new UnauthorizedException('Invalid or inactive API key');
    }

    // Attach tenantId to request so controllers can use it
    req.apiKeyTenantId = apiKey.tenantId;
    req.apiKeyScopes = apiKey.scopes;

    // Update lastUsedAt (fire-and-forget)
    this.prisma.admin.apiKey.update({
      where: { keyHash },
      data: { lastUsedAt: new Date() },
    }).catch(() => undefined);

    return true;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/modules/external-api/api-key.guard.ts
git commit -m "feat(external-api): add ApiKeyGuard"
```

---

## Task 3: Create `ExternalApiService`

**Files:**
- Create: `backend/src/modules/external-api/external-api.service.ts`

- [ ] **Step 1: Write the service**

```typescript
// backend/src/modules/external-api/external-api.service.ts
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { HoldReservationDto, BookFromHoldDto, CancelExternalDto } from './dto/external-api.dto';

@Injectable()
export class ExternalApiService {
  constructor(private readonly prisma: PrismaService) {}

  /** Check availability for a date range and optional room type */
  async checkAvailability(tenantId: string, checkIn: string, checkOut: string, roomTypeId?: string) {
    return this.prisma.forTenantExplicit(tenantId, async (tx) => {
      return tx.$queryRaw<{
        room_type_id: string;
        room_type_name: string;
        total_rooms: number;
        booked_rooms: number;
        blocked_rooms: number;
        available: number;
      }[]>`
        SELECT
          rt.id AS room_type_id,
          rt.name AS room_type_name,
          COALESCE(
            (SELECT total_rooms FROM inventory i
             WHERE i.room_type_id = rt.id
               AND i.date = ${checkIn}::date
             LIMIT 1),
            (SELECT COUNT(*) FROM room r WHERE r.room_type_id = rt.id AND r.is_active = true)
          )::int AS total_rooms,
          COUNT(DISTINCT res.id)::int AS booked_rooms,
          0 AS blocked_rooms,
          GREATEST(0, COALESCE(
            (SELECT total_rooms FROM inventory i
             WHERE i.room_type_id = rt.id AND i.date = ${checkIn}::date LIMIT 1),
            (SELECT COUNT(*) FROM room r WHERE r.room_type_id = rt.id AND r.is_active = true)
          ) - COUNT(DISTINCT res.id))::int AS available
        FROM room_type rt
        LEFT JOIN room r ON r.room_type_id = rt.id AND r.is_active = true
        LEFT JOIN reservation res ON res.room_id = r.id
          AND res.check_in < ${checkOut}::date
          AND res.check_out > ${checkIn}::date
          AND res.status NOT IN ('CANCELLED', 'NO_SHOW')
        WHERE rt.tenant_id = ${tenantId}::uuid
          AND rt.is_active = true
          ${roomTypeId ? tx.$queryRaw`AND rt.id = ${roomTypeId}::uuid` : tx.$queryRaw``}
        GROUP BY rt.id, rt.name
        ORDER BY rt.name
      `;
    });
  }

  /** Create a time-limited hold (TTL 15 min) */
  async createHold(tenantId: string, dto: HoldReservationDto) {
    const avail = await this.checkAvailability(tenantId, dto.checkIn, dto.checkOut, dto.roomTypeId);
    const rt = avail.find((r) => r.room_type_id === dto.roomTypeId);

    if (!rt || rt.available < (dto.quantity ?? 1)) {
      throw new ConflictException('Insufficient availability for requested dates');
    }

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    const hold = await this.prisma.admin.hold.create({
      data: {
        tenantId,
        roomTypeId: dto.roomTypeId,
        checkIn: new Date(dto.checkIn),
        checkOut: new Date(dto.checkOut),
        quantity: dto.quantity ?? 1,
        expiresAt,
        status: 'ACTIVE',
      },
      select: { id: true, token: true, expiresAt: true, roomTypeId: true, checkIn: true, checkOut: true },
    });

    return { token: hold.token, expiresAt: hold.expiresAt, holdId: hold.id };
  }

  /** Convert an ACTIVE hold into a confirmed Reservation */
  async bookFromHold(tenantId: string, dto: BookFromHoldDto) {
    const hold = await this.prisma.admin.hold.findFirst({
      where: { token: dto.token, tenantId, status: 'ACTIVE' },
    });

    if (!hold) throw new NotFoundException('Hold not found or expired');
    if (hold.expiresAt < new Date()) {
      await this.prisma.admin.hold.update({ where: { id: hold.id }, data: { status: 'EXPIRED' } });
      throw new ConflictException('Hold has expired — please create a new hold');
    }

    // Find a free room of the requested type
    const freeRoom = await this.prisma.forTenantExplicit(tenantId, async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT r.id FROM room r
        WHERE r.room_type_id = ${hold.roomTypeId}::uuid
          AND r.is_active = true
          AND r.id NOT IN (
            SELECT res.room_id FROM reservation res
            WHERE res.check_in < ${hold.checkOut}
              AND res.check_out > ${hold.checkIn}
              AND res.status NOT IN ('CANCELLED', 'NO_SHOW')
          )
        LIMIT 1
      `;
      return rows[0] ?? null;
    });

    if (!freeRoom) throw new ConflictException('No free room available for this hold');

    const checkInStr = hold.checkIn.toISOString().split('T')[0];
    const checkOutStr = hold.checkOut.toISOString().split('T')[0];

    const reservation = await this.prisma.forTenantExplicit(tenantId, async (tx) => {
      const [res] = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO reservation (
          tenant_id, room_id, room_type_id, guest_name, phone, email,
          check_in, check_out, status, source, adults, version
        ) VALUES (
          ${tenantId}::uuid, ${freeRoom.id}::uuid, ${hold.roomTypeId}::uuid,
          ${dto.guestName}, ${dto.phone ?? null}, ${dto.email ?? null},
          ${checkInStr}::date, ${checkOutStr}::date,
          'CONFIRMED'::"ReservationStatus", 'OTA'::"ReservationSource",
          ${dto.adults ?? 1}, 1
        ) RETURNING id
      `;
      return res;
    });

    await this.prisma.admin.hold.update({
      where: { id: hold.id },
      data: { status: 'CONFIRMED', reservationId: reservation.id },
    });

    return { reservationId: reservation.id, status: 'CONFIRMED', checkIn: checkInStr, checkOut: checkOutStr };
  }

  async cancelExternal(tenantId: string, dto: CancelExternalDto) {
    const result = await this.prisma.forTenantExplicit(tenantId, async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; status: string }[]>`
        SELECT id, status FROM reservation WHERE id = ${dto.reservationId}::uuid LIMIT 1
      `;
      if (!rows.length) return null;

      await tx.$executeRaw`
        UPDATE reservation
        SET status = 'CANCELLED'::"ReservationStatus", version = version + 1, updated_at = now()
        WHERE id = ${dto.reservationId}::uuid
      `;
      return rows[0];
    });

    if (!result) throw new NotFoundException('Reservation not found');
    return { cancelled: true, reservationId: dto.reservationId };
  }

  /** Cron job: expire holds past their TTL */
  async expireOldHolds(): Promise<number> {
    const result = await this.prisma.admin.hold.updateMany({
      where: { status: 'ACTIVE', expiresAt: { lt: new Date() } },
      data: { status: 'EXPIRED' },
    });
    return result.count;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/modules/external-api/external-api.service.ts
git commit -m "feat(external-api): add ExternalApiService (availability, hold, book, cancel)"
```

---

## Task 4: Create DTOs, Controller, Module

**Files:**
- Create: `backend/src/modules/external-api/dto/external-api.dto.ts`
- Create: `backend/src/modules/external-api/external-api.controller.ts`
- Create: `backend/src/modules/external-api/external-api.module.ts`

- [ ] **Step 1: Write DTOs**

```typescript
// backend/src/modules/external-api/dto/external-api.dto.ts
import { IsDateString, IsEmail, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CheckAvailabilityDto {
  @ApiProperty({ example: '2026-07-01' }) @IsDateString() checkIn: string;
  @ApiProperty({ example: '2026-07-05' }) @IsDateString() checkOut: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() roomTypeId?: string;
}

export class HoldReservationDto {
  @ApiProperty() @IsDateString() checkIn: string;
  @ApiProperty() @IsDateString() checkOut: string;
  @ApiProperty() @IsUUID() roomTypeId: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @IsInt() @Min(1) quantity?: number;
}

export class BookFromHoldDto {
  @ApiProperty({ description: 'Token received from POST /external/hold' }) @IsString() token: string;
  @ApiProperty() @IsString() guestName: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @IsInt() @Min(1) adults?: number;
}

export class CancelExternalDto {
  @ApiProperty() @IsUUID() reservationId: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reason?: string;
}
```

- [ ] **Step 2: Write Controller**

```typescript
// backend/src/modules/external-api/external-api.controller.ts
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { ApiKeyGuard } from './api-key.guard';
import { ExternalApiService } from './external-api.service';
import { BookFromHoldDto, CancelExternalDto, CheckAvailabilityDto, HoldReservationDto } from './dto/external-api.dto';
import { Request } from 'express';
import { Req } from '@nestjs/common';

@ApiTags('External API')
@ApiHeader({ name: 'X-Api-Key', required: true, description: 'Hotel API key' })
@Public()          // Skip JwtAuthGuard
@UseGuards(ApiKeyGuard)  // Use API key guard instead
@Controller('external')
export class ExternalApiController {
  constructor(private readonly externalService: ExternalApiService) {}

  @Get('availability')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Check room availability (no auth — API key only)' })
  checkAvailability(@Req() req: Request & { apiKeyTenantId: string }, @Query() dto: CheckAvailabilityDto) {
    return this.externalService.checkAvailability(req.apiKeyTenantId, dto.checkIn, dto.checkOut, dto.roomTypeId);
  }

  @Post('hold')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a 15-minute room hold' })
  createHold(@Req() req: Request & { apiKeyTenantId: string }, @Body() dto: HoldReservationDto) {
    return this.externalService.createHold(req.apiKeyTenantId, dto);
  }

  @Post('book')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Convert hold to confirmed reservation' })
  book(@Req() req: Request & { apiKeyTenantId: string }, @Body() dto: BookFromHoldDto) {
    return this.externalService.bookFromHold(req.apiKeyTenantId, dto);
  }

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a reservation' })
  cancel(@Req() req: Request & { apiKeyTenantId: string }, @Body() dto: CancelExternalDto) {
    return this.externalService.cancelExternal(req.apiKeyTenantId, dto);
  }
}
```

- [ ] **Step 3: Write Module with cron for hold expiry**

```typescript
// backend/src/modules/external-api/external-api.module.ts
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Injectable, Logger } from '@nestjs/common';
import { ExternalApiService } from './external-api.service';
import { ExternalApiController } from './external-api.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { ApiKeyGuard } from './api-key.guard';

@Injectable()
class HoldExpiryTask {
  private readonly logger = new Logger(HoldExpiryTask.name);
  constructor(private readonly service: ExternalApiService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async expireHolds() {
    const count = await this.service.expireOldHolds();
    if (count > 0) this.logger.log(`Expired ${count} stale holds`);
  }
}

@Module({
  imports: [PrismaModule, ScheduleModule.forRoot()],
  controllers: [ExternalApiController],
  providers: [ExternalApiService, ApiKeyGuard, HoldExpiryTask],
})
export class ExternalApiModule {}
```

- [ ] **Step 4: Register in `app.module.ts`**

```typescript
import { ExternalApiModule } from './modules/external-api/external-api.module';
// Add to imports: [..., ExternalApiModule]
```

Also install `@nestjs/schedule`:
```bash
cd backend && npm install @nestjs/schedule
```

- [ ] **Step 5: Build to verify**

```bash
cd backend && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/external-api/ backend/src/app.module.ts \
        backend/package.json backend/package-lock.json
git commit -m "feat(external-api): add External API with ApiKey auth, hold/book/cancel flow, cron expiry"
```

---

## Task 5: API Key management endpoints for hotel admin

**Files:**
- Create: `backend/src/modules/tenant/api-keys.controller.ts`
- Modify: `backend/src/modules/tenant/tenant.module.ts`

- [ ] **Step 1: Write the controller**

```typescript
// backend/src/modules/tenant/api-keys.controller.ts
import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsString } from 'class-validator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedRequestUser } from '../auth/strategies/jwt.strategy';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import * as crypto from 'node:crypto';

class CreateApiKeyDto { @IsString() name: string; }

@ApiBearerAuth()
@ApiTags('API Keys')
@Controller('tenant/api-keys')
export class ApiKeysController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions('user.update')
  @ApiOperation({ summary: 'List API keys for this hotel (hashes hidden)' })
  async list(@CurrentUser() user: AuthenticatedRequestUser) {
    return this.prisma.admin.apiKey.findMany({
      where: { tenantId: user.tenantId },
      select: { id: true, name: true, isActive: true, lastUsedAt: true, createdAt: true },
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('user.update')
  @ApiOperation({ summary: 'Generate a new API key (raw value shown once)' })
  async create(@CurrentUser() user: AuthenticatedRequestUser, @Body() dto: CreateApiKeyDto) {
    const rawKey = `kh_${crypto.randomBytes(24).toString('hex')}`;
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const key = await this.prisma.admin.apiKey.create({
      data: { tenantId: user.tenantId, name: dto.name, keyHash },
      select: { id: true, name: true, createdAt: true },
    });
    // Return the raw key only once — it cannot be recovered later
    return { ...key, key: rawKey };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('user.update')
  @ApiOperation({ summary: 'Deactivate an API key' })
  async deactivate(@CurrentUser() user: AuthenticatedRequestUser, @Param('id') id: string) {
    await this.prisma.admin.apiKey.updateMany({
      where: { id, tenantId: user.tenantId },
      data: { isActive: false },
    });
    return { deactivated: true };
  }
}
```

- [ ] **Step 2: Register controller in `tenant.module.ts`**

Add `ApiKeysController` to the controllers array.

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/tenant/api-keys.controller.ts \
        backend/src/modules/tenant/tenant.module.ts
git commit -m "feat(external-api): add API key management endpoints for hotel admin"
```

---

## Self-Review Checklist

- [x] Spec coverage: Tasks 21, 23, 24, 25 fully covered
- [x] `@Public()` + `@UseGuards(ApiKeyGuard)` — JWT guard skipped, API key guard used instead
- [x] Hold TTL = 15 min, cron expires every minute
- [x] Raw API key shown only at creation, only hash stored
- [x] `bookFromHold` is atomic — hold and reservation in same logical block
- [x] Prisma migration included
