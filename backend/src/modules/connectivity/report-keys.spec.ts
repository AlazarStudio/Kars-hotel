import {
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  RequestMethod,
  UnauthorizedException,
} from '@nestjs/common';
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import { HttpExceptionFilter } from '../../common/filters/http-exception.filter';
import { ConnectivityController } from './connectivity.controller';
import { ConnectivityService } from './connectivity.service';
import { PARTNER_SCOPES, PARTNER_SCOPES_KEY } from './decorators/partner-scopes.decorator';
import { PartnerApiKeyGuard } from './guards/partner-api-key.guard';

const AVIA = 'avia-partner';
const OTHER = 'other-partner';
const FIXTURE_KEY = 'fixture-report-key-for-test-only-0001';
const OTHER_KEY = 'fixture-other-partner-key-only-0002';

const hotels = [
  {
    id: '1',
    slug: 'visible',
    isActive: true,
    archivedAt: null,
    partnerVisible: true,
    provisional: false,
  },
  {
    id: '2',
    slug: 'hidden',
    isActive: true,
    archivedAt: null,
    partnerVisible: false,
    provisional: false,
  },
  {
    id: '3',
    slug: 'once',
    isActive: true,
    archivedAt: null,
    partnerVisible: false,
    provisional: true,
  },
  {
    id: '4',
    slug: 'inactive',
    isActive: false,
    archivedAt: null,
    partnerVisible: true,
    provisional: false,
  },
  {
    id: '5',
    slug: 'archived',
    isActive: true,
    archivedAt: new Date('2026-01-01'),
    partnerVisible: true,
    provisional: false,
  },
  {
    id: '6',
    slug: 'platform',
    isActive: true,
    archivedAt: null,
    partnerVisible: true,
    provisional: false,
  },
  {
    id: '7',
    slug: 'unowned',
    isActive: true,
    archivedAt: null,
    partnerVisible: true,
    provisional: false,
  },
];
const keys = [
  { tenantId: '1', partnerId: AVIA, key: FIXTURE_KEY },
  { tenantId: '3', partnerId: OTHER, key: OTHER_KEY },
  { tenantId: '7', partnerId: null, key: OTHER_KEY },
];
const rejectedPartners = [
  ['другой партнёр', { id: OTHER, code: 'other', isActive: true }, OTHER],
  ['выключенная Авия', { id: AVIA, code: 'kars-avia', isActive: false }, AVIA],
  ['отсутствующая Авия', null, AVIA],
  ['несовпадающий id', { id: AVIA, code: 'kars-avia', isActive: true }, OTHER],
  ['пустой id', { id: AVIA, code: 'kars-avia', isActive: true }, ''],
] as const;

type Filter = Record<string, unknown>;
function matches(row: object, where: Filter): boolean {
  const values = row as Record<string, unknown>;
  return Object.entries(where).every(([field, expected]) => {
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      const condition = expected as { not?: unknown; in?: unknown[] };
      if ('not' in condition) return values[field] !== condition.not;
      if (condition.in) return condition.in.includes(values[field]);
    }
    return values[field] === expected;
  });
}

type ReportStatus = {
  journalRedacted: boolean;
  hotels: Array<{ slug: string; fingerprint: string | null }>;
};
type ReportsService = ConnectivityService & {
  listReportKeys: (partnerId: string) => Promise<ReportStatus>;
};

function setup(
  partner: { id: string; code: string; isActive: boolean } | null = {
    id: AVIA,
    code: 'kars-avia',
    isActive: true,
  },
) {
  const admin = {
    partner: {
      findUnique: jest.fn(async ({ where }: { where: Filter }) =>
        partner && matches(partner, where) ? partner : null,
      ),
    },
    tenant: {
      findMany: jest.fn(async ({ where }: { where: Filter }) =>
        hotels.filter((hotel) => matches(hotel, where)),
      ),
      findUnique: jest.fn(
        async ({ where }: { where: Filter }) =>
          hotels.find((hotel) => matches(hotel, where)) ?? null,
      ),
    },
    aviaReportsKey: {
      findMany: jest.fn(async ({ where }: { where: Filter }) =>
        keys.filter((key) => matches(key, where)),
      ),
      upsert: jest.fn(async () => undefined),
    },
  };
  const service = Object.create(ConnectivityService.prototype) as ReportsService;
  const logger = { error: jest.fn() };
  Object.assign(service, { prisma: { admin }, logger });
  return { service, admin, logger };
}

