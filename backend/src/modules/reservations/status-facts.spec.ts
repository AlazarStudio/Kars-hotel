import { ConflictException } from '@nestjs/common';
import { TenantContext } from '../../common/context/tenant-context';
import { FolioService } from '../folio/folio.service';
import { ReservationsService } from './reservations.service';

/* Заезд, выезд, неявка формой брони — тем же правилом, что кнопкой
 * (25.10.2026, правка заказчика Kars Avia: «в PMS выселили, а в Авии заявка
 * рабочая»). Статус «Выехал» из формы вставал напрямую: без сверки счёта, без
 * времени выезда, номер не уходил в уборку, партнёр не получал
 * guest.checked_out. Отрицанием: форма НЕ выселяет с долгом и без заезда;
 * тот же статус повторно — НЕ новый факт; прочие статусы фактов НЕ шлют. */

const CUR = {
  id: 'r1',
  room_id: 'room',
  room_type_id: 'rt',
  check_in: new Date('2026-10-21'),
  check_out: new Date('2026-10-25'),
  version: 1,
  guest_name: 'Морозова И.В.',
  phone: null,
  email: null,
  adults: 1,
  children: 0,
  status: 'CHECKED_IN',
  source: 'CORPORATE',
  notes: null,
  total_price: null,
  rate_plan_id: null,
  place_number: 1,
  channel_managed: true,
  arrival_at: null,
  departure_at: null,
  flight: null,
};

/* Форма шлёт всё, что на экране, и статус — при каждом сохранении. */
const FORM = {
  version: 1,
  guestName: 'Морозова И.В.',
  roomId: 'room',
  checkIn: '2026-10-21',
  checkOut: '2026-10-25',
  adults: 1,
  children: 0,
  source: 'CORPORATE',
};

const DEBT = { charges: [{ total: '4500.00' }], payments: [] };
const PAID = {
  charges: [{ total: '4500.00' }],
  payments: [{ amount: '4500.00', type: 'PAYMENT' }],
};

type Folio = { charges: { total: string }[]; payments: { amount: string; type: string }[] } | null;

function make(row: Partial<typeof CUR> = {}, folio: Folio = null) {
  const cur = { ...CUR, ...row };
  const sql: string[] = [];
  const executed: string[] = [];
  const audit: { action: string; diff?: unknown }[] = [];
  const tx = {
    $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?');
      sql.push(text);
      if (text.includes('UPDATE reservation')) {
        // RETURNING status — то, что UPDATE присвоил колонке «status = ${…}».
        const i = strings.findIndex((s) => /\bstatus\s*=\s*$/.test(s));
        return [{ id: 'r1', version: 2, status: i >= 0 ? values[i] : cur.status }];
      }
      if (text.includes('FROM room r')) return [{ capacity: 2, multi_place: false }];
      return [cur];
    }),
    $executeRaw: jest.fn(async (strings: TemplateStringsArray) => {
      executed.push(strings.join('?'));
      return 1;
    }),
    folio: { findUnique: jest.fn(async () => folio) },
  };
  const prisma = {
    forTenant: async (cb: (t: typeof tx) => unknown) => cb(tx),
    admin: { $queryRaw: async () => [{ adults: cur.adults, children: cur.children }] },
    writeAuditLog: async (e: (typeof audit)[number]) => {
      audit.push(e);
    },
  };
  const folioService = Object.assign(Object.create(FolioService.prototype), {
    prisma,
  }) as FolioService;
  const webhooks = {
    emitForReservation: jest.fn(async () => undefined),
    emitReservationChanged: jest.fn(async () => undefined),
  };
  const hk = { autoCreateOnCheckout: jest.fn(async () => undefined) };

  const svc = Object.create(ReservationsService.prototype) as ReservationsService;
  Object.assign(svc, {
    logger: { log: jest.fn(), warn: jest.fn() },
    prisma,
    folioService,
    hkService: hk,
    timelineService: { invalidate: async () => undefined },
    timelineGateway: { notifyUpdate: () => undefined },
    partnerWebhooks: webhooks,
    overlapping: async () => [],
  });
  const wrote = () => sql.some((s) => s.includes('UPDATE reservation'));
  const events = () => (webhooks.emitForReservation.mock.calls as unknown[][]).map((c) => c[0]);
  return { svc, sql, executed, audit, webhooks, hk, wrote, events };
}

const asOwner = <T>(fn: () => Promise<T>) =>
  TenantContext.run(
    {
      tenantId: 't1',
      userId: 'u1',
      roleCode: 'OWNER',
      permissions: [],
      isSuperAdmin: false,
    } as never,
    fn,
  );

const save = (svc: ReservationsService, dto: object) =>
  asOwner(() => svc.update('r1', { ...FORM, ...dto } as never));

