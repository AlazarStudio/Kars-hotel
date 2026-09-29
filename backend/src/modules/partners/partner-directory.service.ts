import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  ConnectPartnerDirectoryDto,
  PartnerAccountDto,
  PartnerCustomerDto,
} from '../connectivity/dto/connect-partner-directory.dto';

/** Сверка присланного набора с имеющимся: что завести, обновить, выключить. */
export function planDirectorySync<T extends { code: string }>(
  existing: { code: string; isActive: boolean }[],
  incoming: T[],
): { upsert: T[]; deactivate: string[] } {
  const seen = new Set<string>();
  for (const row of incoming) {
    const code = row.code.trim();
    if (seen.has(code)) throw new BadRequestException(`Код «${code}» в наборе дважды`);
    seen.add(code);
  }
  return {
    upsert: incoming.map((r) => ({ ...r, code: r.code.trim() })),
    deactivate: existing.filter((e) => e.isActive && !seen.has(e.code)).map((e) => e.code),
  };
}

/**
 * Справочник партнёра: его юрлица («счета») и заказчики (авиакомпании).
 *
 * Партнёр ведёт его сам и присылает целиком; гостиница по нему выбирает, для
 * кого её корпоративный тариф. Записи не удаляются, а выключаются: на них
 * ссылаются тарифы, и исчезнувшее юрлицо не должно молча превратить тариф
 * «для Карс Авиа» в тариф «для любого».
 */
@Injectable()
export class PartnerDirectoryService {
  constructor(private readonly prisma: PrismaService) {}

  async sync(partnerId: string, dto: ConnectPartnerDirectoryDto) {
    const [accounts, customers] = await Promise.all([
      this.prisma.admin.partnerAccount.findMany({ where: { partnerId } }),
      this.prisma.admin.partnerCustomer.findMany({ where: { partnerId } }),
    ]);
    const acc = planDirectorySync<PartnerAccountDto>(accounts, dto.accounts);
    const cus = planDirectorySync<PartnerCustomerDto>(customers, dto.customers);

    await this.prisma.admin.$transaction([
      ...acc.upsert.map((a) =>
        this.prisma.admin.partnerAccount.upsert({
          where: { partnerId_code: { partnerId, code: a.code } },
          create: { partnerId, code: a.code, name: a.name.trim(), inn: a.inn ?? null },
          update: { name: a.name.trim(), inn: a.inn ?? null, isActive: true },
        }),
      ),
      this.prisma.admin.partnerAccount.updateMany({
        where: { partnerId, code: { in: acc.deactivate } },
        data: { isActive: false },
      }),
      ...cus.upsert.map((c) =>
        this.prisma.admin.partnerCustomer.upsert({
          where: { partnerId_code: { partnerId, code: c.code } },
          create: { partnerId, code: c.code, name: c.name.trim() },
          update: { name: c.name.trim(), isActive: true },
        }),
      ),
      this.prisma.admin.partnerCustomer.updateMany({
        where: { partnerId, code: { in: cus.deactivate } },
        data: { isActive: false },
      }),
    ]);
    return {
      accounts: { active: acc.upsert.length, deactivated: acc.deactivate.length },
      customers: { active: cus.upsert.length, deactivated: cus.deactivate.length },
    };
  }

  /** Справочник одного партнёра — как его видит сам партнёр. */
  get(partnerId: string) {
    return this.prisma.admin.partner.findUnique({
      where: { id: partnerId },
      select: {
        code: true,
        name: true,
        accounts: {
          where: { isActive: true },
          orderBy: { name: 'asc' },
          select: { code: true, name: true, inn: true },
        },
        customers: {
          where: { isActive: true },
          orderBy: { name: 'asc' },
          select: { code: true, name: true },
        },
      },
    });
  }

  /** Все действующие партнёры со справочниками — выбор в форме тарифа. */
  listActive() {
    return this.prisma.admin.partner.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        code: true,
        name: true,
        accounts: {
          where: { isActive: true },
          orderBy: { name: 'asc' },
          select: { id: true, code: true, name: true, inn: true },
        },
        customers: {
          where: { isActive: true },
          orderBy: { name: 'asc' },
          select: { id: true, code: true, name: true },
        },
      },
    });
  }
}
