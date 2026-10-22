import { journalRowOf, shouldJournal } from './journal.middleware';

const res = (cd?: string, status = 200) =>
  ({ statusCode: status, writableFinished: true, getHeader: () => cd }) as never;
const req = (method: string, url: string, body?: unknown, extra: object = {}) =>
  ({ method, url, originalUrl: url, headers: {}, body, query: {}, ...extra }) as never;

describe('журнал действий PMS: какие запросы пишутся', () => {
  it('правка брони в кабинете — пишется', () => {
    expect(shouldJournal(req('PATCH', '/api/reservations/1'), res())).toBe(true);
  });
  it('бронь от партнёра — пишется', () => {
    expect(shouldJournal(req('POST', '/api/connect/v1/hotels/h/reservations'), res())).toBe(true);
  });
  it('подбор свободных номеров партнёром — НЕ пишется (чтение на каждый поиск)', () => {
    expect(shouldJournal(req('POST', '/api/connect/v1/hotels/h/availability'), res())).toBe(false);
  });
  it('открытие экрана — НЕ пишется; выгрузка файла — пишется', () => {
    expect(shouldJournal(req('GET', '/api/reservations'), res())).toBe(false);
    expect(shouldJournal(req('GET', '/api/folio/1/pdf'), res('attachment; filename=a.pdf'))).toBe(true);
  });
});

describe('журнал действий PMS: строка запроса', () => {
  it('кто правил бронь и что прислал; пароль на входе скрыт', () => {
    const u = { userId: '11111111-1111-1111-1111-111111111111', tenantId: '22222222-2222-2222-2222-222222222222', email: 'd@h.ru' };
    const row = journalRowOf(req('PATCH', '/api/reservations/1', { adults: 2 }, { user: u, headers: { 'x-client-action': 'a1' } }), res(undefined, 403), Date.now(), 'нельзя');
    expect(row).toMatchObject({ userId: u.userId, tenantId: u.tenantId, email: 'd@h.ru', actionId: 'a1', status: 403, error: 'нельзя', body: { adults: 2 } });
    const login = journalRowOf(req('POST', '/api/auth/login', { email: 'a@b.ru', password: 'x' }), res(undefined, 401), Date.now(), undefined);
    expect(login.body).toEqual({ email: 'a@b.ru', password: '***' });
  });
  it('партнёр — по ключу, без пользователя', () => {
    const row = journalRowOf(req('POST', '/api/connect/v1/hotels/h/reservations', {}, { partner: { partnerId: 'kars-avia' }, user: { userId: '', tenantId: '' } }), res(), Date.now(), undefined);
    expect(row).toMatchObject({ partnerId: 'kars-avia', userId: null, tenantId: null });
  });
});
