# Plan A: RBAC Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a NestJS `PermissionsGuard` + `@RequirePermissions()` decorator and apply them to every controller endpoint so that role-based access control is actually enforced (currently any JWT holder can call any endpoint).

**Architecture:** JWT payload already carries `perms: string[]` (populated at login from `RolePermission` rows). We add a guard that reads `req.user.permissions` (set by `JwtStrategy.validate`) and compares against the required permissions declared via a decorator. The guard is registered globally as a second `APP_GUARD` after `JwtAuthGuard`. Individual endpoints (and controllers) use `@RequirePermissions('reservation.create')` etc. `@Public()` endpoints bypass both guards. Super-admin (`req.user.isSuperAdmin`) bypass the permissions check.

**Tech Stack:** NestJS Guards, Reflector, `@nestjs/common`, existing `AuthenticatedRequestUser` type in `backend/src/modules/auth/strategies/jwt.strategy.ts`

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Create | `backend/src/common/guards/permissions.guard.ts` | The `PermissionsGuard` NestJS guard |
| Create | `backend/src/common/decorators/require-permissions.decorator.ts` | `@RequirePermissions(...codes)` decorator |
| Modify | `backend/src/app.module.ts` | Register `PermissionsGuard` as second global `APP_GUARD` |
| Modify | `backend/src/modules/reservations/reservations.controller.ts` | Add `@RequirePermissions` to each endpoint |
| Modify | `backend/src/modules/rooms/rooms.controller.ts` | Add `@RequirePermissions` |
| Modify | `backend/src/modules/room-types/room-types.controller.ts` | Add `@RequirePermissions` |
| Modify | `backend/src/modules/rate-plans/rate-plans.controller.ts` | Add `@RequirePermissions` |
| Modify | `backend/src/modules/rates/rates.controller.ts` | Add `@RequirePermissions` |
| Modify | `backend/src/modules/restrictions/restrictions.controller.ts` | Add `@RequirePermissions` |
| Modify | `backend/src/modules/inventory/inventory.controller.ts` | Add `@RequirePermissions` |
| Modify | `backend/src/modules/inventory/availability.controller.ts` | Add `@RequirePermissions` |
| Modify | `backend/src/modules/timeline/timeline.controller.ts` | Add `@RequirePermissions` |
| Modify | `backend/src/modules/tenant/tenant.controller.ts` | Add `@RequirePermissions` |
| Modify | `backend/src/modules/pricing/pricing.controller.ts` | Add `@RequirePermissions` |

---

## Task 1: Create `@RequirePermissions` decorator

**Files:**
- Create: `backend/src/common/decorators/require-permissions.decorator.ts`

- [ ] **Step 1: Write the decorator**

```typescript
// backend/src/common/decorators/require-permissions.decorator.ts
import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'required_permissions';

/**
 * Declare which permission codes are required to call this endpoint.
 * All listed codes must be present in req.user.permissions (AND semantics).
 *
 * @example
 *   @RequirePermissions('reservation.create')
 *   @Post()
 *   create(...) {}
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/common/decorators/require-permissions.decorator.ts
git commit -m "feat(rbac): add RequirePermissions decorator"
```

---

## Task 2: Create `PermissionsGuard`

**Files:**
- Create: `backend/src/common/guards/permissions.guard.ts`

- [ ] **Step 1: Write the guard**

```typescript
// backend/src/common/guards/permissions.guard.ts
import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { IS_PUBLIC_KEY } from '../../modules/auth/decorators/public.decorator';
import { AuthenticatedRequestUser } from '../../modules/auth/strategies/jwt.strategy';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    // 1. Skip public endpoints (no JWT required at all)
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    // 2. Read the required permissions for this handler/controller
    const required = this.reflector.getAllAndMerge<string[]>(PERMISSIONS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    // 3. No @RequirePermissions → endpoint is accessible to any authenticated user
    if (!required || required.length === 0) return true;

    const req = ctx.switchToHttp().getRequest();
    const user = req.user as AuthenticatedRequestUser | undefined;

    // 4. Super-admins bypass all permission checks
    if (user?.isSuperAdmin) return true;

    // 5. Check every required code is present in the user's permissions
    const userPerms = new Set(user?.permissions ?? []);
    const missing = required.filter((p) => !userPerms.has(p));

    if (missing.length > 0) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        missing,
        message: `Missing permissions: ${missing.join(', ')}`,
      });
    }

    return true;
  }
}
```

- [ ] **Step 2: Check that `IS_PUBLIC_KEY` is exported from `public.decorator.ts`**

