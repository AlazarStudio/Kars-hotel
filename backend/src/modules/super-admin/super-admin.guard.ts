import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedRequestUser } from '../auth/strategies/jwt.strategy';

/**
 * Guard that allows access only to authenticated super-admins (isa === true).
 * Apply on top of JwtAuthGuard (which is already global).
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const user = req.user as AuthenticatedRequestUser | undefined;
    if (!user?.isSuperAdmin) {
      throw new ForbiddenException('Super-admin access required');
    }
    return true;
  }
}
