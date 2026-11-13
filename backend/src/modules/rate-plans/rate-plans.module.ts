import { Module } from '@nestjs/common';
import { PartnerWebhookService } from '../connectivity/partner-webhook.service';
import { ContractsModule } from '../contracts/contracts.module';
import { RatePlansController } from './rate-plans.controller';
import { RatePlansService } from './rate-plans.service';

@Module({
  // Контракты — срезы и сетки цен договора: цена корпоративного тарифа теперь оттуда.
  imports: [ContractsModule],
  controllers: [RatePlansController],
  // PartnerWebhookService — без состояния, как в ReservationsModule (иначе цикл импортов).
  providers: [RatePlansService, PartnerWebhookService],
  exports: [RatePlansService],
})
export class RatePlansModule {}
