import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { RatesService } from './rates.service';
import { BulkUpsertRatesDto } from './dto/bulk-upsert-rates.dto';
import { FillRatesDto } from './dto/fill-rates.dto';

@ApiTags('rates')
@ApiBearerAuth()
@Controller('rates')
export class RatesController {
  constructor(private readonly service: RatesService) {}

  @Get()
  @ApiOperation({ summary: 'List rates (filter by plan/roomType/date range/occupancy)' })
  @ApiQuery({ name: 'ratePlanId', required: false })
  @ApiQuery({ name: 'roomTypeId', required: false })
  @ApiQuery({ name: 'from', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'to', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'occupancy', required: false, type: Number })
  list(
    @Query('ratePlanId') ratePlanId?: string,
    @Query('roomTypeId') roomTypeId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('occupancy') occupancyRaw?: string,
  ) {
    let occupancy: number | undefined;
    if (occupancyRaw !== undefined && occupancyRaw !== '') {
      const n = Number.parseInt(occupancyRaw, 10);
      if (Number.isNaN(n)) throw new BadRequestException('occupancy must be integer');
      occupancy = n;
    }
    return this.service.list({ ratePlanId, roomTypeId, fromDate: from, toDate: to, occupancy });
  }

  @Put('bulk')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Upsert many rate rows in one call' })
  bulk(@Body() dto: BulkUpsertRatesDto) {
    return this.service.bulkUpsert(dto);
  }

  @Post('fill')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set the same price for every date in [fromDate, toDate]',
    description: 'Productivity shortcut for the rate-calendar UI ("apply 3800 ₽ to the next 30 days").',
  })
  fill(@Body() dto: FillRatesDto) {
    return this.service.fillRange(dto);
  }

  @Delete(':id')
  remove(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.remove(id);
  }
}
