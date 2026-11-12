import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { mergeContractList } from './contract-list';
import {
  ContractPriceDoc,
  FillGrid,
  contractHasPriceOn,
  contractNightRub,
  contractVatRate,
} from './contract-price';
import { PlanSliceSource, SliceResolution, sliceFromPlan } from './slice';

/** Запись справочника партнёра в объёме среза: код и признак «действует». */
export interface DirectoryEntry {
  code: string;
  isActive: boolean;
}

/** Справочник партнёра по id: юрлица и авиакомпании. */
export interface PartnerDirectory {
  accounts: Map<string, DirectoryEntry>;
  customers: Map<string, DirectoryEntry>;
}

/* То, что нужно от базы этому сервису: и внутри транзакции вызывающего, и в
   своей. Вложенная транзакция Prisma — второй BEGIN на соединении, и он
   виснет, поэтому `run` не открывает новую, когда её уже открыли. */
type Db = Pick<
  PrismaService,
  'partnerContract' | 'partnerContractPrice' | 'partnerAccount' | 'partnerCustomer'
>;

/** Код записи справочника, только если она действует; иначе кода нет. */
function activeCode(entries: Map<string, DirectoryEntry> | undefined, id: string): string | null {
  const entry = entries?.get(id);
  return entry?.isActive ? entry.code : null;
}

@Injectable()
export class ContractsService {
  constructor(private readonly prisma: PrismaService) {}

  private run<T>(tx: Prisma.TransactionClient | undefined, fn: (db: Db) => Promise<T>): Promise<T> {
    return tx ? fn(tx as unknown as Db) : this.prisma.forTenant((t) => fn(t as unknown as Db));
  }

  /** Договоры партнёров у гостиницы: реестр и приложения в одном списке. */
  async list() {
    const [registry, docs] = await this.prisma.forTenant((tx) =>
      Promise.all([
        tx.partnerContract.findMany(),
        tx.partnerContractPrice.findMany({
          select: {
            partnerId: true,
            contractNumber: true,
            accountCode: true,
            accountName: true,
            service: true,
            receivedAt: true,
          },
        }),
      ]),
    );
    return mergeContractList(registry, docs);
  }

  /** Документы партнёра в объёме правила цены (сетки, сроки, НДС, юрлицо). */
  async docsFor(partnerId: string, tx?: Prisma.TransactionClient): Promise<ContractPriceDoc[]> {
    const rows = await this.run(tx, (db) =>
      db.partnerContractPrice.findMany({
        where: { partnerId },
        select: {
          partnerId: true,
          contractNumber: true,
          amendmentNumber: true,
          service: true,
          validFrom: true,
          validTo: true,
          vatRate: true,
          accountCode: true,
          fill: true,
        },
      }),
    );
    return rows.map((r) => ({
      partnerId: r.partnerId,
      contractNumber: r.contractNumber,
      amendmentNumber: r.amendmentNumber,
      service: r.service,
      validFrom: r.validFrom.toISOString(),
      validTo: r.validTo?.toISOString() ?? null,
      vatRate: r.vatRate == null ? null : Number(r.vatRate),
      accountCode: r.accountCode,
      fill: (r.fill as unknown as FillGrid[] | null) ?? null,
    }));
  }

  /** Справочник партнёра — двумя выборками в одной транзакции, а не по записи
   *  на тариф: у гостиницы десятки тарифов, и каждая пара findUnique шла своей
   *  транзакцией. Выключенные записи берём тоже — их отсутствие в наборе и
   *  есть ответ «записи нет» (см. sliceOf). */
  private async loadDirectory(
    partnerId: string,
    tx?: Prisma.TransactionClient,
  ): Promise<PartnerDirectory> {
    const [accounts, customers] = await this.run(tx, (db) =>
      Promise.all([
        db.partnerAccount.findMany({
          where: { partnerId },
          select: { id: true, code: true, isActive: true },
        }),
        db.partnerCustomer.findMany({
          where: { partnerId },
          select: { id: true, code: true, isActive: true },
        }),
      ]),
    );
    return {
      accounts: new Map(accounts.map((r) => [r.id, { code: r.code, isActive: r.isActive }])),
      customers: new Map(customers.map((r) => [r.id, { code: r.code, isActive: r.isActive }])),
    };
  }

