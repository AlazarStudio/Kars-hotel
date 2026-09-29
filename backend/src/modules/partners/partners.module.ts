import { Module } from '@nestjs/common';
import { PartnerDirectoryService } from './partner-directory.service';
import { PartnersController } from './partners.controller';

/**
 * Партнёры-каналы и их справочники (29.09.2026). Отдельным модулем: справочник
 * пишет партнёр через API подключения, а читает гостиница в форме тарифа —
 * два потребителя, и ни один не должен тянуть модуль другого.
 */
@Module({
  controllers: [PartnersController],
  providers: [PartnerDirectoryService],
  exports: [PartnerDirectoryService],
})
export class PartnersModule {}
