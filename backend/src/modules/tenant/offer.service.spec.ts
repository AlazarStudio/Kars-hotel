import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { OfferService, offerVersion } from './offer.service';

/* 152-ФЗ, Р-29; план 13.11: оферту принимает владелец сам, с контактом для
 * инцидентов; принятие — версия, время, адрес и устройство. */

const OWNER = { userId: 'u1', tenantId: 't1', roleCode: 'OWNER', email: 'o@h.ru', permissions: [], isSuperAdmin: false };
const CONTACT = { name: 'Иванова Мария', phone: '+7 900 000-00-00', email: 'm@hotel.ru' };

function service() {
  const upsert = jest.fn();
  const prisma = {
    admin: {
      tenant: { update: jest.fn(), findUnique: jest.fn(async () => null) },
      tenantOfferAcceptance: { upsert, findFirst: jest.fn(async () => ({ version: 2, acceptedAt: new Date() })) },
      $transaction: jest.fn(async (ops: unknown[]) => ops),
    },
    writeAuditLog: jest.fn(async () => undefined),
  };
  return { svc: new OfferService(prisma as never), upsert, prisma };
}

describe('Оферта PMS', () => {
  const env = { ...process.env };
  beforeEach(() => (process.env.PMS_OFFER_VERSION = '2'));
  afterEach(() => (process.env = { ...env }));

  it('версия 0 / не задана — оферта не опубликована', () => {
    expect(offerVersion({} as NodeJS.ProcessEnv)).toBe(0);
    expect(offerVersion({ PMS_OFFER_VERSION: 'abc' } as NodeJS.ProcessEnv)).toBe(0);
  });

  it('владелец принимает с контактом — пишется версия, адрес и устройство', async () => {
    const { svc, upsert, prisma } = service();
    await svc.accept(OWNER as never, { version: 2, incidentContact: CONTACT }, '10.0.0.1', 'Browser/1');
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ version: 2, userId: 'u1', ip: '10.0.0.1', userAgent: 'Browser/1' }) }));
    expect(prisma.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'offer.accepted' }));
  });

  it('диспетчер «от имени» с правами владельца — не может', async () => {
    const { svc, upsert } = service();
    await expect(svc.accept({ ...OWNER, impersonatedBy: 'disp' } as never, { version: 2, incidentContact: CONTACT })).rejects.toBeInstanceOf(ForbiddenException);
    expect(upsert).not.toHaveBeenCalled();
  });

  it('не владелец — не может', async () => {
    const { svc } = service();
    await expect(svc.accept({ ...OWNER, roleCode: 'MANAGER' } as never, { version: 2, incidentContact: CONTACT })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('без контакта для инцидентов или не та версия — отказ', async () => {
    const { svc, upsert } = service();
    await expect(svc.accept(OWNER as never, { version: 2, incidentContact: { name: 'И', phone: '1', email: 'x' } })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.accept(OWNER as never, { version: 1, incidentContact: CONTACT })).rejects.toBeInstanceOf(BadRequestException);
    expect(upsert).not.toHaveBeenCalled();
  });
});
