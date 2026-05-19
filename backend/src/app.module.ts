import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { PrismaModule } from './common/prisma/prisma.module';
import { RedisModule } from './common/redis/redis.module';
import { TenantContextInterceptor } from './common/interceptors/tenant-context.interceptor';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RoomTypesModule } from './modules/room-types/room-types.module';
import { RoomsModule } from './modules/rooms/rooms.module';
import { DemoSeedModule } from './modules/demo-seed/demo-seed.module';
import { RatePlansModule } from './modules/rate-plans/rate-plans.module';
import { RatesModule } from './modules/rates/rates.module';
import { RestrictionsModule } from './modules/restrictions/restrictions.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { TimelineModule } from './modules/timeline/timeline.module';
import { ReservationsModule } from './modules/reservations/reservations.module';
import { TenantModule } from './modules/tenant/tenant.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.LOG_LEVEL ?? 'info',
        transport:
          process.env.NODE_ENV !== 'production'
            ? {
                target: 'pino-pretty',
                options: {
                  singleLine: true,
                  translateTime: 'SYS:HH:MM:ss',
                  ignore: 'pid,hostname,req.headers,res.headers',
                },
              }
            : undefined,
      },
    }),
    PrismaModule,
    RedisModule,
    AuthModule,
    HealthModule,
    RoomTypesModule,
    RoomsModule,
    DemoSeedModule,
    RatePlansModule,
    RatesModule,
    RestrictionsModule,
    PricingModule,
    InventoryModule,
    TimelineModule,
    ReservationsModule,
    TenantModule,
  ],
  providers: [
    // Global guard — every controller is protected unless explicitly marked @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Global interceptor — pulls tenantId from req.user into AsyncLocalStorage.
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
  ],
})
export class AppModule {}
