import { Module } from '@nestjs/common';
import { RestrictionsController } from './restrictions.controller';
import { RestrictionsService } from './restrictions.service';

@Module({
  controllers: [RestrictionsController],
  providers: [RestrictionsService],
  exports: [RestrictionsService],
})
export class RestrictionsModule {}
