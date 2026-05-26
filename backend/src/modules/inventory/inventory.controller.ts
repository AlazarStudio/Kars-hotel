import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InventoryService } from './inventory.service';
import { GetInventoryDto } from './dto/get-inventory.dto';
import { BulkUpdateInventoryDto } from './dto/bulk-update-inventory.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';

@ApiBearerAuth()
@ApiTags('Inventory')
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get()
  @RequirePermissions('room.read')
  @ApiOperation({
    summary: 'Get inventory grid',
    description:
      'Returns per-day inventory for a room type over a date range. ' +
      'Dates without explicit records are synthesized from the physical room count.',
  })
  getGrid(@Query() dto: GetInventoryDto) {
    return this.inventoryService.getGrid(dto.roomTypeId, dto.from, dto.to);
  }

  @Put(':roomTypeId')
  @RequirePermissions('room.update')
  @ApiOperation({
    summary: 'Bulk-update inventory',
    description:
      'Upserts totalRooms, blockedRooms and/or stopSell for each date. ' +
      'bookedRooms is managed exclusively by the reservation engine and cannot be set here.',
  })
  bulkUpdate(
    @Param('roomTypeId', ParseUUIDPipe) roomTypeId: string,
    @Body() dto: BulkUpdateInventoryDto,
  ) {
    return this.inventoryService.bulkUpdate(roomTypeId, dto.rows);
  }
}
