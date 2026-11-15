import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

import { checkRestrictionRules, Violation } from './restriction-rules';
export type { Violation, ViolationCode } from './restriction-rules';

export interface CheckRestrictionsInput {
  ratePlanId?: string | null;
  roomTypeId: string;
  arrival: Date;
  departure: Date;
  now?: Date;
}

export interface CheckRestrictionsResult {
  allowed: boolean;
  nights: number;
  violations: Violation[];
}

@Injectable()
export class RestrictionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Validate a hypothetical reservation against per-day restrictions.
   * If any rule is violated, `allowed = false` and the human-readable
   * violations are returned.
   *
   * Plan-specific rows override plan-agnostic rows: when both a row with
   * `ratePlanId = X` and `ratePlanId = NULL` exist for the same (roomType, date),
   * the plan-specific one wins.
   */
  async check(input: CheckRestrictionsInput): Promise<CheckRestrictionsResult> {
    const arrival = startOfUTC(input.arrival);
    const departure = startOfUTC(input.departure);
    const now = startOfUTC(input.now ?? new Date());
    const nights = daysBetween(arrival, departure);

    if (nights <= 0) {
      return { allowed: true, nights: 0, violations: [] };
    }

    // Verify the room type belongs to this tenant (404 otherwise via RLS).
    return this.prisma.forTenant(async (tx) => {
      const rt = await tx.roomType.findUnique({
        where: { id: input.roomTypeId },
        select: { id: true },
      });
      if (!rt) throw new NotFoundException('Категория номера не найдена');

      // Include departure for CTD; the shared rule excludes it from nightly checks.

      const planFilter = input.ratePlanId
        ? { OR: [{ ratePlanId: null }, { ratePlanId: input.ratePlanId }] }
        : { ratePlanId: null };
      const rows = await tx.restriction.findMany({
        where: {
          roomTypeId: input.roomTypeId,
          date: { gte: arrival, lte: departure },
          ...planFilter,
        },
      });

      return checkRestrictionRules(rows, arrival, departure, now);
    });
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function startOfUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}
