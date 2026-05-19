import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request context carrying the authenticated tenant + user identity.
 * Populated by TenantContextMiddleware (B.4) from the JWT, then consumed by:
 *  - PrismaService.forTenant(): wraps each query in a transaction that runs
 *    `SET LOCAL app.tenant_id = <uuid>` so RLS policies see the right tenant.
 *  - Services that audit user actions.
 */
export interface RequestContext {
  tenantId: string;
  userId: string;
  roleCode: string;
  permissions: string[];
}

class TenantContextHolder {
  private readonly als = new AsyncLocalStorage<RequestContext>();

  /** Run `fn` with the given context attached to the current async scope. */
  run<T>(ctx: RequestContext, fn: () => T): T {
    return this.als.run(ctx, fn);
  }

  /** Returns the current context or undefined if running outside a request. */
  get(): RequestContext | undefined {
    return this.als.getStore();
  }

  /** Returns the current tenantId or throws if missing. Use inside protected routes only. */
  getTenantIdOrThrow(): string {
    const ctx = this.als.getStore();
    if (!ctx?.tenantId) {
      throw new Error('TenantContext: tenant_id is required but not set');
    }
    return ctx.tenantId;
  }
}

export const TenantContext = new TenantContextHolder();
