import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { RoleCode, TenantPlan } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  DEFAULT_ROLE_NAMES,
  DEFAULT_ROLE_PERMISSIONS,
  SYSTEM_PERMISSIONS,
} from './auth.constants';
import { RegisterTenantDto } from './dto/register-tenant.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAccessPayload, JwtRefreshPayload } from './types/jwt-payload';
import { slugifyHotelName } from './slug.util';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  accessTtlSeconds: number;
  refreshTtlSeconds: number;
}

export interface AuthenticatedUser {
  id: string;
  tenantId: string;
  email: string;
  fullName: string;
  roleCode: string;
  permissions: string[];
  isSuperAdmin?: boolean;
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  /** Seed the global Permission catalogue + platform admin account once on startup. */
  async onModuleInit(): Promise<void> {
    let inserted = 0;
    for (const perm of SYSTEM_PERMISSIONS) {
      const result = await this.prisma.admin.permission.upsert({
        where: { code: perm.code },
        create: { code: perm.code, name: perm.name },
        update: { name: perm.name },
      });
      if (result) inserted += 1;
    }
    this.logger.log(`Synced ${inserted}/${SYSTEM_PERMISSIONS.length} system permissions`);
    await this.seedPlatformAdmin();
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  async registerTenant(dto: RegisterTenantDto, ip?: string, userAgent?: string): Promise<{
    tenantId: string;
    userId: string;
    tokens: AuthTokens;
  }> {
    const normalizedEmail = dto.email.toLowerCase();

    // 1. Email must be globally unique — no one else has this address.
    const emailTaken = await this.prisma.admin.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });
    if (emailTaken) {
      throw new ConflictException(
        'Этот email уже зарегистрирован в системе. Используйте другой адрес или войдите.',
      );
    }

    // 2. Resolve a unique tenant slug — either the one the caller passed, or auto-generated.
    const slug = await this.resolveUniqueSlug(dto.slug ?? dto.hotelName);

    const passwordHash = await this.hashPassword(dto.password);

