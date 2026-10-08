import { Module } from '@nestjs/common';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';
import { OfferService } from './offer.service';

@Module({
  controllers: [TenantController],
  providers: [TenantService, OfferService],
  exports: [TenantService],
})
export class TenantModule {}
