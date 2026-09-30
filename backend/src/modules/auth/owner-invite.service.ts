import {
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { RoleCode } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

/* ПРИГЛАШЕНИЕ ВЛАДЕЛЬЦА В КАБИНЕТ ГОСТИНИЦЫ (30.09.2026, Э10).
 *
 * Почти все гостиницы заведены партнёром (перенос из его старой системы,
 * регистрация из сбойной заявки) и своего кабинета не имеют: их ведёт
 * партнёр. Чтобы гостиница сама вела корпоративные тарифы, ей нужен вход.
 *
 * Партнёр приглашает — гостиница САМА задаёт пароль по одноразовой ссылке.
 * Пароль не проходит через партнёра и нигде, кроме хеша, не живёт; токен
 * ссылки тоже хранится хешем — утечка таблицы не даёт войти. Ссылка
 * одноразовая и с сроком; новое приглашение отменяет прежние.
 */

const INVITE_TTL_DAYS = 14;

export type CabinetState = 'OWN' | 'INVITED' | 'NONE';

export interface CabinetStatus {
  /** OWN — свой кабинет (сотрудник гостиницы входил); INVITED — приглашение
   *  ждёт; NONE — гостиницу ведёт партнёр. */
  state: CabinetState;
  lastLoginAt: string | null;
  invite: { email: string; expiresAt: string; createdAt: string } | null;
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class OwnerInviteService {
  constructor(private readonly prisma: PrismaService) {}

  /* Состояние кабинета — вычисляется, а не хранится: «ведёт свой кабинет»
     значит, что свой (не диспетчерский) сотрудник гостиницы входил. Флаг,
     поставленный руками, разошёлся бы с жизнью в первый же месяц. */
  async status(tenantId: string): Promise<CabinetStatus> {
    const [lastUser, invite] = await Promise.all([
      this.prisma.admin.user.findFirst({
        where: { tenantId, isDispatcher: false, isActive: true, lastLoginAt: { not: null } },
        orderBy: { lastLoginAt: 'desc' },
        select: { lastLoginAt: true },
      }),
      this.prisma.admin.ownerInvite.findFirst({
        where: { tenantId, usedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
        select: { email: true, expiresAt: true, createdAt: true },
      }),
    ]);
    const inviteView = invite
      ? { email: invite.email, expiresAt: invite.expiresAt.toISOString(), createdAt: invite.createdAt.toISOString() }
      : null;
    if (lastUser?.lastLoginAt) {
      return { state: 'OWN', lastLoginAt: lastUser.lastLoginAt.toISOString(), invite: inviteView };
    }
    return { state: invite ? 'INVITED' : 'NONE', lastLoginAt: null, invite: inviteView };
  }

  /** Новое приглашение: прежние неиспользованные отменяются. Токен — один раз. */
  async create(
    tenantId: string,
    dto: { email: string; fullName: string },
    partnerId: string | null,
  ): Promise<{ token: string; email: string; expiresAt: string }> {
    const email = dto.email.trim().toLowerCase();
    const owner = await this.prisma.admin.user.findFirst({
      where: { tenantId, isDispatcher: false, isActive: true, role: { code: RoleCode.OWNER } },
      select: { email: true },
    });
    if (owner) {
      throw new ConflictException(`У гостиницы уже есть владелец кабинета (${owner.email})`);
    }
    if (await this.prisma.admin.user.findUnique({ where: { email }, select: { id: true } })) {
      throw new ConflictException('Этот адрес уже зарегистрирован в системе');
    }
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000);
    await this.prisma.admin.$transaction([
      this.prisma.admin.ownerInvite.updateMany({
        where: { tenantId, usedAt: null },
        data: { usedAt: new Date(), revoked: true },
      }),
      this.prisma.admin.ownerInvite.create({
        data: { tenantId, email, fullName: dto.fullName.trim(), tokenHash: hash(token), expiresAt, partnerId },
      }),
    ]);
    return { token, email, expiresAt: expiresAt.toISOString() };
  }

  /** Что показать на странице приглашения — без входа. */
  async peek(token: string) {
    const invite = await this.valid(token);
    const tenant = await this.prisma.admin.tenant.findUnique({
      where: { id: invite.tenantId },
      select: { name: true },
    });
    return {
      hotelName: tenant?.name ?? '',
      email: invite.email,
      fullName: invite.fullName,
      expiresAt: invite.expiresAt.toISOString(),
    };
  }

  /* Принять приглашение: владелец задаёт пароль, заводится учётка с ролью
     «Владелец» этой гостиницы, ссылка гаснет. Одной транзакцией — чтобы
     одна ссылка не завела двух владельцев при двойном нажатии. */
  async accept(token: string, password: string): Promise<{ userId: string; tenantId: string; email: string }> {
    const invite = await this.valid(token);
    const role = await this.prisma.admin.role.findFirst({
      where: { tenantId: invite.tenantId, code: RoleCode.OWNER },
      select: { id: true },
    });
    if (!role) throw new ConflictException('У гостиницы нет роли «Владелец» — обратитесь в поддержку');
    const passwordHash = await bcrypt.hash(password, 10);
    return this.prisma.admin.$transaction(async (tx) => {
      const used = await tx.ownerInvite.updateMany({
        where: { id: invite.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (used.count !== 1) throw new GoneException('Приглашение уже использовано');
      if (await tx.user.findUnique({ where: { email: invite.email }, select: { id: true } })) {
        throw new ConflictException('Этот адрес уже зарегистрирован в системе');
      }
      const user = await tx.user.create({
        data: {
          tenantId: invite.tenantId,
          email: invite.email,
          fullName: invite.fullName,
          passwordHash,
          roleId: role.id,
        },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          tenantId: invite.tenantId,
          userId: user.id,
          entity: 'tenant',
          entityId: invite.tenantId,
          action: 'owner_invite_accepted',
        },
      });
      return { userId: user.id, tenantId: invite.tenantId, email: invite.email };
    });
  }

  private async valid(token: string) {
    const invite = await this.prisma.admin.ownerInvite.findUnique({ where: { tokenHash: hash(token) } });
    if (!invite) throw new NotFoundException('Приглашение не найдено');
    if (invite.usedAt) {
      throw new GoneException(invite.revoked ? 'Приглашение заменено новым' : 'Приглашение уже использовано');
    }
    if (invite.expiresAt < new Date()) throw new GoneException('Срок приглашения истёк — попросите новое');
    return invite;
  }
}
