import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantPlan } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { RegisterTenantDto } from '../auth/dto/register-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';

@Injectable()
export class SuperAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
  ) {}

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
      data: { isActive: !user.isActive },
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

  async impersonate(tenantId: string, adminUserId: string) {
    return this.auth.issueImpersonationToken(tenantId, adminUserId);
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
