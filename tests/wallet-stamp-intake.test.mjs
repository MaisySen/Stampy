import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { openWalletService } from '../server/wallet/service.mjs';
import { openPostgresWalletService } from '../server/wallet/postgres/service.mjs';
import { createWalletHttpServer } from '../server/wallet/http.mjs';

const origin = 'https://wallet.example';
const pgOrigin = 'https://wallet.test.invalid';
const passId = 'stampies-corner-cafe';
const otherPassId = 'stampies-other-cafe';
const businessId = 'corner-cafe';
const otherBusinessId = 'other-cafe';
const ownerId = 'fixture_owner_opaque_value_001';
const nowMs = 1790000000000;
const minute = 60 * 1000;
const day = 24 * 60 * minute;
const stampAuth = 'Bearer test-staff-authority';

const pgSocket = process.env.WALLET_FIXTURE_PG_SOCKET;
const hasPgSocket = typeof pgSocket === 'string' && /^\/dev\/shm\/stampies-pg-proof\.[A-Za-z0-9]+\/socket$/.test(pgSocket);
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const stampBody = (overrides = {}) => ({
  stampId: 'r-1790000000000-a', passId, businessId, createdAtMs: nowMs, ...overrides,
});
const postStamp = (service, url, body, contentType = 'application/json', authorization = stampAuth) =>
  service.handle(new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': contentType, ...(authorization ? { Authorization: authorization } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }));
const reply = async (response) => ({ status: response.status, json: await response.json().catch(() => undefined) });

// The same behavioral sequence runs against the SQLite and the Postgres
// service, so the two paths prove they behave the same. setLedger adds a
// committed pass record to the fixture merchant ledger.
async function checkIntakeBehavior({ service, setLedger, url, prefix }) {
  const stamp = (suffix, overrides = {}) => stampBody({ stampId: `${prefix}-${suffix}`, ...overrides });
  let r = await reply(await postStamp(service, url, stamp('a')));
  assert.deepEqual(r, { status: 200, json: { recorded: true, duplicate: false, stamps: 1 } });
  r = await reply(await postStamp(service, url, stamp('a')));
  assert.deepEqual(r, { status: 200, json: { recorded: false, duplicate: true, stamps: 1 } });
  r = await reply(await postStamp(service, url, stamp('b')));
  assert.deepEqual(r, { status: 200, json: { recorded: true, duplicate: false, stamps: 2 } });
  r = await reply(await postStamp(service, url, stamp('c', { passId: 'stampies-unknown-cafe' })));
  assert.equal(r.status, 404);
  r = await reply(await postStamp(service, url, stamp('d', { businessId: otherBusinessId })));
  assert.equal(r.status, 404);
  r = await reply(await postStamp(service, url, stamp('e', { createdAtMs: nowMs + 10 * minute })));
  assert.equal(r.status, 400);
  r = await reply(await postStamp(service, url, stamp('f', { createdAtMs: nowMs - 366 * day })));
  assert.equal(r.status, 400);
  r = await reply(await postStamp(service, url, stamp('g', { createdAtMs: 0 })));
  assert.equal(r.status, 400);
  r = await reply(await postStamp(service, url, { passId, businessId, createdAtMs: nowMs }));
  assert.equal(r.status, 400);
  r = await reply(await postStamp(service, url, 'not json'));
  assert.equal(r.status, 400);
  r = await reply(await postStamp(service, url, stamp('h'), 'text/plain'));
  assert.equal(r.status, 400);
  // A stamp count from the device is ignored. The count comes from the ledger.
  r = await reply(await postStamp(service, url, stamp('i', { stamps: 99, stampCount: 50, reward: 'redeemed' })));
  assert.deepEqual(r, { status: 200, json: { recorded: true, duplicate: false, stamps: 3 } });
  // A stamp id reused for another pass is a conflict, and records nothing.
  setLedger(otherPassId, 1, { passId: otherPassId, businessId, stamps: 0 });
  r = await reply(await postStamp(service, url, stamp('a', { passId: otherPassId })));
  assert.equal(r.status, 409);
  r = await reply(await postStamp(service, url, stamp('j', { passId: otherPassId })));
  assert.deepEqual(r, { status: 200, json: { recorded: true, duplicate: false, stamps: 1 } });
}

function sqliteFixture(t, url = origin, authorised = true) {
  const dir = mkdtempSync(join(tmpdir(), 'wallet-stamp-intake-'));
  t.after(() => rmSync(dir, { force: true, recursive: true }));
  let at = nowMs;
  let identity;
  const ledger = new Map([[passId, { version: 1, record: { passId, businessId, stamps: 3 } }]]);
  const service = openWalletService({
    origin: url, tokenDbPath: join(dir, 'tokens.db'), now: () => at,
    ...(authorised ? { authorizeStamp: ({request}) => request.headers.get('Authorization') === stampAuth } : {}),
    lookupOwnedPass: async (o) => (o.ownerId === ownerId && ledger.has(o.passId) ? ledger.get(o.passId) : null),
    apple: {
      rootKey: Buffer.alloc(32, 17), updateDbPath: join(dir, 'updates.db'),
      loadCommittedPass: async (id) => ledger.get(id) ?? null,
      makeSigner: (options) => { identity = options; return (record) => Buffer.from(JSON.stringify({ count: record.stamps })); },
    },
  });
  t.after(() => service.close());
  return {
    service,
    identity: () => identity,
    setLedger: (id, version, record) => { ledger.set(id, { version, record }); },
    goTo: (ms) => { at = ms; },
  };
}

test('stamp intake records exactly once on SQLite', async (t) => {
  const f = sqliteFixture(t);
  await checkIntakeBehavior({
    service: f.service, setLedger: f.setLedger, url: origin + '/wallet/stamps', prefix: 'r-1790000000000',
  });
});

test('stamp intake rejects unauthorised callers before recording any stamp', async (t) => {
  const f = sqliteFixture(t);
  const endpoint = origin + '/wallet/stamps';
  const stamp = stampBody({stampId: 'r-1790000000000-denied'});
  assert.equal((await postStamp(f.service, endpoint, stamp, 'application/json', null)).status, 403);
  assert.equal((await postStamp(f.service, endpoint, stamp, 'application/json', 'Bearer wrong')).status, 403);
  assert.deepEqual(await reply(await postStamp(f.service, endpoint, stamp)),
    {status: 200, json: {recorded: true, duplicate: false, stamps: 1}});
});

test('stamp intake is unavailable until the host provides an authorizer', async (t) => {
  const f = sqliteFixture(t, origin, false);
  assert.equal((await postStamp(f.service, origin + '/wallet/stamps', stampBody())).status, 503);
});

test('recording a stamp queues the pass update through committedAppleChange', async (t) => {
  const f = sqliteFixture(t);
  const s = f.service;
  // The /v1 install flow mints against the opaque pass id shape, so this
  // test uses a longer pass id than the app queue id. The intake behavior
  // itself is proven with the exact app shapes in the test above.
  const hookPassId = 'stampies-corner-cafe-0001';
  f.setLedger(hookPassId, 1, { passId: hookPassId, businessId, stamps: 3 });
  const raw = (path, method = 'GET', auth, body) => new Request(origin + path, {
    method, headers: { ...(auth ? { Authorization: auth } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const grant = await s.mint({ ownerId, passId: hookPassId, platform: 'apple' });
  assert.equal((await s.handle(raw('/wallet/apple', 'POST', `Bearer ${grant.token}`, { passId: hookPassId, stamps: 50 }))).status, 200);
  const auth = `ApplePass ${f.identity().tokenFor(hookPassId)}`;
  const reg = `/v1/devices/fixture_device_alfa/registrations/pass.au.fintex.stampies/${hookPassId}`;
  assert.equal((await s.handle(raw(reg, 'POST', auth, { pushToken: 'a9'.repeat(32) }))).status, 201);
  // The merchant ledger applies the stamp, then the app syncs it.
  f.setLedger(hookPassId, 2, { passId: hookPassId, businessId, stamps: 4 });
  const r = await reply(await postStamp(s, origin + '/wallet/stamps', stampBody({ stampId: 'r-1790000000000-u', passId: hookPassId })));
  assert.deepEqual(r, { status: 200, json: { recorded: true, duplicate: false, stamps: 1 } });
  const pass = await s.handle(raw(`/v1/passes/pass.au.fintex.stampies/${hookPassId}`, 'GET', auth));
  assert.deepEqual(await pass.json(), { count: 4 });
});

test('stamp intake through the HTTP adapter keeps the ingress protections', async (t) => {
  const f = sqliteFixture(t);
  const server = createWalletHttpServer({ origin, service: f.service });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const sock = server.address();
  const call = (path, { method = 'GET', headers = {}, body = undefined } = {}) => new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: sock.port, path, method, agent: false, headers: { host: 'wallet.example', ...headers }, timeout: 3000 }, async (res) => {
      try {
        const parts = [];
        for await (const chunk of res) parts.push(chunk);
        resolve({ status: res.statusCode, body: Buffer.concat(parts).toString() });
      } catch (error) { reject(error); }
    });
    req.once('timeout', () => req.destroy(new Error('test request timeout')));
    req.once('error', reject);
    req.end(body);
  });
  try {
    const ok = await call('/wallet/stamps', { method: 'POST', headers: { 'content-type': 'application/json', authorization: stampAuth }, body: JSON.stringify(stampBody({ stampId: 'r-1790000000000-h' })) });
    assert.equal(ok.status, 200);
    assert.deepEqual(JSON.parse(ok.body), { recorded: true, duplicate: false, stamps: 1 });
    assert.equal((await call('/wallet/stamps', { method: 'GET' })).status, 405);
    assert.equal((await call('/wallet/stamps?x=1', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(stampBody()) })).status, 404);
    assert.equal((await call('/wallet/stamps', { method: 'POST', headers: { host: 'other.example', 'content-type': 'application/json' }, body: JSON.stringify(stampBody()) })).status, 404);
    const big = 'x'.repeat(8193);
    assert.equal((await call('/wallet/stamps', { method: 'POST', headers: { 'content-length': String(big.length) }, body: big })).status, 413);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

// The exact grants from provision-runtime-role.sql, without the CREATE
// ROLE line. Roles are cluster-wide but grants are per database, so when
// another suite file already created the role, this file still needs the
// grants applied in its own database.
const runtimeGrants = `GRANT USAGE ON SCHEMA stampies_wallet TO stampies_wallet_runtime;
GRANT SELECT,INSERT,DELETE ON stampies_wallet.issue_grants TO stampies_wallet_runtime;
GRANT SELECT,UPDATE(revision) ON stampies_wallet.apple_clock TO stampies_wallet_runtime;
GRANT SELECT,INSERT,UPDATE(payload,source_version,revision) ON stampies_wallet.apple_pass TO stampies_wallet_runtime;
GRANT SELECT,INSERT,UPDATE(encrypted_push),DELETE ON stampies_wallet.apple_registration TO stampies_wallet_runtime;
GRANT SELECT,INSERT,UPDATE(revision,ready_at,lease_id,lease_until,failures),DELETE ON stampies_wallet.apple_wake TO stampies_wallet_runtime;
GRANT SELECT,INSERT ON stampies_wallet.stamp_ledger TO stampies_wallet_runtime;`;

test('stamp intake records exactly once on Postgres', { skip: !hasPgSocket }, async (t) => {
  const pg = await import('pg').catch(() => null);
  if (!pg) { t.skip('pg driver not installed'); return; }
  const { Pool } = pg;
  const opt = { host: pgSocket, database: 'postgres', max: 3, connectionTimeoutMillis: 1500, query_timeout: 5000 };
  const control = new Pool({ ...opt, user: 'fixture_owner' });
  t.after(() => control.end());
  await control.query('DROP DATABASE IF EXISTS wallet_stamp_intake');
  await control.query('CREATE DATABASE wallet_stamp_intake');
  const owner = new Pool({ ...opt, database: 'wallet_stamp_intake', user: 'fixture_owner' });
  t.after(() => owner.end());
  for (const f of ['001-issue-grants.sql', '002-apple-updates.sql', '003-apple-wake-retries.sql', '004-stamp-intake.sql']) {
    await owner.query(read(`../server/wallet/postgres/${f}`));
  }
  const role = await control.query(`SELECT 1 FROM pg_roles WHERE rolname='stampies_wallet_runtime'`);
  if (role.rowCount === 0) {
    await owner.query(read('../server/wallet/postgres/provision-runtime-role.sql'));
  } else {
    await owner.query(runtimeGrants);
  }
  await control.query('ALTER ROLE stampies_wallet_runtime LOGIN;');
  const runtime = new Pool({ ...opt, database: 'wallet_stamp_intake', user: 'stampies_wallet_runtime' });
  t.after(() => runtime.end());
  let at = nowMs;
  const ledger = new Map([[passId, { version: 1, record: { passId, businessId, stamps: 3 } }]]);
  const service = await openPostgresWalletService({
    pool: runtime, origin: pgOrigin, now: () => at,
    authorizeStamp: ({request}) => request.headers.get('Authorization') === stampAuth,
    lookupOwnedPass: async (o) => (o.ownerId === ownerId && ledger.has(o.passId) ? ledger.get(o.passId) : null),
    apple: {
      rootKey: Buffer.alloc(32, 23),
      loadCommittedPass: async (id) => ledger.get(id) ?? null,
      makeSigner: () => (record) => Buffer.from(JSON.stringify(record)),
    },
  });
  t.after(() => service.close());
  await checkIntakeBehavior({
    service, setLedger: (id, version, record) => { ledger.set(id, { version, record }); },
    url: pgOrigin + '/wallet/stamps', prefix: 'r-1790000000001',
  });
});
