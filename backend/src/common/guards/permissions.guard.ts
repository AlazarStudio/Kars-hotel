import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';
import { IS_PUBLIC_KEY } from '../../modules/auth/decorators/public.decorator';
import { AuthenticatedRequestUser } from '../../modules/auth/strategies/jwt.strategy';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    // 1. Skip public endpoints (no JWT required at all)
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    // 2. Read the required permissions for this handler/controller
    const required = this.reflector.getAllAndMerge<string[]>(PERMISSIONS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    // 3. No @RequirePermissions → endpoint is accessible to any authenticated user
    if (!required || required.length === 0) return true;

    const req = ctx.switchToHttp().getRequest();
    const user = req.user as AuthenticatedRequestUser | undefined;

    // 4. Super-admins bypass all permission checks
    if (user?.isSuperAdmin) return true;

    // 5. Check every required code is present in the user's permissions
    const userPerms = new Set(user?.permissions ?? []);
    const missing = required.filter((p) => !userPerms.has(p));

    if (missing.length > 0) {
      throw new ForbiddenException({
        code: 'PERMISSION_DENIED',
        missing,
        message: `Missing permissions: ${missing.join(', ')}`,
      });
    }

    return true;
  }
}
