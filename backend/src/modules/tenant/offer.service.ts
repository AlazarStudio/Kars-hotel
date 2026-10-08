import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuthenticatedRequestUser } from '../auth/strategies/jwt.strategy';

/* ОФЕРТА PMS С ПОРУЧЕНИЕМ НА ОБРАБОТКУ ПДн (152-ФЗ, Р-29, Р-06; план 13.11).
 *
 * Текст оферты пишет юрист и публикует вне кода; здесь — версия
 * (PMS_OFFER_VERSION) и адрес текста (PMS_OFFER_URL). Пока версия 0 — оферта
 * не опубликована, и ничего не спрашивается. Опубликовали — владелец
 * гостиницы при входе обязан её принять и назвать контакт для уведомления
 * об инциденте; принятие пишется с версией, временем, адресом и устройством.
 *
 * Принимает ТОЛЬКО владелец, сам: диспетчер «от имени» тоже работает с
 * правами владельца, но подписаться за гостиницу не может. */
export interface IncidentContact {
  name: string;
  phone: string;
  email: string;
}

export function offerVersion(env: NodeJS.ProcessEnv = process.env): number {
  const v = Number(env.PMS_OFFER_VERSION ?? 0);
  return Number.isInteger(v) && v > 0 ? v : 0;
}

@Injectable()
export class OfferService {
  constructor(private readonly prisma: PrismaService) {}

  async status(tenantId: string) {
    const version = offerVersion();
    const [last, tenant] = await Promise.all([
      this.prisma.admin.tenantOfferAcceptance.findFirst({
        where: { tenantId },
        orderBy: { version: 'desc' },
        select: { version: true, acceptedAt: true },
      }),
      this.prisma.admin.tenant.findUnique({
        where: { id: tenantId },
        select: { incidentContactName: true, incidentContactPhone: true, incidentContactEmail: true },
      }),
    ]);
    return {
      version,
      url: process.env.PMS_OFFER_URL || null,
      acceptedVersion: last?.version ?? 0,
      acceptedAt: last?.acceptedAt ?? null,
      required: version > 0 && (last?.version ?? 0) < version,
      incidentContact: tenant?.incidentContactName
        ? { name: tenant.incidentContactName, phone: tenant.incidentContactPhone, email: tenant.incidentContactEmail }
        : null,
    };
  }

  async accept(
    user: AuthenticatedRequestUser,
    dto: { version?: number; incidentContact?: Partial<IncidentContact> },
    ip?: string,
    userAgent?: string,
  ) {
    if (user.roleCode !== 'OWNER' || user.impersonatedBy) {
      throw new ForbiddenException('Оферту принимает владелец гостиницы сам');
    }
    const version = offerVersion();
    if (!version) throw new BadRequestException('Оферта ещё не опубликована');
    if (dto.version !== version) {
      throw new BadRequestException('Версия оферты сменилась — обновите страницу и прочтите текущую');
    }
    const c = dto.incidentContact ?? {};
    const name = (c.name ?? '').trim();
    const phone = (c.phone ?? '').trim();
    const email = (c.email ?? '').trim();
    if (name.length < 2 || phone.replace(/\D/g, '').length < 10 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('Укажите контакт для инцидентов: ФИО, телефон и e-mail');
    }
    await this.prisma.admin.$transaction([
      this.prisma.admin.tenant.update({
        where: { id: user.tenantId },
        data: { incidentContactName: name, incidentContactPhone: phone, incidentContactEmail: email },
      }),
      this.prisma.admin.tenantOfferAcceptance.upsert({
        where: { tenantId_version: { tenantId: user.tenantId, version } },
        create: { tenantId: user.tenantId, version, userId: user.userId, ip, userAgent },
        update: {},
      }),
    ]);
    await this.prisma.writeAuditLog({
      tenantId: user.tenantId,
      userId: user.userId,
      entity: 'tenant',
      entityId: user.tenantId,
      action: 'offer.accepted',
      diff: { before: {}, after: { version } },
      ip,
      userAgent,
    });
    return this.status(user.tenantId);
  }
}
