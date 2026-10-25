import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TenantPlan } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { seedDefaultRoles } from '../auth/tenant-roles';
import { CreateTenantDto } from './dto/create-tenant.dto';
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

    /* Поля карточки — для окна правки (без персональных данных: сотрудники
       гостиницы — только суперадмину, `getTenant`). */
    return tenants.map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      city: t.city,
      address: t.address,
      phone: t.phone,
      email: t.email,
      stars: t.stars,
      timezone: t.timezone,
      currency: t.currency,
      plan: t.plan,
      isActive: t.isActive,
      provisional: t.provisional,
      createdAt: t.createdAt,
      usersCount: t._count.users,
    }));
  }

  /**
   * Что в гостинице есть — для окна удаления и правки: по нему решается,
   * удалить сразу (броней нет) или только по акту, и можно ли менять валюту.
   */
  async tenantSummary(id: string) {
    const t = await this.prisma.admin.tenant.findUnique({ where: { id }, select: { id: true, slug: true } });
    if (!t || t.slug === 'platform') throw new NotFoundException('Гостиница не найдена');
    const [reservations, rooms, roomTypes, users] = await Promise.all([
      this.prisma.admin.reservation.count({ where: { tenantId: id } }),
      this.prisma.admin.room.count({ where: { tenantId: id } }),
      this.prisma.admin.roomType.count({ where: { tenantId: id } }),
      this.prisma.admin.user.count({ where: { tenantId: id } }),
    ]);
    return { reservations, rooms, roomTypes, users };
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

  /**
   * Заведение гостиницы из панели платформы.
   *
   * С владельцем — прежний путь `AuthService.registerTenant` (гостиница, роли
   * и учётка одной транзакцией); без владельца — гостиница и роли, учётку
   * заводят потом. Токены нового владельца наружу НЕ отдаются: панель
   * заводит гостиницу, а не входит в неё.
   *
   * Предупреждение о дубле: гостиница с тем же названием в том же городе
   * (без учёта регистра и пробелов) — 409 DUPLICATE_HOTEL со списком
   * совпавших; «всё равно создать» — `allowDuplicate`. Дубли — не теория:
   * у перенесённых гостиниц они уже есть.
   */
  async createTenant(dto: CreateTenantDto, actor: AuthenticatedRequestUser) {
    const name = dto.hotelName.trim();
    if (name.length < 2) throw new BadRequestException('Название гостиницы — не короче 2 символов');
    assertTimezone(dto.timezone);
    const owner = ownerOf(dto);
    const city = clean(dto.city);

    if (!dto.allowDuplicate) {
      /* Сравниваем в коде, а не `mode: 'insensitive'` базы: при C-локали
         Postgres не сворачивает регистр кириллицы, и «Отель» с «отель» для
         него разные (поймано на стенде 25.10.2026). Гостиниц — сотни строк. */
      const all = await this.prisma.admin.tenant.findMany({
        where: { slug: { not: 'platform' } },
        select: { id: true, name: true, city: true, isActive: true },
      });
      const duplicates = all.filter((t) => norm(t.name) === norm(name) && norm(t.city) === norm(city));
      if (duplicates.length > 0) {
        throw new ConflictException({
          statusCode: 409,
          code: 'DUPLICATE_HOTEL',
          message: `Гостиница «${name}»${city ? ` в городе ${city}` : ''} уже есть. Проверьте, не дубль ли это.`,
          duplicates,
        });
      }
    }

    const card = {
      city,
      address: clean(dto.address),
      phone: clean(dto.phone),
      email: clean(dto.email)?.toLowerCase() ?? null,
    };

    let tenantId: string;
    if (owner) {
      const res = await this.auth.registerTenant({
        hotelName: name,
        email: owner.email,
        password: owner.password,
        fullName: owner.fullName,
        timezone: dto.timezone,
        currency: dto.currency,
        plan: dto.plan,
      });
      tenantId = res.tenantId;
      await this.prisma.admin.tenant.update({ where: { id: tenantId }, data: card });
    } else {
      const slug = await this.auth.resolveUniqueSlug(name);
      tenantId = await this.prisma.admin.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: {
            slug,
            name,
            timezone: dto.timezone ?? 'Europe/Moscow',
            currency: dto.currency ?? 'RUB',
            plan: (dto.plan ?? 'LITE') as TenantPlan,
            ...card,
          },
        });
        await seedDefaultRoles(tx, tenant.id);
        return tenant.id;
      });
    }

    await this.prisma.admin.auditLog.create({
      data: {
        tenantId,
        userId: actor.userId,
        entity: 'tenant',
        entityId: tenantId,
        action: 'admin.create',
        diff: { before: {}, after: { name, ...card, withOwner: !!owner } },
      },
    });
    const t = await this.prisma.admin.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: { id: true, slug: true, name: true },
    });
    return { ...t, withOwner: !!owner };
  }

  /**
   * Правка карточки гостиницы. Ограничение: валюту нельзя сменить, когда у
   * гостиницы есть брони — суммы броней и счетов записаны в прежней валюте,
   * и после смены они молча стали бы другими деньгами. В журнал гостиницы —
   * «было → стало» по изменённым полям.
   */
  async updateTenant(id: string, dto: UpdateTenantDto, actor: AuthenticatedRequestUser) {
    const tenant = await this.prisma.admin.tenant.findUnique({ where: { id } });
    if (!tenant || tenant.slug === 'platform') throw new NotFoundException('Гостиница не найдена');
    assertTimezone(dto.timezone);

    const next: Record<string, unknown> = {};
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (name.length < 2) throw new BadRequestException('Название гостиницы — не короче 2 символов');
      next.name = name;
    }
    for (const k of ['city', 'address', 'phone'] as const) {
      if (dto[k] !== undefined) next[k] = clean(dto[k]);
    }
    if (dto.email !== undefined) next.email = clean(dto.email)?.toLowerCase() ?? null;
    if (dto.stars !== undefined) next.stars = dto.stars;
    if (dto.timezone) next.timezone = dto.timezone;
    if (dto.currency) next.currency = dto.currency;
    if (dto.plan) next.plan = dto.plan as TenantPlan;

    const changed = Object.keys(next).filter(
      (k) => (tenant as Record<string, unknown>)[k] !== next[k],
    );
    if (changed.length === 0) return tenant;

    if (changed.includes('currency')) {
      const reservations = await this.prisma.admin.reservation.count({ where: { tenantId: id } });
      if (reservations > 0) {
        throw new ConflictException(
          `Валюту не сменить: у гостиницы есть брони (${reservations}), их суммы и счета записаны в ${tenant.currency}.`,
        );
      }
    }

    const data = Object.fromEntries(changed.map((k) => [k, next[k]]));
    const updated = await this.prisma.admin.tenant.update({ where: { id }, data });
    await this.prisma.admin.auditLog.create({
      data: {
        tenantId: id,
        userId: actor.userId,
        entity: 'tenant',
        entityId: id,
        action: 'admin.update',
        diff: {
          before: Object.fromEntries(changed.map((k) => [k, (tenant as Record<string, unknown>)[k] ?? null])),
          after: data,
        } as never,
      },
    });
    return updated;
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

/** Пустая строка и пробелы — «нет значения». */
function clean(v: string | undefined | null): string | null {
  const s = v?.trim();
  return s ? s : null;
}

/** Для сравнения названий и городов: без регистра, ё = е, пробелы схлопнуты. */
function norm(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
}

/** Часовой пояс — только известный среде (IANA): опечатка сдвинула бы все сроки гостиницы. */
function assertTimezone(tz: string | undefined) {
  if (tz === undefined) return;
  try {
    new Intl.DateTimeFormat('ru-RU', { timeZone: tz });
  } catch {
    throw new BadRequestException(`Неизвестный часовой пояс: ${tz}`);
  }
}

/** Учётка владельца — все три поля или ни одного. */
function ownerOf(dto: CreateTenantDto): { fullName: string; email: string; password: string } | null {
  const fullName = clean(dto.ownerFullName);
  const email = clean(dto.ownerEmail);
  const password = dto.ownerPassword ?? '';
  const filled = [fullName, email, password].filter(Boolean).length;
  if (filled === 0) return null;
  if (filled < 3 || !fullName || !email) {
    throw new BadRequestException(
      'Учётка владельца: заполните имя, email и пароль — или оставьте все три поля пустыми',
    );
  }
  return { fullName, email, password };
}
