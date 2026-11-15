/* Local, opt-in release regression against the running PMS API.
 * node --env-file=.env scripts/check-tariff-release.cjs --apply
 * Uses short-lived local test JWTs and disposable QA records; never prints secrets.
 * The synced Avia fixture QA_AVIA_SYNC must exist; other QA records are disposable.
 */
const assert = require('node:assert/strict');
const { randomUUID, createHmac } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { parseEnv } = require('node:util');
const { PrismaClient } = require('@prisma/client');
const { DEFAULT_ROLE_PERMISSIONS } = require('../dist/src/modules/auth/auth.constants');
const base = 'http://localhost:3001/api';
const slug = 'benamar-hotelspa';
const envAvia = parseEnv(readFileSync('../../kars-avia-v3/.env', 'utf8'));
const dbUrl = process.env.DATABASE_URL_MIGRATIONS || process.env.DATABASE_URL;
const local = (url) => ['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname);
assert(local(dbUrl) && local(envAvia.HOTEL_PMS_URL || envAvia.HOTEL_PMS_API_URL || base), 'Local configuration required');
assert.notEqual(process.env.NODE_ENV, 'production');
assert(process.argv.includes('--apply'), 'Pass --apply to create disposable QA data');
const db = new PrismaClient({ datasources: { db: { url: dbUrl } }, log: [] });
const checks = [];
const resources = { plans: [], restrictions: [], reservations: [] };
let user, tenant, owner;
function token(role) {
  const encode = (v) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: user.id,
    tid: tenant.id, role, email: user.email, perms: DEFAULT_ROLE_PERMISSIONS[role],
    exp: Math.floor(Date.now() / 1000) + 600 })}`;
  return `${body}.${createHmac('sha256', process.env.JWT_ACCESS_SECRET).update(body).digest('base64url')}`;
}
async function api(path, method = 'GET', body, auth = owner) {
  const headers = { 'Content-Type': 'application/json', ...(auth === 'partner'
    ? { 'X-Api-Key': envAvia.HOTEL_PMS_API_KEY } : { Authorization: `Bearer ${auth}` }) };
  const response = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}
function passed(name) { checks.push(name); console.log(`PASS ${name}`); }
async function expectStatus(result, status) { assert.equal(result.status, status, JSON.stringify(result.data)); return result.data; }
async function createPlan(data) {
  const plan = await expectStatus(await api('/rate-plans', 'POST', data), 201);
  resources.plans.push(plan.id); return plan;
}
async function main() {
  tenant = await db.tenant.findUniqueOrThrow({ where: { slug } });
  const role = await db.role.findFirstOrThrow({ where: { tenantId: tenant.id, code: 'OWNER' } });
  user = await db.user.create({ data: { tenantId: tenant.id, roleId: role.id,
    email: `qa-tariff-${randomUUID()}@example.invalid`, passwordHash: '!qa-no-login', fullName: 'QA tariff API' } });
  owner = token('OWNER');
  const plans = await expectStatus(await api('/rate-plans'), 200);
  const corp = plans.find((p) => p.code === 'QA_AVIA_SYNC');
  assert(corp, 'Prepare and synchronize the Avia fixture QA_AVIA_SYNC first');
  const own = await createPlan({ code: `QA_RELEASE_${randomUUID().slice(0, 8).toUpperCase()}`, name: 'QA temporary API tariff' });
  for (const role of ['FRONT_DESK', 'CHANNEL_MANAGER']) {
    const auth = token(role);
    for (const path of ['/rate-plans', '/rate-plans/room-types', `/rate-plans/${corp.id}/contract-prices?from=2026-11-19&to=2026-11-21`])
      await expectStatus(await api(path, 'GET', undefined, auth), 200);
    if (role === 'CHANNEL_MANAGER') await expectStatus(await api('/room-types', 'GET', undefined, auth), 403);
  }
  for (const [path, method, body] of [
    ['/rate-plans', 'POST', {}], [`/rate-plans/${own.id}`, 'PATCH', { name: 'forbidden' }],
    [`/rate-plans/${own.id}`, 'DELETE'], ['/rates/standard', 'PUT', {}],
    ['/restrictions/upsert', 'POST', {}],
  ]) await expectStatus(await api(path, method, body, token('FRONT_DESK')), 403);
  passed('read-only and channel-manager permissions through real HTTP guards');
  await expectStatus(await api('/rate-plans', 'POST', { code: 'QA_FORBIDDEN_CHILD', name: 'QA', parentRatePlanId: corp.id }), 409);
  await expectStatus(await api(`/rate-plans/${own.id}`, 'PATCH', { parentRatePlanId: corp.id }), 409);
  passed('corporate parent rejected on create and update');
  const child = await createPlan({ code: 'QA_RELEASE_CHILD_API', name: 'QA child API', description: 'clear me', parentRatePlanId: own.id });
  await expectStatus(await api(`/rate-plans/${child.id}`, 'PATCH', { description: null, parentRatePlanId: null }), 200);
  const cleared = await expectStatus(await api(`/rate-plans/${child.id}`), 200);
  assert.equal(cleared.description, null); assert.equal(cleared.parentRatePlanId, null);
  passed('description and parent clear persist');
  const scope = { forOperator: true, partnerId: corp.partnerId, mealPlan: 'NONE', guestKind: 'DISRUPTION',
    partnerAccountId: null, partnerCustomerId: null, isActive: true };
  await createPlan({ ...scope, code: 'QA_CONTRACT_279', name: 'QA contract 279', operatorContract: '279' });
  await createPlan({ ...scope, code: 'QA_CONTRACT_513', name: 'QA contract 513', operatorContract: '513' });
  await expectStatus(await api('/rate-plans', 'POST', { ...scope, code: 'QA_DUPLICATE', name: 'QA duplicate', operatorContract: ' 279 ' }), 409);
  passed('same conditions on different real contracts allowed; duplicate contract rejected');
  const category = await db.roomType.findUniqueOrThrow({ where: { tenantId_code: { tenantId: tenant.id, code: 'QA_DS_TRIPLE' } } });
  const room = await db.room.create({ data: { tenantId: tenant.id, roomTypeId: category.id,
    number: `QA-RELEASE-${Date.now()}`, capacity: 3, singleBeds: 3, notes: 'Disposable tariff release check' } });
  resources.room = room.id;
  const query = new URLSearchParams({ checkIn: '2026-11-19', checkOut: '2026-11-21', guests: '2', categoryId: category.id });
  if (corp.partnerAccountId) {
    const account = await db.partnerAccount.findUniqueOrThrow({ where: { id: corp.partnerAccountId } });
    query.set('account', account.code);
  }
  const availabilityPath = `/connect/v1/hotels/${slug}/availability?${query}`;
  const initial = await expectStatus(await api(availabilityPath, 'GET', undefined, 'partner'), 200);
  const quote = initial.offers.flatMap((o) => o.ratePlans).find((p) => p.ratePlanId === corp.id);
  assert(quote, 'Corporate offer not found');
  assert.equal(quote.total, 11700); assert.equal(quote.vatRate, null); assert.equal(quote.vatMixed, true);
  assert.deepEqual(quote.perNight.map((n) => n.vatRate), [0, 22]);
  passed('Avia contract across DS: 5600 + 6100, nightly VAT 0/22');
  const blocked = await expectStatus(await api('/restrictions/upsert', 'POST', {
    roomTypeId: category.id, ratePlanId: corp.id, date: '2026-11-20', stopSell: true,
  }), 200); resources.restrictions.push(blocked.id);
  const closed = await expectStatus(await api(availabilityPath, 'GET', undefined, 'partner'), 200);
  assert(!closed.offers.flatMap((o) => o.ratePlans).some((p) => p.ratePlanId === corp.id));
  const booking = { categoryId: category.id, roomId: room.id, ratePlanId: corp.id,
    checkIn: query.get('checkIn'), checkOut: query.get('checkOut'), adults: 2,
    guestName: 'QA tariff release', account: query.get('account') || undefined };
  await expectStatus(await api(`/connect/v1/hotels/${slug}/reservations`, 'POST', booking, 'partner'), 409);
  passed('stop sell immediately removes cached offer and rejects booking');
  await expectStatus(await api(`/restrictions/${blocked.id}`, 'DELETE'), 200); resources.restrictions = [];
  const reopened = await expectStatus(await api(availabilityPath, 'GET', undefined, 'partner'), 200);
  assert(reopened.offers.flatMap((o) => o.ratePlans).some((p) => p.ratePlanId === corp.id));
  passed('removing stop sell immediately restores the offer');
  const reservation = await expectStatus(await api(`/connect/v1/hotels/${slug}/reservations`, 'POST', booking, 'partner'), 201);
  resources.reservations.push(reservation.id);
  const saved = await db.reservation.findUniqueOrThrow({ where: { id: reservation.id } });
  assert.equal(Number(saved.totalPrice), 11700);
  passed('booking stores the complete contract total');
}
main().finally(async () => {
  if (owner) {
    const cleanupErrors = [];
    for (const [path, auth] of [
      ...resources.reservations.map((id) => [`/connect/v1/hotels/${slug}/reservations/${id}`, 'partner']),
      ...resources.restrictions.map((id) => [`/restrictions/${id}`, owner]),
      ...resources.plans.reverse().map((id) => [`/rate-plans/${id}`, owner]),
    ]) {
      try {
        const result = await api(path, 'DELETE', undefined, auth);
        if (result.status < 200 || result.status >= 300) cleanupErrors.push(`${path}: HTTP ${result.status}`);
      } catch { cleanupErrors.push(`${path}: request failed`); }
    }
    if (cleanupErrors.length) { console.error('QA cleanup failed:', cleanupErrors.join('; ')); process.exitCode = 1; }
  }
  if (resources.room) await db.room.update({ where: { id: resources.room }, data: { isActive: false, archivedAt: new Date() } });
  if (user) await db.user.update({ where: { id: user.id }, data: { isActive: false, deactivatedAt: new Date() } });
  await db.$disconnect();
}).catch((error) => { console.error(error instanceof assert.AssertionError ? error.message : 'Local check failed; secrets omitted.'); process.exitCode = 1; });
