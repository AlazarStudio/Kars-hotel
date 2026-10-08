import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { PlatformOperatorGuard, SuperAdminGuard } from './super-admin.guard';
import { SuperAdminService } from './super-admin.service';
import { RegisterTenantDto } from '../auth/dto/register-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { AuthenticatedRequestUser } from '../auth/strategies/jwt.strategy';

/* Гард — у каждой ручки: диспетчеру (PlatformOperatorGuard) открыты только
   сводка, список гостиниц и вход «от имени»; остальное — суперадмину. Новая
   ручка без гарда сюда не пройдёт незамеченной: тест super-admin-guards. */
@Controller('admin')
export class SuperAdminController {
  constructor(private readonly svc: SuperAdminService) {}

  // ─── Stats ──────────────────────────────────────────────────────────────────

  @Get('stats')
  @UseGuards(PlatformOperatorGuard)
  getStats() {
    return this.svc.getStats();
  }

  // ─── Tenants ────────────────────────────────────────────────────────────────

  @Get('tenants')
  @UseGuards(PlatformOperatorGuard)
  listTenants() {
    return this.svc.listTenants();
  }

  @Get('tenants/:id')
  @UseGuards(SuperAdminGuard)
  getTenant(@Param('id') id: string) {
    return this.svc.getTenant(id);
  }

  @Post('tenants')
  @UseGuards(SuperAdminGuard)
  createTenant(@Body() dto: RegisterTenantDto) {
    return this.svc.createTenant(dto);
  }

  @Patch('tenants/:id')
  @UseGuards(SuperAdminGuard)
  updateTenant(@Param('id') id: string, @Body() dto: UpdateTenantDto) {
    return this.svc.updateTenant(id, dto);
  }

  @Patch('tenants/:id/toggle-active')
  @UseGuards(SuperAdminGuard)
  toggleActive(@Param('id') id: string) {
    return this.svc.toggleActive(id);
  }

  // ─── Users ──────────────────────────────────────────────────────────────────

  @Get('users')
  @UseGuards(SuperAdminGuard)
  listUsers() {
    return this.svc.listUsers();
  }

  @Patch('users/:id/toggle-active')
  @UseGuards(SuperAdminGuard)
  toggleUserActive(@Param('id') id: string) {
    return this.svc.toggleUserActive(id);
  }

  @Patch('settings/password')
  @UseGuards(SuperAdminGuard)
  changePassword(@Req() req: Request, @Body() body: { password: string }) {
    const user = (req as any).user;
    return this.svc.changeAdminPassword(user.userId, body.password);
  }

  // ─── Impersonation ──────────────────────────────────────────────────────────

  @Post('impersonate/:tenantId')
  @UseGuards(PlatformOperatorGuard)
  impersonate(@Param('tenantId') tenantId: string, @Req() req: Request) {
    const user = req.user as AuthenticatedRequestUser;
    return this.svc.impersonate(tenantId, user, req.ip, req.headers['user-agent']);
  }
}
