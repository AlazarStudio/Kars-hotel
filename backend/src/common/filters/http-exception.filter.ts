import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Structural check for "this is an HttpException".
 *
 * Deliberately NOT `instanceof`. The same `@nestjs/common` file can be loaded
 * more than once in a single process — pnpm symlinks resolve to a realpath
 * whose drive-letter/folder casing may differ from the one `@nestjs/core`
 * resolved (`D:\GitHub\kars-hotel\…` vs `D:\GitHub\Kars-hotel\…`), and Node's
 * module cache is case-sensitive. Two copies mean two distinct `HttpException`
 * classes, so `instanceof` silently returns false for exceptions thrown inside
 * `@nestjs/core` (e.g. the router's "no such route" NotFoundException) — and
 * every one of them used to leave here as a 500.
 *
 * Duck-typing the public contract (`getStatus()` + `getResponse()`) holds
 * across copies, so the filter answers with the status the thrower meant.
 */
function asHttpException(e: unknown): HttpException | null {
  if (!(e instanceof Object)) return null;
  const candidate = e as Partial<HttpException>;
  if (typeof candidate.getStatus !== 'function' || typeof candidate.getResponse !== 'function') {
    return null;
  }
  const status = candidate.getStatus();
  // Guard against look-alikes: a real HttpException always carries an HTTP code.
  if (!Number.isInteger(status) || status < 100 || status > 599) return null;
  return e as HttpException;
}

/**
 * Global exception filter that converts all thrown exceptions into proper
 * HTTP responses. Without this, HttpExceptions thrown asynchronously (e.g.
 * inside interceptors or after Prisma transactions) may bypass NestJS's
 * built-in handler and fall through to Express, which returns a generic 500.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    if (response.headersSent) return;

    const httpException = asHttpException(exception);
    if (httpException) {
      const status = httpException.getStatus();
      const body = httpException.getResponse();
      response
        .status(status)
        .json(typeof body === 'string' ? { statusCode: status, message: body } : body);
      return;
    }

    // Unknown error — log and return 500
    console.error(`Unhandled exception on ${request.method} ${request.url}:`, exception);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    });
  }
}
