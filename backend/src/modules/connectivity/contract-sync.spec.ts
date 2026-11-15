import { ConnectContractSummaryDto } from './dto/connect-contract-prices.dto';
import { ConnectivityService } from './connectivity.service';

/* СИНХРОНИЗАЦИЯ РЕЕСТРА ДОГОВОРОВ (11.11.2026).
 *
 * Поле `contracts` необязательное: старая Авиа его не присылает вовсе, а
 * `@IsOptional()` в DTO пропускает null — тело `contracts: null` доходит до
 * сервиса как есть. Оба случая обязаны оставить реестр гостиницы нетронутым:
 * `.map` по null бросает TypeError, и транзакция откатывается вместе с
 * ценами — падает вся синхронизация, а не один реестр.
 *
 * Заглушки — только то, что путь действительно вызывает: resolveTenant идёт в
 * admin.tenant.findUnique, дальше admin.$transaction, внутри — цены
 * (partnerContractPrice) и реестр (partnerContract). */

type Row = Record<string, unknown>;

const ONE: ConnectContractSummaryDto = {
  number: '205',
  isPrimary: true,
  state: 'ACTIVE',
  services: ['ACCOMMODATION'],
  sheets: 1,
};

function build(
  opts: {
    keys?: jest.Mock;
    existing?: Array<{
      id: string;
      contractNumber: string;
      amendmentNumber: string | null;
      service: string;
      validFrom: Date;
    }>;
  } = {},
) {
  const created: { data: Row[] }[] = [];
  const tx = {
    partnerContract: {
      deleteMany: jest.fn(async () => ({ count: 0 })),
      createMany: jest.fn(async (args: { data: Row[] }) => {
        created.push(args);
        return { count: args.data.length };
      }),
    },
    partnerContractPrice: {
      findMany: jest.fn(async () => opts.existing ?? []),
      findFirst: jest.fn(
        async ({ where }: { where: { contractNumber: string } }) =>
          opts.existing?.find((r) => r.contractNumber === where.contractNumber) ?? null,
      ),
      deleteMany: jest.fn(async () => ({ count: 0 })),
      create: jest.fn(async () => ({})),
      update: jest.fn(async () => ({})),
    },
  };
  const prisma = {
    admin: {
      partnerContractPrice: tx.partnerContractPrice,
      tenant: {
        findUnique: jest.fn(async () => ({ id: 't1', isActive: true, slug: 'hotel' })),
      },
      $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    },
  };
  /* Сброс кэша цен после синхронизации: dropPriceCache спрашивает ключи и
     удаляет их. Отдаём реалистичный ключ витрины, чтобы проверить обе ветки,
     а не только вход. */
  const redis = {
    raw: {
      keys: opts.keys ?? jest.fn(async () => ['avail:t1:rt:in:out:plans:g2']),
      del: jest.fn(async () => 1),
    },
  };
  const service = new ConnectivityService(
    {} as never,
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    redis as never,
  );
  return { service, tx, created, redis };
}

