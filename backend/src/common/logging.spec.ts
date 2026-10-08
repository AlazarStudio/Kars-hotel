import { createServer, request, type Server } from 'node:http';
import { Writable } from 'node:stream';
import pinoHttp from 'pino-http';
import { maskUrl, pinoHttpOptions } from './logging';

/* 152-ФЗ, Р-51; план 13.6: в бою в журнал не попадают ни заголовки-ключи,
 * ни токен в адресе. Проверка — настоящим pino-http на настоящем запросе. */

const SECRETS = ['SESSIONTOKEN', 'COOKIESECRET', 'PARTNERKEY', 'HOTELKEY', 'HOOKSECRET', 'INVITETOKEN', 'SSOCODE'];

async function logOf(path: string): Promise<string> {
  let out = '';
  const sink = new Writable({
    write(chunk, _enc, cb) {
      out += chunk.toString();
      cb();
    },
  });
  const opts = pinoHttpOptions({ NODE_ENV: 'production' } as NodeJS.ProcessEnv) as object;
  const log = pinoHttp(opts, sink);
  const server: Server = createServer((req, res) => {
    log(req, res);
    res.setHeader('Set-Cookie', 'refresh=COOKIESECRET');
    res.end('ok');
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => {
    const rq = request(
      {
        port,
        path,
        headers: {
          Authorization: 'Bearer SESSIONTOKEN',
          Cookie: 'refresh=COOKIESECRET',
          'X-Api-Key': 'PARTNERKEY',
          'X-Hotel-Key': 'HOTELKEY',
          'X-Webhook-Secret': 'HOOKSECRET',
        },
      },
      (res) => {
        res.resume();
        res.on('end', resolve);
      },
    );
    rq.end();
  });
  await new Promise<void>((r) => server.close(() => r()));
  await new Promise((r) => setTimeout(r, 20));
  return out;
}

describe('журнал запросов', () => {
  it('ни одного ключа и токена — ни в заголовках, ни в адресе', async () => {
    const a = await logOf('/api/auth/invite/INVITETOKEN/accept');
    const b = await logOf('/sso?code=SSOCODE&x=1');
    const all = a + b;
    expect(all).toContain('request completed');
    expect(SECRETS.filter((s) => all.includes(s))).toEqual([]);
    expect(all).toContain('/api/auth/invite/***/accept');
    expect(all).toContain('[скрыто]');
  });

  it('обычный адрес читается как есть', () => {
    expect(maskUrl('/api/connect/v1/hotels/kavkaz')).toBe('/api/connect/v1/hotels/kavkaz');
    expect(maskUrl('/invite/abc?x=1')).toBe('/invite/***?x=1');
  });
});
