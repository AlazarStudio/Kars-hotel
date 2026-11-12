import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { ContractsService } from './contracts.service';

/* Договоры партнёров. Читает тот же, кто читает тарифы: это их источник цен. */
@ApiTags('contracts')
@ApiBearerAuth()
@Controller('contracts')
export class ContractsController {
  constructor(private readonly service: ContractsService) {}

  @Get()
  @RequirePermissions('rate.read')
  @ApiOperation({ summary: 'Partners contracts of this hotel (registry and price applications)' })
  list() {
    return this.service.list();
  }
}