describe('«Выехал» формой брони', () => {
  it('при долге по счёту — НЕ выселяет: 409, статус не пишется, партнёру ничего', async () => {
    const t = make({ status: 'CHECKED_IN' }, DEBT);
    await expect(save(t.svc, { status: 'checked_out' })).rejects.toThrow(
      /outstanding balance of 4500\.00/,
    );
    expect(t.wrote()).toBe(false);
    expect(t.webhooks.emitForReservation).not.toHaveBeenCalled();
    expect(t.webhooks.emitReservationChanged).not.toHaveBeenCalled();
  });

  it('без заезда — НЕ выселяет, отказ тот же, что у кнопки «Выселить»', async () => {
    const form = make({ status: 'CONFIRMED' });
    const formErr = await save(form.svc, { status: 'checked_out' }).catch((e) => e);
    expect(formErr).toBeInstanceOf(ConflictException);
    expect(form.wrote()).toBe(false);
    expect(form.webhooks.emitForReservation).not.toHaveBeenCalled();

    const button = make({ status: 'CONFIRMED' });
    const buttonErr = await asOwner(() => button.svc.checkOut('r1', 'u1')).catch((e) => e);
    expect(buttonErr).toBeInstanceOf(ConflictException);
    expect(formErr.message).toBe(buttonErr.message);
  });

  it('из «Заселён» с закрытым счётом — факт: guest.checked_out, время выезда, номер в уборку', async () => {
    const t = make({ status: 'CHECKED_IN' }, PAID);
    await expect(save(t.svc, { status: 'checked_out' })).resolves.toMatchObject({
      status: 'CHECKED_OUT',
    });
    expect(t.events()).toEqual(['guest.checked_out']);
    expect(t.webhooks.emitForReservation).toHaveBeenCalledWith(
      'guest.checked_out',
      'r1',
      expect.objectContaining({ status: 'checked_out', noShow: false, guestsArrived: 1 }),
    );
    expect(t.executed.some((s) => s.includes('checked_out_at = now()'))).toBe(true);
    expect(t.executed.some((s) => s.includes(`'DIRTY'`))).toBe(true);
    expect(t.hk.autoCreateOnCheckout).toHaveBeenCalledWith('t1', 'room', 'r1');
    expect(t.audit.map((a) => a.action)).toEqual(['update', 'check_out']);
    // Договор с Авией прежний: «бронь изменена» уходит, как при любой правке.
    expect(t.webhooks.emitReservationChanged).toHaveBeenCalledWith('r1');
  });

  it('повторно тот же статус — НЕ новый факт, даже при долге: правка проходит без событий выезда', async () => {
    const t = make({ status: 'CHECKED_OUT' }, DEBT);
    await expect(
      save(t.svc, { status: 'checked_out', notes: 'Счёт закроет бухгалтерия' }),
    ).resolves.toBeDefined();
    expect(t.webhooks.emitForReservation).not.toHaveBeenCalled();
    expect(t.executed).toEqual([]);
    expect(t.hk.autoCreateOnCheckout).not.toHaveBeenCalled();
    expect(t.audit.map((a) => a.action)).toEqual(['update']);
  });
});

describe('«Заселён» и «Не явился» формой брони', () => {
  it('«Заселён» из «Подтверждено» — факт: guest.checked_in и время заезда', async () => {
    const t = make({ status: 'CONFIRMED' });
    await save(t.svc, { status: 'checked_in' });
    expect(t.events()).toEqual(['guest.checked_in']);
    expect(t.executed.some((s) => s.includes('checked_in_at = now()'))).toBe(true);
    expect(t.audit.map((a) => a.action)).toEqual(['update', 'check_in']);
  });

  it('«Заселён» из «Выехал» — НЕ заселяет, как и кнопка', async () => {
    const t = make({ status: 'CHECKED_OUT' });
    await expect(save(t.svc, { status: 'checked_in' })).rejects.toThrow(/Cannot check in/);
    expect(t.wrote()).toBe(false);
    expect(t.webhooks.emitForReservation).not.toHaveBeenCalled();
  });

  it('«Не явился» из «Заселён» — НЕ отмечает, как и кнопка', async () => {
    const t = make({ status: 'CHECKED_IN' });
    await expect(save(t.svc, { status: 'no_show' })).rejects.toThrow(/no-show/);
    expect(t.wrote()).toBe(false);
  });

  it('«Не явился» из «Подтверждено» — guest.no_show, прибывших ноль', async () => {
    const t = make({ status: 'CONFIRMED' });
    await save(t.svc, { status: 'no_show' });
    expect(t.webhooks.emitForReservation).toHaveBeenCalledWith(
      'guest.no_show',
      'r1',
      expect.objectContaining({ noShow: true, guestsArrived: 0 }),
    );
  });

  it.each([
    ['«Новое» из «Подтверждено»', 'CONFIRMED', 'new'],
    ['«Подтверждено» из «Выехал» (исправление ошибки)', 'CHECKED_OUT', 'confirmed'],
  ])('прочие статусы — НЕ факт: %s без событий заезда и выезда', async (_n, from, to) => {
    const t = make({ status: from }, DEBT);
    await save(t.svc, { status: to });
    expect(t.webhooks.emitForReservation).not.toHaveBeenCalled();
    expect(t.executed).toEqual([]);
  });
});

describe('кнопка «Выселить» — то же правило', () => {
  it('при долге — НЕ выселяет', async () => {
    const t = make({ status: 'CHECKED_IN' }, DEBT);
    await expect(asOwner(() => t.svc.checkOut('r1', 'u1'))).rejects.toThrow(/outstanding balance/);
    expect(t.wrote()).toBe(false);
    expect(t.webhooks.emitForReservation).not.toHaveBeenCalled();
  });

  it('с закрытым счётом — guest.checked_out, номер в уборку', async () => {
    const t = make({ status: 'CHECKED_IN' }, PAID);
    await expect(asOwner(() => t.svc.checkOut('r1', 'u1'))).resolves.toMatchObject({
      status: 'CHECKED_OUT',
      version: 2,
    });
    expect(t.events()).toEqual(['guest.checked_out']);
    expect(t.executed.some((s) => s.includes(`'DIRTY'`))).toBe(true);
    expect(t.audit).toEqual([expect.objectContaining({ action: 'check_out', userId: 'u1' })]);
  });
});
