import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/context/tenant-context';
import { AddChargeDto, AddPaymentDto } from './dto/folio.dto';

/* Счёт брони (152-ФЗ, Р-09; план 13.1). Раньше всё шло суперпользователем
 * (prisma.admin) без сверки гостиницы: запрос счёта по чужой брони создавал
 * чужой счёт и давал в него писать, а 409 при выезде называл остаток чужого
 * счёта. Теперь только через forTenant (RLS по app.tenant_id), и сначала —
 * бронь своя ли: чужая неотличима от несуществующей (404), счёт не создаётся.
 * Начисление, платёж и удаление строки — в журнал. */
@Injectable()
export class FolioService {
  constructor(private readonly prisma: PrismaService) {}

  /** Get or create the folio for a reservation. Auto-creates on first access. */
  async getOrCreate(reservationId: string) {
    return this.prisma.forTenant(async (tx) => {
      const folio = await this.folioOf(tx, reservationId);
      const full = await tx.folio.findUniqueOrThrow({
        where: { id: folio.id },
        include: {
          charges: { orderBy: { addedAt: 'asc' } },
          payments: { orderBy: { receivedAt: 'asc' } },
        },
      });
      return this.withBalance(full);
    });
  }

  async addCharge(reservationId: string, dto: AddChargeDto, userId: string) {
    const tenantId = TenantContext.getTenantIdOrThrow();
    const total = Number(dto.quantity) * Number(dto.unitPrice);
    const charge = await this.prisma.forTenant(async (tx) => {
      const folio = await this.folioOf(tx, reservationId);
      return tx.folioCharge.create({
        data: {
          tenantId,
          folioId: folio.id,
          type: dto.type as any,
          description: dto.description,
          quantity: dto.quantity,
          unitPrice: dto.unitPrice,
          total,
          addedBy: userId,
        },
      });
    });
    await this.prisma.writeAuditLog({
      tenantId,
      userId,
      entity: 'folio',
      entityId: reservationId,
      action: 'charge.add',
      diff: { before: {}, after: { chargeId: charge.id, type: dto.type, total } },
    });
    return charge;
  }

  async addPayment(reservationId: string, dto: AddPaymentDto, userId: string) {
    const tenantId = TenantContext.getTenantIdOrThrow();
    const payment = await this.prisma.forTenant(async (tx) => {
      const folio = await this.folioOf(tx, reservationId);
      return tx.payment.create({
        data: {
          tenantId,
          folioId: folio.id,
          type: (dto.type ?? 'PAYMENT') as any,
          method: dto.method as any,
          amount: dto.amount,
          note: dto.note ?? null,
          receivedBy: userId,
        },
      });
    });
    await this.prisma.writeAuditLog({
      tenantId,
      userId,
      entity: 'folio',
      entityId: reservationId,
      action: 'payment.add',
      diff: { before: {}, after: { paymentId: payment.id, type: payment.type, method: dto.method, amount: dto.amount } },
    });
    return payment;
  }

  /** Строка — только из счёта ЭТОЙ брони (а не любая строка гостиницы по id). */
  async deleteCharge(reservationId: string, chargeId: string, userId?: string) {
    const tenantId = TenantContext.getTenantIdOrThrow();
    const charge = await this.prisma.forTenant(async (tx) => {
      const found = await tx.folioCharge.findFirst({
        where: { id: chargeId, folio: { reservationId } },
      });
      if (!found) throw new NotFoundException('Charge not found');
      await tx.folioCharge.delete({ where: { id: chargeId } });
      return found;
    });
    await this.prisma.writeAuditLog({
      tenantId,
      userId,
      entity: 'folio',
      entityId: reservationId,
      action: 'charge.delete',
      diff: { before: { chargeId, type: charge.type, total: Number(charge.total) }, after: {} },
    });
    return { deleted: true };
  }

  /** Called on check-out. Throws 409 if balance > 0. Чужой счёт сюда не виден.
   *  `tx` — транзакция выселения, чтобы счёт сверялся в ней же. */
  async assertZeroBalance(reservationId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const read = (t: Prisma.TransactionClient) =>
      t.folio.findUnique({
        where: { reservationId },
        include: {
          charges: { select: { total: true } },
          payments: { select: { amount: true, type: true } },
        },
      });
    const folio = await (tx ? read(tx) : this.prisma.forTenant(read));
    if (!folio) return; // No folio = nothing charged = balance is 0

    const totalCharged = folio.charges.reduce((s, c) => s + Number(c.total), 0);
    const totalPaid = folio.payments.reduce((s, p) => {
      return p.type === 'REFUND' ? s - Number(p.amount) : s + Number(p.amount);
    }, 0);
    const balance = totalCharged - totalPaid;

    if (balance > 0.01) {
      throw new ConflictException(
        `Cannot check out: outstanding balance of ${balance.toFixed(2)} must be settled first`,
      );
    }
  }

  /** Счёт своей брони; создаётся при первом обращении. Чужая бронь — 404. */
  private async folioOf(tx: Prisma.TransactionClient, reservationId: string) {
    const reservation = await tx.reservation.findUnique({
      where: { id: reservationId },
      select: { id: true, tenantId: true },
    });
    if (!reservation) throw new NotFoundException('Reservation not found');
    const existing = await tx.folio.findUnique({ where: { reservationId } });
    if (existing) return existing;
    return tx.folio.create({ data: { tenantId: reservation.tenantId, reservationId } });
  }

  private withBalance(folio: any) {
    const totalCharged = folio.charges.reduce((s: number, c: any) => s + Number(c.total), 0);
    const totalPaid = folio.payments.reduce((s: number, p: any) => {
      return p.type === 'REFUND' ? s - Number(p.amount) : s + Number(p.amount);
    }, 0);
    const balance = totalCharged - totalPaid;
    return { ...folio, totalCharged, totalPaid, balance };
  }
}