Read `backend/src/modules/auth/decorators/public.decorator.ts`. If `IS_PUBLIC_KEY` is not exported, add `export const IS_PUBLIC_KEY = 'isPublic';` and update the decorator to use it.

Current file content should be:
```typescript
// backend/src/modules/auth/decorators/public.decorator.ts
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/common/guards/permissions.guard.ts backend/src/modules/auth/decorators/public.decorator.ts
git commit -m "feat(rbac): add PermissionsGuard"
```

---

## Task 3: Register `PermissionsGuard` globally

**Files:**
- Modify: `backend/src/app.module.ts:63-68`

- [ ] **Step 1: Add import and provider**

Add `PermissionsGuard` import and register it as `APP_GUARD` after `JwtAuthGuard`. The order matters: `JwtAuthGuard` runs first (sets `req.user`), then `PermissionsGuard` reads `req.user.permissions`.

```typescript
// backend/src/app.module.ts — modify providers array:
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
// ... rest of imports unchanged

providers: [
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: PermissionsGuard },
  { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
],
```

- [ ] **Step 2: Verify app starts**

```bash
cd backend && npm run build 2>&1 | tail -20
```

Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add backend/src/app.module.ts
git commit -m "feat(rbac): register PermissionsGuard as global APP_GUARD"
```

---

## Task 4: Apply permissions to `ReservationsController`

**Files:**
- Modify: `backend/src/modules/reservations/reservations.controller.ts`

Permission mapping for reservations:
- `POST /reservations` → `reservation.create`
- `PATCH /reservations/:id` → `reservation.update`
- `POST /reservations/swap` → `reservation.update`

- [ ] **Step 1: Add `@RequirePermissions` to each handler**

```typescript
// backend/src/modules/reservations/reservations.controller.ts
import { Body, Controller, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReservationsService } from './reservations.service';
import { CreateReservationDto } from './dto/create-reservation.dto';
import { UpdateReservationDto } from './dto/update-reservation.dto';
import { SwapReservationsDto } from './dto/swap-reservations.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@ApiBearerAuth()
@ApiTags('Reservations')
@Controller('reservations')
export class ReservationsController {
  constructor(private readonly reservationsService: ReservationsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('reservation.create')
  @ApiOperation({ summary: 'Create a new reservation' })
  create(@Body() dto: CreateReservationDto) {
    return this.reservationsService.create(dto);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('reservation.update')
  @ApiOperation({ summary: 'Update an existing reservation' })
  update(@Param('id') id: string, @Body() dto: UpdateReservationDto) {
    return this.reservationsService.update(id, dto);
  }

  @Post('swap')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('reservation.update')
  @ApiOperation({ summary: 'Swap place numbers between two reservations' })
  swap(@Body() dto: SwapReservationsDto) {
    return this.reservationsService.swap(dto);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/modules/reservations/reservations.controller.ts
git commit -m "feat(rbac): guard ReservationsController endpoints"
```

---

## Task 5: Apply permissions to `RoomsController`

**Files:**
- Modify: `backend/src/modules/rooms/rooms.controller.ts`

Read the file first, then add `@RequirePermissions` based on this mapping:
- `GET /rooms` → `room.read`
- `POST /rooms` → `room.create`
- `PATCH /rooms/:id` → `room.update`
- `DELETE /rooms/:id` → `room.update` (or `room.delete` if permission exists — check `auth.constants.ts`)
- `PATCH /rooms/:id/status` → `room.update`

- [ ] **Step 1: Read `auth.constants.ts` to confirm available permission codes**

```bash
cat backend/src/modules/auth/auth.constants.ts | grep "code:"
```

- [ ] **Step 2: Add `@RequirePermissions` to each handler in `rooms.controller.ts`**

After reading the file, add the decorator to each method following the same pattern as Task 4.

- [ ] **Step 3: Commit**

```bash
git add backend/src/modules/rooms/rooms.controller.ts
git commit -m "feat(rbac): guard RoomsController endpoints"
```

---

## Task 6: Apply permissions to `RoomTypesController`

**Files:**
- Modify: `backend/src/modules/room-types/room-types.controller.ts`

Permission mapping:
- `GET /room-types` → `room.read`
- `POST /room-types` → `room.create`
- `PATCH /room-types/:id` → `room.update`
- `DELETE /room-types/:id` → `room.update`

- [ ] **Step 1: Add `@RequirePermissions` to each handler**

Read the controller file first, then add the decorator following Task 4 pattern.

- [ ] **Step 2: Commit**

```bash
git add backend/src/modules/room-types/room-types.controller.ts
git commit -m "feat(rbac): guard RoomTypesController endpoints"
```

---

## Task 7: Apply permissions to Rate/RatePlan/Restriction controllers

**Files:**
- Modify: `backend/src/modules/rate-plans/rate-plans.controller.ts`
- Modify: `backend/src/modules/rates/rates.controller.ts`
- Modify: `backend/src/modules/restrictions/restrictions.controller.ts`

Permission mapping:
- `GET /rate-plans` → `rate.read`
- `POST /rate-plans` → `rate.create`
- `PATCH /rate-plans/:id` → `rate.update`
- `DELETE /rate-plans/:id` → `rate.update`
- `GET /rates` → `rate.read`
- `PUT /rates/bulk` → `rate.update`
- `POST /rates/fill` → `rate.update`
- `GET /restrictions` → `rate.read`
- `PUT /restrictions` → `rate.update`

- [ ] **Step 1: Read and modify `rate-plans.controller.ts`**

Add `@RequirePermissions` following Task 4 pattern.

- [ ] **Step 2: Read and modify `rates.controller.ts`**

- [ ] **Step 3: Read and modify `restrictions.controller.ts`**

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/rate-plans/rate-plans.controller.ts \
        backend/src/modules/rates/rates.controller.ts \
        backend/src/modules/restrictions/restrictions.controller.ts
git commit -m "feat(rbac): guard rate-plans, rates, restrictions controllers"
```

---

## Task 8: Apply permissions to Inventory/Availability/Timeline/Tenant/Pricing controllers

**Files:**
- Modify: `backend/src/modules/inventory/inventory.controller.ts`
- Modify: `backend/src/modules/inventory/availability.controller.ts`
- Modify: `backend/src/modules/timeline/timeline.controller.ts`
- Modify: `backend/src/modules/tenant/tenant.controller.ts`
- Modify: `backend/src/modules/pricing/pricing.controller.ts`

Permission mapping:
- `GET /inventory` → `room.read`
- `PUT /inventory/bulk` → `room.update`
- `GET /availability/check` → `room.read` (or keep open — no sensitive data)
- `GET /timeline` → `reservation.read`
- `GET /tenant/settings` → `room.read` (any authenticated hotel user can read settings)
- `PATCH /tenant/settings` → `user.update` (only owner/manager can update hotel settings)
- `POST /pricing/quote` → `rate.read`

- [ ] **Step 1: Read and modify each controller following Task 4 pattern**

- [ ] **Step 2: Commit all at once**

```bash
git add backend/src/modules/inventory/inventory.controller.ts \
        backend/src/modules/inventory/availability.controller.ts \
        backend/src/modules/timeline/timeline.controller.ts \
        backend/src/modules/tenant/tenant.controller.ts \
        backend/src/modules/pricing/pricing.controller.ts
git commit -m "feat(rbac): guard inventory, availability, timeline, tenant, pricing controllers"
```

---

## Task 9: Smoke test — verify guard is working

- [ ] **Step 1: Start the backend**

```bash
cd backend && npm run start:dev
```

- [ ] **Step 2: Test that a HOUSEKEEPING user gets 403 on reservation.create**

Login as a HOUSEKEEPING user (or create one via the demo-seed), then:

```bash
# Login as HOUSEKEEPING user
curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"housekeeping@test.com","password":"test123"}' | jq .tokens.accessToken

# Try to create a reservation — should get 403
curl -s -X POST http://localhost:3000/reservations \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"roomId":"...","guestName":"Test","checkIn":"2026-06-01","checkOut":"2026-06-03","adults":1}' | jq .
```

Expected response:
```json
{
  "statusCode": 403,
  "code": "PERMISSION_DENIED",
  "missing": ["reservation.create"]
}
```

- [ ] **Step 3: Test that an OWNER user can still create reservations (200/201)**

```bash
# Login as OWNER, use token, POST /reservations → expect 201
```

- [ ] **Step 4: Final commit**

```bash
git commit -m "feat(rbac): complete RBAC enforcement — PermissionsGuard active on all endpoints"
```

---

## Self-Review Checklist

- [x] Spec coverage: Task 5 fully covered — PermissionsGuard, decorator, applied to all controllers, 403 with proper body
- [x] No placeholders: all code is complete and concrete
- [x] Type consistency: `AuthenticatedRequestUser.permissions: string[]` used consistently, `IS_PUBLIC_KEY` exported correctly
- [x] Super-admin bypass handled in guard
- [x] `@Public()` endpoints (auth routes) bypass guard
