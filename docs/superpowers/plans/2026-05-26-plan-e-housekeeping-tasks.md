# Plan E: Housekeeping Tasks

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `HousekeepingTask` model so cleaners can be assigned rooms, track progress (PENDING → IN_PROGRESS → DONE), and supervisors can see the whole shift's workload. Tasks are auto-created when a guest checks out.

**Architecture:** New Prisma model `HousekeepingTask`. New NestJS `HousekeepingModule` with CRUD + assign + complete actions. `ReservationsService.checkOut()` creates a task after room is marked DIRTY. Frontend `Housekeeping.jsx` extended with a task list and assignment UI.

**Tech Stack:** NestJS, Prisma, React Query. **Depends on:** Plan B (checkOut must trigger task creation).

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Modify | `backend/prisma/schema.prisma` | Add `HousekeepingTask` model |
| Modify | `backend/prisma/migrations/` | New migration |
| Create | `backend/src/modules/housekeeping/housekeeping.service.ts` | Task CRUD + auto-create |
| Create | `backend/src/modules/housekeeping/housekeeping.controller.ts` | REST endpoints |
| Create | `backend/src/modules/housekeeping/housekeeping.module.ts` | NestJS module |
| Create | `backend/src/modules/housekeeping/dto/housekeeping.dto.ts` | DTOs |
| Modify | `backend/src/app.module.ts` | Register HousekeepingModule |
| Modify | `backend/src/modules/reservations/reservations.service.ts` | Auto-create task on checkOut |
| Create | `frontend/src/api/housekeeping.js` | API client |
| Create | `frontend/src/hooks/api/useHousekeepingTasks.js` | React Query hook |
| Modify | `frontend/src/Components/HotelPMS/components/Housekeeping/Housekeeping.jsx` | Add tasks section |

---

## Task 1: Add `HousekeepingTask` to Prisma schema

**Files:**
- Modify: `backend/prisma/schema.prisma`

- [ ] **Step 1: Add enum and model at the end of the schema**

```prisma
// ─── Phase M — Housekeeping Tasks ────────────────────────────────────────────

enum HkTaskStatus {
  PENDING
  IN_PROGRESS
  DONE
  INSPECTED
}

enum HkTaskType {
  CLEANING      // Post-departure clean
  TURNDOWN      // Evening turndown service
  INSPECTION    // Quality check after clean
  MAINTENANCE   // Something needs fixing (not OOO, just minor)
  DEEP_CLEAN    // Periodic thorough clean
}

model HousekeepingTask {
  id                      String      @id @default(uuid()) @db.Uuid
  tenantId                String      @map("tenant_id") @db.Uuid
  roomId                  String      @map("room_id") @db.Uuid
  room                    Room        @relation(fields: [roomId], references: [id], onDelete: Cascade)
  type                    HkTaskType  @default(CLEANING)
  status                  HkTaskStatus @default(PENDING)
  assigneeId              String?     @map("assignee_id") @db.Uuid
  assignee                User?       @relation(fields: [assigneeId], references: [id], onDelete: SetNull)
  createdFromReservationId String?    @map("created_from_reservation_id") @db.Uuid
  notes                   String?
  completedAt             DateTime?   @map("completed_at")
  createdAt               DateTime    @default(now())
  updatedAt               DateTime    @updatedAt

  @@index([tenantId])
  @@index([tenantId, status])
  @@index([roomId])
  @@index([assigneeId])
  @@map("housekeeping_task")
}
```

Also add the reverse relation to `Room` and `User` models:
- In `Room` model, add: `housekeepingTasks HousekeepingTask[]`
- In `User` model, add: `housekeepingTasks HousekeepingTask[]`

- [ ] **Step 2: Run migration**

```bash
cd backend && npx prisma migrate dev --name add_housekeeping_task
```

- [ ] **Step 3: Commit**

```bash
git add backend/prisma/schema.prisma backend/prisma/migrations/
git commit -m "feat(housekeeping): add HousekeepingTask Prisma model"
```

---

## Task 2: Create `HousekeepingService`

**Files:**
- Create: `backend/src/modules/housekeeping/housekeeping.service.ts`

- [ ] **Step 1: Write the service**

