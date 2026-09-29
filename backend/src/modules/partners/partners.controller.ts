import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PartnerDirectoryService } from './partner-directory.service';

/* Партнёры и их справочники — для формы корпоративного тарифа: гостиница
   выбирает, для какого партнёра, юрлица и авиакомпании её тариф. Читает тот
   же, кто читает тарифы; править справочник гостиница не может — его ведёт
   партнёр. */
@ApiTags('partners')
@ApiBearerAuth()
@Controller('partners')
export class PartnersController {
  constructor(private readonly directory: PartnerDirectoryService) {}

  @Get()
  @RequirePermissions('rate.read')
  @ApiOperation({ summary: 'Active partners with their accounts and customers (read-only)' })
  list() {
    return this.directory.listActive();
  }
}
