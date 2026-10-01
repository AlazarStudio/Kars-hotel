import { Module } from '@nestjs/common';
import { AviaReportsController } from './avia-reports.controller';
import { AviaReportsService } from './avia-reports.service';

/**
 * Отчёты, которые Kars Avia выпустила для гостиницы (01.10.2026). Только
 * чтение: собирает и выпускает отчёты диспетчер в Авиа, гостиница их видит и
 * скачивает — как раздел «Отчёты» гостиницы в старой системе.
 */
@Module({
  controllers: [AviaReportsController],
  providers: [AviaReportsService],
})
export class AviaReportsModule {}
