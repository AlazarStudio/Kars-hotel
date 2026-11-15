import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedRequestUser } from '../auth/strategies/jwt.strategy';
import { SquadronSubmitDto } from './squadron-report.dto';
import { SquadronReportService } from './squadron-report.service';

@ApiTags('avia-reports')
@ApiBearerAuth()
@Controller('avia-reports/squadron')
export class SquadronReportController {
  constructor(private readonly reports: SquadronReportService, private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions('avia-report.access')
  list(@CurrentUser() user: AuthenticatedRequestUser) {
    return this.reports.list(user.tenantId);
  }

  @Get('preview')
  @RequirePermissions('avia-report.access')
  preview(@CurrentUser() user: AuthenticatedRequestUser, @Query('startDate') startDate: string, @Query('endDate') endDate: string) {
    return this.reports.preview(user.tenantId, startDate, endDate);
  }

  @Get(':id')
  @RequirePermissions('avia-report.access')
  detail(@CurrentUser() user: AuthenticatedRequestUser, @Param('id') id: string) {
    return this.reports.detail(user.tenantId, id);
  }

  @Post()
  @RequirePermissions('avia-report.access')
  async submit(@CurrentUser() user: AuthenticatedRequestUser, @Body() dto: SquadronSubmitDto) {
    const result = await this.reports.submit(user.tenantId, dto);
    await this.prisma.writeAuditLog({ tenantId: user.tenantId, userId: user.userId,
      entity: 'avia_squadron_hotel_report', entityId: result.id, action: 'send' });
    return result;
  }
}
