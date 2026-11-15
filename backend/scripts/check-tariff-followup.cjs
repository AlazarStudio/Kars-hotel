/* Local PMS regression, from backend/:
 * node --env-file=.env scripts/check-tariff-followup.cjs legacy --apply
 * node --env-file=.env scripts/check-tariff-followup.cjs init|prepare|update|cleanup --apply
 * UI flow: init; open /tariffs; prepare; observe the registry; open a wizard;
 * update (directory only); observe the untouched draft; close it; cleanup.
 */
const assert = require('node:assert/strict');
const { createHash, randomBytes, randomUUID } = require('node:crypto');
const { readFileSync, unlinkSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { PrismaClient } = require('@prisma/client');

const base = 'http://localhost:3001/api/connect/v1';
const benamar = 'benamar-hotelspa';
const manifest = join(tmpdir(), 'kars-hotel-tariff-followup-local.json');
const day = (offset) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const at = (date) => new Date(`${date}T00:00:00Z`);
const qaCode = (id) => `qa-tariff-followup-${id}`;
const contractNo = (id) => `QA-DIR-${id.slice(0, 8).toUpperCase()}`;
const uuid = /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/;

function checkLocal(url) {
  let target;
  try { target = new URL(url); } catch { throw new Error('Missing or invalid local URL'); }
  assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(target.hostname), 'Loopback only');
}

function createPartner(tx, id) {
  return tx.partner.create({ data: { id, code: qaCode(id), name: `QA Tariff ${id.slice(0, 8)}` } });
}

