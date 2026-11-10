import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { SuperAdminController } from './super-admin.controller';
import { PlatformOperatorGuard, SuperAdminGuard } from './super-admin.guard';

/* 152-ФЗ, Р-34; план 13.3. Диспетчер Kars Avia — не суперадмин: в панели
 * платформы ему открыты сводка, гостиницы (с 25.10.2026 — и заведение,
 * правка, выключение, удаление) и вход «от имени». Сотрудники всех гостиниц
 * и настройки — только суперадмину. У КАЖДОЙ ручки свой гард: новая без
 * гарда валит тест. */

const handlers = Object.getOwnPropertyNames(SuperAdminController.prototype).filter((n) => n !== 'constructor');
const guardsOf = (name: string) =>
  (Reflect.getMetadata(GUARDS_METADATA, (SuperAdminController.prototype as never)[name]) ?? []) as unknown[];

const ctx = (user: object) => ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as never;

describe('Панель платформы — гарды', () => {
  it('у каждой ручки есть гард', () => {
    expect(handlers.filter((h) => guardsOf(h).length === 0)).toEqual([]);
  });

  /* + функции гостиниц массово (решение владельца 22.10.2026): персональных
     данных в них нет.
     + заведение, правка, выключение и удаление пустой гостиницы (решение
     владельца 25.10.2026). Уход по акту с выгрузкой (exportTenant,
     destroyTenant) — НЕ диспетчеру: днём 25.10 был открыт, вечером владелец
     вернул суперадмину (стирает данные, выгрузка — все ПДн гостиницы).
     Сотрудники гостиниц (getTenant, listUsers, toggleUserActive) и
     настройки — тоже НЕ диспетчеру. */
  it('диспетчеру — ровно сводка, гостиницы, вход «от имени» и функции гостиниц', () => {
    const forDispatcher = handlers.filter((h) => guardsOf(h).includes(PlatformOperatorGuard)).sort();
    expect(forDispatcher).toEqual([
      'applyFeature',
      'archiveTenant',
      'createTenant',
      'deleteTenant',
      'getStats',
      'impersonate',
      'listFeatures',
      'listTenants',
      'restoreTenant',
      'tenantSummary',
      'toggleActive',
      'updateTenant',
    ]);
    expect(handlers.filter((h) => !forDispatcher.includes(h)).every((h) => guardsOf(h).includes(SuperAdminGuard))).toBe(true);
  });

  it('PlatformOperatorGuard: суперадмин и диспетчер вне гостиницы — да; сотрудник и диспетчер «от имени» — нет', () => {
    const g = new PlatformOperatorGuard();
    expect(g.canActivate(ctx({ isSuperAdmin: true }))).toBe(true);
    expect(g.canActivate(ctx({ isDispatcher: true }))).toBe(true);
    expect(() => g.canActivate(ctx({ isDispatcher: true, impersonatedBy: 'd1' }))).toThrow(ForbiddenException);
    expect(() => g.canActivate(ctx({ roleCode: 'OWNER' }))).toThrow(ForbiddenException);
  });

  it('SuperAdminGuard диспетчера не пускает', () => {
    expect(() => new SuperAdminGuard().canActivate(ctx({ isDispatcher: true }))).toThrow(ForbiddenException);
  });

  /* Интерфейс показывает ответ сервера как есть, поэтому отказ обязан быть
     понятным по-русски и называть причину кодом: прежняя английская строка
     «Platform access required» выходила в русской форме заведения гостиницы
     у диспетчера в режиме «от имени» (11.11.2026). */
  it('отказ объясняет причину кодом и русским текстом, без английской строки', () => {
    const response = (activate: () => boolean) => {
      try {
        activate();
      } catch (err) {
        return (err as ForbiddenException).getResponse() as { code: string; message: string };
      }
      throw new Error('отказа не было');
    };
    const platform = new PlatformOperatorGuard();
    const admin = new SuperAdminGuard();

    const staffDenied = response(() => platform.canActivate(ctx({ roleCode: 'OWNER' })));
    expect(staffDenied.code).toBe('PLATFORM_ACCESS_REQUIRED');

    const impersonatingDenied = response(() => platform.canActivate(ctx({ isDispatcher: true, impersonatedBy: 'd1' })));
    expect(impersonatingDenied.code).toBe('PLATFORM_ACCESS_WHILE_IMPERSONATING');
    expect(impersonatingDenied.message).toMatch(/Выйдите из режима «от имени»/);

    expect(response(() => admin.canActivate(ctx({ isDispatcher: true }))).code).toBe('SUPER_ADMIN_REQUIRED');
    for (const denied of [staffDenied, impersonatingDenied]) {
      expect(denied.message).toMatch(/[А-Яа-яЁё]/);
      expect(denied.message).not.toMatch(/Platform access required/i);
    }
  });
});
