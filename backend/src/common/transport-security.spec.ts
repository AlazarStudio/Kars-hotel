import { assertSecureTransport, insecureTransport } from './transport-security';

/* 152-ФЗ, Р-10; план 12.1: на бою адреса наружу — только https. */
const prod = (over: Record<string, string>) => ({ NODE_ENV: 'production', ...over }) as NodeJS.ProcessEnv;

describe('assertSecureTransport', () => {
  it('свой адрес http:// на бою — не стартует', () => {
    expect(() => assertSecureTransport(prod({ PUBLIC_URL: 'http://89.1.2.3' }))).toThrow(/PUBLIC_URL/);
  });

  it('вебхуки и отчёты партнёру по http — не стартует', () => {
    expect(insecureTransport(prod({ PARTNER_WEBHOOK_URL: 'http://avia.karsavia.ru/api/hotel/webhooks', PARTNER_REPORTS_URL: 'http://10.0.0.2/api' }))).toEqual([
      'PARTNER_WEBHOOK_URL',
      'PARTNER_REPORTS_URL',
    ]);
  });

  it('голый домен, https и внутренние адреса — можно', () => {
    expect(() =>
      assertSecureTransport(prod({ PUBLIC_URL: 'pms.karsavia.ru', PARTNER_WEBHOOK_URL: 'https://api.karsavia.ru/api/hotel/webhooks', PARTNER_REPORTS_URL: 'http://core-api:3333/api' })),
    ).not.toThrow();
    expect(insecureTransport(prod({ PARTNER_WEBHOOK_URL: 'http://localhost:4000/api/hotel/webhooks' }))).toEqual([]);
  });

  it('осознанный режим без доменов — старт с предупреждением', () => {
    const warn = jest.fn();
    expect(() => assertSecureTransport(prod({ PUBLIC_URL: 'http://89.1.2.3', ALLOW_INSECURE_HTTP: 'yes' }), warn)).not.toThrow();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('PUBLIC_URL=http://89.1.2.3'));
  });

  it('вне production не проверяется', () => {
    expect(() => assertSecureTransport({ NODE_ENV: 'development', PUBLIC_URL: 'http://89.1.2.3' } as NodeJS.ProcessEnv)).not.toThrow();
  });
});
