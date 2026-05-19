import { Controller, Delete, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DemoSeedService } from './demo-seed.service';

@ApiTags('demo-seed')
@ApiBearerAuth()
@Controller('demo-seed')
export class DemoSeedController {
  constructor(private readonly service: DemoSeedService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Populate the current tenant with the legacy mock dataset (4 categories, 21 rooms)',
  })
  seed() {
    return this.service.seed();
  }

  @Delete()
  @ApiOperation({ summary: 'Wipe all rooms + room types of the current tenant' })
  reset() {
    return this.service.reset();
  }
}
