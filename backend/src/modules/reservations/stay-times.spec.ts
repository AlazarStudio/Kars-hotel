import { TenantContext } from '../../common/context/tenant-context';
import { ReservationsService } from './reservations.service';

/* Время прилёта и отъезда и рейс брони партнёра (24.10.2026, правка заказчика
 * Kars Avia: «в бронях видна дата, но не видно время прибытия»). Ведёт их
 * партнёр: присланное — пишется, не присланное — остаётся, `null` — стирает.
 * Отрицанием: правка из кабинета гостиницы время НЕ трогает, даже если поле
 * пролезло в тело запроса. */

const CUR = {
  id: 'r1', room_id: 'room', room_type_id: 'rt', check_in: new Date('2026-10-21'), check_out: new Date('2026-10-24'),
  version: 1, guest_name: 'Морозова И.В.', phone: null, email: null, adults: 1, children: 0, status: 'CONFIRMED',
  source: 'CORPORATE', notes: null, total_price: null, rate_plan_id: null, place_number: 1, channel_managed: true,
  arrival_at: '2026-10-21T03:30', departure_at: '2026-10-24T10:40', flight: 'S7 178',
};

type Call = { sql: string; strings: string[]; values: unknown[] };

function make() {
  const svc = Object.create(ReservationsService.prototype) as ReservationsService;
  const calls: Call[] = [];
  const audit: { diff: { before: Record<string, unknown>; after: Record<string, unknown> } }[] = [];
  const tx = {
    $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.join('?');
      calls.push({ sql, strings: [...strings], values });
      if (sql.includes('UPDATE reservation SET')) return [{ id: 'r1', version: 2, status: 'CONFIRMED' }];
      if (sql.includes('INSERT INTO reservation')) return [{ id: 'r1', status: 'CONFIRMED', version: 1, place_number: 1 }];
      if (sql.includes('FROM room r')) return [{ id: 'room', room_type_id: 'rt', capacity: 2, multi_place: false }];
      return [CUR];
    }),
  };
  Object.assign(svc, {
    logger: { log: jest.fn(), warn: jest.fn() },
    prisma: {
      forTenant: async (cb: (t: typeof tx) => unknown) => cb(tx),
      writeAuditLog: async (e: (typeof audit)[number]) => {
        audit.push(e);
      },
    },
    timelineService: { invalidate: async () => undefined },
    timelineGateway: { notifyUpdate: () => undefined },
    partnerWebhooks: { emitReservationChanged: async () => undefined },
    overlapping: async () => [],
  });
  return { svc, calls, audit };
}

/** Что UPDATE присвоил колонкам: «колонка = ${значение}». */
function assigned(calls: Call[]): Record<string, unknown> {
  const call = calls.find((c) => c.sql.includes('UPDATE reservation SET'));
  const out: Record<string, unknown> = {};
  call?.strings.slice(0, -1).forEach((s, i) => {
    const m = /(\w+)\s*=\s*$/.exec(s);
    if (m) out[m[1]] = call.values[i];
  });
  return out;
}

const asOwner = <T>(fn: () => Promise<T>) =>
  TenantContext.run(
    { tenantId: 't1', userId: 'u1', roleCode: 'OWNER', permissions: [], isSuperAdmin: false } as never,
    fn,
  );

describe('время брони партнёра в PMS', () => {
  it('партнёр прислал новый прилёт — пишется; не присланное остаётся', async () => {
    const { svc, calls } = make();
    await asOwner(() => svc.update('r1', { version: 1 } as never, { fromChannel: true, stay: { arrivalAt: '2026-10-21T05:30' } }));
    expect(assigned(calls)).toMatchObject({
      arrival_at: '2026-10-21T05:30',
      departure_at: '2026-10-24T10:40',
      flight: 'S7 178',
    });
  });

  it('null — стирает', async () => {
    const { svc, calls } = make();
    await asOwner(() => svc.update('r1', { version: 1 } as never, { fromChannel: true, stay: { flight: null } }));
    expect(assigned(calls)).toMatchObject({ flight: null, arrival_at: '2026-10-21T03:30' });
  });

  it('кабинет гостиницы время НЕ трогает, даже если поле пролезло в тело', async () => {
    const { svc, calls } = make();
    await asOwner(() => svc.update('r1', { version: 1, arrivalAt: '2026-10-21T09:00', flight: 'XX 1' } as never));
    expect(assigned(calls)).toMatchObject({ arrival_at: '2026-10-21T03:30', flight: 'S7 178' });
  });

  it('журнал правки называет, как сдвинулся прилёт', async () => {
    const { svc, audit } = make();
    await asOwner(() => svc.update('r1', { version: 1 } as never, { fromChannel: true, stay: { arrivalAt: '2026-10-21T05:30' } }));
    expect(audit[0].diff.before).toMatchObject({ arrivalAt: '2026-10-21T03:30' });
    expect(audit[0].diff.after).toMatchObject({ arrivalAt: '2026-10-21T05:30' });
    expect(audit[0].diff.before).not.toHaveProperty('flight');
  });

  it('новая бронь партнёра — время и рейс записываются', async () => {
    const { svc, calls } = make();
    await asOwner(() =>
      svc.create(
        { roomId: 'room', guestName: 'Гость', checkIn: '2026-10-21', checkOut: '2026-10-24', adults: 1 } as never,
        { arrivalAt: '2026-10-22T02:00', flight: 'S7 178' },
      ),
    );
    const insert = calls.find((c) => c.sql.includes('INSERT INTO reservation'));
    expect(insert?.sql).toMatch(/arrival_at, departure_at, flight/);
    expect(insert?.values).toEqual(expect.arrayContaining(['2026-10-22T02:00', 'S7 178']));
  });

  it('своя бронь гостиницы — времени нет, пишется пусто, а не «undefined»', async () => {
    const { svc, calls } = make();
    await asOwner(() =>
      svc.create({ roomId: 'room', guestName: 'Гость', checkIn: '2026-10-21', checkOut: '2026-10-24', adults: 1 } as never),
    );
    const insert = calls.find((c) => c.sql.includes('INSERT INTO reservation'));
    expect(insert?.values).not.toContain(undefined);
  });
});
