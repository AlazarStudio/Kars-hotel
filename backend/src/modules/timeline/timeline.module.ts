import { Module } from '@nestjs/common';
import { TimelineService } from './timeline.service';
import { TimelineController } from './timeline.controller';
import { TimelineGateway } from './timeline.gateway';

@Module({
  controllers: [TimelineController],
  providers: [TimelineService, TimelineGateway],
  exports: [TimelineService, TimelineGateway],
})
export class TimelineModule {}