    const result = await this.prisma.admin.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          slug,
          name: dto.hotelName,
          timezone: dto.timezone ?? 'Europe/Moscow',
          currency: dto.currency ?? 'RUB',
          plan: (dto.plan ?? 'LITE') as TenantPlan,
        },
      });

      // Seed default roles + permissions.
      const allPerms = await tx.permission.findMany();
      const permByCode = new Map(allPerms.map((p) => [p.code, p.id]));

      const roleByCode: Partial<Record<RoleCode, string>> = {};
      for (const code of Object.keys(DEFAULT_ROLE_PERMISSIONS) as RoleCode[]) {
        const role = await tx.role.create({
          data: {
            tenantId: tenant.id,
            code,
            name: DEFAULT_ROLE_NAMES[code] ?? code,
            isSystem: true,
          },
        });
        roleByCode[code] = role.id;

        const permCodes = DEFAULT_ROLE_PERMISSIONS[code] ?? [];
        if (permCodes.length > 0) {
          await tx.rolePermission.createMany({
            data: permCodes
              .map((c) => permByCode.get(c))
              .filter((id): id is string => !!id)
              .map((permissionId) => ({ roleId: role.id, permissionId })),
            skipDuplicates: true,
          });
        }
      }

      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: normalizedEmail,
          passwordHash,
          fullName: dto.fullName,
          roleId: roleByCode.OWNER!,
        },
      });

      await tx.auditLog.create({
        data: {
          tenantId: tenant.id,
          userId: user.id,
          entity: 'tenant',
          entityId: tenant.id,
          action: 'register',
          ip: ip ?? null,
          userAgent: userAgent ?? null,
        },
      });

      return { tenant, user };
    });

    const tokens = await this.issueTokens({
      userId: result.user.id,
      tenantId: result.tenant.id,
      email: result.user.email,
      roleCode: 'OWNER',
      permissions: DEFAULT_ROLE_PERMISSIONS.OWNER as string[],
      ip,
      userAgent,
    });

    return { tenantId: result.tenant.id, userId: result.user.id, tokens };
  }

  async login(dto: LoginDto, ip?: string, userAgent?: string): Promise<{
    user: AuthenticatedUser;
    tokens: AuthTokens;
  }> {
    // Email is globally unique → one query finds the user (and their tenant).
    const user = await this.prisma.admin.user.findUnique({
      where: { email: dto.email.toLowerCase() },
      include: {
        tenant: { select: { id: true, isActive: true } },
        role: {
          include: {
            rolePermissions: { include: { permission: true } },
          },
        },
      },
    });
    if (!user || !user.isActive || !user.tenant.isActive) {
      throw new UnauthorizedException('Неверный email или пароль');
    }

    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Неверный email или пароль');
    }

    await this.prisma.admin.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const permissions = user.role.rolePermissions.map((rp) => rp.permission.code);

    const isSuperAdmin = (user.role.code as string) === 'SUPER_ADMIN';

    const tokens = await this.issueTokens({
      userId: user.id,
      tenantId: user.tenant.id,
      email: user.email,
      roleCode: user.role.code,
      permissions,
      isSuperAdmin,
      ip,
      userAgent,
    });

    return {
      user: {
        id: user.id,
        tenantId: user.tenant.id,
        email: user.email,
        fullName: user.fullName,
        roleCode: user.role.code,
        permissions,
        isSuperAdmin,
      },
      tokens,
    };
  }

  async refresh(refreshToken: string, ip?: string, userAgent?: string): Promise<AuthTokens> {
    let payload: JwtRefreshPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtRefreshPayload>(refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const tokenHash = this.hashToken(refreshToken);
    const tokenRow = await this.prisma.admin.refreshToken.findUnique({
      where: { tokenHash },
      include: {
        user: {
          include: {
            role: { include: { rolePermissions: { include: { permission: true } } } },
          },
        },
      },
    });

    if (!tokenRow || tokenRow.revokedAt || tokenRow.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired or revoked');
    }
    if (tokenRow.userId !== payload.sub || tokenRow.tenantId !== payload.tid) {
      throw new UnauthorizedException('Refresh token does not match payload');
    }
    if (!tokenRow.user.isActive) {
      throw new ForbiddenException('User is inactive');
    }

    await this.prisma.admin.refreshToken.update({
      where: { id: tokenRow.id },
      data: { revokedAt: new Date() },
    });

    const permissions = tokenRow.user.role.rolePermissions.map((rp) => rp.permission.code);
    const isSuperAdmin = (tokenRow.user.role.code as string) === 'SUPER_ADMIN';

    return this.issueTokens({
      userId: tokenRow.user.id,
      tenantId: tokenRow.tenantId,
      email: tokenRow.user.email,
      roleCode: tokenRow.user.role.code,
      permissions,
      isSuperAdmin,
      ip,
      userAgent,
    });
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    const tokenHash = this.hashToken(refreshToken);
    await this.prisma.admin.refreshToken
      .update({
        where: { tokenHash },
        data: { revokedAt: new Date() },
      })
      .catch(() => undefined);
  }

  async me(userId: string, tenantId: string): Promise<AuthenticatedUser> {
    const user = await this.prisma.admin.user.findFirst({
      where: { id: userId, tenantId, isActive: true },
      include: {
        role: { include: { rolePermissions: { include: { permission: true } } } },
      },
    });
    if (!user) throw new UnauthorizedException('User no longer exists');
    return {
      id: user.id,
      tenantId,
      email: user.email,
      fullName: user.fullName,
      roleCode: user.role.code,
      permissions: user.role.rolePermissions.map((rp) => rp.permission.code),
      isSuperAdmin: (user.role.code as string) === 'SUPER_ADMIN',
    };
  }

  /**
   * Issue a short-lived impersonation access token (no refresh token) that
   * gives the caller OWNER-level access to a specific tenant. Only callable
   * by super-admin users. Returns just the access token string.
   */
  async issueImpersonationToken(
    targetTenantId: string,
    adminUserId: string,
  ): Promise<{ accessToken: string; accessTtlSeconds: number }> {
    const tenant = await this.prisma.admin.tenant.findUnique({
      where: { id: targetTenantId },
      select: { id: true, isActive: true },
    });
    if (!tenant || !tenant.isActive) {
      throw new ForbiddenException('Tenant not found or inactive');
    }

    // Find the OWNER user in the target tenant.
    const owner = await this.prisma.admin.user.findFirst({
      where: { tenantId: targetTenantId, isActive: true },
      include: {
        role: { include: { rolePermissions: { include: { permission: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!owner) {
      throw new ForbiddenException('No active user found in target tenant');
    }

    const permissions = owner.role.rolePermissions.map((rp) => rp.permission.code);

    // Issue a 1-hour access token for the owner user, tagged with the admin's userId.
    const accessPayload: JwtAccessPayload = {
      sub: owner.id,
      tid: targetTenantId,
      role: owner.role.code,
      perms: permissions,
      email: owner.email,
      imp: adminUserId,
    };

    const accessTtlSeconds = 3600; // 1 hour
    const accessToken = await this.jwt.signAsync(accessPayload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: accessTtlSeconds,
    });

    return { accessToken, accessTtlSeconds };
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  /**
   * Seed the platform tenant + SUPER_ADMIN user from env vars.
   * Safe to re-run on every startup (upsert-based, no duplicates).
   */
  private async seedPlatformAdmin(): Promise<void> {
    const email = this.config.get<string>('SUPER_ADMIN_EMAIL');
    const password = this.config.get<string>('SUPER_ADMIN_PASSWORD');
    if (!email || !password) {
      this.logger.warn('SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD not set — skipping platform admin seed');
      return;
    }

    // Upsert platform tenant.
    const tenant = await this.prisma.admin.tenant.upsert({
      where: { slug: 'platform' },
      create: { slug: 'platform', name: 'Platform Admin', timezone: 'UTC', currency: 'USD', plan: 'PREMIUM' },
      update: {},
    });

    // Upsert SUPER_ADMIN role in the platform tenant.
    const role = await this.prisma.admin.role.upsert({
      where: { tenantId_code: { tenantId: tenant.id, code: 'SUPER_ADMIN' } },
      create: { tenantId: tenant.id, code: 'SUPER_ADMIN', name: 'Super Admin', isSystem: true },
      update: {},
    });

    // Check if the super-admin user already exists.
    const existing = await this.prisma.admin.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true },
    });
    if (existing) {
      this.logger.log('Platform super-admin already exists — no changes');
      return;
    }

    const passwordHash = await this.hashPassword(password);
    await this.prisma.admin.user.create({
      data: {
        tenantId: tenant.id,
        email: email.toLowerCase(),
        passwordHash,
        fullName: 'Super Admin',
        roleId: role.id,
      },
    });
    this.logger.log(`Platform super-admin seeded: ${email}`);
  }

  /**
   * Pick a slug that is not yet taken. If `seed` already passes our format,
   * try it first; otherwise transliterate. On collision, suffix `-2`, `-3`, …
   * up to 50 attempts before giving up.
   */
  private async resolveUniqueSlug(seed: string): Promise<string> {
    const base = /^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$/.test(seed) ? seed : slugifyHotelName(seed);
    let candidate = base;
    for (let n = 2; n < 50; n++) {
      const taken = await this.prisma.admin.tenant.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });
      if (!taken) return candidate;
      const suffix = `-${n}`;
      candidate =
        base.length + suffix.length <= 32
          ? `${base}${suffix}`
          : `${base.slice(0, 32 - suffix.length)}${suffix}`;
    }
    throw new ConflictException('Не удалось подобрать уникальный slug для отеля');
  }

  private async issueTokens(args: {
    userId: string;
    tenantId: string;
    email: string;
    roleCode: string;
    permissions: string[];
    isSuperAdmin?: boolean;
    impersonatedBy?: string;
    ip?: string;
    userAgent?: string;
  }): Promise<AuthTokens> {
    const accessTtlSeconds = this.parseTtl(this.config.getOrThrow<string>('JWT_ACCESS_TTL'));
    const refreshTtlSeconds = this.parseTtl(this.config.getOrThrow<string>('JWT_REFRESH_TTL'));

    const accessPayload: JwtAccessPayload = {
      sub: args.userId,
      tid: args.tenantId,
      role: args.roleCode,
      perms: args.permissions,
      email: args.email,
      ...(args.isSuperAdmin ? { isa: true } : {}),
      ...(args.impersonatedBy ? { imp: args.impersonatedBy } : {}),
    };

    const accessToken = await this.jwt.signAsync(accessPayload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: accessTtlSeconds,
    });

    const jti = crypto.randomBytes(16).toString('hex');
    const refreshPayload: JwtRefreshPayload = {
      sub: args.userId,
      tid: args.tenantId,
      jti,
    };

    const refreshToken = await this.jwt.signAsync(refreshPayload, {
      secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      expiresIn: refreshTtlSeconds,
    });

    await this.prisma.admin.refreshToken.create({
      data: {
        tenantId: args.tenantId,
        userId: args.userId,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: new Date(Date.now() + refreshTtlSeconds * 1000),
        ip: args.ip ?? null,
        userAgent: args.userAgent ?? null,
      },
    });

    return { accessToken, refreshToken, accessTtlSeconds, refreshTtlSeconds };
  }

  private async hashPassword(plain: string): Promise<string> {
    const rounds = Number(this.config.get('BCRYPT_ROUNDS') ?? 10);
    return bcrypt.hash(plain, rounds);
  }

  private hashToken(token: string): string {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private parseTtl(input: string): number {
    const m = input.trim().match(/^(\d+)\s*([smhd]?)$/i);
    if (!m) throw new Error(`Invalid TTL: ${input}`);
    const n = Number(m[1]);
    switch ((m[2] ?? '').toLowerCase()) {
      case '':
      case 's':
        return n;
      case 'm':
        return n * 60;
      case 'h':
        return n * 3600;
      case 'd':
        return n * 86400;
      default:
        throw new Error(`Invalid TTL unit: ${m[2]}`);
    }
  }
}
