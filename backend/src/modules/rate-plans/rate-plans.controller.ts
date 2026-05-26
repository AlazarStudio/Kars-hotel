import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RatePlansService } from './rate-plans.service';
import { CreateRatePlanDto } from './dto/create-rate-plan.dto';
import { UpdateRatePlanDto } from './dto/update-rate-plan.dto';
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
