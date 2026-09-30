import { Module } from '@nestjs/common';
import { PartnerWebhookService } from '../connectivity/partner-webhook.service';
import { RatesController } from './rates.controller';
import { RatesService } from './rates.service';

@Module({
  controllers: [RatesController],
  // PartnerWebhookService — без состояния, как в ReservationsModule (иначе цикл импортов).
  providers: [RatesService, PartnerWebhookService],
  exports: [RatesService],
})
export class RatesModule {}
