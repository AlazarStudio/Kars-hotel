import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedRequestUser } from '../strategies/jwt.strategy';

/** Extracts the authenticated principal (set by JwtStrategy.validate) from req. */
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthenticatedRequestUser => {
    const req = ctx.switchToHttp().getRequest();
    return req.user as AuthenticatedRequestUser;
  },
);
