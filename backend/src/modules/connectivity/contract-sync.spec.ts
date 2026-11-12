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

function build() {
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
      findMany: jest.fn(async () => []),
      deleteMany: jest.fn(async () => ({ count: 0 })),
      create: jest.fn(async () => ({})),
      update: jest.fn(async () => ({})),
    },
  };
  const prisma = {
    admin: {
      tenant: {
        findUnique: jest.fn(async () => ({ id: 't1', isActive: true, slug: 'hotel' })),
      },
      $transaction: jest.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
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
  );
  return { service, tx, created };
}

describe('syncContractPrices — реестр договоров в зеркале', () => {
  it('leaves the registry alone when contracts field is absent', async () => {
    const { service, tx } = build();
    /* Старая Авиа: поля нет. Реестр, который уже лежит в ПМС, не трогаем —
       иначе первый же sync старой версией стёр бы его целиком. */
    const res = await service.syncContractPrices('hotel', [], 'p1');
    expect(tx.partnerContract.deleteMany).not.toHaveBeenCalled();
    expect(tx.partnerContract.createMany).not.toHaveBeenCalled();
    expect(res.contracts).toBeNull();
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
