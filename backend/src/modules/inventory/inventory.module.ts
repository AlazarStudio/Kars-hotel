import { Module } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { AvailabilityService } from './availability.service';
import { InventoryController } from './inventory.controller';
import { AvailabilityController } from './availability.controller';

@Module({
  controllers: [InventoryController, AvailabilityController],
  providers: [InventoryService, AvailabilityService],
  exports: [InventoryService, AvailabilityService],
})
export class InventoryModule {}
