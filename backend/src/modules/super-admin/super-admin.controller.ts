import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { SuperAdminGuard } from './super-admin.guard';
import { SuperAdminService } from './super-admin.service';
import { RegisterTenantDto } from '../auth/dto/register-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { AuthenticatedRequestUser } from '../auth/strategies/jwt.strategy';

@UseGuards(SuperAdminGuard)
@Controller('admin')
export class SuperAdminController {
  constructor(private readonly svc: SuperAdminService) {}

  // ─── Stats ──────────────────────────────────────────────────────────────────

  @Get('stats')
  getStats() {
    return this.svc.getStats();
  }

  // ─── Tenants ────────────────────────────────────────────────────────────────

  @Get('tenants')
  listTenants() {
    return this.svc.listTenants();
  }

  @Get('tenants/:id')
  getTenant(@Param('id') id: string) {
    return this.svc.getTenant(id);
  }

  @Post('tenants')
  createTenant(@Body() dto: RegisterTenantDto) {
    return this.svc.createTenant(dto);
  }

  @Patch('tenants/:id')
  updateTenant(@Param('id') id: string, @Body() dto: UpdateTenantDto) {
    return this.svc.updateTenant(id, dto);
  }

  @Patch('tenants/:id/toggle-active')
  toggleActive(@Param('id') id: string) {
    return this.svc.toggleActive(id);
  }

  // ─── Users ──────────────────────────────────────────────────────────────────

  @Get('users')
  listUsers() {
    return this.svc.listUsers();
  }

  @Patch('users/:id/toggle-active')
  toggleUserActive(@Param('id') id: string) {
    return this.svc.toggleUserActive(id);
  }

  @Patch('settings/password')
  changePassword(@Req() req: Request, @Body() body: { password: string }) {
    const user = (req as any).user;
    return this.svc.changeAdminPassword(user.userId, body.password);
  }

  // ─── Impersonation ──────────────────────────────────────────────────────────

  @Post('impersonate/:tenantId')
  impersonate(@Param('tenantId') tenantId: string, @Req() req: Request) {
    const user = req.user as AuthenticatedRequestUser;
    return this.svc.impersonate(tenantId, user.userId);
  }
}
