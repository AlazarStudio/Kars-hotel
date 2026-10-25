import { Body, Controller, Delete, Get, Param, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { PlatformOperatorGuard, SuperAdminGuard } from './super-admin.guard';
import { SuperAdminService } from './super-admin.service';
import { TenantExitService } from './tenant-exit.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { ApplyFeatureDto } from './dto/apply-feature.dto';
import { AuthenticatedRequestUser } from '../auth/strategies/jwt.strategy';

/* Гард — у каждой ручки: диспетчеру (PlatformOperatorGuard) открыты сводка,
   гостиницы (список, заведение, правка, выключение, удаление пустой — пока
   выключено), вход «от имени» и функции гостиниц; уход по акту с выгрузкой,
   сотрудники гостиниц и настройки — суперадмину. Новая ручка без гарда сюда
   не пройдёт незамеченной: тест super-admin-guards. */
@Controller('admin')
export class SuperAdminController {
  constructor(
    private readonly svc: SuperAdminService,
    private readonly exit: TenantExitService,
  ) {}

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

  /* Заведение, правка, выключение и удаление гостиниц — суперадмину и
     диспетчеру Kars Avia (решение владельца 25.10.2026; до того — только
     суперадмину). Сотрудники гостиниц (`getTenant`, `users`) и настройки
     платформы — по-прежнему только суперадмину. */
  @Post('tenants')
  @UseGuards(PlatformOperatorGuard)
  createTenant(@Body() dto: CreateTenantDto, @Req() req: Request) {
    return this.svc.createTenant(dto, req.user as AuthenticatedRequestUser);
  }

  @Patch('tenants/:id')
  @UseGuards(PlatformOperatorGuard)
  updateTenant(@Param('id') id: string, @Body() dto: UpdateTenantDto, @Req() req: Request) {
    return this.svc.updateTenant(id, dto, req.user as AuthenticatedRequestUser);
  }

  /** Сколько в гостинице броней, номеров, категорий и сотрудников — для окон удаления и правки. */
  @Get('tenants/:id/summary')
  @UseGuards(PlatformOperatorGuard)
  tenantSummary(@Param('id') id: string) {
    return this.svc.tenantSummary(id);
  }

  /** Пустая гостиница (без броней) — удаляется сразу; с бронями — 409, только по акту.
   *  Пока ВЫКЛЮЧЕНО (`tenant-delete.switch.ts`): 403, ждёт удаления «в архив». */
  @Delete('tenants/:id')
  @UseGuards(PlatformOperatorGuard)
  deleteTenant(@Param('id') id: string, @Req() req: Request) {
    const user = req.user as AuthenticatedRequestUser;
    return this.exit.deleteEmpty(id, user.userId);
  }

  /* Уход гостиницы (152-ФЗ, план 13.8): выгрузка, затем уничтожение по акту.
     Только суперадмину: уничтожение стирает данные, а выгрузка отдаёт все
     персональные данные гостиницы одним файлом (днём 25.10.2026 были открыты
     диспетчеру, вечером владелец вернул как было). */
  @Get('tenants/:id/export')
  @UseGuards(SuperAdminGuard)
  async exportTenant(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const user = req.user as AuthenticatedRequestUser;
    const { fileName, json } = await this.exit.export(id, user.userId);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(json);
  }

  @Post('tenants/:id/destroy')
  @UseGuards(SuperAdminGuard)
  destroyTenant(@Param('id') id: string, @Body() body: { confirmSlug?: string }, @Req() req: Request) {
    const user = req.user as AuthenticatedRequestUser;
    return this.exit.destroy(id, body?.confirmSlug, user.userId);
  }

  @Patch('tenants/:id/toggle-active')
  @UseGuards(PlatformOperatorGuard)
  toggleActive(@Param('id') id: string) {
    return this.svc.toggleActive(id);
  }

  // ─── Функции гостиниц (массово) ─────────────────────────────────────────────

  /* Диспетчеру тоже (решение владельца 22.10.2026): включать функции разом у
     многих гостиниц — работа Kars Avia над каталогом, персональных данных в
     ней нет. На уровень платформы диспетчер попадает только из «Гостиниц»
     Kars Avia администратором (В27). */
  @Get('features')
  @UseGuards(PlatformOperatorGuard)
  listFeatures() {
    return this.svc.listFeatures();
  }

  @Post('features/apply')
  @UseGuards(PlatformOperatorGuard)
  applyFeature(@Body() dto: ApplyFeatureDto, @Req() req: Request) {
    return this.svc.applyFeature(dto, req.user as AuthenticatedRequestUser);
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
