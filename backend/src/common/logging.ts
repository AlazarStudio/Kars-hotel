import type { Params } from 'nestjs-pino';

/* ЖУРНАЛ ЗАПРОСОВ БЕЗ КЛЮЧЕЙ (152-ФЗ, Р-51; план 13.6).
 *
 * В бою pino писал в журнал Docker заголовки запросов целиком: токен сессии
 * (Authorization), куку обновления, ключ партнёра, ключ гостиницы, секрет
 * вебхуков — и адреса с токеном приглашения владельца и кодом SSO. Кто читал
 * журнал, тот входил в любой кабинет.
 *
 * Теперь заголовки-ключи заменяются на «[скрыто]», а токен в адресе — на ***.
 * Новый заголовок или адрес с секретом — дописать сюда же. */

const CENSOR = '[скрыто]';

export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["x-hotel-key"]',
  'req.headers["x-webhook-secret"]',
  'req.query.token',
  'req.query.code',
  'req.params.token',
  'res.headers["set-cookie"]',
];

/** Токен в пути (`/invite/…`, `/auth/invite/…`) и в `token=`/`code=` — ***. */
export function maskUrl(url: string | undefined): string | undefined {
  return url?.replace(/(\/invite\/|[?&](?:token|code)=)[^/?&]+/g, '$1***');
}

export function pinoHttpOptions(env: NodeJS.ProcessEnv = process.env): Params['pinoHttp'] {
  return {
    level: env.LOG_LEVEL ?? 'info',
    redact: { paths: REDACT_PATHS, censor: CENSOR },
    serializers: {
      req: (req: { url?: string }) => ({ ...req, url: maskUrl(req.url) }),
    },
    transport:
      env.NODE_ENV !== 'production'
        ? {
            target: 'pino-pretty',
            options: {
              singleLine: true,
              translateTime: 'SYS:HH:MM:ss',
              ignore: 'pid,hostname,req.headers,res.headers',
            },
          }
        : undefined,
  };
}
