import { HttpException, HttpStatus } from '@nestjs/common';

/* ЛИМИТ ВХОДА (152-ФЗ, Р-45; план 13.2). Вход шёл без ограничения: пароль
 * сотрудника гостиницы можно было подбирать бесконечно, и никто бы не узнал.
 *
 * Счётчик неудач — в Redis, окно 15 минут, два ключа: по адресу почты (подбор
 * пароля одного человека) и по IP (перебор адресов с одной машины). Порог
 * достигнут — 429 до конца окна, даже с верным паролем: иначе подбор просто
 * продолжался бы, а отличить «угадал» от «вспомнил» нельзя. Удачный вход
 * обнуляет счётчик своей почты. */

export const WINDOW_SECONDS = 15 * 60;
export const MAX_PER_EMAIL = 5;
export const MAX_PER_IP = 20;

/** То, что нужно от Redis: счётчик с окном. */
export interface CounterStore {
  get(key: string): Promise<string | null>;
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  del(key: string): Promise<number>;
  ttl(key: string): Promise<number>;
}

const emailKey = (email: string) => `login:fail:email:${email.toLowerCase()}`;
const ipKey = (ip: string) => `login:fail:ip:${ip}`;

export class LoginThrottle {
  constructor(private readonly store: CounterStore) {}

  /** До проверки пароля: порог уже достигнут — 429. */
  async assertAllowed(email: string, ip?: string): Promise<void> {
    const keys: Array<[string, number]> = [[emailKey(email), MAX_PER_EMAIL]];
    if (ip) keys.push([ipKey(ip), MAX_PER_IP]);
    for (const [key, max] of keys) {
      if (Number((await this.store.get(key)) ?? 0) >= max) {
        const left = Math.max(1, Math.ceil((await this.store.ttl(key)) / 60));
        throw new HttpException(`Слишком много неудачных попыток. Попробуйте через ${left} мин.`, HttpStatus.TOO_MANY_REQUESTS);
      }
    }
  }

  /** Неудача: +1 в обоих окнах. Возвращает счёт по почте — для журнала. */
  async fail(email: string, ip?: string): Promise<number> {
    const keys = [emailKey(email), ...(ip ? [ipKey(ip)] : [])];
    let byEmail = 0;
    for (const key of keys) {
      const n = await this.store.incr(key);
      if (n === 1) await this.store.expire(key, WINDOW_SECONDS);
      if (key === keys[0]) byEmail = n;
    }
    return byEmail;
  }

  async success(email: string): Promise<void> {
    await this.store.del(emailKey(email));
  }
}