describe('syncContractPrices — реестр договоров в зеркале', () => {
  it('normalizes legacy identity on single-document ingestion too', async () => {
    const { service, tx } = build({
      existing: [
        {
          id: 'legacy',
          contractNumber: '205 ',
          amendmentNumber: null,
          service: 'ACCOMMODATION',
          validFrom: new Date('2026-01-01'),
        },
      ],
    });
    await service.putContractPrices(
      'hotel',
      { contractNumber: '205', service: 'ACCOMMODATION', validFrom: '2026-01-01', rows: [] },
      'p1',
    );
    expect(tx.partnerContractPrice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'legacy' },
        data: expect.objectContaining({ tenantId: 't1', partnerId: 'p1', contractNumber: '205' }),
      }),
    );
    expect(tx.partnerContractPrice.create).not.toHaveBeenCalled();
  });

  it('updates a legacy document after normalizing its number instead of creating a duplicate', async () => {
    const { service, tx } = build({
      existing: [
        {
          id: 'legacy',
          contractNumber: '205 ',
          amendmentNumber: null,
          service: 'ACCOMMODATION',
          validFrom: new Date('2026-01-01'),
        },
      ],
    });
    await service.syncContractPrices(
      'hotel',
      [{ contractNumber: '205', service: 'ACCOMMODATION', validFrom: '2026-01-01', rows: [] }],
      'p1',
    );
    expect(tx.partnerContractPrice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'legacy' },
        data: expect.objectContaining({ contractNumber: '205' }),
      }),
    );
    expect(tx.partnerContractPrice.create).not.toHaveBeenCalled();
  });

  it('removes an old whitespace duplicate before updating the canonical document', async () => {
    const base = {
      amendmentNumber: null,
      service: 'ACCOMMODATION',
      validFrom: new Date('2026-01-01'),
    };
    const { service, tx } = build({
      existing: [
        { ...base, id: 'canonical', contractNumber: '205' },
        { ...base, id: 'legacy', contractNumber: ' 205 ' },
      ],
    });
    await service.syncContractPrices(
      'hotel',
      [{ contractNumber: '205', service: 'ACCOMMODATION', validFrom: '2026-01-01', rows: [] }],
      'p1',
    );
    expect(tx.partnerContractPrice.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['legacy'] } },
    });
    expect(tx.partnerContractPrice.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'canonical' } }),
    );
  });

  it('rejects ambiguous duplicate document keys after normalization before changing any rows', async () => {
    const { service, tx } = build();
    const doc = {
      contractNumber: '205',
      service: 'ACCOMMODATION' as const,
      validFrom: '2026-01-01',
      rows: [],
    };
    await expect(
      service.syncContractPrices('hotel', [doc, { ...doc, contractNumber: '205 ' }], 'p1'),
    ).rejects.toThrow('дважды');
    expect(tx.partnerContractPrice.deleteMany).not.toHaveBeenCalled();
    expect(tx.partnerContractPrice.create).not.toHaveBeenCalled();
  });

  it('stores the same normalized number for registry and price documents', async () => {
    const { service, tx } = build();
    await service.syncContractPrices(
      'hotel',
      [{ contractNumber: ' 205 ', service: 'ACCOMMODATION', validFrom: '2026-01-01', rows: [] }],
      'p1',
      [{ ...ONE, number: ' 205 ' }],
    );
    expect(tx.partnerContractPrice.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ contractNumber: '205' }) }),
    );
    expect(tx.partnerContract.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ number: '205' })],
    });
  });

  it('leaves the registry alone when contracts field is absent', async () => {
    const { service, tx } = build();
    /* Старая Авиа: поля нет. Реестр, который уже лежит в ПМС, не трогаем —
       иначе первый же sync старой версией стёр бы его целиком. */
    const res = await service.syncContractPrices('hotel', [], 'p1');
    expect(tx.partnerContract.deleteMany).not.toHaveBeenCalled();
    expect(tx.partnerContract.createMany).not.toHaveBeenCalled();
    expect(res.contracts).toBeNull();
  });

  /* Цена ночи живёт в кэше витрины минуту; после синхронизации договора она
     обязана умереть — иначе гостиница и оператор минуту видят старую цену.
     Сбрасываем в любом наборе, и без поля contracts: сетки цен перезаписываются
     всегда. */
  it('drops the price cache after every sync', async () => {
    const { service, redis } = build();
    await service.syncContractPrices('hotel', [], 'p1');
    expect(redis.raw.keys).toHaveBeenCalledWith('avail:t1:*:plans:*');
    expect(redis.raw.del).toHaveBeenCalledWith('avail:t1:rt:in:out:plans:g2');
  });

  /* Строки уже закоммичены; сбой Redis после COMMIT не должен превращать
     успешную синхронизацию в 500, иначе Авиа запишет «зеркало не
     синхронизировано» для уже применённой записи. */
  it('resolves the committed result when the price cache is down', async () => {
    const keysDown = jest.fn(async () => {
      throw new Error('redis down');
    });
    const { service, tx } = build({ keys: keysDown });
    await expect(service.syncContractPrices('hotel', [], 'p1')).resolves.toEqual({
      kept: 0,
      removed: 0,
      contracts: null,
    });
    expect(tx.partnerContractPrice.findMany).toHaveBeenCalled();
  });

  it('clears the registry on an empty set', async () => {
    const { service, tx } = build();
    /* Пустой набор законен и означает ровно то, что означает: действующих
       договоров нет. Строки стираются — так и задумано. */
    const res = await service.syncContractPrices('hotel', [], 'p1', []);
    expect(tx.partnerContract.deleteMany).toHaveBeenCalledTimes(1);
    expect(tx.partnerContract.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: 't1', partnerId: 'p1' },
    });
    expect(tx.partnerContract.createMany).not.toHaveBeenCalled();
    expect(res.contracts).toBe(0);
  });

  it('writes one sent contract as a mirror row', async () => {
    const { service, tx, created } = build();
    await service.syncContractPrices('hotel', [], 'p1', [ONE]);
    expect(tx.partnerContract.deleteMany).toHaveBeenCalledTimes(1);
    expect(tx.partnerContract.createMany).toHaveBeenCalledTimes(1);
    expect(created[0].data).toHaveLength(1);
    /* Строка собирается кодом, а не клиентом: номер обрезан, число приложений
       под своим именем, время снимка — Date, принадлежность — из запроса. */
    expect(created[0].data[0]).toMatchObject({
      number: '205',
      sheetsCount: 1,
      tenantId: 't1',
      partnerId: 'p1',
    });
    expect(created[0].data[0].receivedAt).toBeInstanceOf(Date);
  });

  it('keeps the registry when contracts is null', async () => {
    const { service, tx } = build();
    /* Битый клиент: @IsOptional() пропускает null. Это и есть защита от 500 —
       раньше здесь падал `input.map` и откатывал транзакцию с ценами. */
    const broken = null as unknown as ConnectContractSummaryDto[];
    const res = await service.syncContractPrices('hotel', [], 'p1', broken);
    expect(tx.partnerContract.deleteMany).not.toHaveBeenCalled();
    expect(tx.partnerContract.createMany).not.toHaveBeenCalled();
    expect(res.contracts).toBeNull();
  });
});
