import { Module } from '@nestjs/common';
import { ConnectivityController } from './connectivity.controller';
import { ConnectivityService } from './connectivity.service';
import { PartnerKeyService } from './partner-key.service';
import { PartnerApiKeyGuard } from './guards/partner-api-key.guard';
import { PartnerWebhookService } from './partner-webhook.service';
import { InventoryModule } from '../inventory/inventory.module';
import { ReservationsModule } from '../reservations/reservations.module';
import { AuthModule } from '../auth/auth.module';
import { RatePlansModule } from '../rate-plans/rate-plans.module';

/**
 * Connectivity module — exposes the cross-tenant partner API (`/api/connect/v1`)
 * secured by partner API keys. Reuses AvailabilityService + ReservationsService
 * so partner bookings share the exact same business rules as in-app bookings.
 */
@Module({
  imports: [InventoryModule, ReservationsModule, AuthModule, RatePlansModule],
  controllers: [ConnectivityController],
  providers: [
    ConnectivityService,
    PartnerKeyService,
    PartnerApiKeyGuard,
    // Тот же сервис объявлен и в ReservationsModule: он без состояния, и
    // держать его экземпляр на модуль дешевле, чем городить взаимный импорт.
    PartnerWebhookService,
  ],
  exports: [PartnerKeyService],
})
export class ConnectivityModule {}
