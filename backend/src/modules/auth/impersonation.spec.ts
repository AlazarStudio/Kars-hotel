import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

/* Вход диспетчера в гостиницу БЕЗ СОБСТВЕННЫХ СОТРУДНИКОВ.
 *
 * Правило проверяется отрицанием — «не работает для всех остальных»: в двух
 * местах подряд стояло условие «пользователь обязан числиться в этом
 * тенанте», и оба раза это было условие ПРО ИЗВЕСТНЫЙ СЛУЧАЙ (гостиница со
 * своим персоналом), а не закрытое умолчание. Из 392 перенесённых гостиниц
 * сотрудники есть у единиц, поэтому «обычным» оказался как раз тот случай,
 * который запрещался: диспетчер получал «No active user found in target
 * tenant», а после починки первого места — молчаливый 401 из `/auth/me`.
 *
 * Тест держит оба конца: и выдачу токена, и чтение личности по нему.
 */

type AnyFn = (...args: unknown[]) => unknown;
const fn = () => jest.fn() as unknown as AnyFn & jest.Mock;

const TENANT = '11111111-1111-1111-1111-111111111111';
const DISPATCHER = '22222222-2222-2222-2222-222222222222';

function makeService(overrides: {
  tenant?: unknown;
  ownerInTenant?: unknown;
  ownerRole?: unknown;
  actor?: unknown;
  userInTenant?: unknown;
}) {
  const prisma = {
    admin: {
      tenant: { findUnique: fn().mockResolvedValue(overrides.tenant ?? { id: TENANT, isActive: true }) },
      user: {
        // `findFirst` обслуживает и «владелец тенанта», и «актор глобально»:
        // различаем по наличию tenantId в условии.
        findFirst: jest.fn(async (args: { where?: { tenantId?: string } }) =>
          args?.where?.tenantId
            ? ((overrides.ownerInTenant ?? overrides.userInTenant) ?? null)
            : (overrides.actor ?? null),
        ),
        findUnique: jest.fn(async () => overrides.actor ?? null),
      },
      role: { findFirst: fn().mockResolvedValue(overrides.ownerRole ?? null) },
    },
  };
  const jwtService = { signAsync: jest.fn(async (payload: unknown) => JSON.stringify(payload)) };
  const service = Object.create(AuthService.prototype) as AuthService;
  Object.assign(service, {
    prisma,
    jwt: jwtService,
    config: { getOrThrow: () => 'test-secret' },
  });
  return { service, jwtService };
}

describe('вход диспетчера в гостиницу', () => {
  it('в гостинице БЕЗ сотрудников выдаёт токен от имени самого диспетчера', async () => {
    const { service, jwtService } = makeService({
      ownerInTenant: null,
      ownerRole: {
        rolePermissions: [
          { permission: { code: 'room.read' } },
          { permission: { code: 'reservation.create' } },
        ],
      },
      actor: { id: DISPATCHER, email: 'dispatcher@kars.ru', fullName: 'Диспетчер' },
    });

    await service.issueImpersonationToken(TENANT, DISPATCHER);

    const payload = jwtService.signAsync.mock.calls[0][0] as {
      sub: string;
      tid: string;
      imp: string;
      perms: string[];
    };
    // Личность — сам диспетчер, область — гостиница, права — её роли владельца.
    expect(payload.sub).toBe(DISPATCHER);
    expect(payload.tid).toBe(TENANT);
    expect(payload.imp).toBe(DISPATCHER);
    expect(payload.perms).toEqual(['room.read', 'reservation.create']);
  });

  it('в отключённую гостиницу не пускает даже так', async () => {
    const { service } = makeService({
      tenant: { id: TENANT, isActive: false },
      actor: { id: DISPATCHER, email: 'd@kars.ru', fullName: 'Д' },
    });
    await expect(service.issueImpersonationToken(TENANT, DISPATCHER)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('`me` отвечает диспетчеру, которого нет среди сотрудников гостиницы', async () => {
    const { service } = makeService({
      userInTenant: null,
      actor: {
        id: DISPATCHER,
        email: 'dispatcher@kars.ru',
        fullName: 'Диспетчер',
        isDispatcher: true,
      },
    });

    const me = await service.me(DISPATCHER, TENANT, DISPATCHER, {
      roleCode: 'OWNER',
      permissions: ['room.read'],
    });

    expect(me.tenantId).toBe(TENANT);
    expect(me.isDispatcher).toBe(true);
    expect(me.permissions).toEqual(['room.read']);
    // Права берутся из токена, а не выдаются «на всякий случай» полностью.
    expect(me.isSuperAdmin).toBe(false);
  });

  it('`me` НЕ пускает чужого пользователя, который просто не в этом тенанте', async () => {
    const { service } = makeService({ userInTenant: null, actor: null });
    // Здесь `imp` не совпадает с `sub`: это не «диспетчер работает за
    // гостиницу», а токен на чужую учётку — такому места нет.
    await expect(
      service.me('33333333-3333-3333-3333-333333333333', TENANT, DISPATCHER),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
