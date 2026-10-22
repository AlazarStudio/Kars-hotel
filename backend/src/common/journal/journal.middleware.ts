import type { NextFunction, Request, Response } from 'express';
import type { AuthenticatedRequestUser } from '../../modules/auth/strategies/jwt.strategy';
import type { VerifiedPartner } from '../../modules/connectivity/partner-key.service';
import { redactForJournal } from './journal-redact';
import type { JournalRow, JournalService } from './journal.service';

/* Каждый запрос, меняющий данные, — строкой журнала действий (23.10.2026).
 *
 * Express-middleware, а не интерсептор Nest: интерсептор не видит запросов,
 * отбитых гардом или валидацией, а именно отказы («нет права», «неверный
 * пароль», «число гостей меняет Авиа») и нужны, чтобы восстановить, что
 * человек пытался сделать. Пишется на закрытии ответа — тогда известны и
 * пользователь (его ставит гард), и итог.
 *
 * Что пишется: всё, кроме чтения. Чтение — только скачивание файла. Подбор
 * свободных номеров партнёром ходит POST-ом, но это чтение на каждый поиск
 * диспетчера — не пишется. Открытие экранов видно в следе кабинета. */

const READ = new Set(['GET', 'HEAD', 'OPTIONS']);
export const SESSION_HEADER = 'x-client-session';
export const ACTION_HEADER = 'x-client-action';
export const PAGE_HEADER = 'x-client-page';
const SELF_PATHS = ['/api/journal/ui'];
const READ_LIKE_POST = /\/connect\/v1\/.*\/availability$/;

type JournalRequest = Request & {
  user?: AuthenticatedRequestUser;
  partner?: VerifiedPartner;
  file?: { fieldname: string; originalname: string; size: number; mimetype: string };
  files?: unknown;
};

function header(req: Request, name: string, max = 64): string | undefined {
  const v = req.headers[name];
  const s = Array.isArray(v) ? v[0] : v;
  return s ? s.slice(0, max) : undefined;
}

export function shouldJournal(req: Request, res: Response): boolean {
  const path = (req.originalUrl || req.url).split('?')[0];
  if (SELF_PATHS.includes(path) || READ_LIKE_POST.test(path)) return false;
  if (READ.has(req.method)) {
    const cd = res.getHeader('content-disposition');
    return typeof cd === 'string' && /attachment/i.test(cd);
  }
  return true;
}

export function errorText(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as { message?: unknown; error?: unknown };
  if (Array.isArray(b.message)) return b.message.join('; ').slice(0, 1000);
  if (typeof b.message === 'string') return b.message.slice(0, 1000);
  if (typeof b.error === 'string') return b.error.slice(0, 1000);
  return undefined;
}

function filesOf(req: JournalRequest) {
  const list: { fieldname: string; originalname: string; size: number; mimetype: string }[] = [];
  if (req.file) list.push(req.file);
  const f = req.files;
  if (Array.isArray(f)) list.push(...f);
  else if (f && typeof f === 'object') for (const v of Object.values(f)) if (Array.isArray(v)) list.push(...v);
  return list.map((x) => ({ field: x.fieldname, name: x.originalname, size: x.size, type: x.mimetype }));
}

const hasKeys = (v: unknown) => !!v && typeof v === 'object' && Object.keys(v as object).length > 0;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function journalRowOf(req: JournalRequest, res: Response, startedAt: number, error: string | undefined): JournalRow {
  const path = (req.originalUrl || req.url).split('?')[0];
  const user = req.user;
  const body = req.body as Record<string, unknown> | undefined;
  const files = filesOf(req);
  const ua = req.headers['user-agent'];
  return {
    at: new Date(startedAt),
    kind: 'request',
    tenantId: user?.tenantId && UUID.test(user.tenantId) ? user.tenantId : null,
    userId: user?.userId && UUID.test(user.userId) ? user.userId : null,
    // До входа пользователя ещё нет — кто пытался войти, видно по адресу из формы.
    email: user?.email ?? (typeof body?.email === 'string' ? body.email.slice(0, 200) : null),
    impersonatedBy: user?.impersonatedBy ?? null,
    partnerId: req.partner?.partnerId ?? null,
    sessionId: header(req, SESSION_HEADER) ?? null,
    actionId: header(req, ACTION_HEADER) ?? null,
    page: header(req, PAGE_HEADER, 500) ?? null,
    method: req.method,
    route: req.route?.path ? String(req.route.path) : null,
    path: path.slice(0, 500),
    status: res.writableFinished ? res.statusCode : 499,
    durationMs: Date.now() - startedAt,
    body: hasKeys(body) ? (redactForJournal(body, path) as object) : undefined,
    query: hasKeys(req.query) ? (redactForJournal(req.query, path) as object) : undefined,
    error: error ?? null,
    meta: files.length ? { files } : undefined,
    ip: req.ip ?? null,
    userAgent: (Array.isArray(ua) ? ua[0] : ua)?.slice(0, 200) ?? null,
  };
}

export function journalMiddleware(journal: JournalService) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const startedAt = Date.now();
    let error: string | undefined;
    const json = res.json.bind(res);
    res.json = (body: unknown) => {
      if (res.statusCode >= 400) error = errorText(body);
      return json(body);
    };
    res.on('close', () => {
      try {
        if (shouldJournal(req, res)) journal.push(journalRowOf(req as JournalRequest, res, startedAt, error));
      } catch {
        /* журнал не должен ронять ответ */
      }
    });
    next();
  };
}
