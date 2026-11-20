import { ServiceUnavailableException } from '@nestjs/common';
import { DomainsController, karsOrigins } from './domains.controller';

const MAIN = 'https://hotel.karsavia.ru';
const RESERVE = 'https://hotel.karsavia-reserve.ru';

function res() {
  const headers: Record<string, string> = {};
  return { headers, setHeader: (k: string, v: string) => void (headers[k] = v) };
}

describe('адреса PMS по приоритету', () => {
  it('порядок из env, только origin, без мусора и повторов', () => {
    expect(karsOrigins({ KARS_ORIGINS: ` ${MAIN}/x , мусор, ${RESERVE},${MAIN},ftp://a.b` })).toEqual([MAIN, RESERVE]);
    expect(karsOrigins({})).toEqual([]);
  });
});

describe('GET /api/domains', () => {
  const env = process.env.KARS_ORIGINS;
  beforeEach(() => (process.env.KARS_ORIGINS = `${MAIN},${RESERVE}`));
  afterAll(() => (process.env.KARS_ORIGINS = env));

  const ctl = (ping: () => Promise<unknown>) => new DomainsController({ ping } as never);

  it('живой: список адресов и CORS адресу из списка', async () => {
    const r = res();
    await expect(ctl(async () => 1).status({ headers: { origin: RESERVE } } as never, r as never)).resolves.toEqual({
      ok: true,
      origins: [MAIN, RESERVE],
    });
    expect(r.headers['Access-Control-Allow-Origin']).toBe(RESERVE);
  });

  it('чужой адрес НЕ получает CORS', async () => {
    const r = res();
    await ctl(async () => 1).status({ headers: { origin: 'https://evil.ru' } } as never, r as never);
    expect(r.headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('база лежит — 503, а не «жив»', async () => {
    await expect(
      ctl(async () => {
        throw new Error('down');
      }).status({ headers: {} } as never, res() as never),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
