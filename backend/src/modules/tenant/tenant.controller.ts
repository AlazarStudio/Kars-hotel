import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TenantService } from './tenant.service';
import { OfferService } from './offer.service';
import type { Request } from 'express';
import { UpdateTenantSettingsDto } from './dto/update-tenant-settings.dto';
import { UpdateGalleryDto } from './dto/update-gallery.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedRequestUser } from '../auth/strategies/jwt.strategy';
import { CreateTenantUserDto, UpdateTenantUserDto } from './dto/manage-user.dto';
import { UpsertPartnerServiceDto } from './dto/partner-service.dto';
import { MAX_PHOTO_BYTES, UploadedFile as MediaFile } from '../../common/storage/storage.service';

@ApiTags('Tenant')
@ApiBearerAuth()
@Controller('tenant')
export class TenantController {
  constructor(
    private readonly service: TenantService,
    private readonly offer: OfferService,
  ) {}

  @Get('settings')
  @RequirePermissions('room.read')
  @ApiOperation({ summary: 'Get current tenant settings' })
  getSettings() {
    return this.service.getSettings();
  }

  /* Б5/Е2/Е4 · каталог услуг для партнёра. Читать — как настройки, менять —
   * как настройки: это коммерческие данные отеля, а не операционные. */
  @Get('partner-services')
  @RequirePermissions('room.read')
  @ApiOperation({ summary: 'Partner-facing service catalogue (meals + extras)' })
  listPartnerServices() {
    return this.service.listPartnerServices();
  }

  @Post('partner-services')
  @RequirePermissions('user.update')
  @ApiOperation({ summary: 'Add a partner-facing service' })
  createPartnerService(@Body() dto: UpsertPartnerServiceDto) {
    return this.service.createPartnerService(dto);
  }

  @Patch('partner-services/:id')
  @RequirePermissions('user.update')
  @ApiOperation({ summary: 'Update a partner-facing service' })
  updatePartnerService(@Param('id') id: string, @Body() dto: UpsertPartnerServiceDto) {
    return this.service.updatePartnerService(id, dto);
  }

  @Delete('partner-services/:id')
  @RequirePermissions('user.update')
  @ApiOperation({ summary: 'Delete a partner-facing service' })
  deletePartnerService(@Param('id') id: string) {
    return this.service.deletePartnerService(id);
  }

  /* Оферта PMS с поручением (152-ФЗ, Р-29; план 13.11): статус видит любой
     сотрудник гостиницы, принимает — владелец сам. */
  @Get('offer')
  @ApiOperation({ summary: 'Offer (data processing agreement) status for this hotel' })
  offerStatus(@CurrentUser() user: AuthenticatedRequestUser) {
    return this.offer.status(user.tenantId);
  }

  @Post('offer/accept')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept the current offer version (owner only)' })
  acceptOffer(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Body() dto: { version?: number; incidentContact?: { name?: string; phone?: string; email?: string } },
    @Req() req: Request,
  ) {
    return this.offer.accept(user, dto, req.ip, req.headers['user-agent']);
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

  @Post('gallery')
  @RequirePermissions('user.update')
  @ApiOperation({ summary: 'Add a photo to the hotel gallery (stored in our object storage)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_PHOTO_BYTES } }))
  addGalleryPhoto(@UploadedFile() file?: MediaFile) {
    if (!file) {
      throw new BadRequestException('Файл не передан (ожидается поле "file")');
    }
    return this.service.addGalleryPhoto(file);
  }

  @Patch('gallery')
  @RequirePermissions('user.update')
  @ApiOperation({ summary: 'Reorder the gallery (first = cover) or remove photos' })
  updateGallery(@Body() dto: UpdateGalleryDto) {
    return this.service.setGallery(dto.photos);
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
  updateUser(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('userId') userId: string,
    @Body() dto: UpdateTenantUserDto,
  ) {
    return this.service.updateUser(user.tenantId, userId, dto);
  }

  @Post('users/:userId/reset-password')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('user.update')
  @ApiOperation({ summary: 'Reset a team member password (temporary password, sessions revoked)' })
  resetPassword(@CurrentUser() user: AuthenticatedRequestUser, @Param('userId') userId: string) {
    return this.service.resetPassword(user.tenantId, userId, user.userId);
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
