import { Module } from '@nestjs/common';
import { RetentionService } from './retention.service';

/** Сроки хранения ПДн (152-ФЗ, план 13.9). */
@Module({
  providers: [RetentionService],
  exports: [RetentionService],
})
export class RetentionModule {}