```typescript
// backend/src/modules/housekeeping/housekeeping.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/context/tenant-context';
import { AssignTaskDto, CreateTaskDto } from './dto/housekeeping.dto';

@Injectable()
export class HousekeepingService {
  constructor(private readonly prisma: PrismaService) {}

  async listTasks(status?: string) {
    const tenantId = TenantContext.getTenantIdOrThrow();
    return this.prisma.forTenant(async (tx) => {
      return tx.$queryRaw<{
        id: string; room_id: string; room_number: string; room_type_name: string;
        type: string; status: string; assignee_id: string | null;
        assignee_name: string | null; created_from_reservation_id: string | null;
        notes: string | null; completed_at: Date | null; created_at: Date;
      }[]>`
        SELECT
          ht.id, ht.room_id, r.number AS room_number, rt.name AS room_type_name,
          ht.type, ht.status, ht.assignee_id,
          u.full_name AS assignee_name,
          ht.created_from_reservation_id, ht.notes,
          ht.completed_at, ht.created_at
        FROM housekeeping_task ht
        JOIN room r ON r.id = ht.room_id
        JOIN room_type rt ON rt.id = r.room_type_id
        LEFT JOIN app_user u ON u.id = ht.assignee_id
        WHERE ht.tenant_id = ${tenantId}::uuid
          ${status ? tx.$queryRaw`AND ht.status = ${status}::"HkTaskStatus"` : tx.$queryRaw``}
        ORDER BY ht.created_at DESC
      `;
    });
  }

  async createTask(dto: CreateTaskDto, userId: string) {
    const tenantId = TenantContext.getTenantIdOrThrow();
    return this.prisma.forTenant(async (tx) => {
      const [task] = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO housekeeping_task
          (tenant_id, room_id, type, status, assignee_id, notes, created_from_reservation_id)
        VALUES (
          ${tenantId}::uuid,
          ${dto.roomId}::uuid,
          ${dto.type ?? 'CLEANING'}::"HkTaskType",
          'PENDING'::"HkTaskStatus",
          ${dto.assigneeId ?? null},
          ${dto.notes ?? null},
          ${dto.reservationId ?? null}
        )
        RETURNING id
      `;
      return task;
    });
  }

  /** Auto-called by checkOut — creates CLEANING task for the vacated room */
  async autoCreateOnCheckout(tenantId: string, roomId: string, reservationId: string) {
    return this.prisma.forTenantExplicit(tenantId, async (tx) => {
      // Don't create duplicate task if one already exists for this reservation
      const existing = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM housekeeping_task
        WHERE created_from_reservation_id = ${reservationId}::uuid
          AND type = 'CLEANING'::"HkTaskType"
          AND status != 'DONE'::"HkTaskStatus"
        LIMIT 1
      `;
      if (existing.length > 0) return existing[0];

      const [task] = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO housekeeping_task
          (tenant_id, room_id, type, status, created_from_reservation_id)
        VALUES (
          ${tenantId}::uuid, ${roomId}::uuid,
          'CLEANING'::"HkTaskType", 'PENDING'::"HkTaskStatus",
          ${reservationId}::uuid
        )
        RETURNING id
      `;
      return task;
    });
  }

  async assignTask(taskId: string, dto: AssignTaskDto) {
    const tenantId = TenantContext.getTenantIdOrThrow();
    return this.prisma.forTenant(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        UPDATE housekeeping_task
        SET assignee_id = ${dto.assigneeId}::uuid,
            status = CASE WHEN status = 'PENDING'::"HkTaskStatus"
                          THEN 'IN_PROGRESS'::"HkTaskStatus"
                          ELSE status END,
            updated_at = now()
        WHERE id = ${taskId}::uuid
        RETURNING id
      `;
      if (!rows.length) throw new NotFoundException('Task not found');
      return rows[0];
    });
  }

  async completeTask(taskId: string, userId: string) {
    const tenantId = TenantContext.getTenantIdOrThrow();
    return this.prisma.forTenant(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string; room_id: string }[]>`
        UPDATE housekeeping_task
        SET status = 'DONE'::"HkTaskStatus",
            completed_at = now(),
            updated_at = now()
        WHERE id = ${taskId}::uuid
        RETURNING id, room_id
      `;
      if (!rows.length) throw new NotFoundException('Task not found');

      // Mark room as CLEAN
      await tx.$executeRaw`
        UPDATE room
        SET status = 'CLEAN'::"RoomStatus", updated_at = now()
        WHERE id = ${rows[0].room_id}::uuid
      `;

      return { id: rows[0].id, status: 'DONE' };
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/modules/housekeeping/housekeeping.service.ts
git commit -m "feat(housekeeping): add HousekeepingService with task CRUD and auto-create"
```

---

## Task 3: Create DTOs, Controller, Module

**Files:**
- Create: `backend/src/modules/housekeeping/dto/housekeeping.dto.ts`
- Create: `backend/src/modules/housekeeping/housekeeping.controller.ts`
- Create: `backend/src/modules/housekeeping/housekeeping.module.ts`

- [ ] **Step 1: Write DTOs**

```typescript
// backend/src/modules/housekeeping/dto/housekeeping.dto.ts
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateTaskDto {
  @IsUUID() roomId: string;
  @IsOptional() @IsEnum(['CLEANING','TURNDOWN','INSPECTION','MAINTENANCE','DEEP_CLEAN']) type?: string;
  @IsOptional() @IsUUID() assigneeId?: string;
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsUUID() reservationId?: string;
}

export class AssignTaskDto {
  @IsUUID() assigneeId: string;
}
```

- [ ] **Step 2: Write Controller**

```typescript
// backend/src/modules/housekeeping/housekeeping.controller.ts
import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { HousekeepingService } from './housekeeping.service';
import { AssignTaskDto, CreateTaskDto } from './dto/housekeeping.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedRequestUser } from '../auth/strategies/jwt.strategy';

@ApiBearerAuth()
@ApiTags('Housekeeping')
@Controller('housekeeping/tasks')
export class HousekeepingController {
  constructor(private readonly hkService: HousekeepingService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('hk.task.read')
  listTasks(@Query('status') status?: string) {
    return this.hkService.listTasks(status);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('hk.task.read')
  createTask(
    @Body() dto: CreateTaskDto,
    @CurrentUser() user: AuthenticatedRequestUser,
  ) {
    return this.hkService.createTask(dto, user.userId);
  }

  @Post(':taskId/assign')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('hk.task.update')
  assignTask(@Param('taskId') taskId: string, @Body() dto: AssignTaskDto) {
    return this.hkService.assignTask(taskId, dto);
  }

  @Post(':taskId/complete')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('hk.task.update')
  completeTask(
    @Param('taskId') taskId: string,
    @CurrentUser() user: AuthenticatedRequestUser,
  ) {
    return this.hkService.completeTask(taskId, user.userId);
  }
}
```

- [ ] **Step 3: Write Module**

```typescript
// backend/src/modules/housekeeping/housekeeping.module.ts
import { Module } from '@nestjs/common';
import { HousekeepingService } from './housekeeping.service';
import { HousekeepingController } from './housekeeping.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [HousekeepingController],
  providers: [HousekeepingService],
  exports: [HousekeepingService],
})
export class HousekeepingModule {}
```

- [ ] **Step 4: Register in `app.module.ts`**

```typescript
import { HousekeepingModule } from './modules/housekeeping/housekeeping.module';
// Add to imports: [..., HousekeepingModule]
```

- [ ] **Step 5: Build to verify**

```bash
cd backend && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/housekeeping/ backend/src/app.module.ts
git commit -m "feat(housekeeping): add HousekeepingController, Module, DTOs"
```

---

## Task 4: Wire `autoCreateOnCheckout` into `ReservationsService`

**Files:**
- Modify: `backend/src/modules/reservations/reservations.service.ts`
- Modify: `backend/src/modules/reservations/reservations.module.ts`

- [ ] **Step 1: Import `HousekeepingModule` in `ReservationsModule`**

```typescript
// reservations.module.ts — add to imports:
imports: [TimelineModule, FolioModule, HousekeepingModule],
```

- [ ] **Step 2: Inject `HousekeepingService` and call after checkout**

In the constructor:
```typescript
constructor(
  private readonly prisma: PrismaService,
  private readonly timelineService: TimelineService,
  private readonly timelineGateway: TimelineGateway,
  private readonly folioService: FolioService,
  private readonly hkService: HousekeepingService,
) {}
```

In `checkOut()`, after the forTenant transaction (after audit log write):
```typescript
// Auto-create housekeeping task for the vacated room
if (result.ok) {
  const roomId = /* need to return roomId from the transaction */ result.roomId;
  await this.hkService.autoCreateOnCheckout(tenantId, roomId, id).catch((e) => {
    this.logger.warn(`Failed to auto-create HK task: ${e.message}`);
  });
}
```

Note: Update the transaction return type in `checkOut()` to also return `roomId`:
```typescript
// In the TxResult type:
| { ok: true; id: string; version: number; before: string; roomId: string }
// In the UPDATE query, also SELECT room_id:
const [res] = await tx.$queryRaw<{ id: string; version: number; room_id: string }[]>`...`
return { ok: true, id: res.id, version: res.version, before: cur.status, roomId: res.room_id };
```

- [ ] **Step 3: Build to verify**

```bash
cd backend && npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/reservations/
git commit -m "feat(housekeeping): auto-create cleaning task on guest check-out"
```

---

## Task 5: Frontend — tasks list in `Housekeeping.jsx`

**Files:**
- Create: `frontend/src/api/housekeeping.js`
- Create: `frontend/src/hooks/api/useHousekeepingTasks.js`
- Modify: `frontend/src/Components/HotelPMS/components/Housekeeping/Housekeeping.jsx`

- [ ] **Step 1: Create API client**

```javascript
// frontend/src/api/housekeeping.js
import client from './client';

export const getTasks = (status) =>
  client.get('/housekeeping/tasks', { params: status ? { status } : {} }).then((r) => r.data);

export const assignTask = (taskId, assigneeId) =>
  client.post(`/housekeeping/tasks/${taskId}/assign`, { assigneeId }).then((r) => r.data);

export const completeTask = (taskId) =>
  client.post(`/housekeeping/tasks/${taskId}/complete`).then((r) => r.data);

export const createTask = (data) =>
  client.post('/housekeeping/tasks', data).then((r) => r.data);
```

- [ ] **Step 2: Create hook**

```javascript
// frontend/src/hooks/api/useHousekeepingTasks.js
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { assignTask, completeTask, createTask, getTasks } from '../../api/housekeeping';

export function useHousekeepingTasks(status) {
  return useQuery({
    queryKey: ['hkTasks', status],
    queryFn: () => getTasks(status),
    refetchInterval: 30_000,
  });
}

export function useCompleteTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: completeTask,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hkTasks'] }),
  });
}

export function useAssignTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, assigneeId }) => assignTask(taskId, assigneeId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hkTasks'] }),
  });
}
```

- [ ] **Step 3: Extend `Housekeeping.jsx` with tasks section**

Read the current file. Add a "Задачи уборки" section below the existing room-status grid. Show a table with columns: Номер | Тип | Статус | Исполнитель | Действие.

```jsx
// Add to Housekeeping.jsx:
import { useHousekeepingTasks, useCompleteTask } from '../../../../hooks/api/useHousekeepingTasks';

// Inside component:
const { data: tasks = [] } = useHousekeepingTasks();
const completeMutation = useCompleteTask();

const STATUS_LABELS = {
  PENDING: 'Ожидает',
  IN_PROGRESS: 'Убирается',
  DONE: 'Убрано',
  INSPECTED: 'Проверено',
};

// In JSX, after the room status grid:
<div className="mt-8">
  <h2 className="text-lg font-semibold mb-3">Задачи уборки</h2>
  <div className="bg-white rounded-xl shadow overflow-hidden">
    <table className="w-full text-sm">
      <thead className="bg-gray-50 border-b">
        <tr>
          <th className="px-4 py-2 text-left">Номер</th>
          <th className="px-4 py-2 text-left">Тип</th>
          <th className="px-4 py-2 text-left">Статус</th>
          <th className="px-4 py-2 text-left">Исполнитель</th>
          <th className="px-4 py-2"></th>
        </tr>
      </thead>
      <tbody className="divide-y">
        {tasks.map((task) => (
          <tr key={task.id} className="hover:bg-gray-50">
            <td className="px-4 py-2 font-medium">№{task.room_number}</td>
            <td className="px-4 py-2 text-gray-600">{task.type}</td>
            <td className="px-4 py-2">{STATUS_LABELS[task.status] ?? task.status}</td>
            <td className="px-4 py-2 text-gray-500">{task.assignee_name ?? '—'}</td>
            <td className="px-4 py-2 text-right">
              {task.status !== 'DONE' && task.status !== 'INSPECTED' && (
                <button
                  onClick={() => completeMutation.mutate(task.id)}
                  className="text-sm text-green-600 hover:underline"
                >
                  Готово
                </button>
              )}
            </td>
          </tr>
        ))}
        {tasks.length === 0 && (
          <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">Нет активных задач</td></tr>
        )}
      </tbody>
    </table>
  </div>
</div>
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/housekeeping.js \
        frontend/src/hooks/api/useHousekeepingTasks.js \
        frontend/src/Components/HotelPMS/components/Housekeeping/Housekeeping.jsx
git commit -m "feat(housekeeping): add tasks list with complete action to Housekeeping screen"
```

---

## Self-Review Checklist

- [x] Spec coverage: Tasks 45 and 42 fully covered
- [x] Auto-create on checkout fires even if HK service fails (swallowed error with warning log)
- [x] `completeTask()` marks room as CLEAN automatically
- [x] No duplicate tasks for same reservation checkout
- [x] Prisma migration included
- [x] `@RequirePermissions('hk.task.read/update')` on endpoints
