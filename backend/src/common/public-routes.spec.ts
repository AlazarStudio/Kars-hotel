import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '../modules/auth/decorators/public.decorator';
import { PartnerApiKeyGuard } from '../modules/connectivity/guards/partner-api-key.guard';

/* ЗАКРЫТЫЙ СПИСОК ТОГО, ЧТО ДОСТУПНО БЕЗ ВХОДА (152-ФЗ, Т-27; план 13.12).
 *
 * Глобальный гард пускает без сессии всё, что помечено @Public(). Пометку
 * легко поставить «на время» и забыть — и ручка с ФИО гостей окажется
 * открытой. Тест обходит ВСЕ контроллеры и сверяет открытые ручки со списком
 * ниже. Новая открытая ручка — сначала сюда, с причиной; иначе сборка падает.
 * Партнёрский API открыт для гарда сессий, но закрыт ключом партнёра на
 * уровне класса — это тоже проверяется. */

const ALLOWED: Record<string, string> = {
  'AuthController.login': 'вход',
  'AuthController.refresh': 'продление по куке',
  'AuthController.logout': 'выход по куке',
  'AuthController.peekInvite': 'чья гостиница в приглашении — по одноразовому токену',
  'AuthController.acceptInvite': 'принять приглашение — по одноразовому токену',
  'AuthController.ssoExchange': 'вход диспетчера — по одноразовому коду',
  'AuthController.registerTenant': 'закрыта: всегда 403 «по приглашению»',
  'HealthController.check': 'проверка живости без данных',
};

function controllers(): Array<new (...a: never[]) => unknown> {
  const out: Array<new (...a: never[]) => unknown> = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (name.endsWith('.controller.ts')) {
        for (const exp of Object.values(require(full) as Record<string, unknown>)) {
          if (typeof exp === 'function' && Reflect.getMetadata('path', exp) !== undefined) out.push(exp as never);
        }
      }
    }
  };
  walk(join(__dirname, '..', 'modules'));
  return out;
}

describe('Открыто без входа — только по списку', () => {
  const all = controllers();
  const open: string[] = [];
  const keyGuarded: string[] = [];
  for (const ctl of all) {
    const classPublic = Reflect.getMetadata(IS_PUBLIC_KEY, ctl) === true;
    const classGuards = (Reflect.getMetadata(GUARDS_METADATA, ctl) ?? []) as unknown[];
    for (const name of Object.getOwnPropertyNames(ctl.prototype)) {
      if (name === 'constructor') continue;
      const handler = (ctl.prototype as Record<string, unknown>)[name];
      if (typeof handler !== 'function' || Reflect.getMetadata('method', handler) === undefined) continue;
      const isPublic = classPublic || Reflect.getMetadata(IS_PUBLIC_KEY, handler) === true;
      if (!isPublic) continue;
      const id = `${ctl.name}.${name}`;
      if (classGuards.includes(PartnerApiKeyGuard)) keyGuarded.push(id);
      else open.push(id);
    }
  }

  it('нашли контроллеры', () => {
    expect(all.length).toBeGreaterThan(10);
  });

  it('открытые ручки — ровно те, что в списке', () => {
    expect(open.sort()).toEqual(Object.keys(ALLOWED).sort());
  });

  it('партнёрский API без сессии — только с ключом партнёра', () => {
    expect(keyGuarded.length).toBeGreaterThan(5);
    expect(keyGuarded.every((id) => id.startsWith('ConnectivityController.'))).toBe(true);
  });
});
