import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RatePlansService } from './rate-plans.service';
import { CreateRatePlanDto } from './dto/create-rate-plan.dto';
import { UpdateRatePlanDto } from './dto/update-rate-plan.dto';
import { ContractPricePreviewDto, ContractPriceQueryDto } from './dto/contract-price-preview.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@ApiTags('rate-plans')
@ApiBearerAuth()
@Controller('rate-plans')
export class RatePlansController {
  constructor(private readonly service: RatePlansService) {}

  @Get()
  @RequirePermissions('rate.read')
  @ApiOperation({ summary: 'List rate plans' })
  list() {
    return this.service.list();
  }

  @Get('room-types')
  @RequirePermissions('rate.read')
  @ApiOperation({ summary: 'Minimal room categories for tariff management' })
  roomTypes() {
    return this.service.roomTypes();
  }

  /* Объявлен ДО ':id' намеренно: иначе путь съест параметрический маршрут и
     ответит 400 на нечисловой uuid. */
  @Get('operator-tariff')
  @RequirePermissions('rate.read')
  @ApiOperation({ summary: 'Корпоративный тариф для оператора со статусом сверки' })
  operatorTariff() {
    return this.service.operatorTariff();
  }

  @Post('contract-prices/preview')
  @RequirePermissions('rate.read')
  @ApiOperation({ summary: 'Preview contract prices for draft tariff conditions (read-only)' })
  previewContractPrices(@Body() dto: ContractPricePreviewDto) {
    return this.service.previewContractPrices(dto);
  }

  @Get(':id/contract-prices')
  @RequirePermissions('rate.read')
  @ApiOperation({ summary: 'Contract prices of a corporate tariff (read-only)' })
  contractPrices(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: ContractPriceQueryDto,
  ) {
    return this.service.contractPrices(id, query.from, query.to);
  }

  @Get(':id')
  @RequirePermissions('rate.read')
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.get(id);
  }

  @Post()
  @RequirePermissions('rate.update')
  create(@Body() dto: CreateRatePlanDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('rate.update')
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: UpdateRatePlanDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('rate.update')
  remove(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.remove(id);
  }
}
