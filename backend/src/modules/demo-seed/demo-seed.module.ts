import { Module } from '@nestjs/common';
import { DemoSeedController } from './demo-seed.controller';
import { DemoSeedService } from './demo-seed.service';

@Module({
  controllers: [DemoSeedController],
  providers: [DemoSeedService],
})
export class DemoSeedModule {}

/**
 * Демо-данные — только вне боя (152-ФЗ, Т-71; план 12.9). `DELETE /demo-seed`
 * стирает весь номерной фонд гостиницы любому её сотруднику, а `POST` тянет
 * картинки с внешнего адреса: на бою ни то, ни другое не нужно, и ручек там
 * нет вовсе (404), а не «есть, но с проверкой».
 */
export function demoSeedModules(env = process.env.NODE_ENV): Array<typeof DemoSeedModule> {
  return env === 'production' ? [] : [DemoSeedModule];
}
