import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { Request } from 'express';
import { AuthenticatedRequestUser } from '../../modules/auth/strategies/jwt.strategy';
import { TenantContext } from '../context/tenant-context';

/**
 * Globally-applied interceptor that pulls req.user (set by Passport) and
 * binds it to AsyncLocalStorage so any downstream service can read the
 * current tenantId via TenantContext.getTenantIdOrThrow().
 *
 * For @Public() routes (login/register/health) req.user is undefined — we
 * just pass-through.
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const user = req.user as AuthenticatedRequestUser | undefined;

    if (!user?.tenantId || !user?.userId) {
      return next.handle();
    }

    let out: Observable<unknown> | undefined;
    TenantContext.run(
      {
        tenantId: user.tenantId,
        userId: user.userId,
        roleCode: user.roleCode,
        permissions: user.permissions,
      },
      () => {
        out = next.handle();
      },
    );
    if (!out) throw new Error('TenantContextInterceptor: next.handle did not return');
    return out;
  }
}
