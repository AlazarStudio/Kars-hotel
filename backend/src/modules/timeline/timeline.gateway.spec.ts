import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { TimelineGateway } from './timeline.gateway';

/* В КАКУЮ КОМНАТУ ШАХМАТКИ ПОПАДАЕТ СОКЕТ (25.10.2026).
 *
 * Над gateway было написано «клиент шлёт JWT в auth.token, мы его
 * проверяем», а код сажал сокет в `timeline:<tenantId>` по `tenantId`,
 * который прислал сам клиент. Правило жило в комментарии, а не там, где
 * исполняется: любой, кто знал id гостиницы, получал её `timeline:update`.
 *
 * Проверяется отрицанием — «не работает для всех остальных»: без токена, с
 * чужой подписью, с токеном продления, истёкшим, без гостиницы в токене
 * сокет НЕ попадает ни в какую комнату и отключается; гостиница из
 * handshake не значит ничего. Свой токен — комната своей гостиницы, и
 * только она.
 */

const ACCESS_SECRET = 'test-access-secret';
const OTHER_SECRET = 'test-other-secret';

const HOTEL_A = '11111111-1111-1111-1111-111111111111';
const HOTEL_B = '22222222-2222-2222-2222-222222222222';
const USER = '33333333-3333-3333-3333-333333333333';

const jwt = new JwtService({});

function makeGateway() {
  const config = { getOrThrow: () => ACCESS_SECRET } as unknown as ConfigService;
  return new TimelineGateway(jwt, config);
}

function connect(auth: Record<string, unknown> | undefined) {
  const client = {
    id: 'socket-1',
    handshake: { auth },
    join: jest.fn(),
    disconnect: jest.fn(),
  };
  makeGateway().handleConnection(client as never);
  return client;
}

function accessToken(payload: Record<string, unknown>, secret = ACCESS_SECRET) {
  return jwt.sign({ sub: USER, tid: HOTEL_A, role: 'OWNER', perms: [], email: 'a@hotel.ru', ...payload }, { secret });
}

function expectRejected(client: ReturnType<typeof connect>) {
  expect(client.join).not.toHaveBeenCalled();
  expect(client.disconnect).toHaveBeenCalledWith(true);
}

describe('сокет шахматки: комната — только по проверенному токену', () => {
  it('без handshake.auth — ни в какую комнату', () => {
    expectRejected(connect(undefined));
  });

  it('гостиница в handshake без токена (прежний кабинет) — ни в какую комнату', () => {
    expectRejected(connect({ tenantId: HOTEL_B }));
  });

  it('токен, подписанный не нашим секретом, — ни в какую комнату, даже вместе с tenantId', () => {
    const forged = accessToken({ tid: HOTEL_B }, OTHER_SECRET);
    expectRejected(connect({ token: forged, tenantId: HOTEL_B }));
  });

  it('токен без подписи (alg: none) — ни в какую комнату', () => {
    const b64 = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const unsigned = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: USER, tid: HOTEL_B })}.`;
    expectRejected(connect({ token: unsigned }));
  });

  it('токен продления (свой секрет) вместо access — ни в какую комнату', () => {
    const refresh = jwt.sign({ sub: USER, tid: HOTEL_A, jti: 'abc' }, { secret: 'test-refresh-secret' });
    expectRejected(connect({ token: refresh }));
  });

  it('истёкший access-токен — ни в какую комнату', () => {
    const expired = accessToken({ exp: Math.floor(Date.now() / 1000) - 60 });
    expectRejected(connect({ token: expired }));
  });

  it('подписанный токен без гостиницы или без пользователя — ни в какую комнату', () => {
    expectRejected(connect({ token: accessToken({ tid: undefined }) }));
    expectRejected(connect({ token: accessToken({ sub: undefined }) }));
  });

  it('мусор и не-строка вместо токена — ни в какую комнату', () => {
    expectRejected(connect({ token: 'not-a-jwt' }));
    expectRejected(connect({ token: '' }));
    expectRejected(connect({ token: { tid: HOTEL_A } }));
    expectRejected(connect({ token: 42 }));
  });

  it('свой токен — комната своей гостиницы, tenantId из handshake не читается', () => {
    const client = connect({ token: accessToken({ tid: HOTEL_A }), tenantId: HOTEL_B });

    expect(client.disconnect).not.toHaveBeenCalled();
    expect(client.join.mock.calls).toEqual([[`timeline:${HOTEL_A}`]]);
  });
});
