import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { TenantContext } from '../context/tenant-context';

/**
 * Prisma access layer with multi-tenant RLS support.
 *
 * Two underlying clients:
 *   - this (extends PrismaClient): runtime client connected as `app_user`
 *     (NOSUPERUSER NOBYPASSRLS). Every query is subject to RLS. Without an
 *     active SET LOCAL `app.tenant_id` the query returns 0 rows (fail-safe).
 *   - admin: superuser client (BYPASSRLS). Used ONLY for operations that must
 *     cross tenant boundaries: tenant registration, login user lookup, audit
 *     log writes for system-level events.
 *
 * Typical usage in services:
 *   await this.prisma.forTenant(async (tx) => tx.user.findMany());
 * Or, when a tenantId is already known explicitly:
 *   await this.prisma.forTenantExplicit(tenantId, async (tx) => …);
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  /** Superuser client (BYPASSRLS). Cross-tenant operations only. */
  public readonly admin: PrismaClient;

  constructor() {
    super({
      log: [
        { level: 'error', emit: 'event' },
        { level: 'warn', emit: 'event' },
      ],
      datasources: {
        db: { url: process.env.DATABASE_URL ?? process.env.DATABASE_URL_MIGRATIONS },
      },
    });

    this.admin = new PrismaClient({
      log: [
        { level: 'error', emit: 'event' },
        { level: 'warn', emit: 'event' },
      ],
      datasources: {
        db: { url: process.env.DATABASE_URL_MIGRATIONS ?? process.env.DATABASE_URL },
      },
    });
  }

  async onModuleInit(): Promise<void> {
    await Promise.all([this.$connect(), this.admin.$connect()]);
    this.logger.log('Prisma connected (app_user + admin)');
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.$disconnect(), this.admin.$disconnect()]);
  }

  /** Lightweight DB liveness probe via the runtime (RLS-enabled) connection. */
  async ping(): Promise<void> {
    // SELECT 1 doesn't touch any table, so RLS doesn't affect it.
    await this.$queryRaw`SELECT 1`;
  }

  /**
   * Run `callback` inside an interactive transaction whose `app.tenant_id`
   * GUC is set to the tenant from the current AsyncLocalStorage context.
   *
   * MUST be used for any tenant-scoped read/write performed during a request.
   */
  async forTenant<T>(callback: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const tenantId = TenantContext.getTenantIdOrThrow();
    return this.forTenantExplicit(tenantId, callback);
  }

  /**
   * Same as `forTenant` but accepts an explicit tenantId (no ALS lookup).
   * Useful in jobs / cron / tests where there's no HTTP request.
   */
  async forTenantExplicit<T>(
    tenantId: string,
    callback: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(async (tx) => {
      // SET LOCAL accepts string literals only — UUID is validated by Postgres on cast.
      // We sanitize manually since prepared statements aren't allowed in SET LOCAL.
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) {
        throw new Error(`Invalid tenantId for SET LOCAL: ${tenantId}`);
      }
      await tx.$executeRawUnsafe(`SET LOCAL app.tenant_id = '${tenantId}'`);
      return callback(tx);
    });
  }
}
