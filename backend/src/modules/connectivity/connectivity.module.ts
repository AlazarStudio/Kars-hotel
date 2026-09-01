import { Module } from '@nestjs/common';
import { ConnectivityController } from './connectivity.controller';
import { ConnectivityService } from './connectivity.service';
import { PartnerKeyService } from './partner-key.service';
import { PartnerApiKeyGuard } from './guards/partner-api-key.guard';
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
  providers: [ConnectivityService, PartnerKeyService, PartnerApiKeyGuard],
  exports: [PartnerKeyService],
})
export class ConnectivityModule {}
