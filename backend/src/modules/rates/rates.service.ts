import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/context/tenant-context';
import { BulkUpsertRatesDto } from './dto/bulk-upsert-rates.dto';
import { FillRatesDto } from './dto/fill-rates.dto';
import { SetStandardRatesDto } from './dto/set-standard-rates.dto';
import { ReplaceSeasonsDto } from './dto/replace-seasons.dto';

export interface ListRatesFilter {
  ratePlanId?: string;
  roomTypeId?: string;
  fromDate?: string;
  toDate?: string;
  occupancy?: number;
}

@Injectable()
export class RatesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(filter: ListRatesFilter) {
    return this.prisma.forTenant((tx) =>
      tx.rate.findMany({
        where: {
          ratePlanId: filter.ratePlanId || undefined,
          roomTypeId: filter.roomTypeId || undefined,
          occupancy: filter.occupancy ?? undefined,
          date:
            filter.fromDate || filter.toDate
              ? {
                  gte: filter.fromDate ? new Date(`${filter.fromDate}T00:00:00.000Z`) : undefined,
                  lte: filter.toDate ? new Date(`${filter.toDate}T00:00:00.000Z`) : undefined,
                }
              : undefined,
        },
        orderBy: [{ date: 'asc' }, { occupancy: 'asc' }],
      }),
    );
  }

  async bulkUpsert(dto: BulkUpsertRatesDto) {
    const tenantId = TenantContext.getTenantIdOrThrow();
    const result = await this.prisma.forTenant(async (tx) => {
      let written = 0;
      for (const it of dto.items) {
        await tx.rate.upsert({
          where: {
            tenantId_ratePlanId_roomTypeId_date_occupancy: {
              tenantId,
              ratePlanId: it.ratePlanId,
              roomTypeId: it.roomTypeId,
              date: new Date(`${it.date}T00:00:00.000Z`),
              occupancy: it.occupancy ?? 2,
            },
          },
          create: {
            tenantId,
            ratePlanId: it.ratePlanId,
            roomTypeId: it.roomTypeId,
            date: new Date(`${it.date}T00:00:00.000Z`),
            occupancy: it.occupancy ?? 2,
            price: it.price,
            currency: it.currency ?? 'RUB',
          },
          update: {
            price: it.price,
            currency: it.currency ?? 'RUB',
          },
        });
        written++;
      }
      return { written };
    });
    const firstItem = dto.items[0];
    await this.prisma.writeAuditLog({
      tenantId,
      entity: 'rate',
      action: 'bulk_upsert',
      diff: {
        before: {},
        after: {
          count: result.written,
          ratePlanId: firstItem?.ratePlanId,
          roomTypeId: firstItem?.roomTypeId,
        },
      },
    });
    return result;
  }

  async fillRange(dto: FillRatesDto) {
    const tenantId = TenantContext.getTenantIdOrThrow();
    const from = new Date(`${dto.fromDate}T00:00:00.000Z`);
    const to = new Date(`${dto.toDate}T00:00:00.000Z`);
    if (to.getTime() < from.getTime()) {
      throw new BadRequestException('toDate must be ≥ fromDate');
    }
    // hard ceiling so a typo cannot accidentally write ~36500 rows
    const days = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
    if (days > 366) throw new BadRequestException('Range too large (max 366 days)');

    const result = await this.prisma.forTenant(async (tx) => {
      let written = 0;
      for (let i = 0; i < days; i++) {
        const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + i));
        await tx.rate.upsert({
          where: {
            tenantId_ratePlanId_roomTypeId_date_occupancy: {
              tenantId,
              ratePlanId: dto.ratePlanId,
              roomTypeId: dto.roomTypeId,
              date: d,
              occupancy: dto.occupancy ?? 2,
            },
          },
          create: {
            tenantId,
            ratePlanId: dto.ratePlanId,
            roomTypeId: dto.roomTypeId,
            date: d,
            occupancy: dto.occupancy ?? 2,
            price: dto.price,
            currency: dto.currency ?? 'RUB',
          },
          update: {
            price: dto.price,
            currency: dto.currency ?? 'RUB',
          },
        });
        written++;
      }
      return { written, daysCovered: days };
    });
    await this.prisma.writeAuditLog({
      tenantId,
      entity: 'rate',
      action: 'fill_range',
      diff: {
        before: {},
        after: {
          ratePlanId: dto.ratePlanId,
          roomTypeId: dto.roomTypeId,
          from: dto.fromDate,
          to: dto.toDate,
          price: dto.price,
          written: result.written,
        },
      },
    });
    return result;
  }

  async remove(id: string) {
    await this.prisma.forTenant((tx) => tx.rate.delete({ where: { id } }));
    return { ok: true };
  }

  // ─── Standard (baseline) prices ────────────────────────────────────────────

  /** All standard prices for a rate plan (one per configured category). */
  async listStandard(ratePlanId: string) {
    return this.prisma.forTenant((tx) =>
      tx.standardRate.findMany({
        where: { ratePlanId: ratePlanId || undefined },
        orderBy: { roomTypeId: 'asc' },
      }),
    );
  }

  /**
   * Upsert the standard price per category for a plan. price = 0 deletes the
   * row (no baseline for that category). Returns the resulting list.
   */
  async setStandard(dto: SetStandardRatesDto) {
    const tenantId = TenantContext.getTenantIdOrThrow();
    const currency = dto.currency ?? 'RUB';
    await this.prisma.forTenant(async (tx) => {
      for (const it of dto.items) {
        if (it.price > 0) {
          await tx.standardRate.upsert({
            where: {
              tenantId_ratePlanId_roomTypeId: {
                tenantId,
                ratePlanId: dto.ratePlanId,
                roomTypeId: it.roomTypeId,
              },
            },
            create: {
              tenantId,
              ratePlanId: dto.ratePlanId,
              roomTypeId: it.roomTypeId,
              price: it.price,
              currency,
            },
            update: { price: it.price, currency },
          });
        } else {
          await tx.standardRate.deleteMany({
            where: { ratePlanId: dto.ratePlanId, roomTypeId: it.roomTypeId },
          });
        }
      }
    });
    await this.prisma.writeAuditLog({
      tenantId,
      entity: 'standard_rate',
      action: 'set',
      diff: { before: {}, after: { ratePlanId: dto.ratePlanId, count: dto.items.length } },
    });
    return this.listStandard(dto.ratePlanId);
  }

  // ─── Seasons ───────────────────────────────────────────────────────────────

  /** All season rows for a rate plan, ordered for display. */
  async listSeasons(ratePlanId: string) {
    return this.prisma.forTenant((tx) =>
      tx.rateSeason.findMany({
        where: { ratePlanId: ratePlanId || undefined },
        orderBy: [{ sortOrder: 'asc' }, { dateFrom: 'asc' }],
      }),
    );
  }

  /**
   * Replace the entire set of seasons for a rate plan atomically. Each season
   * input expands to one row per category (with its own price). Editing the
   * season list in the UI and saving sends the full desired state here.
   */
  async replaceSeasons(dto: ReplaceSeasonsDto) {
    const tenantId = TenantContext.getTenantIdOrThrow();
    const currency = dto.currency ?? 'RUB';

    for (const s of dto.seasons) {
      if (s.dateTo < s.dateFrom) {
        throw new BadRequestException(`Сезон «${s.name}»: дата окончания раньше начала`);
      }
    }

    await this.prisma.forTenant(async (tx) => {
      await tx.rateSeason.deleteMany({ where: { ratePlanId: dto.ratePlanId } });
      const rows = dto.seasons.flatMap((s, idx) =>
        s.items
          .filter((it) => it.price > 0)
          .map((it) => ({
            tenantId,
            ratePlanId: dto.ratePlanId,
            roomTypeId: it.roomTypeId,
            name: s.name,
            color: s.color ?? null,
            dateFrom: new Date(`${s.dateFrom}T00:00:00.000Z`),
            dateTo: new Date(`${s.dateTo}T00:00:00.000Z`),
            price: it.price,
            currency,
            sortOrder: s.sortOrder ?? idx,
          })),
      );
      if (rows.length) await tx.rateSeason.createMany({ data: rows });
    });

    await this.prisma.writeAuditLog({
      tenantId,
      entity: 'rate_season',
      action: 'replace',
      diff: { before: {}, after: { ratePlanId: dto.ratePlanId, seasons: dto.seasons.length } },
    });
    return this.listSeasons(dto.ratePlanId);
  }
}
