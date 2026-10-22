/* ФУНКЦИИ ГОСТИНИЦ — каталог для массового включения из панели платформы
 * (решение владельца Kars Avia 22.10.2026).
 *
 * Каждая функция — булева колонка гостиницы (`tenant`), которую гостиница
 * сама включает в «Настройки → Функции». Здесь их можно включить или
 * выключить сразу у выбранных гостиниц. Новая функция — новая строка
 * каталога: ключ — имя поля Prisma у `Tenant`. Ключа вне каталога сервер не
 * примет — массово писать произвольное поле гостиницы нельзя. */

export const TENANT_FEATURES = [
  {
    key: 'multiPlaceEnabled',
    label: 'Многоместные номера',
    description:
      'Позволяет расселять гостей по местам внутри одного номера: в шахматке появляются места (Место 1, Место 2…) и кнопка разворачивания номера.',
  },
] as const;

export type TenantFeatureKey = (typeof TENANT_FEATURES)[number]['key'];

export const TENANT_FEATURE_KEYS: readonly string[] = TENANT_FEATURES.map((f) => f.key);

export function isTenantFeature(key: unknown): key is TenantFeatureKey {
  return typeof key === 'string' && TENANT_FEATURE_KEYS.includes(key);
}