async function withKey(db, partnerId, scopes, run) {
  const raw = `klh_test_${randomBytes(24).toString('base64url')}`;
  const { id } = await db.partnerApiKey.create({ data: {
    partnerId, scopes, name: 'QA tariff followup',
    keyPrefix: raw.slice(0, 16), keyHash: createHash('sha256').update(raw).digest('hex'),
    expiresAt: new Date(Date.now() + 5 * 60_000),
  } });
  try {
    await run(async (path, method = 'GET', body, status = 200) => {
      const response = await fetch(`${base}${path}`, {
        method, headers: { 'X-Api-Key': raw, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      });
      assert.equal(response.status, status, `${method} ${path} HTTP status`);
      return response.json();
    });
  } finally {
    await db.partnerApiKey.delete({ where: { id, partnerId } });
  }
}

async function legacy(db) {
  const partnerId = randomUUID();
  const slug = qaCode(partnerId);
  const closedDate = day(4);
  const openDates = { checkIn: day(2), checkOut: closedDate };
  const closedDates = { checkIn: day(3), checkOut: day(5) };
  const { tenantId, categoryId, roomId, planId } = await db.$transaction(async (tx) => {
    await createPartner(tx, partnerId);
    const { id: tenantId } = await tx.tenant.create({ data: { slug, name: 'QA tariff followup', partnerVisible: false } });
    const { id: categoryId } = await tx.roomType.create({ data: { tenantId, code: 'QA', name: 'QA', basePrice: 1000 } });
    const { id: roomId } = await tx.room.create({ data: { tenantId, roomTypeId: categoryId, number: 'QA', capacity: 2, doubleBeds: 1 } });
    const { id: planId } = await tx.ratePlan.create({ data: {
      tenantId, partnerId, code: 'QA_CORP', name: 'QA corporate no grid', forOperator: true, operatorContract: 'QA-NO-GRID',
    } });
    const row = { tenantId, roomTypeId: categoryId, ratePlanId: planId, occupancy: 0, price: 100 };
    await tx.standardRate.create({ data: row });
    await tx.rate.create({ data: { ...row, date: at(openDates.checkIn) } });
    await tx.rateSeason.create({ data: { ...row, name: 'QA historical', dateFrom: at(openDates.checkIn), dateTo: at(closedDates.checkOut) } });
    await tx.restriction.create({ data: { tenantId, roomTypeId: categoryId, date: at(closedDate), stopSell: true } });
    return { tenantId, categoryId, roomId, planId };
  });
  try {
    await withKey(db, partnerId, ['availability:read', 'reservations:write'], async (api) => {
      const path = `/hotels/${slug}`;
      const availability = (dates) => api(`${path}/availability?${new URLSearchParams({ ...dates, categoryId, guests: '2' })}`);
      const open = await availability(openDates);
      assert.equal(open.offers.length, 1, 'One offer in the isolated QA hotel');
      assert.equal(open.offers[0].nightlyRate, 1000, 'The base rate must win over historical corporate prices');
      assert.deepEqual(open.offers[0].ratePlans, [], 'Unpriced corporate tariff must not be offered');
      assert.equal(open.corporateTariff?.ratePlanId, planId);
      assert.equal(open.corporateTariff?.applies, false);
      console.log('PASS isolated corporate tariff: 1000 RUB, ratePlans=[], applies=false');

      const closed = await availability(closedDates);
      assert.deepEqual(closed.offers, [], 'A general stop sale prevents category fallback');
      const rejected = await api(`${path}/reservations`, 'POST', {
        ...closedDates, categoryId, roomId, guestName: 'QA tariff followup', adults: 2,
      }, 409);
      assert.match(rejected.message ?? '', /rate-plan restrictions/);
      assert.equal(await db.reservation.count({ where: { tenantId, roomId } }), 0);
      console.log('PASS general stop sale: no offer, booking without ratePlanId rejected');
    });
  } finally {
    await db.$transaction(async (tx) => {
      const reservations = await tx.reservation.findMany({ where: { tenantId, roomId }, select: { id: true } });
      const ids = reservations.map(({ id }) => id);
      await tx.folio.deleteMany({ where: { tenantId, reservationId: { in: ids } } });
      await tx.reservation.deleteMany({ where: { tenantId, roomId, id: { in: ids } } });
      await tx.restriction.deleteMany({ where: { tenantId, roomTypeId: categoryId } });
      await tx.ratePlan.delete({ where: { id: planId, tenantId, partnerId } });
      await tx.room.delete({ where: { id: roomId, tenantId, roomTypeId: categoryId } });
      await tx.roomType.delete({ where: { id: categoryId, tenantId } });
      await tx.partnerApiKey.deleteMany({ where: { partnerId, name: 'QA tariff followup' } });
      await tx.partner.delete({ where: { id: partnerId, code: slug } });
      await tx.tenant.delete({ where: { id: tenantId, slug } });
    });
    console.log('PASS isolated fixture removed');
  }
}

async function directory(db, command) {
  const tenant = await db.tenant.findUniqueOrThrow({ where: { slug: benamar }, select: { id: true } });
  if (command === 'init') {
    const partnerId = randomUUID();
    writeFileSync(manifest, JSON.stringify({ tenantId: tenant.id, partnerId }), { flag: 'wx', mode: 0o600 });
    try { await createPartner(db, partnerId); } catch (error) { unlinkSync(manifest); throw error; }
    console.log(`Ready to open /tariffs. Test contract: ${contractNo(partnerId)}.`);
    return;
  }
  const { tenantId, partnerId } = JSON.parse(readFileSync(manifest, 'utf8'));
  assert.ok(tenantId === tenant.id && uuid.test(partnerId), 'Unrecognized local fixture');
  const number = contractNo(partnerId);
  const partner = await db.partner.findUniqueOrThrow({ where: { id: partnerId, code: qaCode(partnerId) }, select: { id: true } });
  if (command === 'cleanup') {
    await db.$transaction(async (tx) => {
      await tx.ratePlan.deleteMany({ where: { tenantId, partnerId, operatorContract: number } });
      await tx.partnerApiKey.deleteMany({ where: { partnerId, name: 'QA tariff followup' } });
      await tx.partner.delete({ where: { id: partner.id, code: qaCode(partnerId) } }); // cascades to this fixture's directory and documents
    });
    unlinkSync(manifest);
    console.log(`PASS removed ${number} and its isolated partner`);
    return;
  }

  const identity = { account: { code: 'qa-legal', name: 'QA Legal' }, customer: { code: 'QA-AIR', name: 'QA Airline' } };
  const account = { ...identity.account, name: `${identity.account.name}${command === 'update' ? ' Updated' : ''}` };
  const customer = { ...identity.customer, name: `${identity.customer.name}${command === 'update' ? ' Updated' : ''}` };
  await withKey(db, partnerId, command === 'prepare' ? ['directory:write', 'contract-prices:write'] : ['directory:write'], async (api) => {
    const synced = await api('/partner/directory', 'PUT', { accounts: [account], customers: [customer] });
    assert.equal(synced.accounts.active, 1);
    assert.equal(synced.customers.active, 1);
    if (command === 'prepare') {
      const category = await db.roomType.findFirstOrThrow({ where: { tenantId, isActive: true, maxOccupancy: { gte: 2 } }, select: { id: true } });
      const from = day(-7);
      const service = 'ACCOMMODATION';
      const result = await api(`/hotels/${benamar}/contract-prices/sync`, 'PUT', {
        contracts: [{ number, account, signedAt: from, state: 'ACTIVE', isPrimary: false, services: [service], sheets: 1 }],
        documents: [{ contractNumber: number, account, service, validFrom: from, vatRate: 0, rows: [],
          fill: [{ from, slices: [{ customer: customer.code, guestKind: 'CREW', mealPlan: 'NONE',
            cells: [{ categoryId: category.id, occupancy: 2, price: 340000 }] }] }],
        }],
      });
      assert.equal(result.contracts, 1);
      assert.equal(result.kept, 1);
    }
  });
  const where = (code) => ({ partnerId_code: { partnerId, code } });
  const [savedAccount, savedCustomer] = await Promise.all([
    db.partnerAccount.findUniqueOrThrow({ where: where(account.code), select: { name: true, id: true } }),
    db.partnerCustomer.findUniqueOrThrow({ where: where(customer.code), select: { name: true, id: true } }),
  ]);
  assert.equal(savedAccount.name, account.name);
  assert.equal(savedCustomer.name, customer.name);
  console.log(`PASS ${command}: ${number}; account ${savedAccount.id}; airline ${savedCustomer.id}`);
}

async function main() {
  const [command, flag] = process.argv.slice(2);
  assert.ok(['legacy', 'init', 'prepare', 'update', 'cleanup'].includes(command) && flag === '--apply',
    'Usage: node --env-file=.env scripts/check-tariff-followup.cjs legacy|init|prepare|update|cleanup --apply');
  assert.notEqual(process.env.NODE_ENV?.toLowerCase(), 'production', 'Development only');
  const url = process.env.DATABASE_URL_MIGRATIONS || process.env.DATABASE_URL;
  checkLocal(base);
  checkLocal(url);
  if (process.env.DATABASE_URL) checkLocal(process.env.DATABASE_URL);
  const db = new PrismaClient({ datasources: { db: { url } }, log: [] });
  try {
    if (command === 'legacy') await legacy(db);
    else await directory(db, command);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof assert.AssertionError ? error.message : `Local check or cleanup failed (${error.code ?? error.name}); details omitted.`);
  process.exitCode = 1;
});
