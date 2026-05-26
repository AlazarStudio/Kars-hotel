import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TenantService } from './tenant.service';
import { UpdateTenantSettingsDto } from './dto/update-tenant-settings.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@ApiTags('Tenant')
@ApiBearerAuth()
@Controller('tenant')
export class TenantController {
  constructor(private readonly service: TenantService) {}

  @Get('settings')
  @RequirePermissions('room.read')
  @ApiOperation({ summary: 'Get current tenant settings' })
  getSettings() {
    return this.service.getSettings();
  }

  @Patch('settings')
  @RequirePermissions('user.update')
  @ApiOperation({ summary: 'Update current tenant settings' })
  updateSettings(@Body() dto: UpdateTenantSettingsDto) {
    return this.service.updateSettings(dto);
  }
}
