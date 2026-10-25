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
      'createTenant',
      'deleteTenant',
      'getStats',
      'impersonate',
      'listFeatures',
      'listTenants',
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
});
