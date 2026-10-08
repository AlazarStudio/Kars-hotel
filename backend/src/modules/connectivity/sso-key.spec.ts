import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PartnerApiKeyGuard } from './guards/partner-api-key.guard';
import { PartnerKeyService } from './partner-key.service';
import { PARTNER_SCOPES } from './decorators/partner-scopes.decorator';

/* 152-ФЗ, Р-34; план 13.3: вход диспетчеров — только отдельным ключом. */

function guard(scopes: string[], required: string[]) {
  const keys = { verify: async () => ({ id: 'k', name: 'k', partnerId: 'p', scopes }) } as unknown as PartnerKeyService;
  const reflector = { getAllAndOverride: () => required } as unknown as Reflector;
  const req = { header: () => 'klh_test_x', headers: {} };
  const ctx = { switchToHttp: () => ({ getRequest: () => req }), getHandler: () => null, getClass: () => null } as never;
  return new PartnerApiKeyGuard(keys, reflector).canActivate(ctx);
}

describe('Ключ входа диспетчеров', () => {
  it('отдельный ключ sso:create — проходит', async () => {
    await expect(guard([PARTNER_SCOPES.SsoCreate], [PARTNER_SCOPES.SsoCreate])).resolves.toBe(true);
  });

  it('общий ключ интеграции с sso:create — отказ', async () => {
    await expect(guard([PARTNER_SCOPES.SsoCreate, PARTNER_SCOPES.ReservationsWrite], [PARTNER_SCOPES.SsoCreate])).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('прочие ручки общим ключом — как раньше', async () => {
    await expect(guard([PARTNER_SCOPES.HotelsRead, PARTNER_SCOPES.ReservationsWrite], [PARTNER_SCOPES.HotelsRead])).resolves.toBe(true);
  });

  it('выпустить ключ sso:create вместе с другими правами нельзя', async () => {
    const svc = Object.create(PartnerKeyService.prototype) as PartnerKeyService;
    await expect(svc.mint({ name: 'x', scopes: [PARTNER_SCOPES.SsoCreate, PARTNER_SCOPES.HotelsRead] })).rejects.toThrow(/отдельно/);
  });
});
