import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/context/tenant-context';
import { TimelineGateway } from '../timeline/timeline.gateway';

/* ДАННЫЕ ГОСТЯ: ОБЕЗЛИЧИТЬ И ВЫГРУЗИТЬ (152-ФЗ, Р-49, Г-22, ст. 14, 21; план 13.7).
 *
 * Обезличить бронь не было никакого способа — ни по команде гостиницы, ни по
 * требованию гостя, а правка имени оставалась в журнале навсегда. Выгрузить
 * всё, что гостиница хранит о человеке, по его запросу — тоже.
 *
 * ОБЕЗЛИЧИВАНИЕ — только у завершённой брони (выехал, отменена, неявка):
 * у живой брони имя нужно гостинице, чтобы человека заселить. Стираются ФИО,
 * телефон, почта, комментарий брони, заметки платежей её счёта и эти же поля
 * в записях журнала о брони. Суммы, даты и номер остаются — это учёт, а не
 * человек. Партнёру не сообщается: у него своя копия и свои сроки.
 *
 * ВЫГРУЗКА — по точному телефону, почте или ФИО (поиск «похожих» здесь вреден:
 * он отдал бы чужие данные). В журнал — сколько броней ушло, без самого
 * запроса: запрос и есть персональные данные. */

export const ANONYMIZED_NAME = 'Гость (обезличен)';
const FINISHED = ['CHECKED_OUT', 'CANCELLED', 'NO_SHOW'];
const PD_KEYS = ['guestName', 'phone', 'email', 'notes'];

const digits = (s: string) => s.replace(/\D/g, '');

@Injectable()
export class GuestDataService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly timeline?: TimelineGateway,
  ) {}

  async anonymize(id: string, userId: string): Promise<{ id: string; anonymized: true }> {
    const tenantId = TenantContext.getTenantIdOrThrow();
    await this.prisma.forTenant(async (tx) => {
      const r = await tx.reservation.findUnique({ where: { id }, select: { id: true, status: true } });
      if (!r) throw new NotFoundException('Reservation not found');
      if (!FINISHED.includes(r.status)) {
        throw new ConflictException('Обезличить можно завершённую бронь: выехал, отменена или неявка');
      }
      await tx.reservation.update({
        where: { id },
        data: { guestName: ANONYMIZED_NAME, phone: null, email: null, notes: null },
      });
      await tx.payment.updateMany({ where: { folio: { reservationId: id } }, data: { note: null } });
    });
    // Следы в журнале: те же поля в «до/после» правок этой брони.
    await this.prisma.admin.$executeRaw`
      UPDATE audit_log
         SET diff = jsonb_set(
               jsonb_set(diff, '{before}', COALESCE(diff->'before', '{}'::jsonb) - ${PD_KEYS}::text[]),
               '{after}', COALESCE(diff->'after', '{}'::jsonb) - ${PD_KEYS}::text[])
       WHERE tenant_id = ${tenantId}::uuid
         AND entity = 'reservation'
         AND entity_id = ${id}
         AND diff IS NOT NULL
         AND jsonb_typeof(diff) = 'object'
    `;
    await this.prisma.writeAuditLog({ tenantId, userId, entity: 'reservation', entityId: id, action: 'anonymize' });
    this.timeline?.notifyUpdate(tenantId, { action: 'updated' });
    return { id, anonymized: true };
  }

  async export(query: { phone?: string; email?: string; name?: string }, userId: string) {
    const tenantId = TenantContext.getTenantIdOrThrow();
    const phone = digits(query.phone ?? '');
    const email = (query.email ?? '').trim().toLowerCase();
    const name = (query.name ?? '').trim().replace(/\s+/g, ' ');
    if (phone.length < 10 && !email && name.length < 5) {
      throw new BadRequestException('Укажите точный телефон, e-mail или полное ФИО гостя');
    }
    const rows = await this.prisma.forTenant((tx) =>
      tx.reservation.findMany({
        where: {
          OR: [
            ...(email ? [{ email: { equals: email, mode: 'insensitive' as const } }] : []),
            ...(name.length >= 5 ? [{ guestName: { equals: name, mode: 'insensitive' as const } }] : []),
            ...(phone.length >= 10 ? [{ phone: { not: null } }] : []),
          ],
        },
        include: { room: { select: { number: true } } },
        orderBy: { checkIn: 'asc' },
      }),
    );
    // Телефон сравниваем по цифрам: «+7 (900) 000-00-00» и «89000000000» — один номер.
    const tail = phone.slice(-10);
    const matched = rows.filter(
      (r) =>
        (email && r.email?.toLowerCase() === email) ||
        (name.length >= 5 && r.guestName.toLowerCase() === name.toLowerCase()) ||
        (phone.length >= 10 && r.phone && digits(r.phone).slice(-10) === tail),
    );
    const folios = await this.prisma.forTenant((tx) =>
      tx.folio.findMany({
        where: { reservationId: { in: matched.map((r) => r.id) } },
        include: { charges: true, payments: true },
      }),
    );
    await this.prisma.writeAuditLog({
      tenantId,
      userId,
      entity: 'guest',
      action: 'export',
      diff: { before: {}, after: { reservations: matched.length } },
    });
    return {
      exportedAt: new Date().toISOString(),
      reservations: matched.map((r) => {
        const f = folios.find((x) => x.reservationId === r.id);
        return {
          guestName: r.guestName,
          phone: r.phone,
          email: r.email,
          checkIn: r.checkIn.toISOString().slice(0, 10),
          checkOut: r.checkOut.toISOString().slice(0, 10),
          room: r.room?.number ?? null,
          status: r.status,
          adults: r.adults,
          children: r.children,
          notes: r.notes,
          createdAt: r.createdAt,
          charges: f?.charges.map((c) => ({ type: c.type, description: c.description, total: Number(c.total), addedAt: c.addedAt })) ?? [],
          payments: f?.payments.map((p) => ({ type: p.type, method: p.method, amount: Number(p.amount), receivedAt: p.receivedAt, note: p.note })) ?? [],
        };
      }),
    };
  }
}
