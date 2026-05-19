import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TimelineService } from './timeline.service';
import { GetTimelineDto } from './dto/get-timeline.dto';

@ApiBearerAuth()
@ApiTags('Timeline')
@Controller('timeline')
export class TimelineController {
  constructor(private readonly timelineService: TimelineService) {}

  @Get()
  @ApiOperation({
    summary: 'Get timeline (rack-chart data)',
    description:
      'Returns all active rooms grouped by room type, with their reservations ' +
      'that overlap the [from, to] window. Cached in Redis for 30 seconds. ' +
      'Subscribe to the /timeline WebSocket namespace to receive real-time ' +
      'invalidation events (timeline:update).',
  })
  getTimeline(@Query() dto: GetTimelineDto) {
    return this.timelineService.getTimeline(dto.from, dto.to);
  }
}
