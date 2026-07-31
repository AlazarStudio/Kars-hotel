import { Prisma } from '@prisma/client';
import {
  PRISMA_RECORD_NOT_FOUND,
  PRISMA_UNIQUE_VIOLATION,
  asError,
  prismaErrorCode,
} from './prisma-error';

/**
 * These assertions are about a translation the API owes its callers: P2002 must
 * surface as 409 and P2025 as 404. The previous `instanceof` check delivered
 * that only while exactly one copy of the generated Prisma client was loaded —
 * a condition no test asserted and nothing in the build enforces.
 */
describe('prismaErrorCode', () => {
  it('reads the code off a real PrismaClientKnownRequestError', () => {
    const e = new Prisma.PrismaClientKnownRequestError('unique failed', {
      code: PRISMA_UNIQUE_VIOLATION,
      clientVersion: '5.22.0',
    });

    expect(prismaErrorCode(e)).toBe(PRISMA_UNIQUE_VIOLATION);
  });

  // The regression that mattered: same shape, different class identity.
  it('reads the code off an error from another copy of the client', () => {
    class ForeignKnownRequestError extends Error {
      code = PRISMA_RECORD_NOT_FOUND;
      clientVersion = '5.22.0';
      meta = { cause: 'Record to update not found.' };
    }

    expect(prismaErrorCode(new ForeignKnownRequestError())).toBe(PRISMA_RECORD_NOT_FOUND);
  });

  it.each([
    ['a Node system error', Object.assign(new Error('connect'), { code: 'ECONNREFUSED' })],
    ['a numeric code', Object.assign(new Error('exit'), { code: 2002 })],
    ['a code of the wrong shape', Object.assign(new Error('x'), { code: 'P202' })],
    ['a validation error without a code', new Error('Invalid `prisma.room.create()`')],
    ['null', null],
    ['a string', 'P2002'],
  ])('does not claim %s as a Prisma code', (_label, value) => {
    expect(prismaErrorCode(value)).toBeNull();
  });
});

describe('asError', () => {
  it('passes an Error through untouched', () => {
    const e = new Error('boom');

    expect(asError(e)).toBe(e);
  });

  it('wraps a thrown non-Error so it still reaches the filter as a 500', () => {
    expect(asError('строка')).toBeInstanceOf(Error);
    expect(asError('строка').message).toBe('строка');
  });
});
