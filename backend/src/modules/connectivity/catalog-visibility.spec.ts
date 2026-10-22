import { NotFoundException } from '@nestjs/common';
import { ConnectivityService } from './connectivity.service';

/* Каталог для партнёра (решение владельца Kars Avia 22.10.2026): скрытая из
 * каталога гостиница — рабочая, её видят диспетчеры и не видят авиакомпании;
 * выключенную видит только администратор. Различие людей проводит партнёр,
 * поэтому PMS отдаёт скрытые и выключенные ТОЛЬКО по просьбе и с признаками
 * в карточке, а без просьбы — прежний каталог. */

type T = { id: string; slug: string; isActive: boolean; partnerVisible: boolean; provisional: boolean };
const TENANTS: T[] = [
  { id: '1', slug: 'visible', isActive: true, partnerVisible: true, provisional: false },
  { id: '2', slug: 'hidden', isActive: true, partnerVisible: false, provisional: false },
  { id: '3', slug: 'off', isActive: false, partnerVisible: true, provisional: false },
  { id: '4', slug: 'once', isActive: true, partnerVisible: false, provisional: true },
  { id: '5', slug: 'platform', isActive: true, partnerVisible: true, provisional: false },
];

/* Ровно та форма условия, которую строит listHotels: равенства, slug.not и OR. */
function matches(t: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === 'OR') return (v as Record<string, unknown>[]).some((w) => matches(t, w));
    if (v && typeof v === 'object' && 'not' in v) return t[k] !== (v as { not: unknown }).not;
    return t[k] === v;
  });
}

function service() {
  const svc = Object.create(ConnectivityService.prototype) as ConnectivityService;
  const prisma = {
    admin: {
      tenant: {
        findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
          TENANTS.filter((t) => matches(t, where)).map((t) => ({ ...t, name: t.slug, country: 'RU' })),
        ),
        findUnique: jest.fn(async ({ where }: { where: { slug: string } }) => TENANTS.find((t) => t.slug === where.slug) ?? null),
      },
      roomType: { groupBy: jest.fn(async () => []) },
    },
  };
  Object.assign(svc, { prisma });
  return svc;
}

const slugs = async (opts: Parameters<ConnectivityService['listHotels']>[0]) =>
  (await service().listHotels(opts)).map((h) => h.slug).sort();

describe('Каталог PMS — скрытые и выключенные только по просьбе', () => {
  it('без просьбы — только видимые и действующие', async () => {
    expect(await slugs({})).toEqual(['visible']);
  });

  it('includeHidden — добавляет скрытые, но не разовые и не выключенные', async () => {
    expect(await slugs({ includeHidden: true })).toEqual(['hidden', 'visible']);
  });

  it('includeInactive — добавляет выключенные, но не скрытые', async () => {
    expect(await slugs({ includeInactive: true })).toEqual(['off', 'visible']);
  });

  it('разовые — своей просьбой, скрытые к ним не подмешиваются', async () => {
    expect(await slugs({ includeProvisional: true })).toEqual(['once', 'visible']);
  });

  it('признаки едут в карточке — партнёр по ним решает, кому показать', async () => {
    const all = await service().listHotels({ includeHidden: true, includeInactive: true });
    const by = Object.fromEntries(all.map((h) => [h.slug, h]));
    expect(by.hidden).toMatchObject({ partnerVisible: false, isActive: true });
    expect(by.off).toMatchObject({ partnerVisible: true, isActive: false });
    expect(by.platform).toBeUndefined();
  });

  it('выключенная по прямой ссылке — только на чтение карточки', async () => {
    const svc = service() as unknown as { resolveTenant: (s: string, o?: object) => Promise<T> };
    await expect(svc.resolveTenant('off')).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.resolveTenant('off', { allowInactive: true })).resolves.toMatchObject({ slug: 'off' });
    await expect(svc.resolveTenant('hidden')).resolves.toMatchObject({ slug: 'hidden' });
  });
});
