import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { PartnerApiKeyGuard } from '../connectivity/guards/partner-api-key.guard';
import { PARTNER_SCOPES, RequireScopes } from '../connectivity/decorators/partner-scopes.decorator';
import { BackupsService, type BackupConfigPatch } from './backups.service';

/**
 * Резервные копии PMS — для админки Kars Avia (02.11.2026). Тот же вход, что у
 * партнёрского API (ключ `X-Api-Key`), но своё право `backups:manage`.
 * Данных из базы наружу не уходит: время, размер, коды итога и настройки.
 */
@ApiTags('Connectivity (Partner API)')
@ApiSecurity('partner-api-key')
@Public()
@UseGuards(PartnerApiKeyGuard)
@RequireScopes(PARTNER_SCOPES.BackupsManage)
@Controller('connect/v1/backups')
export class BackupsController {
  constructor(private readonly backups: BackupsService) {}

  @Get()
  @ApiOperation({ summary: 'Backup service state and the latest runs' })
  state() {
    return this.backups.state();
  }

  @Put('config')
  @ApiOperation({ summary: 'Change the backup schedule, retention and e-mail destination' })
  saveConfig(@Body() body: BackupConfigPatch) {
    return this.backups.saveConfig(body ?? {});
  }

  @Post('run')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a backup now (picked up within a minute)' })
  run() {
    return this.backups.requestRun();
  }
}
