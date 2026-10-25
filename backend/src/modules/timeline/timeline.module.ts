import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TimelineService } from './timeline.service';
import { TimelineController } from './timeline.controller';
import { TimelineGateway } from './timeline.gateway';

@Module({
  // Только проверка access-токена в handshake сокета; секрет gateway берёт сам.
  imports: [JwtModule.register({})],
  controllers: [TimelineController],
  providers: [TimelineService, TimelineGateway],
  exports: [TimelineService, TimelineGateway],
})
export class TimelineModule {}
