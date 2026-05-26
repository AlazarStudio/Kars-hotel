import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TenantService } from './tenant.service';
import { UpdateTenantSettingsDto } from './dto/update-tenant-settings.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedRequestUser } from '../auth/strategies/jwt.strategy';
import { CreateTenantUserDto, UpdateTenantUserDto } from './dto/manage-user.dto';

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

  @Get('users')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('user.read')
  @ApiOperation({ summary: 'List all users in this hotel' })
  listUsers(@CurrentUser() user: AuthenticatedRequestUser) {
    return this.service.listUsers(user.tenantId);
  }

  @Post('users')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('user.invite')
  @ApiOperation({ summary: 'Invite a new user to this hotel' })
  createUser(@CurrentUser() user: AuthenticatedRequestUser, @Body() dto: CreateTenantUserDto) {
    return this.service.createUser(user.tenantId, dto);
  }

  @Patch('users/:userId')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('user.update')
  @ApiOperation({ summary: 'Update role or active status of a team member' })
  updateUser(@CurrentUser() user: AuthenticatedRequestUser, @Param('userId') userId: string, @Body() dto: UpdateTenantUserDto) {
    return this.service.updateUser(user.tenantId, userId, dto);
  }

  @Delete('users/:userId')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('user.delete')
  @ApiOperation({ summary: 'Deactivate a team member (soft delete)' })
  deleteUser(@CurrentUser() user: AuthenticatedRequestUser, @Param('userId') userId: string) {
    return this.service.deleteUser(user.tenantId, userId);
  }

  @Get('roles')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('user.read')
  @ApiOperation({ summary: 'List roles available in this hotel' })
  listRoles(@CurrentUser() user: AuthenticatedRequestUser) {
    return this.service.listRoles(user.tenantId);
  }
}
