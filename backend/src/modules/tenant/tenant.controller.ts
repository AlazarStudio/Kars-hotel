import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TenantService } from './tenant.service';
import { UpdateTenantSettingsDto } from './dto/update-tenant-settings.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedRequestUser } from '../auth/strategies/jwt.strategy';
import { CreateTenantUserDto, UpdateTenantUserDto } from './dto/manage-user.dto';
import { MAX_PHOTO_BYTES, UploadedFile as MediaFile } from '../../common/storage/storage.service';

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

  @Post('logo')
  @RequirePermissions('user.update')
  @ApiOperation({ summary: 'Upload the hotel logo (stored in our object storage)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PHOTO_BYTES } }))
  uploadLogo(@UploadedFile() file?: MediaFile) {
    if (!file) {
      throw new BadRequestException('Файл не передан (ожидается поле "file")');
    }
    return this.service.uploadLogo(file);
  }

  @Delete('logo')
  @RequirePermissions('user.update')
  @ApiOperation({ summary: 'Remove the hotel logo' })
  removeLogo() {
    return this.service.removeLogo();
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
