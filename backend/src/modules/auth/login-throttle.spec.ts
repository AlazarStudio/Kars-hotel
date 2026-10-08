import { HttpException } from '@nestjs/common';
import { CounterStore, LoginThrottle, MAX_PER_EMAIL, MAX_PER_IP } from './login-throttle';

/* 152-ФЗ, Р-45; план 13.2: пароль не подобрать перебором. */

function memory(): CounterStore {
  const m = new Map<string, number>();
  return {
    get: async (k) => (m.has(k) ? String(m.get(k)) : null),
    incr: async (k) => {
      m.set(k, (m.get(k) ?? 0) + 1);
      return m.get(k)!;
    },
    expire: async () => 1,
    del: async (k) => (m.delete(k) ? 1 : 0),
    ttl: async () => 600,
  };
}

describe('LoginThrottle', () => {
  it(`после ${MAX_PER_EMAIL} неудач по почте — 429, даже если пароль теперь верный`, async () => {
    const t = new LoginThrottle(memory());
    for (let i = 0; i < MAX_PER_EMAIL; i++) {
      await t.assertAllowed('a@h.ru', '1.1.1.1');
      await t.fail('A@h.ru', '1.1.1.1');
    }
    await expect(t.assertAllowed('a@h.ru', '2.2.2.2')).rejects.toMatchObject({ status: 429 });
  });

  it('удачный вход обнуляет счётчик своей почты', async () => {
    const t = new LoginThrottle(memory());
    for (let i = 0; i < MAX_PER_EMAIL - 1; i++) await t.fail('a@h.ru');
    await t.success('a@h.ru');
    await t.fail('a@h.ru');
    await expect(t.assertAllowed('a@h.ru')).resolves.toBeUndefined();
  });

  it(`перебор адресов с одного IP — 429 после ${MAX_PER_IP}`, async () => {
    const t = new LoginThrottle(memory());
    for (let i = 0; i < MAX_PER_IP; i++) await t.fail(`u${i}@h.ru`, '9.9.9.9');
    const err = await t.assertAllowed('fresh@h.ru', '9.9.9.9').catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    await expect(t.assertAllowed('fresh@h.ru', '8.8.8.8')).resolves.toBeUndefined();
  });

  it('fail возвращает счёт по почте — для журнала', async () => {
    const t = new LoginThrottle(memory());
    await t.fail('a@h.ru', '1.1.1.1');
    expect(await t.fail('a@h.ru', '1.1.1.1')).toBe(2);
  });
});
