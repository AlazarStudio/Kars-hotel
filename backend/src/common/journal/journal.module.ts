import { Module } from '@nestjs/common';
import { JournalController } from './journal.controller';
import { JournalService } from './journal.service';

/* Журнал действий (23.10.2026): сплошная лента запросов и нажатий.
   Запись запросов — middleware в main.ts (journalMiddleware), след кабинета
   и выдача для панели платформы — здесь. */
@Module({
  controllers: [JournalController],
  providers: [JournalService],
  exports: [JournalService],
})
export class JournalModule {}
