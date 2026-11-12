import { PrismaService } from '../../common/prisma/prisma.service';
import { ContractsService } from './contracts.service';
import { PlanSliceSource } from './slice';

/* СПРАВОЧНИК ПАРТНЁРА — ТОЛЬКО ДЕЙСТВУЮЩИЕ ЗАПИСИ (11.11.2026).
 *
 * Авиакомпания и юрлицо тарифа — ссылки на справочник партнёра, а в договоре
 * они названы КОДАМИ. Код берётся из записи, и только у действующей: тариф с
 * выключенной записью при сохранении отвергается (rate-plans.service), значит
 * цены по нему быть не должно. Пустой код — это «любая авиакомпания», поэтому
 * подстановка кода выключенной записи молча считала бы тариф по чужой цене.
 *
 * Заглушка Prisma: forTenant отдаёт tx, справочник — двумя findMany на
 * партнёра. Число вызовов и есть проверка N+1: на два тарифа одного партнёра
 * справочник читается один раз, а не по разу на тариф (и не по транзакции на
 * каждую запись). */

type DirectoryRow = { id: string; partnerId: string; code: string; isActive: boolean };

const PLAN: PlanSliceSource = {
  partnerId: 'p1',
  operatorContract: '205',
  partnerAccountId: 'a1',
  partnerCustomerId: 'c1',
  guestKind: null,
  mealPlan: 'BB',
};

const active = (id: string, code: string): DirectoryRow => ({
  id,
  partnerId: 'p1',
  code,
  isActive: true,
});
const disabled = (id: string, code: string): DirectoryRow => ({
  ...active(id, code),
  isActive: false,
});

function make(stub: { accounts?: DirectoryRow[]; customers?: DirectoryRow[] } = {}) {
  const accounts = jest.fn(async ({ where }: { where: { partnerId: string } }) =>
    (stub.accounts ?? []).filter((row) => row.partnerId === where.partnerId),
  );
  const customers = jest.fn(async ({ where }: { where: { partnerId: string } }) =>
    (stub.customers ?? []).filter((row) => row.partnerId === where.partnerId),
  );
  const prices = jest.fn(async () => []);
  const tx = {
    partnerAccount: { findMany: accounts },
    partnerCustomer: { findMany: customers },
    partnerContractPrice: { findMany: prices },
  };
  const prisma = {
    forTenant: (cb: (tx: unknown) => Promise<unknown>) => cb(tx),
  } as unknown as PrismaService;
  return { service: new ContractsService(prisma), accounts, customers, prices };
}

describe('ContractsService — справочник партнёра в срезе тарифа', () => {
  it('действующая авиакомпания даёт срез её кодом', async () => {
    const { service } = make({
      accounts: [active('a1', 'ani')],
      customers: [active('c1', 'cosmos')],
    });
    await expect(service.sliceOf(PLAN)).resolves.toEqual({
      slice: {
        partnerId: 'p1',
        contractNumber: '205',
        accountCode: 'ani',
        customerCode: 'cosmos',
        guestKind: null,
        mealPlan: 'BB',
      },
      unknownCustomer: false,
    });
  });

  it('выключенная авиакомпания — не «любая»: цены нет', async () => {
    const { service } = make({
      accounts: [active('a1', 'ani')],
      customers: [disabled('c1', 'cosmos')],
    });
    await expect(service.sliceOf(PLAN)).resolves.toEqual({
      slice: null,
      unknownCustomer: true,
    });
  });

  it('авиакомпании нет в справочнике — цены нет, а тариф всё равно «неизвестный»', async () => {
    const { service } = make({ accounts: [active('a1', 'ani')], customers: [] });
    await expect(service.sliceOf(PLAN)).resolves.toEqual({
      slice: null,
      unknownCustomer: true,
    });
  });

  it('выключенное юрлицо — не «любое»: цену не считаем', async () => {
    const { service } = make({
      accounts: [disabled('a1', 'ani')],
      customers: [active('c1', 'cosmos')],
    });
    await expect(service.sliceOf(PLAN)).resolves.toEqual({
      slice: null,
      unknownCustomer: false,
    });
  });

  it('на два тарифа одного партнёра справочник читается один раз', async () => {
    const { service, accounts, customers, prices } = make({
      accounts: [active('a1', 'ani')],
      customers: [active('c1', 'cosmos'), active('c2', 'rossiya')],
    });
    const states = await service.priceStates(
      [
        { ...PLAN, id: 'plan-1' },
        { ...PLAN, id: 'plan-2', partnerCustomerId: 'c2' },
      ],
      '2026-11-20',
    );
    expect(states.get('plan-1')).toEqual({
      hasPrice: false,
      unknownCustomer: false,
      vatRate: null,
    });
    expect(states.get('plan-2')).toEqual({
      hasPrice: false,
      unknownCustomer: false,
      vatRate: null,
    });
    expect(accounts).toHaveBeenCalledTimes(1);
    expect(customers).toHaveBeenCalledTimes(1);
    expect(prices).toHaveBeenCalledTimes(1);
  });
});
