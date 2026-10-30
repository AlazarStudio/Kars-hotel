import { ConflictException } from '@nestjs/common';
import { TenantContext } from '../../common/context/tenant-context';
import { ReservationsService, type ReservationChannelContext } from './reservations.service';

const DTO = {
  roomId: 'room-1',
  guestName: 'Гость',
  checkIn: '2026-11-01',
  checkOut: '2026-11-03',
  adults: 1,
};
const CHANNEL = {
  partnerId: 'p-avia',
  idempotency: { key: 'stable-key', payloadHash: 'a'.repeat(64) },
};
type Call = { sql: string; values: unknown[] };
type Row = Record<string, unknown>;

function make() {
  const rows: Row[] = [];
  const calls: Call[] = [];
  const locks = new Map<unknown, Promise<void>>();
  const audit = jest.fn(async () => undefined);
  const invalidate = jest.fn(async () => undefined);
  const notifyUpdate = jest.fn();
  const prisma = {
    forTenant: async (callback: (tx: object) => Promise<unknown>) => {
      const releases: (() => void)[] = [];
      const tx = {
        $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
          calls.push({ sql: strings.join('?'), values });
          const previous = locks.get(values[0]);
          const held = new Promise<void>((resolve) => releases.push(resolve));
          locks.set(values[0], held);
          await previous;
          return 1;
        },
        reservation: {
          findFirst: async ({ where }: { where: Record<string, unknown> }) => {
            calls.push({ sql: 'replay lookup', values: [where] });
            const row = rows.find(
              (r) =>
                r.tenant_id === where.tenantId &&
                r.partner_id === where.partnerId &&
                r.partner_idempotency_key === where.partnerIdempotencyKey &&
                r.channel_managed === where.channelManaged,
            );
            return row
              ? {
                  id: row.id,
                  status: row.status,
                  version: row.version,
                  placeNumber: row.place_number,
                  partnerPayloadHash: row.partner_payload_hash,
                }
              : null;
          },
        },
        $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
          const sql = strings.join('?');
          calls.push({ sql, values });
          if (sql.includes('FROM room r'))
            return [{ id: DTO.roomId, room_type_id: 'cat', capacity: 2, multi_place: false }];
          if (sql.includes('INSERT INTO reservation')) {
            const columns = /INSERT INTO reservation\s*\(([\s\S]*?)\)\s*VALUES/
              .exec(sql)![1]
              .split(',')
              .map((s) => s.trim());
            const expressions = /VALUES\s*\(([\s\S]*?)\)\s*RETURNING/.exec(sql)![1].split(',');
            let index = 0;
            const row: Row = { id: `r${rows.length + 1}` };
            columns.forEach((column, i) => {
              row[column] = expressions[i].includes('?')
                ? values[index++]
                : Number(expressions[i].trim());
            });
            rows.push(row);
            return [row];
          }
          if (sql.includes('FROM reservation')) {
            return rows.filter(
              (r) => r.tenant_id === TenantContext.getTenantIdOrThrow() && r.room_id === values[0],
            );
          }
          throw new Error(`Unexpected query: ${sql}`);
        },
      };
      try {
        return await callback(tx);
      } finally {
        releases.forEach((release) => release());
      }
    },
    writeAuditLog: audit,
  };
  const service = () => {
    const svc = Object.create(ReservationsService.prototype) as ReservationsService;
    Object.assign(svc, {
      prisma,
      logger: { log: jest.fn() },
      timelineService: { invalidate },
      timelineGateway: { notifyUpdate },
    });
    return svc;
  };
  return { service, rows, calls, audit, invalidate, notifyUpdate };
}

const create = (
  svc: ReservationsService,
  channel?: ReservationChannelContext,
  dto = DTO,
  tenantId = 't1',
) =>
  TenantContext.run({ tenantId, userId: '', roleCode: 'CHANNEL_MANAGER', permissions: [] }, () =>
    svc.create(dto, {}, channel),
  );

describe('durable partner reservation idempotency', () => {
  it('replays after a lost response and service restart before checking occupied places', async () => {
    const { service, rows, audit, invalidate, notifyUpdate, calls } = make();
    const first = await create(service(), CHANNEL);
    const beforeReplay = calls.length;
    expect(await create(service(), CHANNEL)).toEqual(first);
    expect(rows).toHaveLength(1);
    expect(
      calls
        .slice(beforeReplay)
        .map((c) => c.sql)
        .join(' '),
    ).not.toContain('FROM room');
    expect(audit).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(notifyUpdate).toHaveBeenCalledTimes(1);
  });

  it('serializes concurrent attempts before allocation and inserts only once', async () => {
    const { service, rows, calls, audit } = make();
    const [first, second] = await Promise.all([
      create(service(), CHANNEL),
      create(service(), CHANNEL),
    ]);
    expect(second).toEqual(first);
    expect(rows).toHaveLength(1);
    expect(calls[0].sql).toContain('pg_advisory_xact_lock');
    expect(audit).toHaveBeenCalledTimes(1);
  });

  it('records partner ownership, key and original payload hash in the same insert', async () => {
    const { service, rows } = make();
    await create(service(), CHANNEL);
    expect(rows[0]).toMatchObject({
      tenant_id: 't1',
      partner_id: 'p-avia',
      channel_managed: true,
      partner_idempotency_key: 'stable-key',
      partner_payload_hash: 'a'.repeat(64),
    });
  });

  it('rejects the same key with another original payload as 409 without allocating', async () => {
    const { service, calls, rows } = make();
    await create(service(), CHANNEL);
    const beforeReplay = calls.length;
    await expect(
      create(service(), {
        ...CHANNEL,
        idempotency: { ...CHANNEL.idempotency, payloadHash: 'b'.repeat(64) },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(rows).toHaveLength(1);
    expect(
      calls
        .slice(beforeReplay)
        .map((c) => c.sql)
        .join(' '),
    ).not.toContain('FROM room');
  });

  it('keeps the original fingerprint after a later reservation edit', async () => {
    const { service, rows } = make();
    const first = await create(service(), CHANNEL);
    rows[0].guest_name = 'Исправленный гость';
    rows[0].version = 2;
    expect(await create(service(), CHANNEL)).toEqual({ ...first, version: 2 });
    expect(rows).toHaveLength(1);
  });

  it('does not replay a reservation owned by another partner', async () => {
    const { service, rows } = make();
    await create(service(), CHANNEL);
    await expect(create(service(), { ...CHANNEL, partnerId: 'p-other' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(rows).toHaveLength(1);
    const other = await create(
      service(),
      { ...CHANNEL, partnerId: 'p-other' },
      { ...DTO, roomId: 'room-2' },
    );
    expect(other.id).toBe('r2');
  });

  it('scopes the same key to the tenant as well as the partner', async () => {
    const { service, rows } = make();
    await create(service(), CHANNEL);
    const other = await create(service(), CHANNEL, DTO, 't2');
    expect(other.id).toBe('r2');
    expect(rows).toHaveLength(2);
  });

  it('keeps channel ownership atomic for existing callers without a key', async () => {
    const { service, rows } = make();
    await create(service(), { partnerId: 'p-avia' });
    expect(rows[0]).toMatchObject({
      partner_id: 'p-avia',
      channel_managed: true,
      partner_idempotency_key: null,
      partner_payload_hash: null,
    });
  });

  it('keeps hotel-created reservations compatible without a channel context', async () => {
    const { service, rows } = make();
    await create(service());
    expect(rows[0]).toMatchObject({
      partner_id: null,
      channel_managed: false,
      partner_idempotency_key: null,
      partner_payload_hash: null,
    });
  });
});
