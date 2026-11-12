import { BadRequestException } from '@nestjs/common';

/* РЕЕСТР ДОГОВОРОВ В СТРОКИ ТАБЛИЦЫ (11.11.2026).
 *
 * Партнёр присылает договоры набором, как и цены. Строка здесь — только
 * снимок для показа и ключ, по которому тариф находит документы; правок нет.
 * Пустой номер и повтор номера отклоняются на входе: ключ таблицы уникален, и
 * упасть на нём транзакцией позже значит не сказать, что именно не так. */
export interface ContractSummaryInput {
  number: string;
  account?: { code: string; name: string } | null;
  signedAt?: string | null;
  expiresAt?: string | null;
  isPrimary: boolean;
  state: 'ACTIVE' | 'ARCHIVED';
  services: ('ACCOMMODATION' | 'MEAL')[];
  sheets: number;
}

export interface PartnerContractRow {
  tenantId: string;
  partnerId: string;
  number: string;
  accountCode: string | null;
  accountName: string | null;
  validFrom: Date | null;
  validTo: Date | null;
  isPrimary: boolean;
  state: string;
  services: string[];
  sheetsCount: number;
  receivedAt: Date;
}

export function contractRows(
  input: ContractSummaryInput[],
  tenantId: string,
  partnerId: string,
): PartnerContractRow[] {
  const seen = new Set<string>();
  const now = new Date();
  return input.map((c) => {
    const number = c.number.trim();
    if (!number) throw new BadRequestException('Номер договора пуст');
    if (seen.has(number)) {
      throw new BadRequestException(`Договор «${number}» в наборе дважды`);
    }
    seen.add(number);
    return {
      tenantId,
      partnerId,
      number,
      accountCode: c.account?.code?.trim() || null,
      accountName: c.account?.name?.trim() || null,
      validFrom: c.signedAt ? new Date(c.signedAt) : null,
      validTo: c.expiresAt ? new Date(c.expiresAt) : null,
      isPrimary: c.isPrimary,
      state: c.state,
      services: [...new Set(c.services)],
      sheetsCount: c.sheets,
      receivedAt: now,
    };
  });
}
