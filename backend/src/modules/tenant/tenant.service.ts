import * as bcrypt from 'bcryptjs';
import * as crypto from 'node:crypto';
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/context/tenant-context';
import { UpdateTenantSettingsDto } from './dto/update-tenant-settings.dto';
import { CreateTenantUserDto, UpdateTenantUserDto } from './dto/manage-user.dto';

@Injectable()
export class TenantService {
  constructor(private readonly prisma: PrismaService) {}

  async getSettings() {
    const tenantId = TenantContext.getTenantIdOrThrow();
    // Use admin client to bypass RLS — tenant table is not tenant-scoped by RLS,
    // but the app_user connection requires SET LOCAL app.tenant_id which forTenant provides.
    return this.prisma.admin.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  }

  async updateSettings(dto: UpdateTenantSettingsDto) {
    const tenantId = TenantContext.getTenantIdOrThrow();
    const data = Object.fromEntries(
      Object.entries(dto).filter(([, v]) => v !== undefined),
    );
    return this.prisma.admin.tenant.update({
      where: { id: tenantId },
      data,
    });
  }

  async listUsers(tenantId: string) {
    return this.prisma.admin.user.findMany({
      where: { tenantId },
      select: {
        id: true,
        email: true,
        fullName: true,
        isActive: true,
        lastLoginAt: true,
        createdAt: true,
        role: { select: { id: true, code: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async listRoles(tenantId: string) {
    return this.prisma.admin.role.findMany({
      where: { tenantId, code: { not: 'SUPER_ADMIN' } },
      select: { id: true, code: true, name: true, isSystem: true },
      orderBy: { code: 'asc' },
    });
  }

  async createUser(tenantId: string, dto: CreateTenantUserDto): Promise<{ id: string; email: string; temporaryPassword?: string }> {
    const normalizedEmail = dto.email.toLowerCase();

    const role = await this.prisma.admin.role.findFirst({
      where: { id: dto.roleId, tenantId },
    });
    if (!role) throw new NotFoundException('Role not found in this tenant');
    if (role.code === 'OWNER' || role.code === 'SUPER_ADMIN') {
      throw new ForbiddenException('Cannot assign OWNER or SUPER_ADMIN role via team management');
    }

    const existing = await this.prisma.admin.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) throw new ConflictException('This email is already registered');

    const temporaryPassword = dto.password ?? crypto.randomBytes(8).toString('hex');
    const passwordHash = await bcrypt.hash(temporaryPassword, 10);

    const user = await this.prisma.admin.user.create({
      data: { tenantId, email: normalizedEmail, passwordHash, fullName: dto.fullName, roleId: dto.roleId },
      select: { id: true, email: true },
    });

    return dto.password
      ? { id: user.id, email: user.email }
      : { id: user.id, email: user.email, temporaryPassword };
  }

  async updateUser(tenantId: string, userId: string, dto: UpdateTenantUserDto) {
    const user = await this.prisma.admin.user.findFirst({
      where: { id: userId, tenantId },
      include: { role: { select: { code: true } } },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.role.code === 'OWNER') throw new ForbiddenException('Cannot modify the OWNER account');

    if (dto.roleId) {
      const role = await this.prisma.admin.role.findFirst({ where: { id: dto.roleId, tenantId } });
      if (!role) throw new NotFoundException('Role not found in this tenant');
      if (role.code === 'OWNER' || role.code === 'SUPER_ADMIN') {
        throw new ForbiddenException('Cannot assign OWNER or SUPER_ADMIN role');
      }
    }

    return this.prisma.admin.user.update({
      where: { id: userId },
      data: {
        ...(dto.roleId ? { roleId: dto.roleId } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.fullName ? { fullName: dto.fullName } : {}),
      },
      select: { id: true, email: true, fullName: true, isActive: true, role: { select: { id: true, code: true, name: true } } },
    });
  }

  async deleteUser(tenantId: string, userId: string) {
    const user = await this.prisma.admin.user.findFirst({
      where: { id: userId, tenantId },
      include: { role: { select: { code: true } } },
    });
    if (!user) throw new NotFoundException('User not found');
    if (user.role.code === 'OWNER') throw new ForbiddenException('Cannot delete the OWNER account');

    await this.prisma.admin.user.update({
      where: { id: userId },
      data: { isActive: false },
    });
    return { deleted: true, id: userId };
  }
}
