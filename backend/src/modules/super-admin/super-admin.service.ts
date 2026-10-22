import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { TenantPlan } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { RegisterTenantDto } from '../auth/dto/register-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { AuthenticatedRequestUser } from '../auth/strategies/jwt.strategy';
import { ApplyFeatureDto } from './dto/apply-feature.dto';
import { TENANT_FEATURES, isTenantFeature } from './tenant-features';

@Injectable()
export class SuperAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

  // ─── Функции гостиниц (массово) ─────────────────────────────────────────────

  /** Каталог функций и состояние каждой у каждой гостиницы. */
  async listFeatures() {
    const tenants = await this.prisma.admin.tenant.findMany({
      where: { slug: { not: 'platform' } },
      select: { id: true, name: true, city: true, isActive: true, multiPlaceEnabled: true },
      orderBy: { name: 'asc' },
    });
    return {
      features: TENANT_FEATURES,
      tenants: tenants.map((t) => ({
        id: t.id,
        name: t.name,
        city: t.city,
        isActive: t.isActive,
        features: Object.fromEntries(TENANT_FEATURES.map((f) => [f.key, t[f.key] === true])),
      })),
    };
  }

  /* Включить или выключить функцию у выбранных гостиниц. Платформенная запись
     не трогается, даже если её id прислали. Каждая изменённая гостиница
     получает строку в своём журнале — «кто включил мне многоместность». */
  async applyFeature(dto: ApplyFeatureDto, actor: AuthenticatedRequestUser) {
    if (!isTenantFeature(dto.feature)) throw new NotFoundException('Unknown feature');
    const key = dto.feature;
    const ids = [...new Set(dto.tenantIds)];
    const changed = await this.prisma.admin.tenant.findMany({
      where: { id: { in: ids }, slug: { not: 'platform' }, [key]: { not: dto.enabled } },
      select: { id: true },
    });
    if (changed.length > 0) {
      await this.prisma.admin.$transaction([
        this.prisma.admin.tenant.updateMany({
          where: { id: { in: changed.map((t) => t.id) } },
          data: { [key]: dto.enabled },
        }),
        this.prisma.admin.auditLog.createMany({
          data: changed.map((t) => ({
            tenantId: t.id,
            userId: actor.userId,
            entity: 'tenant',
            entityId: t.id,
            action: 'feature.apply',
            diff: { [key]: [!dto.enabled, dto.enabled] },
          })),
        }),
      ]);
    }
    return { feature: key, enabled: dto.enabled, changed: changed.length, requested: ids.length };
  }

  // ─── Tenants ────────────────────────────────────────────────────────────────

  async listTenants() {
    const tenants = await this.prisma.admin.tenant.findMany({
      where: { slug: { not: 'platform' } },
      include: {
        _count: { select: { users: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return tenants.map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      city: t.city,
      plan: t.plan,
      isActive: t.isActive,
      createdAt: t.createdAt,
      usersCount: t._count.users,
    }));
  }

  async getTenant(id: string) {
    const t = await this.prisma.admin.tenant.findUnique({
      where: { id },
      include: {
        users: {
          select: {
            id: true,
            email: true,
            fullName: true,
            isActive: true,
            lastLoginAt: true,
            role: { select: { code: true, name: true } },
          },
        },
      },
    });
    if (!t || t.slug === 'platform') throw new NotFoundException('Tenant not found');
    return t;
  }

  async createTenant(dto: RegisterTenantDto) {
    // Delegate to AuthService.registerTenant which handles slug resolution,
    // role seeding, and user creation in one transaction.
    return this.auth.registerTenant(dto);
  }

  async updateTenant(id: string, dto: UpdateTenantDto) {
    const tenant = await this.prisma.admin.tenant.findUnique({
      where: { id },
      select: { id: true, slug: true },
    });
    if (!tenant || tenant.slug === 'platform') throw new NotFoundException('Tenant not found');

    return this.prisma.admin.tenant.update({
      where: { id },
      data: {
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.city !== undefined ? { city: dto.city } : {}),
        ...(dto.address !== undefined ? { address: dto.address } : {}),
        ...(dto.stars !== undefined ? { stars: dto.stars } : {}),
        ...(dto.timezone ? { timezone: dto.timezone } : {}),
        ...(dto.currency ? { currency: dto.currency } : {}),
        ...(dto.plan ? { plan: dto.plan as TenantPlan } : {}),
      },
    });
  }

  async toggleActive(id: string) {
    const tenant = await this.prisma.admin.tenant.findUnique({
      where: { id },
      select: { id: true, slug: true, isActive: true },
    });
    if (!tenant || tenant.slug === 'platform') throw new NotFoundException('Tenant not found');

    return this.prisma.admin.tenant.update({
      where: { id },
      data: { isActive: !tenant.isActive },
      select: { id: true, isActive: true },
    });
  }

  async toggleUserActive(userId: string) {
    const user = await this.prisma.admin.user.findUnique({
      where: { id: userId },
      select: { id: true, isActive: true, tenant: { select: { slug: true } } },
    });
    if (!user || user.tenant.slug === 'platform') throw new NotFoundException('User not found');
    return this.prisma.admin.user.update({
      where: { id: userId },
      data: { isActive: !user.isActive, deactivatedAt: user.isActive ? new Date() : null },
      select: { id: true, isActive: true },
    });
  }

  async changeAdminPassword(userId: string, newPassword: string) {
    const bcrypt = await import('bcryptjs');
    const rounds = 10;
    const passwordHash = await bcrypt.hash(newPassword, rounds);
    await this.prisma.admin.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
    return { success: true };
  }

  // ─── Impersonation ──────────────────────────────────────────────────────────

  /* Диспетчер входит только в действующую гостиницу — тот же круг, что
     отдаёт партнёрский API. Скрытая из каталога (partnerVisible=false) —
     тоже: её не видят авиакомпании, а диспетчер как раз и доделывает её
     карточку (решение владельца Kars Avia 22.10.2026). Суперадмин — в любую
     действующую. */
  async impersonate(tenantId: string, actor: AuthenticatedRequestUser, ip?: string, userAgent?: string) {
    if (!actor.isSuperAdmin) {
      const t = await this.prisma.admin.tenant.findUnique({
        where: { id: tenantId },
        select: { isActive: true, slug: true },
      });
      if (!t || !t.isActive || t.slug === 'platform') {
        throw new ForbiddenException('Гостиница недоступна диспетчеру');
      }
    }
    return this.auth.issueImpersonationToken(tenantId, actor.userId, ip, userAgent);
  }

  // ─── Users ──────────────────────────────────────────────────────────────────

  async listUsers() {
    const users = await this.prisma.admin.user.findMany({
      where: { tenant: { slug: { not: 'platform' } } },
      include: {
        tenant: { select: { id: true, name: true, slug: true } },
        role: { select: { code: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return users.map((u) => ({
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      isActive: u.isActive,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
      role: u.role.name,
      roleCode: u.role.code,
      tenant: { id: u.tenant.id, name: u.tenant.name, slug: u.tenant.slug },
    }));
  }

  // ─── Platform stats ─────────────────────────────────────────────────────────

  async getStats() {
    const [totalTenants, activeTenants, totalUsers] = await Promise.all([
      this.prisma.admin.tenant.count({ where: { slug: { not: 'platform' } } }),
      this.prisma.admin.tenant.count({ where: { isActive: true, slug: { not: 'platform' } } }),
      this.prisma.admin.user.count({ where: { tenant: { slug: { not: 'platform' } } } }),
    ]);

    return { totalTenants, activeTenants, totalUsers };
  }
}
