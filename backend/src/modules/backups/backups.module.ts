import { Module } from '@nestjs/common';
import { ConnectivityModule } from '../connectivity/connectivity.module';
import { PartnerApiKeyGuard } from '../connectivity/guards/partner-api-key.guard';
import { BackupsController } from './backups.controller';
import { BackupsService } from './backups.service';

/** Резервные копии PMS для админки Kars Avia (`/api/connect/v1/backups`). */
@Module({
  imports: [ConnectivityModule],
  controllers: [BackupsController],
  providers: [BackupsService, PartnerApiKeyGuard],
})
export class BackupsModule {}
