/**
 * Structural reading of Prisma's known-request errors.
 *
 * Deliberately NOT `e instanceof Prisma.PrismaClientKnownRequestError`. The
 * class travels through a generated client that is re-exported and symlinked,
 * so a second copy of it in the same process (a differently-cased realpath, a
 * hoisted duplicate, a client regenerated into another folder) makes the check
 * return false without a word — and then a unique-constraint violation stops
 * being a 409 and leaves as a 500. The error code is part of Prisma's public
 * contract; the class identity is not.
 *
 * Prisma codes are `P` + four digits (P2002 unique constraint, P2025 record not
 * found, …). That shape also keeps Node's own `code`-carrying errors out —
 * `ECONNREFUSED` and friends must stay 500s.
 */
const PRISMA_CODE = /^P\d{4}$/;

export function prismaErrorCode(e: unknown): string | null {
  if (typeof e !== 'object' || e === null) return null;
  const code = (e as { code?: unknown }).code;
  if (typeof code !== 'string' || !PRISMA_CODE.test(code)) return null;
  return code;
}

/** Unique constraint violated. */
export const PRISMA_UNIQUE_VIOLATION = 'P2002';

/** Record required by the operation was not found. */
export const PRISMA_RECORD_NOT_FOUND = 'P2025';

/**
 * Last step of a `translatePrismaError`: whatever we could not classify must
 * still reach the global filter as an Error, so it becomes an honest 500
 * instead of a swallowed value.
 */
export function asError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}
