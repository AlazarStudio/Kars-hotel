/** Local PMS read-model fixture; no Avia sync, accounts, mail or bookings.
 * From backend/: node --env-file=.env scripts/seed-tariff-periods.cjs --tenant=benamar-hotelspa --apply
 * Without --apply, only reports the target and fixture. Existing hotel data is not replaced.
 */
const { PrismaClient } = require('@prisma/client');
const assert = require('node:assert/strict');

const partnerCode = 'qa-pms-tariff-periods';
const contractNumber = 'QA-DS-2026-11';
const marker = 'QA: local tariff periods fixture';
const periods = [
  { amendment: null, from: '2026-11-07', to: '2026-11-13', vat: 0, double: [3000, 4400], triple: [3500, 4900, 6200] },
  { amendment: '1', from: '2026-11-14', to: '2026-11-18', vat: 5, double: [3300, 4700], triple: [3800, 5200, null] },
  // 19 November deliberately has no document; DS 1 deliberately lacks a price for three guests.
  { amendment: '2', from: '2026-11-20', to: '2026-11-27', vat: 10, double: [3600, 5000], triple: [4100, 5500, 7000] },
];
const at = (day) => new Date(`${day}T00:00:00.000Z`);

async function main() {
  const slug = process.argv.find((arg) => arg.startsWith('--tenant='))?.slice(9);
  assert.ok(slug, 'Specify --tenant=<local hotel slug>');
  assert.notEqual(process.env.NODE_ENV, 'production', 'Only a local development environment is supported');
  const url = process.env.DATABASE_URL_MIGRATIONS || process.env.DATABASE_URL;
  assert.ok(url, 'Database configuration is required');
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname), 'Only a loopback database is supported');
  const db = new PrismaClient({ datasources: { db: { url } }, log: [] });
  try {
    const tenant = await db.tenant.findUnique({ where: { slug }, select: { id: true, slug: true, name: true } });
    assert.ok(tenant, 'Local tenant not found');
    const existing = await db.partner.findUnique({ where: { code: partnerCode } });
    assert.ok(!existing || existing.name === 'QA — периоды ДС и гости', 'Fixture partner code already belongs to other data');
    console.log(JSON.stringify({ tenant: tenant.slug, contractNumber, periods, apply: process.argv.includes('--apply') }, null, 2));
    if (!process.argv.includes('--apply')) return;
    const result = await db.$transaction(async (tx) => {
      const partner = await tx.partner.upsert({ where: { code: partnerCode }, update: {}, create: { code: partnerCode, name: 'QA — периоды ДС и гости' } });
      const account = await tx.partnerAccount.upsert({ where: { partnerId_code: { partnerId: partner.id, code: 'qa-local' } }, update: {}, create: { partnerId: partner.id, code: 'qa-local', name: 'QA — тестовое юрлицо' } });
      const rooms = [];
      for (const [code, name, capacity] of [['QA_DS_DOUBLE', 'QA Двухместный', 2], ['QA_DS_TRIPLE', 'QA Трёхместный', 3]]) {
        const where = { tenantId_code: { tenantId: tenant.id, code } };
        const found = await tx.roomType.findUnique({ where });
        assert.ok(!found || found.description === marker, 'Fixture category code already belongs to other data');
        rooms.push(await tx.roomType.upsert({ where, update: {}, create: { tenantId: tenant.id, code, name, description: marker, baseOccupancy: capacity, maxOccupancy: capacity, sortOrder: 900 + capacity } }));
      }
      const contractData = { accountCode: account.code, accountName: account.name, validFrom: at(periods[0].from), validTo: at(periods.at(-1).to), state: 'ACTIVE', services: ['ACCOMMODATION'], sheetsCount: periods.length };
      const contract = await tx.partnerContract.upsert({ where: { tenantId_partnerId_number: { tenantId: tenant.id, partnerId: partner.id, number: contractNumber } }, update: contractData, create: { tenantId: tenant.id, partnerId: partner.id, number: contractNumber, ...contractData } });
      for (const period of periods) {
        const where = { tenantId: tenant.id, partnerId: partner.id, contractNumber, amendmentNumber: period.amendment, service: 'ACCOMMODATION', validFrom: at(period.from) };
        const cells = [period.double, period.triple].flatMap((prices, i) => prices.flatMap((rub, j) => rub == null ? [] : [{ categoryId: rooms[i].id, occupancy: j + 1, price: rub * 100 }]));
        const data = { ...where, accountCode: account.code, accountName: account.name, validTo: at(period.to), vatRate: period.vat, rows: [], fill: [{ from: period.from, slices: [{ customer: null, guestKind: 'CREW', mealPlan: 'NONE', cells }] }] };
        const found = await tx.partnerContractPrice.findFirst({ where, select: { id: true } });
        if (found) await tx.partnerContractPrice.update({ where: { id: found.id }, data });
        else await tx.partnerContractPrice.create({ data });
      }
      await tx.auditLog.create({ data: { tenantId: tenant.id, entity: 'PartnerContract', entityId: contract.id, action: 'QA_FIXTURE_SEED', diff: { after: { contractNumber, partnerCode, categories: rooms.map((room) => room.code) } } } });
      return { partnerId: partner.id, contractNumber, categories: rooms.map(({ id, code, maxOccupancy }) => ({ id, code, maxOccupancy })) };
    });
    console.log(JSON.stringify({ seeded: result }, null, 2));
  } finally {
    await db.$disconnect();
  }
}
main().catch((err) => { console.error(err instanceof assert.AssertionError ? err.message : 'Fixture failed; no credentials or connection details logged.'); process.exitCode = 1; });
