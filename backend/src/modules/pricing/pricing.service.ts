import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { calculatePricing, makeMapLookup } from './pricing.calculator';
import { PricingBreakdown, RatePlanLike } from './pricing.types';

export interface QuoteInput {
  ratePlanId: string;
  roomTypeId: string;
  arrival: Date;
  departure: Date;
  occupancy: number;
  currency?: string;
}

@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the full pricing breakdown for the given (ratePlan × roomType × dates × occupancy)
   * combination. Walks the parent chain of the rate plan up to 5 levels (we don't expect
   * deeper inheritance in practice).
   */
  async quote(input: QuoteInput): Promise<PricingBreakdown> {
    return this.prisma.forTenant(async (tx) => {
      // ── Validate dates ────────────────────────────────────────────────────
      if (Number.isNaN(input.arrival.getTime()) || Number.isNaN(input.departure.getTime())) {
        throw new BadRequestException('arrival/departure must be valid dates');
      }
      if (input.departure.getTime() < input.arrival.getTime()) {
        throw new BadRequestException('departure must be ≥ arrival');
      }

      // ── Load room type (for baseOccupancy) ────────────────────────────────
      const roomType = await tx.roomType.findUnique({
        where: { id: input.roomTypeId },
        select: { id: true, baseOccupancy: true },
      });
      if (!roomType) throw new NotFoundException('Категория номера не найдена');

      // ── Load rate plan + parent chain (max 5 levels) ──────────────────────
      const ratePlan = await tx.ratePlan.findUnique({
        where: { id: input.ratePlanId },
        select: {
          id: true,
          parentRatePlanId: true,
          priceModifierType: true,
          priceModifierValue: true,
          occupancyPricing: true,
        },
      });
      if (!ratePlan) throw new NotFoundException('Тариф не найден');

      const parentChain: RatePlanLike[] = [];
      let currentParentId = ratePlan.parentRatePlanId;
      let depth = 0;
      while (currentParentId && depth < 5) {
        const parent = await tx.ratePlan.findUnique({
          where: { id: currentParentId },
          select: {
            id: true,
            parentRatePlanId: true,
            priceModifierType: true,
            priceModifierValue: true,
            occupancyPricing: true,
          },
        });
        if (!parent) break;
        parentChain.push({
          id: parent.id,
          parentRatePlanId: parent.parentRatePlanId,
          priceModifierType: parent.priceModifierType,
          priceModifierValue: parent.priceModifierValue.toString(),
          occupancyPricing: parent.occupancyPricing,
        });
        currentParentId = parent.parentRatePlanId;
        depth++;
      }

      const planIds = [ratePlan.id, ...parentChain.map((p) => p.id)];

      // ── Fetch all candidate Rate rows in one query ────────────────────────
      const departureForFetch = new Date(input.departure);
      // We need rates for dates in [arrival, departure-1]. Query inclusive endpoints.
      const lastNight = new Date(departureForFetch);
      lastNight.setUTCDate(lastNight.getUTCDate() - 1);

      const rateRows = await tx.rate.findMany({
        where: {
          ratePlanId: { in: planIds },
          roomTypeId: input.roomTypeId,
          date: {
            gte: startOfUTC(input.arrival),
            lte: startOfUTC(lastNight),
          },
        },
        select: { ratePlanId: true, roomTypeId: true, date: true, occupancy: true, price: true },
      });

      const rates = makeMapLookup(
        rateRows.map((r) => ({
          ratePlanId: r.ratePlanId,
          roomTypeId: r.roomTypeId,
          date: r.date,
          occupancy: r.occupancy,
          price: r.price as unknown as Prisma.Decimal,
        })),
      );

      // ── Calculate ─────────────────────────────────────────────────────────
      return calculatePricing({
        ratePlan: {
          id: ratePlan.id,
          parentRatePlanId: ratePlan.parentRatePlanId,
          priceModifierType: ratePlan.priceModifierType,
          priceModifierValue: ratePlan.priceModifierValue.toString(),
          occupancyPricing: ratePlan.occupancyPricing,
        },
        parentChain,
        arrival: startOfUTC(input.arrival),
        departure: startOfUTC(input.departure),
        occupancy: input.occupancy,
        baseOccupancy: roomType.baseOccupancy,
        roomTypeId: input.roomTypeId,
        currency: input.currency ?? 'RUB',
        rates,
      });
    });
  }
}

function startOfUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
