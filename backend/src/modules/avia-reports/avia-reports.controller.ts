import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedRequestUser } from '../auth/strategies/jwt.strategy';
import { AviaReportsService } from './avia-reports.service';
import { PrismaService } from '../../common/prisma/prisma.service';

/* Отчёты Kars Avia по этой гостинице — читает тот, кто смотрит отчёты. */
@ApiTags('avia-reports')
@ApiBearerAuth()
@Controller('avia-reports')
export class AviaReportsController {
  constructor(
    private readonly reports: AviaReportsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @RequirePermissions('avia-report.access')
  @ApiOperation({ summary: 'Reports issued by Kars Avia for this hotel' })
  list(@CurrentUser() user: AuthenticatedRequestUser) {
    return this.reports.list(user.tenantId);
  }

  @Get(':id/file')
  @RequirePermissions('avia-report.access')
  @ApiOperation({ summary: 'Download an issued report (xlsx)' })
  async file(@CurrentUser() user: AuthenticatedRequestUser, @Param('id') id: string, @Res() res: Response) {
    const { buffer, name } = await this.reports.file(user.tenantId, id);
    // Скачивание отчёта с ФИО гостей — в журнал гостиницы (план 13.5).
    await this.prisma.writeAuditLog({
      tenantId: user.tenantId,
      userId: user.userId,
      entity: 'avia_report',
      entityId: id,
      action: 'download',
    });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(buffer);
  }
}
