import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedRequestUser } from '../auth/strategies/jwt.strategy';

/**
 * Guard that allows access only to authenticated super-admins (isa === true).
 * Apply on top of JwtAuthGuard (which is already global).
 */
/**
 * Панель платформы для диспетчера Kars Avia (152-ФЗ, Р-34; план 13.3):
 * суперадмин ИЛИ диспетчер. Ставится только на сводку, список гостиниц и
 * вход «от имени»; сотрудники гостиниц, заведение и выключение гостиниц,
 * настройки платформы — только суперадмину.
 */
@Injectable()
export class PlatformOperatorGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const user = ctx.switchToHttp().getRequest<Request>().user as AuthenticatedRequestUser | undefined;
    if (!user?.isSuperAdmin && !(user?.isDispatcher && !user.impersonatedBy)) {
      throw new ForbiddenException('Platform access required');
    }
    return true;
  }
}

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