describe('внутренняя сверка ключей отчётов', () => {
  it('возвращает только отпечатки ключей Авии и активные гостиницы каталога', async () => {
    const { service } = setup();
    const result = await service.listReportKeys(AVIA);
    expect(result.journalRedacted).toBe(true);
    expect(result.hotels.map((hotel) => hotel.slug).sort()).toEqual([
      'hidden',
      'once',
      'unowned',
      'visible',
    ]);
    expect(result.hotels).toEqual(
      expect.arrayContaining([
        {
          slug: 'visible',
          fingerprint: createHash('sha256').update(FIXTURE_KEY, 'utf8').digest('hex'),
        },
        { slug: 'hidden', fingerprint: null },
        { slug: 'once', fingerprint: null },
        { slug: 'unowned', fingerprint: null },
      ]),
    );
    expect(JSON.stringify(result)).not.toContain(FIXTURE_KEY);
    expect(JSON.stringify(result)).not.toContain(OTHER_KEY);
  });

  it.each(rejectedPartners)('%s не читает ключи', async (_name, partner, partnerId) => {
    const { service, admin } = setup(partner);
    await expect(service.listReportKeys(partnerId)).rejects.toBeInstanceOf(ForbiddenException);
    expect(admin.tenant.findMany).not.toHaveBeenCalled();
    expect(admin.aviaReportsKey.findMany).not.toHaveBeenCalled();
  });

  it.each(rejectedPartners)('%s не меняет ключи', async (_name, partner, partnerId) => {
    const { service, admin } = setup(partner);
    await expect(service.setReportsKey('visible', FIXTURE_KEY, partnerId)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(admin.tenant.findUnique).not.toHaveBeenCalled();
    expect(admin.aviaReportsKey.upsert).not.toHaveBeenCalled();
  });

  it.each(['inactive', 'archived', 'platform'])('не подключает гостиницу %s', async (slug) => {
    const { service, admin } = setup();
    await expect(service.setReportsKey(slug, FIXTURE_KEY, AVIA)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(admin.aviaReportsKey.upsert).not.toHaveBeenCalled();
  });

  it.each(['visible', 'hidden', 'once'])('подключает действующую гостиницу %s', async (slug) => {
    const { service, admin } = setup();
    const hotel = hotels.find((row) => row.slug === slug)!;
    await expect(service.setReportsKey(slug, FIXTURE_KEY, AVIA)).resolves.toBeUndefined();
    expect(admin.aviaReportsKey.upsert).toHaveBeenCalledWith({
      where: { tenantId: hotel.id },
      create: { tenantId: hotel.id, key: FIXTURE_KEY, partnerId: AVIA },
      update: { key: FIXTURE_KEY, partnerId: AVIA },
    });
  });

  it.each(['read', 'write'] as const)(
    'ошибка операции %s с ключом не раскрывает его в ответе и логе',
    async (operation) => {
      const { service, admin, logger } = setup();
      const failure = new Error(`fixture database failure: ${FIXTURE_KEY}`);
      if (operation === 'read') admin.aviaReportsKey.findMany.mockRejectedValueOnce(failure);
      else admin.aviaReportsKey.upsert.mockRejectedValueOnce(failure);
      const error = await (
        operation === 'read'
          ? service.listReportKeys(AVIA)
          : service.setReportsKey('visible', FIXTURE_KEY, AVIA)
      ).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(InternalServerErrorException);
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(logger.error.mock.calls)).not.toContain(FIXTURE_KEY);
      const json = jest.fn();
      const status = jest.fn(() => ({ json }));
      const host = {
        switchToHttp: () => ({
          getResponse: () => ({ headersSent: false, status }),
          getRequest: () => ({ method: 'PUT', url: '/api/connect/v1/hotels/visible/reports-key' }),
        }),
      } as never;
      const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        new HttpExceptionFilter().catch(error, host);
        expect(log).not.toHaveBeenCalled();
        expect(status).toHaveBeenCalledWith(500);
        expect(JSON.stringify(json.mock.calls)).not.toContain(FIXTURE_KEY);
      } finally {
        log.mockRestore();
      }
    },
  );
});

describe('доступ к маршрутам ключей отчётов', () => {
  const handlerOf = (name: string) => Reflect.get(ConnectivityController.prototype, name) as object;

  it('открывает нужный GET и сохраняет статус PUT', () => {
    const get = handlerOf('getReportKeys');
    expect(typeof get).toBe('function');
    expect(Reflect.getMetadata(PATH_METADATA, get)).toBe('report-keys');
    expect(Reflect.getMetadata(METHOD_METADATA, get)).toBe(RequestMethod.GET);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handlerOf('setReportsKey'))).toBe(204);
    expect(Reflect.getMetadata(GUARDS_METADATA, ConnectivityController)).toContain(
      PartnerApiKeyGuard,
    );
  });

  it.each(['getReportKeys', 'setReportsKey'])(
    '%s требует hotels:write и проверенный ключ',
    async (name) => {
      const handler = handlerOf(name);
      expect(typeof handler).toBe('function');
      expect(Reflect.getMetadata(PARTNER_SCOPES_KEY, handler)).toEqual([
        PARTNER_SCOPES.HotelsWrite,
      ]);
      const req = { header: () => 'fixture-api-key', headers: {} };
      const ctx = {
        switchToHttp: () => ({ getRequest: () => req }),
        getHandler: () => handler,
        getClass: () => ConnectivityController,
      } as never;
      const verify = jest.fn();
      const guard = new PartnerApiKeyGuard({ verify } as never, new Reflector());
      verify.mockResolvedValueOnce(null);
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
      verify.mockResolvedValueOnce({
        id: 'api',
        name: 'api',
        partnerId: AVIA,
        scopes: [PARTNER_SCOPES.HotelsRead],
      });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
      verify.mockResolvedValueOnce({
        id: 'api',
        name: 'api',
        partnerId: AVIA,
        scopes: [PARTNER_SCOPES.HotelsWrite],
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    },
  );
});
