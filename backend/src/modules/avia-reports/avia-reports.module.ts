import { Module } from '@nestjs/common';
import { AviaReportsController } from './avia-reports.controller';
import { AviaReportsService } from './avia-reports.service';
import { InventoryModule } from '../inventory/inventory.module';
import { SquadronReportController } from './squadron-report.controller';
import { SquadronReportService } from './squadron-report.service';

/**
 * Выпущенные Avia отчёты и отправляемые гостиницей отчёты по Эскадрилье.
 * Расчёт последних использует цены PMS; связь с Avia — только по HTTP.
 */
@Module({
  imports: [InventoryModule],
  controllers: [AviaReportsController, SquadronReportController],
  providers: [AviaReportsService, SquadronReportService],
})
export class AviaReportsModule {}
