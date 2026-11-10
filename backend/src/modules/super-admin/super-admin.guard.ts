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
 *
 * Отказ отдаётся кодом и русским текстом: интерфейс показывает ответ сервера
 * как есть, и прежняя английская строка «Platform access required» выходила в
 * русской форме заведения гостиницы (диспетчер в режиме «от имени», 11.11.2026).
 */
const PLATFORM_DENIED = {
  code: 'PLATFORM_ACCESS_REQUIRED',
  message: 'Заводить и менять гостиницы может администратор платформы или диспетчер Kars Avia. Проверьте, под какой учёткой вы вошли.',
};

/* Диспетчер внутри гостиницы — не платформенный оператор: сначала выйти из
   режима «от имени», иначе действия пойдут в чужую гостиницу (решение 25.10.2026). */
const IMPERSONATION_DENIED = {
  code: 'PLATFORM_ACCESS_WHILE_IMPERSONATING',
  message: 'Вы работаете от имени гостиницы. Выйдите из режима «от имени», чтобы заводить и менять гостиницы.',
};

const SUPER_ADMIN_DENIED = {
  code: 'SUPER_ADMIN_REQUIRED',
  message: 'Это действие доступно только администратору платформы.',
};

@Injectable()
export class PlatformOperatorGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const user = ctx.switchToHttp().getRequest<Request>().user as AuthenticatedRequestUser | undefined;
    if (user?.isSuperAdmin || (user?.isDispatcher && !user.impersonatedBy)) return true;
    throw new ForbiddenException(user?.impersonatedBy ? IMPERSONATION_DENIED : PLATFORM_DENIED);
  }
}

@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const user = req.user as AuthenticatedRequestUser | undefined;
    if (!user?.isSuperAdmin) throw new ForbiddenException(SUPER_ADMIN_DENIED);
    return true;
  }
}
