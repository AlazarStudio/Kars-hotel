import { Module } from '@nestjs/common';
import { ReservationsService } from './reservations.service';
import { ReservationsController } from './reservations.controller';
import { TimelineModule } from '../timeline/timeline.module';
import { FolioModule } from '../folio/folio.module';
import { HousekeepingModule } from '../housekeeping/housekeeping.module';

@Module({
  imports: [TimelineModule, FolioModule, HousekeepingModule],
  controllers: [ReservationsController],
  providers: [ReservationsService],
  exports: [ReservationsService],
})
export class ReservationsModule {}
