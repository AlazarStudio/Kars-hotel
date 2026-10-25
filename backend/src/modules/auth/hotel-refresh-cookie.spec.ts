import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OwnerInviteService } from './owner-invite.service';

/* КУКА ГОСТИНИЦЫ — У КАЖДОЙ СВОЯ (бой, 25.10.2026).
 *
 * Вход по ссылке из Kars Avia в гостиницу клал продление в ОБЩУЮ куку
 * браузера. Диспетчер открывал в соседней вкладке другую гостиницу — кука
 * становилась её, и продление первой вкладки молча выдавало токен чужой
 * гостиницы: выезд гостя «Апартаментов» уходил от имени «Европы» и получал
 * «Reservation not found».
 *
 * Тест держит оба конца, отрицанием: вход в гостиницу НЕ трогает общую куку,
 * а продление гостиницы НЕ читает общую — даже когда своей нет. */

const HOTEL = '11111111-1111-1111-1111-111111111111';
const HOTEL_PATH = `/api/auth/hotel/${HOTEL}`;

const TOKENS = {
  accessToken: 'access',
  refreshToken: 'refresh-new',
  accessTtlSeconds: 900,
  refreshTtlSeconds: 604800,
};

function setup() {
  const auth = {
    exchangeSsoCode: jest.fn(),
    refresh: jest.fn(async () => TOKENS),
    logout: jest.fn(async () => undefined),
  };
  const controller = new AuthController(
    auth as unknown as AuthService,
    {} as unknown as OwnerInviteService,
  );
  const res = {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn(),
  };
  const req = (cookies: Record<string, string>) =>
    ({ cookies, ip: '127.0.0.1', headers: {} }) as never;
  const cookiesSet = () => res.cookie.mock.calls.map(([name, , opts]) => [name, opts.path]);
  return { auth, controller, res, req, cookiesSet };
}

describe('вход по ссылке из Kars Avia', () => {
  it('в гостиницу — кука ЭТОЙ гостиницы, общая НЕ трогается', async () => {
    const { auth, controller, res, req, cookiesSet } = setup();
    auth.exchangeSsoCode.mockResolvedValue({
      ...TOKENS,
      mode: 'hotel',
      tenant: { id: HOTEL, name: 'Европа' },
    });

    const body = await controller.ssoExchange({ code: 'c' }, req({}), res as never);

    expect(cookiesSet()).toEqual([['refresh_hotel', HOTEL_PATH]]);
    expect(body).not.toHaveProperty('refreshToken');
  });

  it('в гостиницу без её id — куки нет вовсе, общей она НЕ становится', async () => {
    const { auth, controller, res, req } = setup();
    auth.exchangeSsoCode.mockResolvedValue({ ...TOKENS, mode: 'hotel' });

    await controller.ssoExchange({ code: 'c' }, req({}), res as never);

    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('в панель диспетчера — общая кука, как раньше', async () => {
    const { auth, controller, res, req, cookiesSet } = setup();
    auth.exchangeSsoCode.mockResolvedValue({ ...TOKENS, mode: 'admin' });

    await controller.ssoExchange({ code: 'c' }, req({}), res as never);

    expect(cookiesSet()).toEqual([['refresh_token', '/api/auth']]);
  });
});

describe('продление входа в гостиницу', () => {
  it('НЕ читает общую куку, даже когда своей нет', async () => {
    const { auth, controller, res, req } = setup();

    await controller.refreshHotel(HOTEL, req({ refresh_token: 'europa-session' }), res as never);

    expect(auth.refresh).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('продлевает своей кукой, сверяя гостиницу из пути, и кладёт новую туда же', async () => {
    const { auth, controller, res, req, cookiesSet } = setup();

    await controller.refreshHotel(
      HOTEL,
      req({ refresh_hotel: 'apartments-session', refresh_token: 'europa-session' }),
      res as never,
    );

    expect(auth.refresh).toHaveBeenCalledWith('apartments-session', '127.0.0.1', undefined, HOTEL);
    expect(cookiesSet()).toEqual([['refresh_hotel', HOTEL_PATH]]);
    expect(res.json).toHaveBeenCalledWith({ accessToken: 'access', accessTtlSeconds: 900 });
  });

  it('отказ сервиса — 401 и новой куки НЕТ', async () => {
    const { auth, controller, res, req } = setup();
    auth.refresh.mockRejectedValueOnce(new Error('Refresh token belongs to another session'));

    await controller.refreshHotel(HOTEL, req({ refresh_hotel: 'x' }), res as never);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('общее продление — общей кукой и без гостиницы, как раньше', async () => {
    const { auth, controller, res, req, cookiesSet } = setup();

    await controller.refresh(req({ refresh_token: 'own', refresh_hotel: 'hotel' }), res as never);

    expect(auth.refresh).toHaveBeenCalledWith('own', '127.0.0.1', undefined, undefined);
    expect(cookiesSet()).toEqual([['refresh_token', '/api/auth']]);
  });
});

describe('выход из гостиницы', () => {
  it('гасит её куку и НЕ трогает общую', async () => {
    const { auth, controller, res, req } = setup();

    await controller.logoutHotel(
      HOTEL,
      req({ refresh_hotel: 'apartments-session', refresh_token: 'dispatcher-panel' }),
      res as never,
    );

    expect(auth.logout).toHaveBeenCalledTimes(1);
    expect(auth.logout).toHaveBeenCalledWith('apartments-session');
    expect(res.clearCookie).toHaveBeenCalledTimes(1);
    expect(res.clearCookie).toHaveBeenCalledWith('refresh_hotel', { path: HOTEL_PATH });
  });
});
