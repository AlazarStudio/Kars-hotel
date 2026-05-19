import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { JwtAccessPayload } from '../types/jwt-payload';

/** Identity attached to req.user after a successful JWT verification. */
export interface AuthenticatedRequestUser {
  userId: string;
  tenantId: string;
  email: string;
  roleCode: string;
  permissions: string[];
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) => req?.headers?.authorization?.replace(/^Bearer\s+/i, '') ?? null,
      ]),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  async validate(payload: JwtAccessPayload): Promise<AuthenticatedRequestUser> {
    if (!payload?.sub || !payload?.tid) {
      throw new UnauthorizedException('Malformed token');
    }
    return {
      userId: payload.sub,
      tenantId: payload.tid,
      email: payload.email,
      roleCode: payload.role,
      permissions: payload.perms ?? [],
    };
  }
}
