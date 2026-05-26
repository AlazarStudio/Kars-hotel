import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/context/tenant-context';
import { AddChargeDto, AddPaymentDto } from './dto/folio.dto';

@Injectable()
export class FolioService {
  constructor(private readonly prisma: PrismaService) {}

  /** Get or create the folio for a reservation. Auto-creates on first access. */
  async getOrCreate(reservationId: string) {
    const tenantId = TenantContext.getTenantIdOrThrow();

    let folio = await this.prisma.admin.folio.findUnique({
      where: { reservationId },
      include: {
        charges: { orderBy: { addedAt: 'asc' } },
        payments: { orderBy: { receivedAt: 'asc' } },
      },
    });

    if (!folio) {
      folio = await this.prisma.admin.folio.create({
        data: { tenantId, reservationId },
        include: {
          charges: true,
          payments: true,
        },
      });
    }

    return this.withBalance(folio);
  }

  async addCharge(reservationId: string, dto: AddChargeDto, userId: string) {
    const tenantId = TenantContext.getTenantIdOrThrow();
    const folio = await this.getOrCreateRaw(reservationId, tenantId);

    const total = Number(dto.quantity) * Number(dto.unitPrice);

    return this.prisma.admin.folioCharge.create({
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
  }

  async addPayment(reservationId: string, dto: AddPaymentDto, userId: string) {
    const tenantId = TenantContext.getTenantIdOrThrow();
    const folio = await this.getOrCreateRaw(reservationId, tenantId);

    return this.prisma.admin.payment.create({
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
  }

  async deleteCharge(chargeId: string) {
    const tenantId = TenantContext.getTenantIdOrThrow();
    const charge = await this.prisma.admin.folioCharge.findFirst({
      where: { id: chargeId, tenantId },
    });
    if (!charge) throw new NotFoundException('Charge not found');
    await this.prisma.admin.folioCharge.delete({ where: { id: chargeId } });
    return { deleted: true };
  }

  /** Called by checkOut. Throws 409 if balance > 0. */
  async assertZeroBalance(reservationId: string): Promise<void> {
    const folio = await this.prisma.admin.folio.findUnique({
      where: { reservationId },
      include: {
        charges: { select: { total: true } },
        payments: { select: { amount: true, type: true } },
      },
    });
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

  private async getOrCreateRaw(reservationId: string, tenantId: string) {
    const existing = await this.prisma.admin.folio.findUnique({ where: { reservationId } });
    if (existing) return existing;
    return this.prisma.admin.folio.create({ data: { tenantId, reservationId } });
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
