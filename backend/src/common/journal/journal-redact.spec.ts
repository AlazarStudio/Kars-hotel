import { JOURNAL_HIDDEN, redactForJournal } from './journal-redact';

/* Журнал хранится бессрочно: секрет, попавший туда, лежит открыто навсегда.
 * Отрицанием — секрет НЕ доходит ни на какой глубине; обычные значения — доходят. */
describe('журнал действий: секреты не записываются', () => {
  it.each([
    ['password', { email: 'a@b.ru', password: 'Qwerty123!' }],
    ['currentPassword / newPassword', { currentPassword: 'old', newPassword: 'new' }],
    ['pin', { pin: '1234' }],
    ['refreshToken', { refreshToken: 'abc' }],
    ['apiKey', { apiKey: 'k' }],
    ['паспорт лётного сотрудника', { people: [{ fullName: 'Иванов', document: '4510 123456' }] }],
    ['MRZ', { mrzLines: 'P<RUSIVANOV' }],
    ['переменные GraphQL', { query: 'mutation', variables: { input: { password: 'x' } } }],
  ])('%s — скрыт', (_n, body) => {
    expect(JSON.stringify(redactForJournal(body, '/api/users'))).not.toMatch(/Qwerty|old"|new"|1234|abc|"k"|4510|IVANOV|"x"/);
  });

  it('код входа скрыт на входе и во втором факторе', () => {
    expect(redactForJournal({ code: '481516' }, '/api/auth/login')).toEqual({ code: JOURNAL_HIDDEN });
    expect(redactForJournal({ code: '481516' }, '/api/auth/2fa/verify')).toEqual({ code: JOURNAL_HIDDEN });
  });

  it('код организации и тарифа — НЕ секрет, записывается', () => {
    expect(redactForJournal({ code: 'SU', name: 'Аэрофлот' }, '/api/organizations')).toEqual({ code: 'SU', name: 'Аэрофлот' });
  });

  it('обычные значения записываются как есть', () => {
    expect(redactForJournal({ adults: 2, guestName: 'Морозова', at: null }, '/api/requests/1')).toEqual({
      adults: 2,
      guestName: 'Морозова',
      at: null,
    });
  });

  it('длинное обрезано с пометкой, сколько скрыто', () => {
    const r = redactForJournal({ notes: 'x'.repeat(2100), ids: Array.from({ length: 60 }, (_, i) => i) }, '/api/x') as {
      notes: string;
      ids: unknown[];
    };
    expect(r.notes).toMatch(/… \(\+100\)$/);
    expect(r.ids).toHaveLength(51);
    expect(r.ids[50]).toBe('… (+10)');
  });
});
