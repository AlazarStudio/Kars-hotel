import { Body, Controller, Get, Param, Post, Put, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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

  @Get('fap')
  @RequirePermissions('avia-report.access')
  @ApiOperation({ summary: 'Kars Avia FAP requests of this hotel' })
  fapList(@CurrentUser() user: AuthenticatedRequestUser) {
    return this.reports.fapList(user.tenantId);
  }

  @Get('fap/:id')
  @RequirePermissions('avia-report.access')
  @ApiOperation({ summary: 'Hotel report of a FAP request' })
  fapReport(@CurrentUser() user: AuthenticatedRequestUser, @Param('id') id: string) {
    return this.reports.fapReport(user.tenantId, id);
  }

  @Put('fap/:id')
  @RequirePermissions('avia-report.access')
  @ApiOperation({ summary: 'Send the hotel report of a FAP request to Kars Avia' })
  async fapSave(@CurrentUser() user: AuthenticatedRequestUser, @Param('id') id: string, @Body() body: { rows: unknown[] }) {
    const saved = await this.reports.fapSave(user.tenantId, id, body.rows);
    await this.prisma.writeAuditLog({ tenantId: user.tenantId, userId: user.userId, entity: 'avia_report', entityId: id, action: 'send' });
    return saved;
  }

  @Post('fap/:id/invoice')
  @RequirePermissions('avia-report.access')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  @ApiOperation({ summary: 'Attach the invoice PDF after the airline approved the report' })
  async fapInvoice(
    @CurrentUser() user: AuthenticatedRequestUser,
    @Param('id') id: string,
    @UploadedFile() file: { buffer: Buffer; originalname: string },
    @Body() body: { amount: string; number?: string },
  ) {
    const saved = await this.reports.fapInvoice(user.tenantId, id, file, body.amount, body.number);
    await this.prisma.writeAuditLog({ tenantId: user.tenantId, userId: user.userId, entity: 'avia_report', entityId: id, action: 'invoice' });
    return saved;
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
