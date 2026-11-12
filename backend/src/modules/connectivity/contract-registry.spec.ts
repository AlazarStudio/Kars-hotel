import { BadRequestException } from '@nestjs/common';
import { contractRows } from './contract-registry';

/* Реестр договоров: что гостиница увидит и что отклонится.
 *
 * Договор без приложения — обычное дело (у «Апартаментов» 27 таких), поэтому
 * проверяется не «отправилось», а как список лёг в строки: номера уникальны,
 * сроки и юрлицо — снимком, пустой номер — ошибка, а не тихая строка. */

const ONE = {
  number: '205',
  account: { code: 'ani', name: 'Ани Групп Аэро' },
  signedAt: '2025-11-10T00:00:00.000Z',
  expiresAt: null,
  isPrimary: true,
  state: 'ACTIVE' as const,
  services: ['ACCOMMODATION' as const],
  sheets: 1,
};

describe('contractRows — присланный реестр в строки таблицы', () => {
  it('снимает номер и юрлицо, сроки переводит в даты', () => {
    const [row] = contractRows([ONE], 't1', 'p1');
    expect(row).toMatchObject({
      tenantId: 't1',
      partnerId: 'p1',
      number: '205',
      accountCode: 'ani',
      accountName: 'Ани Групп Аэро',
      isPrimary: true,
      state: 'ACTIVE',
      services: ['ACCOMMODATION'],
      sheetsCount: 1,
    });
    expect(row.validFrom).toEqual(new Date('2025-11-10T00:00:00.000Z'));
    expect(row.validTo).toBeNull();
  });

  it('договор без цен — законная строка', () => {
    const [row] = contractRows([{ ...ONE, sheets: 0, services: [] }], 't1', 'p1');
    expect(row.sheetsCount).toBe(0);
    expect(row.services).toEqual([]);
  });

  it('пустой номер — отказ, а не строка без имени', () => {
    expect(() => contractRows([{ ...ONE, number: '  ' }], 't1', 'p1')).toThrow(BadRequestException);
  });

  it('один номер дважды — отказ: ключ таблицы уникален', () => {
    expect(() => contractRows([ONE, ONE], 't1', 'p1')).toThrow(BadRequestException);
  });

  it('пустой набор — пустой результат, а не отказ', () => {
    expect(contractRows([], 't1', 'p1')).toEqual([]);
  });
});
