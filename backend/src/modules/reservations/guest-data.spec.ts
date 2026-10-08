import { BadRequestException, ConflictException } from '@nestjs/common';
import { ANONYMIZED_NAME, GuestDataService } from './guest-data.service';
import { TenantContext } from '../../common/context/tenant-context';

/* 152-ФЗ, Р-49, Г-22; план 13.7. */

const ROWS = [
  { id: 'r1', guestName: 'Иванов Иван Иванович', phone: '+7 (900) 111-22-33', email: 'ivan@mail.ru', status: 'CHECKED_OUT' },
  { id: 'r2', guestName: 'Иванова Мария', phone: '89001112234', email: null, status: 'CHECKED_OUT' },
].map((r) => ({ ...r, checkIn: new Date('2026-09-01'), checkOut: new Date('2026-09-03'), room: { number: '101' }, adults: 1, children: 0, notes: null, createdAt: new Date() }));

function service(status = 'CHECKED_OUT') {
  const update = jest.fn();
  const tx = {
    reservation: { findUnique: jest.fn(async () => ({ id: 'r1', status })), update, findMany: jest.fn(async () => ROWS) },
    payment: { updateMany: jest.fn() },
    folio: { findMany: jest.fn(async () => []) },
  };
  const prisma = {
    forTenant: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    admin: { $executeRaw: jest.fn(async () => 3) },
    writeAuditLog: jest.fn(async () => undefined),
  };
  return { svc: new GuestDataService(prisma as never), update, prisma, tx };
}

describe('Обезличивание брони', () => {
  beforeEach(() => jest.spyOn(TenantContext, 'getTenantIdOrThrow').mockReturnValue('t1'));
  afterEach(() => jest.restoreAllMocks());

  it('завершённая — ФИО, телефон, почта, комментарий стёрты, следы в журнале вычищены', async () => {
    const { svc, update, prisma, tx } = service('CHECKED_OUT');
    await svc.anonymize('r1', 'u1');
    expect(update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { guestName: ANONYMIZED_NAME, phone: null, email: null, notes: null } });
    expect(tx.payment.updateMany).toHaveBeenCalled();
    expect(prisma.admin.$executeRaw).toHaveBeenCalled();
    expect(prisma.writeAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'anonymize' }));
  });

  it('живая бронь (гость в номере) — нельзя', async () => {
    const { svc, update } = service('CHECKED_IN');
    await expect(svc.anonymize('r1', 'u1')).rejects.toBeInstanceOf(ConflictException);
    expect(update).not.toHaveBeenCalled();
  });
});

describe('Выгрузка данных гостя', () => {
  beforeEach(() => jest.spyOn(TenantContext, 'getTenantIdOrThrow').mockReturnValue('t1'));
  afterEach(() => jest.restoreAllMocks());

  it('по телефону в любой записи — только его брони, не «похожие»', async () => {
    const { svc } = service();
    const out = await svc.export({ phone: '8 900 111 22 33' }, 'u1');
    expect(out.reservations.map((r) => r.guestName)).toEqual(['Иванов Иван Иванович']);
  });

  it('по ФИО — только точное совпадение', async () => {
    const { svc } = service();
    const out = await svc.export({ name: 'иванова  мария' }, 'u1');
    expect(out.reservations.map((r) => r.guestName)).toEqual(['Иванова Мария']);
  });

  it('без точного признака — отказ, а не «все брони»', async () => {
    const { svc } = service();
    await expect(svc.export({ name: 'Ива' }, 'u1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('в журнал — число броней, без самого запроса', async () => {
    const { svc, prisma } = service();
    await svc.export({ email: 'IVAN@mail.ru' }, 'u1');
    const logged = JSON.stringify((prisma.writeAuditLog as jest.Mock).mock.calls);
    expect(logged).toContain('"reservations":1');
    expect(logged).not.toContain('ivan@mail.ru');
  });
});
