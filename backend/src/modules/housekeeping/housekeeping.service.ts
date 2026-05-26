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
      if (status) {
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
          WHERE ht.status = ${status}::"HkTaskStatus"
          ORDER BY ht.created_at DESC
        `;
      }
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
          ${dto.assigneeId ?? null}::uuid,
          ${dto.notes ?? null},
          ${dto.reservationId ?? null}::uuid
        )
        RETURNING id
      `;
      return task;
    });
  }

  /** Auto-called by checkOut — creates CLEANING task for the vacated room */
  async autoCreateOnCheckout(tenantId: string, roomId: string, reservationId: string) {
    return this.prisma.forTenantExplicit(tenantId, async (tx) => {
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

      await tx.$executeRaw`
        UPDATE room
        SET status = 'CLEAN'::"RoomStatus", updated_at = now()
        WHERE id = ${rows[0].room_id}::uuid
      `;

      return { id: rows[0].id, status: 'DONE' };
    });
  }
}
