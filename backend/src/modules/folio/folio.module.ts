import { Module } from '@nestjs/common';
import { FolioService } from './folio.service';
import { FolioController } from './folio.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [FolioController],
  providers: [FolioService],
  exports: [FolioService],
})
export class FolioModule {}
