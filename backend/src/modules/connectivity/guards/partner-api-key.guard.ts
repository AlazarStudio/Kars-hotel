import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PartnerKeyService, VerifiedPartner } from '../partner-key.service';
import { PARTNER_SCOPES_KEY, PartnerScope } from '../decorators/partner-scopes.decorator';

/** Express request augmented with the verified partner identity. */
export interface PartnerRequest extends Request {
  partner?: VerifiedPartner;
}

/**
 * Authenticates connectivity requests via a partner API key and enforces the
 * scopes declared with {@link RequireScopes}.
 *
 * The key is read from the `X-Api-Key` header (preferred) or an
 * `Authorization: Bearer <key>` header (fallback for clients that only speak
 * bearer auth). Routes using this guard must also be marked `@Public()` so the
 * global JWT guard steps aside — partner traffic carries no user JWT.
 */
@Injectable()
export class PartnerApiKeyGuard implements CanActivate {
  constructor(
    private readonly keys: PartnerKeyService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<PartnerRequest>();

    const rawKey = this.extractKey(req);
    const partner = await this.keys.verify(rawKey);
    if (!partner) {
      throw new UnauthorizedException('Invalid or missing partner API key');
    }

    const required =
      this.reflector.getAllAndOverride<PartnerScope[]>(PARTNER_SCOPES_KEY, [
        ctx.getHandler(),
        ctx.getClass(),
      ]) ?? [];
    const missing = required.filter((s) => !partner.scopes.includes(s));
    if (missing.length) {
      throw new ForbiddenException(`Partner key missing scope(s): ${missing.join(', ')}`);
    }

    req.partner = partner;
    return true;
  }

  private extractKey(req: Request): string | undefined {
    const header = req.header('x-api-key');
    if (header) return header.trim();

    const auth = req.header('authorization');
    if (auth?.toLowerCase().startsWith('bearer ')) {
      return auth.slice(7).trim();
    }
    return undefined;
  }
}
