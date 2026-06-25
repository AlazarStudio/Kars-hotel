import * as bcrypt from 'bcryptjs';
import * as crypto from 'node:crypto';
import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/context/tenant-context';
import { StorageService, UploadedFile } from '../../common/storage/storage.service';
import { UpdateTenantSettingsDto } from './dto/update-tenant-settings.dto';
import { CreateTenantUserDto, UpdateTenantUserDto } from './dto/manage-user.dto';

@Injectable()
export class TenantService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

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

  /**
   * Upload a hotel logo to our own storage (MinIO) and point the tenant at it.
   * The previous logo, if it was one of ours, is removed best-effort. Written
   * via the admin client because the tenant table is RLS-restricted for app_user.
   */
  async uploadLogo(file: UploadedFile) {
    const tenantId = TenantContext.getTenantIdOrThrow();
    const current = await this.prisma.admin.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { logoUrl: true },
    });
    const logoUrl = await this.storage.uploadTenantLogo(tenantId, file);
    const updated = await this.prisma.admin.tenant.update({
      where: { id: tenantId },
      data: { logoUrl },
    });
    if (current.logoUrl && current.logoUrl !== logoUrl) {
      await this.storage.deleteByUrl(current.logoUrl); // ignores foreign URLs
    }
    return updated;
  }

  /** Clear the hotel logo and delete the stored object (best-effort). */
  async removeLogo() {
    const tenantId = TenantContext.getTenantIdOrThrow();
    const current = await this.prisma.admin.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { logoUrl: true },
    });
    const updated = await this.prisma.admin.tenant.update({
      where: { id: tenantId },
      data: { logoUrl: null },
    });
    if (current.logoUrl) await this.storage.deleteByUrl(current.logoUrl);
    return updated;
  }

  /**
   * Upload one gallery photo to our storage and append it to the hotel gallery.
   * The gallery is an ordered list (first = cover) shown as a slider on the
   * partner-facing hotel page. Written via the admin client (tenant table is
   * RLS-restricted for app_user).
   */
  async addGalleryPhoto(file: UploadedFile) {
    const tenantId = TenantContext.getTenantIdOrThrow();
    const url = await this.storage.uploadTenantGalleryPhoto(tenantId, file);
    const current = await this.readGallery(tenantId);
    return this.prisma.admin.tenant.update({
      where: { id: tenantId },
      data: { galleryPhotos: [...current, url] },
    });
  }

  /**
   * Replace the gallery with an explicit ordered list. Handles reordering
   * (e.g. promoting a photo to cover) and removal in one call: any of our own
   * URLs no longer present is deleted from storage. Every URL must already be
   * one we host — foreign URLs are rejected so the gallery can never reference
   * an external CDN.
   */
  async setGallery(photos: string[]) {
    const tenantId = TenantContext.getTenantIdOrThrow();
    const next = photos.filter((p, i) => photos.indexOf(p) === i); // dedupe, keep order
    const foreign = next.filter((p) => !this.storage.isOwnUrl(p));
    if (foreign.length) {
      throw new ConflictException(
        'Галерея может содержать только изображения, загруженные в наше хранилище.',
      );
    }
    const current = await this.readGallery(tenantId);
    const updated = await this.prisma.admin.tenant.update({
      where: { id: tenantId },
      data: { galleryPhotos: next },
    });
    // Delete objects dropped from the gallery (best-effort).
    const removed = current.filter((p) => !next.includes(p));
    await Promise.all(removed.map((url) => this.storage.deleteByUrl(url)));
    return updated;
  }

  /** Read the current gallery as a clean string[] (tolerates legacy shapes). */
  private async readGallery(tenantId: string): Promise<string[]> {
    const row = await this.prisma.admin.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { galleryPhotos: true },
    });
    return Array.isArray(row.galleryPhotos)
      ? (row.galleryPhotos as unknown[]).filter((p): p is string => typeof p === 'string')
      : [];
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
