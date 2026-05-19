import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
import { Public } from '../auth/decorators/public.decorator';

type ComponentStatus = 'ok' | 'down';

interface HealthPayload {
  status: 'ok' | 'degraded';
  service: string;
  timestamp: string;
  uptimeSeconds: number;
  components: {
    db: { status: ComponentStatus; error?: string };
    redis: { status: ComponentStatus; error?: string };
  };
}

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Liveness + readiness probe',
    description: 'Pings Postgres and Redis. Returns 200 always; "status" is "degraded" if a dependency is down.',
  })
  @ApiResponse({ status: 200, description: 'Health snapshot' })
  async check(): Promise<HealthPayload> {
    const [dbResult, redisResult] = await Promise.allSettled([this.prisma.ping(), this.redis.ping()]);

    const db: HealthPayload['components']['db'] =
      dbResult.status === 'fulfilled'
        ? { status: 'ok' }
        : { status: 'down', error: this.errorMessage(dbResult.reason) };

    const redis: HealthPayload['components']['redis'] =
      redisResult.status === 'fulfilled'
        ? { status: 'ok' }
        : { status: 'down', error: this.errorMessage(redisResult.reason) };

    const status: HealthPayload['status'] = db.status === 'ok' && redis.status === 'ok' ? 'ok' : 'degraded';

    return {
      status,
      service: 'kars-hotel-backend',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      components: { db, redis },
    };
  }

  private errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
  }
}
