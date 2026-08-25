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
import { DEFAULT_ROLE_NAMES, DEFAULT_ROLE_PERMISSIONS, SYSTEM_PERMISSIONS } from './auth.constants';
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
  isDispatcher?: boolean;
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

  async registerTenant(
    dto: RegisterTenantDto,
    ip?: string,
    userAgent?: string,
  ): Promise<{
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

  async login(
    dto: LoginDto,
    ip?: string,
    userAgent?: string,
  ): Promise<{
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

    /* Сессия «от имени»: восстанавливаем ту же личность и ту же гостиницу,
       что были при входе, а не учётку из записи. Иначе продление тихо
       переносило бы человека в другой тенант с другими правами. */
    if (tokenRow.impersonatedBy) {
      const who = await this.resolveImpersonation(tokenRow.tenantId, tokenRow.impersonatedBy);
      return this.issueTokens({
        userId: who.userId,
        tenantId: tokenRow.tenantId,
        email: who.email,
        roleCode: who.roleCode,
        permissions: who.permissions,
        impersonatedBy: tokenRow.impersonatedBy,
        ip,
        userAgent,
      });
    }

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

  async me(
    userId: string,
    tenantId: string,
    impersonatedBy?: string,
    /* Права и роль ИЗ ТОКЕНА — нужны только в одном случае: диспетчер работает
     * в гостинице, у которой нет своих сотрудников, и его собственная учётка
     * живёт в тенанте платформы. Тогда членство в гостинице подтверждать
     * нечем, а область действия уже определена токеном, который мы сами и
     * выдали. Для обычной учётки гостиницы всё остаётся как было — права
     * читаются из её роли в базе. */
    fromToken?: { roleCode: string; permissions: string[] },
  ): Promise<AuthenticatedUser> {
    const user = await this.prisma.admin.user.findFirst({
      where: { id: userId, tenantId, isActive: true },
      include: {
        role: { include: { rolePermissions: { include: { permission: true } } } },
      },
    });

    /* Диспетчер внутри гостиницы без сотрудников: сам он числится в тенанте
     * платформы, поэтому проверка «пользователь принадлежит этой гостинице»
     * его не находит. Раньше это давало 401 сразу после успешного входа —
     * ссылка «Управлять в Hotel PMS» вела на экран «ссылка недействительна»,
     * хотя недействительной она не была. */
    if (!user && impersonatedBy && userId === impersonatedBy) {
      const actor = await this.prisma.admin.user.findFirst({
        where: { id: userId, isActive: true },
        select: { id: true, email: true, fullName: true, isDispatcher: true },
      });
      if (!actor) throw new UnauthorizedException('User no longer exists');
      return {
        id: actor.id,
        tenantId,
        email: actor.email,
        fullName: actor.fullName,
        roleCode: fromToken?.roleCode ?? RoleCode.OWNER,
        permissions: fromToken?.permissions ?? [],
        isSuperAdmin: false,
        isDispatcher: actor.isDispatcher,
      };
    }
    if (!user) throw new UnauthorizedException('User no longer exists');

    // Display identity: when a Kars Avia dispatcher operates a hotel via SSO,
    // the session runs as that hotel's owner (permissions/tenant scope), but the
    // UI must show WHO is actually working — the dispatcher — while the banner
    // says «от имени <hotel>». Permissions/roleCode stay the effective owner's
    // so the hotel screens gate correctly; only the shown name/label change.
    let displayName = user.fullName;
    let displayEmail = user.email;
    let isDispatcher = user.isDispatcher;
    if (impersonatedBy) {
      const dispatcher = await this.prisma.admin.user.findUnique({
        where: { id: impersonatedBy },
        select: { email: true, fullName: true, isDispatcher: true },
      });
      if (dispatcher) {
        displayName = dispatcher.fullName;
        displayEmail = dispatcher.email;
        isDispatcher = dispatcher.isDispatcher;
      }
    }

    return {
      id: user.id,
      tenantId,
      email: displayEmail,
      fullName: displayName,
      roleCode: user.role.code,
      permissions: user.role.rolePermissions.map((rp) => rp.permission.code),
      isSuperAdmin: (user.role.code as string) === 'SUPER_ADMIN',
      isDispatcher,
    };
  }

  /**
   * Exit impersonation: re-issue an access token for whoever STARTED the
   * impersonation (the `imp` claim on the current token). Works without a
   * refresh cookie — the impersonation token itself proves who the operator is
   * — so it fixes both the SSO-dispatcher exit (no cookie at all) and the
   * super-admin exit (avoids rotating the refresh cookie on every toggle). The
   * re-issued token restores admin-panel access (isa) and the dispatcher flag.
   */
  /* Выход из режима «от имени» перевыпускает и продление.
   *
   * Кука одна на браузер: пока идёт работа в гостинице, в ней лежит сессия
   * гостиницы. Если при выходе её не заменить, то через час обновление
   * вернуло бы человека обратно в гостиницу — из режима, из которого он
   * только что вышел. */
  async exitImpersonation(
    operatorUserId: string,
    ip?: string,
    userAgent?: string,
  ): Promise<AuthTokens> {
    const user = await this.prisma.admin.user.findUnique({
      where: { id: operatorUserId },
      include: {
        role: { include: { rolePermissions: { include: { permission: true } } } },
      },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Operator account is inactive');
    }
    const isSuperAdmin = (user.role.code as string) === 'SUPER_ADMIN';
    return this.issueTokens({
      userId: user.id,
      tenantId: user.tenantId,
      email: user.email,
      roleCode: user.role.code,
      permissions: user.role.rolePermissions.map((rp) => rp.permission.code),
      isSuperAdmin,
      isDispatcher: user.isDispatcher,
      ip,
      userAgent,
    });
  }

  /**
   * Issue a short-lived impersonation access token (no refresh token) that
   * gives the caller OWNER-level access to a specific tenant. Only callable
   * by super-admin users. Returns just the access token string.
   */
  /* Личность, от которой идёт работа ВНУТРИ гостиницы.
   *
   * Одна на два входа: открытие сессии и её продление. Раньше это жило только
   * в выдаче токена, и продление пошло бы другим путём — а разойтись этим двум
   * ответам нельзя: по ним считаются права внутри чужой гостиницы. */
  private async resolveImpersonation(
    targetTenantId: string,
    adminUserId: string,
  ): Promise<{
    userId: string;
    email: string;
    roleCode: string;
    permissions: string[];
  }> {
    const tenant = await this.prisma.admin.tenant.findUnique({
      where: { id: targetTenantId },
      select: { id: true, isActive: true },
    });
    if (!tenant || !tenant.isActive) {
      throw new ForbiddenException('Tenant not found or inactive');
    }

    // Владелец гостиницы, если он есть.
    const owner = await this.prisma.admin.user.findFirst({
      where: { tenantId: targetTenantId, isActive: true },
      include: {
        role: { include: { rolePermissions: { include: { permission: true } } } },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (owner) {
      return {
        userId: owner.id,
        email: owner.email,
        roleCode: owner.role.code,
        permissions: owner.role.rolePermissions.map((rp) => rp.permission.code),
      };
    }

    /* Гостиница БЕЗ СВОИХ СОТРУДНИКОВ — обычное дело, а не сбой: из 392
     * перенесённых из старой системы логин был лишь у десяти, остальные ведёт
     * оператор. Заходим ОТ СВОЕГО ИМЕНИ: `sub` — тот, кто пришёл, права — по
     * роли «Владелец» этой гостиницы. Это честнее и там, где сотрудник есть:
     * занимать чужую учётку ради входа не нужно, а в журнале остаётся живой
     * человек, а не «владелец», которым действовал кто-то другой. */
    const ownerRole = await this.prisma.admin.role.findFirst({
      where: { tenantId: targetTenantId, code: RoleCode.OWNER },
      include: { rolePermissions: { include: { permission: true } } },
    });
    const actor = await this.prisma.admin.user.findUnique({
      where: { id: adminUserId },
      select: { id: true, email: true },
    });
    if (!actor) throw new ForbiddenException('Operator account not found');
    return {
      userId: actor.id,
      email: actor.email,
      roleCode: RoleCode.OWNER,
      /* Роли у тенанта может не быть только у совсем старого переноса — тогда
         берём эталонный набор владельца, тот же, что раздаётся при заведении
         гостиницы. */
      permissions:
        ownerRole?.rolePermissions.map((rp) => rp.permission.code) ??
        (DEFAULT_ROLE_PERMISSIONS.OWNER as string[]),
    };
  }

  /**
   * Короткоживущий токен «от имени гостиницы» БЕЗ продления — им пользуется
   * супер-админ из панели платформы: у него есть собственная сессия с кукой,
   * и вторая кука её бы затёрла, сделав выход из режима невозможным.
   * Вход диспетчера по ссылке из Kars Avia продлевается (см. `exchangeSsoCode`).
   */
  async issueImpersonationToken(
    targetTenantId: string,
    adminUserId: string,
  ): Promise<{ accessToken: string; accessTtlSeconds: number }> {
    const who = await this.resolveImpersonation(targetTenantId, adminUserId);
    const accessPayload: JwtAccessPayload = {
      sub: who.userId,
      tid: targetTenantId,
      role: who.roleCode,
      perms: who.permissions,
      email: who.email,
      imp: adminUserId,
    };
    const accessTtlSeconds = 3600;
    const accessToken = await this.jwt.signAsync(accessPayload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: accessTtlSeconds,
    });
    return { accessToken, accessTtlSeconds };
  }

  // ─── Partner SSO (Kars Avia dispatcher → PMS) ───────────────────────────────
  //
  // The dispatcher platform requests a one-time SSO code over the partner API
  // (X-Api-Key), embeds it in a link, and the PMS frontend exchanges it for an
  // access token on arrival. The code — not the token — travels in the URL, is
  // single-use and short-lived, so a leaked/history'd link is useless.
  //
  // Every Kars Avia dispatcher gets their OWN PMS account (auto-provisioned by
  // email on first SSO, reused afterwards) — never a shared super-admin or a
  // hotel's owner account. That account holds the SUPER_ADMIN role (full rights)
  // but is flagged isDispatcher, so the UI labels it «Администратор/Диспетчер».
  //
  // Two entry modes:
  //  • admin (no hotel): sign in AS the dispatcher → lands in the admin panel.
  //  • hotel (with slug): impersonate that hotel, tagged imp=<dispatcher id> for
  //    attribution → the frontend shows «Вы работаете от имени <hotel>».
  //
  // Codes live in memory: 60 s TTL + single-use make persistence pointless.

  private readonly ssoCodes = new Map<
    string,
    { dispatcherUserId: string; tenantId: string | null; expiresAt: number }
  >();
  private static readonly SSO_CODE_TTL_MS = 60_000;

  /**
   * Find-or-create the PMS account representing a Kars Avia dispatcher. Keyed by
   * email; lives in the platform tenant with the SUPER_ADMIN role but flagged
   * isDispatcher. Password is random — dispatchers only ever enter via SSO.
   */
  async provisionDispatcher(dispatcher: {
    email: string;
    fullName: string;
  }): Promise<{ id: string }> {
    const email = dispatcher.email.trim().toLowerCase();
    const existing = await this.prisma.admin.user.findUnique({
      where: { email },
      select: { id: true, isDispatcher: true },
    });
    if (existing) {
      // Legacy/edge: an account with this email exists but wasn't flagged — make
      // it a dispatcher so labels/attribution are correct.
      if (!existing.isDispatcher) {
        await this.prisma.admin.user.update({
          where: { id: existing.id },
          data: { isDispatcher: true },
        });
      }
      return { id: existing.id };
    }
    const platform = await this.prisma.admin.tenant.findUnique({
      where: { slug: 'platform' },
      select: { id: true },
    });
    if (!platform) {
      throw new ForbiddenException('Platform tenant is not provisioned');
    }
    const role = await this.prisma.admin.role.findFirst({
      where: { tenantId: platform.id, code: RoleCode.SUPER_ADMIN },
      select: { id: true },
    });
    if (!role) {
      throw new ForbiddenException('Platform SUPER_ADMIN role is missing');
    }
    const passwordHash = await bcrypt.hash(crypto.randomBytes(24).toString('base64url'), 10);
    const created = await this.prisma.admin.user.create({
      data: {
        tenantId: platform.id,
        email,
        fullName: dispatcher.fullName || email,
        passwordHash,
        roleId: role.id,
        isDispatcher: true,
      },
      select: { id: true },
    });
    this.logger.log(`Dispatcher provisioned: ${email}`);
    return created;
  }

  async createSsoCode(
    dispatcher: { email: string; fullName: string },
    tenantId: string | null,
  ): Promise<{ code: string; expiresInSeconds: number }> {
    const now = Date.now();
    for (const [k, v] of this.ssoCodes) {
      if (v.expiresAt < now) this.ssoCodes.delete(k);
    }
    const { id: dispatcherUserId } = await this.provisionDispatcher(dispatcher);
    const code = crypto.randomBytes(24).toString('base64url');
    this.ssoCodes.set(code, {
      dispatcherUserId,
      tenantId,
      expiresAt: now + AuthService.SSO_CODE_TTL_MS,
    });
    return { code, expiresInSeconds: AuthService.SSO_CODE_TTL_MS / 1000 };
  }

  /* Вход по ссылке выдаёт И продление тоже.
   *
   * Раньше отдавался только access-токен на час: сессия жила ровно час, а
   * перезагрузка страницы обрывала её и раньше. Диспетчеру, который ведёт
   * гостиницу полдня, это возвращало форму входа посреди работы. Кука
   * ставится контроллером, как и при обычном входе. */
  async exchangeSsoCode(
    code: string,
    ip?: string,
    userAgent?: string,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    accessTtlSeconds: number;
    refreshTtlSeconds: number;
    // 'admin' → landed in the platform admin panel as the dispatcher;
    // 'hotel' → impersonating a specific hotel (banner «от имени <name>»).
    mode: 'admin' | 'hotel';
    tenant?: { id: string; name: string };
  }> {
    const entry = this.ssoCodes.get(code);
    // Single-use: the code dies on first touch, valid or not.
    this.ssoCodes.delete(code);
    if (!entry || entry.expiresAt < Date.now()) {
      throw new UnauthorizedException('SSO code is invalid or expired');
    }

    // Hotel mode: dispatcher works inside one hotel, tagged with their id.
    if (entry.tenantId) {
      const who = await this.resolveImpersonation(entry.tenantId, entry.dispatcherUserId);
      const tokens = await this.issueTokens({
        userId: who.userId,
        tenantId: entry.tenantId,
        email: who.email,
        roleCode: who.roleCode,
        permissions: who.permissions,
        impersonatedBy: entry.dispatcherUserId,
        ip,
        userAgent,
      });
      const tenant = await this.prisma.admin.tenant.findUnique({
        where: { id: entry.tenantId },
        select: { id: true, name: true },
      });
      return { ...tokens, mode: 'hotel', tenant: tenant ?? undefined };
    }

    // Admin mode: sign in as the dispatcher's own account.
    const dispatcher = await this.prisma.admin.user.findUnique({
      where: { id: entry.dispatcherUserId },
      include: {
        role: {
          include: { rolePermissions: { include: { permission: true } } },
        },
      },
    });
    if (!dispatcher || !dispatcher.isActive) {
      throw new ForbiddenException('Dispatcher account is inactive');
    }
    const tokens = await this.issueTokens({
      userId: dispatcher.id,
      tenantId: dispatcher.tenantId,
      email: dispatcher.email,
      roleCode: dispatcher.role.code,
      permissions: dispatcher.role.rolePermissions.map((rp) => rp.permission.code),
      isSuperAdmin: true,
      isDispatcher: true,
      ip,
      userAgent,
    });
    return { ...tokens, mode: 'admin' };
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
      this.logger.warn(
        'SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD not set — skipping platform admin seed',
      );
      return;
    }

    // Upsert platform tenant.
    const tenant = await this.prisma.admin.tenant.upsert({
      where: { slug: 'platform' },
      create: {
        slug: 'platform',
        name: 'Platform Admin',
        timezone: 'UTC',
        currency: 'USD',
        plan: 'PREMIUM',
      },
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
    isDispatcher?: boolean;
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
      ...(args.isDispatcher ? { disp: true } : {}),
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
        /* Продление должно вернуть ТУ ЖЕ сессию. Для входа «от имени»
           этого не выразить парой «пользователь + тенант»: диспетчер
           числится в тенанте платформы, и без отметки обновление вернуло бы
           его в общую панель вместо гостиницы. */
        impersonatedBy: args.impersonatedBy ?? null,
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
