import { ServiceUnavailableException } from '@nestjs/common';
import { AviaReportsService } from './avia-reports.service';

/* 152-ФЗ, Р-44; план 11.3. Отчёты Kars Avia гостиница забирает СВОИМ ключом:
 * ключ берётся из её арендатора, а общий секрет вебхуков наружу не уходит. */

function service(keys: Record<string, string>) {
  const prisma = {
    admin: {
      $queryRaw: jest.fn(async () => [{ slug: 'alpha' }]),
      aviaReportsKey: {
        findUnique: jest.fn(async ({ where }: { where: { tenantId: string } }) =>
          keys[where.tenantId] ? { tenantId: where.tenantId, key: keys[where.tenantId] } : null,
        ),
      },
    },
  };
  return new AviaReportsService(prisma as never);
}

describe('AviaReportsService — ключ гостиницы', () => {
  const env = { ...process.env };
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env.PARTNER_REPORTS_URL = 'http://avia.test/api/hotel/connect/reports';
    process.env.PARTNER_WEBHOOK_SECRET = 'webhook-secret';
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]', { status: 200 }));
  });
  afterEach(() => {
    process.env = { ...env };
    fetchSpy.mockRestore();
  });

  it('предъявляет ключ своей гостиницы, а не секрет вебхуков', async () => {
    await service({ t1: 'key-of-alpha' }).list('t1');
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://avia.test/api/hotel/connect/reports?hotelId=alpha');
    expect(init.headers).toEqual({ 'X-Hotel-Key': 'key-of-alpha' });
    expect(JSON.stringify(init.headers)).not.toContain('webhook-secret');
  });

  it('ключа ещё нет — понятный отказ, запроса к Kars Avia нет', async () => {
    await expect(service({}).list('t1')).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
