import { Module } from '@nestjs/common';
import { ReservationsService } from './reservations.service';
import { ReservationsController } from './reservations.controller';
import { TimelineModule } from '../timeline/timeline.module';
import { FolioModule } from '../folio/folio.module';
import { HousekeepingModule } from '../housekeeping/housekeeping.module';
import { PartnerWebhookService } from '../connectivity/partner-webhook.service';

// PartnerWebhookService объявлен здесь, а не импортом ConnectivityModule:
// connectivity сам зависит от reservations, и импорт обратно завёл бы цикл.
// Сервис без состояния — второй экземпляр ничего не стоит.
@Module({
  imports: [TimelineModule, FolioModule, HousekeepingModule],
  controllers: [ReservationsController],
  providers: [ReservationsService, PartnerWebhookService],
  exports: [ReservationsService],
})
export class ReservationsModule {}
