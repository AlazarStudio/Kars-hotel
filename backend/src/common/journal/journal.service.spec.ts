import { JournalService } from './journal.service';

describe('журнал действий PMS: чтение', () => {
  it('скрывает ключ в исторической строке, сохраняя обычные технические ключи', async () => {
    const rows = [
      {
        id: 'historical',
        at: new Date('2026-11-15T10:00:00.000Z'),
        userId: null,
        tenantId: null,
        path: '/API/connect/v1/hotels/imperiya/reports-key/',
        body: { key: 'fixture-report-key', details: [{ KEY: 'fixture-nested-key' }] },
        query: { key: 'fixture-query-key' },
      },
      {
        id: 'normal',
        at: new Date('2026-11-15T09:00:00.000Z'),
        userId: null,
        tenantId: null,
        path: '/api/technical',
        body: { key: 'technical-key' },
        query: null,
      },
    ];
    const findMany = jest.fn().mockResolvedValue(rows);
    const service = new JournalService({ admin: { actionJournal: { findMany } } } as never);

    const result = await service.list({});

    expect(result.items[0]).toMatchObject({
      body: { key: '***', details: [{ KEY: '***' }] },
      query: { key: '***' },
    });
    expect(result.items[1].body).toEqual({ key: 'technical-key' });
    expect(rows[0].body.key).toBe('fixture-report-key');
    expect(rows[0].query?.key).toBe('fixture-query-key');
  });

  it('не ищет значение ключа в теле и параметрах запроса', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new JournalService({ admin: { actionJournal: { findMany } } } as never);

    await service.list({ q: 'fixture-report-key' });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              OR: [
                { label: { contains: 'fixture-report-key', mode: 'insensitive' } },
                { path: { contains: 'fixture-report-key', mode: 'insensitive' } },
                { page: { contains: 'fixture-report-key', mode: 'insensitive' } },
                { email: { contains: 'fixture-report-key', mode: 'insensitive' } },
                { error: { contains: 'fixture-report-key', mode: 'insensitive' } },
              ],
            },
          ],
        },
      }),
    );
  });
});
