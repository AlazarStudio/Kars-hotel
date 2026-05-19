import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TenantService } from './tenant.service';
import { UpdateTenantSettingsDto } from './dto/update-tenant-settings.dto';

@ApiTags('Tenant')
@ApiBearerAuth()
@Controller('tenant')
export class TenantController {
  constructor(private readonly service: TenantService) {}

  @Get('settings')
  @ApiOperation({ summary: 'Get current tenant settings' })
  getSettings() {
    return this.service.getSettings();
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Update current tenant settings' })
  updateSettings(@Body() dto: UpdateTenantSettingsDto) {
    return this.service.updateSettings(dto);
  }
}
