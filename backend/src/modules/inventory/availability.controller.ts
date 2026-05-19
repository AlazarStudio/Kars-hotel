import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AvailabilityService } from './availability.service';
import { CheckAvailabilityDto } from './dto/check-availability.dto';

@ApiBearerAuth()
@ApiTags('Availability')
@Controller('availability')
export class AvailabilityController {
  constructor(private readonly availabilityService: AvailabilityService) {}

  @Get()
  @ApiOperation({
    summary: 'Check availability',
    description:
      'Returns per-day availability breakdown for a stay period. ' +
      'Results are cached in Redis for 60 seconds. ' +
      'If roomTypeId is omitted, availability for all active room types is returned.',
  })
  check(@Query() dto: CheckAvailabilityDto) {
    if (dto.roomTypeId) {
      return this.availabilityService.check(
        dto.roomTypeId,
        dto.checkIn,
        dto.checkOut,
        dto.ratePlanId,
      );
    }
    return this.availabilityService.checkAll(dto.checkIn, dto.checkOut, dto.ratePlanId);
  }
}
