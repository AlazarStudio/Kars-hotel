import { ArgumentsHost, NotFoundException } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

/**
 * The bug this guards against: `@nestjs/common` can be loaded twice in one
 * process (pnpm realpath casing differs between the app's resolution and
 * `@nestjs/core`'s; Node's module cache is case-sensitive). Two copies mean two
 * distinct `HttpException` classes, so an `instanceof` check in the filter
 * silently returns false for anything thrown inside `@nestjs/core` — the
 * router's "no such route" 404 included — and every one of them left as a 500.
 *
 * A partner that cannot tell "no such booking" from "the PMS is broken" will
 * retry or fail hard on what is really a plain not-found, so these assertions
 * are about the contract, not about tidiness.
 */

/** Stand-in for an HttpException that came from a *different* module copy. */
class ForeignHttpException {
  constructor(
    private readonly status: number,
    private readonly body: unknown,
  ) {}
  getStatus(): number {
    return this.status;
  }
  getResponse(): unknown {
    return this.body;
  }
}

function runFilter(exception: unknown, headersSent = false) {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status, headersSent }),
      getRequest: () => ({ method: 'GET', url: '/api/connect/v1/nope' }),
    }),
  } as unknown as ArgumentsHost;

  new HttpExceptionFilter().catch(exception, host);
  return { status, json };
}

describe('HttpExceptionFilter', () => {
  it('keeps the status of an HttpException from another module copy', () => {
    const { status, json } = runFilter(
      new ForeignHttpException(404, {
        statusCode: 404,
        error: 'Not Found',
        message: 'Cannot GET /api/connect/v1/nope',
      }),
    );

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 404 }),
    );
  });

  it('keeps the status of an HttpException from this module copy', () => {
    const { status } = runFilter(new NotFoundException('Бронь не найдена'));

    expect(status).toHaveBeenCalledWith(404);
  });

  it('wraps a string body from another copy into a JSON envelope', () => {
    const { status, json } = runFilter(new ForeignHttpException(409, 'занято'));

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({ statusCode: 409, message: 'занято' });
  });

  it('answers 500 for a plain error, without leaking its message', () => {
    const { status, json } = runFilter(new Error('connect ECONNREFUSED 5442'));

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      statusCode: 500,
      message: 'Internal server error',
    });
  });

  // The duck-typing must not be so loose that any object with these method
  // names dictates the response code.
  it.each([
    ['a status outside the HTTP range', 0],
    ['a non-integer status', 4.04],
    ['a non-numeric status', 'not-found' as unknown as number],
  ])('answers 500 for a look-alike with %s', (_label, status) => {
    const { status: setStatus } = runFilter(
      new ForeignHttpException(status as number, { message: 'x' }),
    );

    expect(setStatus).toHaveBeenCalledWith(500);
  });

  it('answers 500 for an object that only looks like it has the methods', () => {
    const { status } = runFilter({ getStatus: 404, getResponse: {} });

    expect(status).toHaveBeenCalledWith(500);
  });

  it('stays silent once the response has already been sent', () => {
    const { status } = runFilter(new NotFoundException('поздно'), true);

    expect(status).not.toHaveBeenCalled();
  });
});
