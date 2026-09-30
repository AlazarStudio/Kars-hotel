import { Module } from '@nestjs/common';
import { PartnerWebhookService } from '../connectivity/partner-webhook.service';
import { RatePlansController } from './rate-plans.controller';
import { RatePlansService } from './rate-plans.service';

@Module({
  controllers: [RatePlansController],
  // PartnerWebhookService — без состояния, как в ReservationsModule (иначе цикл импортов).
  providers: [RatePlansService, PartnerWebhookService],
  exports: [RatePlansService],
})
export class RatePlansModule {}
