import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedRequestUser } from '../auth/strategies/jwt.strategy';
import { AviaReportsService } from './avia-reports.service';

/* Отчёты Kars Avia по этой гостинице — читает тот, кто смотрит отчёты. */
@ApiTags('avia-reports')
@ApiBearerAuth()
@Controller('avia-reports')
export class AviaReportsController {
  constructor(private readonly reports: AviaReportsService) {}

  @Get()
  @RequirePermissions('report.view.operations')
  @ApiOperation({ summary: 'Reports issued by Kars Avia for this hotel' })
  list(@CurrentUser() user: AuthenticatedRequestUser) {
    return this.reports.list(user.tenantId);
  }

  @Get(':id/file')
  @RequirePermissions('report.view.operations')
  @ApiOperation({ summary: 'Download an issued report (xlsx)' })
  async file(@CurrentUser() user: AuthenticatedRequestUser, @Param('id') id: string, @Res() res: Response) {
    const { buffer, name } = await this.reports.file(user.tenantId, id);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.send(buffer);
  }
}
