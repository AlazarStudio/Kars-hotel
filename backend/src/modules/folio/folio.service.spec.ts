import { NotFoundException } from '@nestjs/common';
import { FolioService } from './folio.service';
import { TenantContext } from '../../common/context/tenant-context';

/* 152-ФЗ, Р-09; план 13.1: счёт — только по своей брони. Под RLS чужая бронь
 * не видна (findUnique → null) — и счёт не создаётся, и строка не пишется. */

function service(reservation: { id: string; tenantId: string } | null) {
  const tx = {
    reservation: { findUnique: jest.fn(async () => reservation) },
    folio: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }: { data: object }) => ({ id: 'f1', ...data })),
      findUniqueOrThrow: jest.fn(async () => ({ id: 'f1', charges: [], payments: [] })),
    },
    folioCharge: { create: jest.fn(async ({ data }: { data: object }) => ({ id: 'c1', ...data })), findFirst: jest.fn(async () => null), delete: jest.fn() },
    payment: { create: jest.fn() },
  };
  const prisma = {
    forTenant: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    writeAuditLog: jest.fn(async () => undefined),
  };
  return { svc: new FolioService(prisma as never), tx, prisma };
}

describe('FolioService — только своя бронь', () => {
  beforeEach(() => jest.spyOn(TenantContext, 'getTenantIdOrThrow').mockReturnValue('00000000-0000-0000-0000-00000000000a'));
  afterEach(() => jest.restoreAllMocks());

  it('чужая бронь: 404, счёт не создаётся', async () => {
    const { svc, tx } = service(null);
    await expect(svc.getOrCreate('r-foreign')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.addCharge('r-foreign', { type: 'MANUAL', description: 'x', quantity: 1, unitPrice: 1 } as never, 'u')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.addPayment('r-foreign', { method: 'CASH', amount: 1 } as never, 'u')).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.folio.create).not.toHaveBeenCalled();
    expect(tx.folioCharge.create).not.toHaveBeenCalled();
    expect(tx.payment.create).not.toHaveBeenCalled();
  });

  it('своя бронь: счёт создаётся на её гостиницу, начисление — в журнал', async () => {
    const { svc, tx, prisma } = service({ id: 'r1', tenantId: 't-own' });
    await svc.addCharge('r1', { type: 'MANUAL', description: 'x', quantity: 2, unitPrice: 5 } as never, 'u1');
    expect(tx.folio.create).toHaveBeenCalledWith({ data: { tenantId: 't-own', reservationId: 'r1' } });
    expect(prisma.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ entity: 'folio', action: 'charge.add', userId: 'u1' }));
  });

  it('строка удаляется только из счёта ЭТОЙ брони', async () => {
    const { svc, tx } = service({ id: 'r1', tenantId: 't-own' });
    await expect(svc.deleteCharge('r1', 'c-other', 'u1')).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.folioCharge.findFirst).toHaveBeenCalledWith({ where: { id: 'c-other', folio: { reservationId: 'r1' } } });
    expect(tx.folioCharge.delete).not.toHaveBeenCalled();
  });
});
