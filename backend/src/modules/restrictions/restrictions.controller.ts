import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/context/tenant-context';
import { RestrictionsService } from './restrictions.service';
import { CheckRestrictionsDto } from './dto/check-restrictions.dto';
import { UpsertRestrictionDto } from './dto/upsert-restriction.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@ApiTags('restrictions')
@ApiBearerAuth()
@Controller('restrictions')
export class RestrictionsController {
  constructor(
    private readonly service: RestrictionsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @RequirePermissions('rate.read')
  @ApiOperation({ summary: 'List restrictions for a date window (optional)' })
  @ApiQuery({ name: 'roomTypeId', required: false })
  @ApiQuery({ name: 'ratePlanId', required: false })
  @ApiQuery({ name: 'from', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'to', required: false, description: 'YYYY-MM-DD' })
  list(
    @Query('roomTypeId') roomTypeId?: string,
    @Query('ratePlanId') ratePlanId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.prisma.forTenant((tx) =>
      tx.restriction.findMany({
        where: {
          roomTypeId: roomTypeId || undefined,
          ratePlanId: ratePlanId === 'null' ? null : ratePlanId || undefined,
          date: from || to
            ? {
                gte: from ? new Date(`${from}T00:00:00.000Z`) : undefined,
                lte: to ? new Date(`${to}T00:00:00.000Z`) : undefined,
              }
            : undefined,
        },
        orderBy: [{ date: 'asc' }],
      }),
    );
  }

  @Post('upsert')
  @RequirePermissions('rate.update')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create or update a restriction row for one date' })
  upsert(@Body() dto: UpsertRestrictionDto) {
    const tenantId = TenantContext.getTenantIdOrThrow();
    const dateObj = new Date(`${dto.date}T00:00:00.000Z`);
    return this.prisma.forTenant(async (tx) => {
      // The (tenantId, ratePlanId, roomTypeId, date) composite is unique — Prisma handles null in unique
      // poorly, so we hand-roll the upsert.
      const existing = await tx.restriction.findFirst({
        where: {
          ratePlanId: dto.ratePlanId ?? null,
          roomTypeId: dto.roomTypeId,
          date: dateObj,
        },
        select: { id: true },
      });
      const data = {
        closed: dto.closed ?? false,
        cta: dto.cta ?? false,
        ctd: dto.ctd ?? false,
        stopSell: dto.stopSell ?? false,
        minLos: dto.minLos ?? null,
        maxLos: dto.maxLos ?? null,
        minLosArrival: dto.minLosArrival ?? null,
        maxLosArrival: dto.maxLosArrival ?? null,
        minAdvance: dto.minAdvance ?? null,
        maxAdvance: dto.maxAdvance ?? null,
      };
      if (existing) {
        return tx.restriction.update({ where: { id: existing.id }, data });
      }
      return tx.restriction.create({
        data: {
          tenantId,
          ratePlanId: dto.ratePlanId ?? null,
          roomTypeId: dto.roomTypeId,
          date: dateObj,
          ...data,
        },
      });
    });
  }

  @Post('check')
  @RequirePermissions('rate.read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate a hypothetical reservation against all per-day rules' })
  check(@Body() dto: CheckRestrictionsDto) {
    return this.service.check({
      ratePlanId: dto.ratePlanId ?? null,
      roomTypeId: dto.roomTypeId,
      arrival: new Date(`${dto.arrival}T00:00:00.000Z`),
      departure: new Date(`${dto.departure}T00:00:00.000Z`),
    });
  }

  @Delete(':id')
  @RequirePermissions('rate.update')
  @ApiOperation({ summary: 'Remove a restriction row' })
  remove(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.prisma.forTenant((tx) => tx.restriction.delete({ where: { id } }));
  }
}
