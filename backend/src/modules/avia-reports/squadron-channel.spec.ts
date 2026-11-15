import { BadGatewayException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { AviaReportsService } from './avia-reports.service';

describe('Squadron report channel', () => {
  const originalUrl = process.env.PARTNER_REPORTS_URL;
  const prisma = {
    admin: {
      $queryRaw: jest.fn(async () => [{ slug: 'hotel-a' }]),
      aviaReportsKey: { findUnique: jest.fn(async () => ({ key: 'hotel-key', partnerId: 'partner-a' })) },
    },
  };
  let fetchSpy: jest.SpyInstance;
  let reports: AviaReportsService;

  beforeEach(() => {
    process.env.PARTNER_REPORTS_URL = 'https://avia.example/reports';
    prisma.admin.aviaReportsKey.findUnique.mockResolvedValue({ key: 'hotel-key', partnerId: 'partner-a' });
    fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('[]', { status: 200 }));
    reports = new AviaReportsService(prisma as never);
  });
  afterEach(() => {
    if (originalUrl === undefined) delete process.env.PARTNER_REPORTS_URL;
    else process.env.PARTNER_REPORTS_URL = originalUrl;
    fetchSpy.mockRestore();
  });

  it('sends match through the current hotel slug and key', async () => {
    expect(typeof (reports as any).squadronMatch).toBe('function');
    await (reports as any).squadronMatch('tenant-a', ['11111111-1111-4111-8111-111111111111']);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://avia.example/reports/squadron/match?hotelId=hotel-a');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json', 'X-Hotel-Key': 'hotel-key' });
    expect(init.redirect).toBe('error');
    expect(JSON.parse(init.body as string)).toEqual({ reservationIds: ['11111111-1111-4111-8111-111111111111'] });
  });

  it('preserves conflict, but hides invalid credentials and network failures', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('{"message":"Обновите отчёт"}', { status: 409 }));
    await expect((reports as any).squadronList('tenant-a')).rejects.toBeInstanceOf(ConflictException);
    fetchSpy.mockResolvedValueOnce(new Response('secret details', { status: 401 }));
    await expect((reports as any).squadronList('tenant-a')).rejects.toBeInstanceOf(ServiceUnavailableException);
    fetchSpy.mockRejectedValueOnce(new Error('connection details'));
    await expect((reports as any).squadronList('tenant-a')).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('requires a configured partner before reading reservations', async () => {
    prisma.admin.aviaReportsKey.findUnique.mockResolvedValueOnce({ key: 'hotel-key', partnerId: null } as never);
    await expect((reports as any).squadronPartnerId('tenant-a')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
