import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { DomainsController } from './domains.controller';

@Module({
  controllers: [HealthController, DomainsController],
})
export class HealthModule {}