  /** Срез тарифа: условия ПМС → коды справочника партнёра.
   *
   * Справочник — не только источник кодов: он же говорит, жива ли запись.
   * Тариф с выключенной авиакомпанией при сохранении отвергается
   * (rate-plans.service), значит и цену по нему считать нечем. Пустой код
   * молча означал бы «любая», то есть чужую цену, поэтому запись берём только
   * действующую, а отсутствие разводим по смыслу: авиакомпания — «не знаем
   * кого» (unknownCustomer), юрлицо — просто не считаем и «любым» не
   * подменяем. `dir` — уже загруженный справочник партнёра (priceStates). */
  async sliceOf(
    plan: PlanSliceSource,
    tx?: Prisma.TransactionClient,
    dir?: PartnerDirectory,
  ): Promise<SliceResolution> {
    if (!plan.partnerId || !plan.operatorContract) {
      return { slice: null, unknownCustomer: false };
    }
    const directory =
      dir ??
      (plan.partnerAccountId || plan.partnerCustomerId
        ? await this.loadDirectory(plan.partnerId, tx)
        : null);
    const accountCode = plan.partnerAccountId
      ? activeCode(directory?.accounts, plan.partnerAccountId)
      : null;
    const customerCode = plan.partnerCustomerId
      ? activeCode(directory?.customers, plan.partnerCustomerId)
      : null;
    /* Выключенное юрлицо не подменяем «любым»: цена не тому юрлицу — не цена. */
    if (plan.partnerAccountId && !accountCode) return { slice: null, unknownCustomer: false };
    return sliceFromPlan(plan, accountCode, customerCode);
  }

  /** Цена договора на ночь в рублях; null — цены нет. */
  async nightRub(
    plan: PlanSliceSource,
    roomTypeId: string,
    guests: number,
    day: string,
    tx?: Prisma.TransactionClient,
  ): Promise<string | null> {
    const { slice } = await this.sliceOf(plan, tx);
    if (!slice) return null;
    const docs = await this.docsFor(slice.partnerId, tx);
    return contractNightRub(docs, slice, roomTypeId, guests, day);
  }

  /** Состояние цен тарифов на день: есть ли цена и каков НДС договора. */
  async priceStates(
    plans: Array<PlanSliceSource & { id: string }>,
    day: string,
    tx?: Prisma.TransactionClient,
  ): Promise<Map<string, { hasPrice: boolean; unknownCustomer: boolean; vatRate: number | null }>> {
    const out = new Map<
      string,
      { hasPrice: boolean; unknownCustomer: boolean; vatRate: number | null }
    >();
    const byPartner = new Map<string, ContractPriceDoc[]>();
    const directories = new Map<string, PartnerDirectory>();
    for (const plan of plans) {
      /* Справочник читается один раз на партнёра и передаётся в sliceOf:
         иначе на каждый тариф — своя пара запросов. */
      const partnerId = plan.partnerId;
      const needsDirectory = !!partnerId && !!(plan.partnerAccountId || plan.partnerCustomerId);
      if (partnerId && needsDirectory && !directories.has(partnerId)) {
        directories.set(partnerId, await this.loadDirectory(partnerId, tx));
      }
      const dir = partnerId ? directories.get(partnerId) : undefined;
      const { slice, unknownCustomer } = await this.sliceOf(plan, tx, dir);
      if (!slice) {
        out.set(plan.id, { hasPrice: false, unknownCustomer, vatRate: null });
        continue;
      }
      if (!byPartner.has(slice.partnerId)) {
        byPartner.set(slice.partnerId, await this.docsFor(slice.partnerId, tx));
      }
      const docs = byPartner.get(slice.partnerId) as ContractPriceDoc[];
      out.set(plan.id, {
        hasPrice: contractHasPriceOn(docs, slice, day),
        unknownCustomer: false,
        vatRate: contractVatRate(docs, slice, day),
      });
    }
    return out;
  }
}
