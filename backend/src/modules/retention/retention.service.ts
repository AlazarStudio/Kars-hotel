import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { retentionMode, runRetention, RuleResult } from './retention.rules';

/* Исполнитель сроков хранения (152-ФЗ, Р-11; план 13.9): раз в сутки, первый
 * прогон — через 10 минут после старта. Режим — PMS_RETENTION_MODE
 * (off по умолчанию / dry — только счёт / on — обезличивает). */
@Injectable()
export class RetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RetentionService.name);
  private timers: NodeJS.Timeout[] = [];

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (retentionMode() === 'off') {
      this.logger.log('Сроки хранения ПДн: PMS_RETENTION_MODE=off — исполнитель не запускается');
      return;
    }
    const first = setTimeout(() => void this.run(), 10 * 60_000);
    const daily = setInterval(() => void this.run(), 24 * 3_600_000);
    first.unref();
    daily.unref();
    this.timers = [first, daily];
  }

  onModuleDestroy() {
    this.timers.forEach((t) => clearTimeout(t));
  }

  async run(): Promise<RuleResult[]> {
    const mode = retentionMode();
    if (mode === 'off') return [];
    try {
      const res = await runRetention(this.prisma.admin as never, mode);
      for (const r of res) {
        const total = r.byTenant.reduce((s, x) => s + x.count, 0);
        this.logger.log(`Сроки ПДн [${mode}] ${r.rule}: ${r.skipped ? 'пропущено (другой экземпляр)' : total}`);
      }
      return res;
    } catch (e) {
      this.logger.error(`Сроки ПДн: прогон упал — ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  }
}
