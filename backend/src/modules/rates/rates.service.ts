import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/context/tenant-context';
import { BulkUpsertRatesDto } from './dto/bulk-upsert-rates.dto';
import { FillRatesDto } from './dto/fill-rates.dto';

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

    return this.prisma.forTenant(async (tx) => {
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
  }

  async remove(id: string) {
    await this.prisma.forTenant((tx) => tx.rate.delete({ where: { id } }));
    return { ok: true };
  }
}
