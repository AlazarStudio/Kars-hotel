import { Module } from '@nestjs/common';
import { DemoSeedController } from './demo-seed.controller';
import { DemoSeedService } from './demo-seed.service';

@Module({
  controllers: [DemoSeedController],
  providers: [DemoSeedService],
})
export class DemoSeedModule {}
