import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/context/tenant-context';
import { CreateRatePlanDto } from './dto/create-rate-plan.dto';
import { UpdateRatePlanDto } from './dto/update-rate-plan.dto';

@Injectable()
export class RatePlansService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    return this.prisma.forTenant((tx) =>
      tx.ratePlan.findMany({
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: {
          _count: { select: { rates: true } },
          parentRatePlan: { select: { id: true, code: true, name: true } },
        },
      }),
    );
  }

  async get(id: string) {
    const rp = await this.prisma.forTenant((tx) =>
      tx.ratePlan.findUnique({
        where: { id },
        include: {
          _count: { select: { rates: true } },
          parentRatePlan: { select: { id: true, code: true, name: true } },
        },
      }),
    );
    if (!rp) throw new NotFoundException('Тариф не найден');
    return rp;
  }

  async create(dto: CreateRatePlanDto) {
    try {
      return await this.prisma.forTenant((tx) =>
        tx.ratePlan.create({
          data: {
            tenantId: TenantContext.getTenantIdOrThrow(),
            code: dto.code,
            name: dto.name,
            description: dto.description ?? null,
            mealPlan: dto.mealPlan ?? 'NONE',
            occupancyPricing: dto.occupancyPricing ?? false,
            parentRatePlanId: dto.parentRatePlanId ?? null,
            priceModifierType: dto.priceModifierType ?? 'PERCENT',
            priceModifierValue: dto.priceModifierValue ?? 0,
            cancellationPolicyId: dto.cancellationPolicyId ?? null,
            paymentPolicyId: dto.paymentPolicyId ?? null,
            sortOrder: dto.sortOrder ?? 0,
            isActive: dto.isActive ?? true,
          },
          include: { parentRatePlan: { select: { id: true, code: true, name: true } } },
        }),
      );
    } catch (e) {
      throw this.translatePrismaError(e, dto.code);
    }
  }

  async update(id: string, dto: UpdateRatePlanDto) {
    if (dto.parentRatePlanId === id) {
      throw new ConflictException('Тариф не может быть родителем самого себя');
    }
    try {
      return await this.prisma.forTenant((tx) =>
        tx.ratePlan.update({
          where: { id },
          data: {
            code: dto.code ?? undefined,
            name: dto.name ?? undefined,
            description: dto.description === undefined ? undefined : dto.description,
            mealPlan: dto.mealPlan ?? undefined,
            occupancyPricing: dto.occupancyPricing ?? undefined,
            parentRatePlanId: dto.parentRatePlanId === undefined ? undefined : dto.parentRatePlanId,
            priceModifierType: dto.priceModifierType ?? undefined,
            priceModifierValue: dto.priceModifierValue ?? undefined,
            cancellationPolicyId:
              dto.cancellationPolicyId === undefined ? undefined : dto.cancellationPolicyId,
            paymentPolicyId: dto.paymentPolicyId === undefined ? undefined : dto.paymentPolicyId,
            sortOrder: dto.sortOrder ?? undefined,
            isActive: dto.isActive ?? undefined,
          },
        }),
      );
    } catch (e) {
      throw this.translatePrismaError(e, dto.code);
    }
  }

  async remove(id: string) {
    // Prisma cascades Rate rows; child rate plans get parentRatePlanId set to null (SetNull).
    try {
      await this.prisma.forTenant((tx) => tx.ratePlan.delete({ where: { id } }));
      return { ok: true };
    } catch (e) {
      throw this.translatePrismaError(e);
    }
  }

  private translatePrismaError(e: unknown, code?: string): Error {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === 'P2002') {
        return new ConflictException(`Тариф с кодом "${code ?? '?'}" уже существует`);
      }
      if (e.code === 'P2025') {
        return new NotFoundException('Тариф не найден');
      }
    }
    return e instanceof Error ? e : new Error(String(e));
  }
}
