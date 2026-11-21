// Google Wallet pass refresh tests. The updater is the Google half
// of the pass refresh: it PUTs the rebuilt loyalty object to the
// Google Wallet API. Google has no push, so this call is the refresh.
// The transport is injected, so no test touches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createGoogleWalletUpdater } from '../server/wallet/google-updates.mjs';
import { openWalletService } from '../server/wallet/service.mjs';

const issuerId = '12345678901234567890';
const classId = `${issuerId}.stampies-loyalty-class`;
const clientEmail = 'stampies-test@stampies-test.iam.gserviceaccount.com';
const origin = 'https://wallet.example';
const passId = 'stampies-corner-cafe';
const program = {
  businessName: 'Corner Cafe',
  reward: 'Buy 8, get the 9th free',
  target: 9,
  brandColor: '#C9B8FF',
  cover: 'Dots',
  barcodeValue: passId,
};
const record = { passId, program, stamps: 5, redeemed: false, timeZone: 'Australia/Sydney' };
const now = new Date('2026-11-22T10:00:00Z');

function keyFixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'wallet-google-updates-'));
  t.after(() => rmSync(dir, { force: true, recursive: true }));
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const privateKeyPath = join(dir, 'service-key.pem');
  writeFileSync(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  return { issuerId, classId, clientEmail, privateKeyPath, origin };
}

function fakeFetch(calls, putStatus = 200, tokenStatus = 200) {
  return async (url, init) => {
    calls.push({ url: String(url), method: init?.method, headers: init?.headers, body: init?.body?.toString() });
    if (String(url).includes('oauth2.googleapis.com')) {
      return { ok: tokenStatus === 200, status: tokenStatus, json: async () => ({ access_token: 'fixture-access-token', expires_in: 3600, token_type: 'Bearer' }) };
    }
    return { ok: putStatus === 200, status: putStatus, json: async () => ({}) };
  };
}

test('Google updater exchanges a token once and PUTs the rebuilt object', async (t) => {
  const calls = [];
  const updater = createGoogleWalletUpdater({ ...keyFixture(t), fetchImpl: fakeFetch(calls) });
  assert.equal(await updater.updateObject(record, now), 'updated');
  assert.equal(await updater.updateObject({ ...record, stamps: 6 }, now), 'updated');
  const tokenCalls = calls.filter((c) => c.url.includes('oauth2.googleapis.com'));
  assert.equal(tokenCalls.length, 1);
  const tokenBody = new URLSearchParams(tokenCalls[0].body);
  assert.equal(tokenBody.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  const assertion = tokenBody.get('assertion');
  assert.equal(assertion.split('.').length, 3);
  assert.deepEqual(JSON.parse(Buffer.from(assertion.split('.')[0], 'base64url').toString()), { alg: 'RS256', typ: 'JWT' });
  const puts = calls.filter((c) => c.method === 'PUT');
  assert.equal(puts.length, 2);
  assert.equal(puts[0].url, `https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/${issuerId}.stampies-${passId}`);
  assert.equal(puts[0].headers.Authorization, 'Bearer fixture-access-token');
  const body = JSON.parse(puts[0].body);
  assert.equal(body.id, `${issuerId}.stampies-${passId}`);
  assert.equal(body.classId, classId);
  assert.equal(body.state, 'ACTIVE');
  assert.equal(body.loyaltyPoints.balance.string, '5 of 9');
  assert.equal(body.textModulesData.find((m) => m.id === 'stamp-grid').body, '●●●●●○○○○');
  const second = JSON.parse(puts[1].body);
  assert.equal(second.loyaltyPoints.balance.string, '6 of 9');
});

test('Google updater reports not-found, denied, and retry without throwing', async (t) => {
  const base = keyFixture(t);
  for (const [putStatus, expected] of [[404, 'not-found'], [403, 'denied'], [500, 'retry'], [429, 'retry']]) {
    const calls = [];
    const updater = createGoogleWalletUpdater({ ...base, fetchImpl: fakeFetch(calls, putStatus) });
    assert.equal(await updater.updateObject(record, now), expected);
  }
  const throwing = createGoogleWalletUpdater({
    ...base,
    fetchImpl: async (url) => {
      if (String(url).includes('oauth2.googleapis.com')) {
        return { ok: true, status: 200, json: async () => ({ access_token: 'fixture-access-token', expires_in: 3600 }) };
      }
      throw new Error('network down');
    },
  });
  assert.equal(await throwing.updateObject(record, now), 'retry');
  const badToken = createGoogleWalletUpdater({ ...base, fetchImpl: fakeFetch([], 200, 400) });
  assert.equal(await badToken.updateObject(record, now), 'retry');
});

test('Google updater rejects bad config and bad records', async (t) => {
  const base = keyFixture(t);
  assert.throws(() => createGoogleWalletUpdater({ ...base, issuerId: 'abc' }), /Invalid Google Wallet issuer configuration/);
  assert.throws(() => createGoogleWalletUpdater({ ...base, classId: 'other.issuer-class' }), /Invalid Google Wallet issuer configuration/);
  assert.throws(() => createGoogleWalletUpdater({ ...base, clientEmail: 'not-an-email' }), /Invalid Google Wallet issuer configuration/);
  assert.throws(() => createGoogleWalletUpdater({ ...base, origin: 'http://wallet.example' }), /Invalid Google Wallet origin/);
  assert.throws(() => createGoogleWalletUpdater({ ...base, privateKeyPath: '/no/such/key.pem' }), /ENOENT/);
  const updater = createGoogleWalletUpdater({ ...base, fetchImpl: fakeFetch([]) });
  await assert.rejects(updater.updateObject({ ...record, stamps: 10 }, now), /Invalid Google Wallet pass record/);
  await assert.rejects(updater.updateObject({ ...record, passId: 'abc' }, now), /Invalid Google Wallet pass record/);
});

// Service wiring: a recorded stamp refreshes the Google pass as well
// as the Apple pass, and committedGoogleChange reports the updater
// status. The Google update is best effort and never fails the stamp.
function serviceFixture(t, googleCalls) {
  const dir = mkdtempSync(join(tmpdir(), 'wallet-google-service-'));
  t.after(() => rmSync(dir, { force: true, recursive: true }));
  const ledger = new Map([[passId, { version: 1, record: { passId, businessId: 'corner-cafe', stamps: 3 } }]]);
  const ownerId = 'fixture_owner_opaque_value_001';
  const service = openWalletService({
    origin, tokenDbPath: join(dir, 'tokens.db'), now: () => 1790000000000,
    lookupOwnedPass: async (o) => (o.ownerId === ownerId && ledger.has(o.passId) ? ledger.get(o.passId) : null),
    apple: {
      rootKey: Buffer.alloc(32, 17), updateDbPath: join(dir, 'updates.db'),
      loadCommittedPass: async (id) => ledger.get(id) ?? null,
      makeSigner: () => (r) => Buffer.from(JSON.stringify({ count: r.stamps })),
    },
    googleUpdates: {
      loadCommittedPass: async (id) => ledger.get(id) ?? null,
      updateObject: async (r) => { googleCalls.push(r); return 'updated'; },
    },
  });
  t.after(() => service.close());
  return { service, ledger, setLedger: (id, version, rec) => { ledger.set(id, { version, record: rec }); } };
}

test('committedGoogleChange reports the updater status and skips cleanly when unconfigured', async (t) => {
  const googleCalls = [];
  const f = serviceFixture(t, googleCalls);
  assert.equal(await f.service.committedGoogleChange(passId), 'updated');
  assert.deepEqual(googleCalls[0], { passId, businessId: 'corner-cafe', stamps: 3 });
  assert.equal(await f.service.committedGoogleChange('stampies-unknown-cafe'), false);
  const plain = openWalletService({
    origin, tokenDbPath: join(mkdtempSync(join(tmpdir(), 'wallet-google-plain-')), 'tokens.db'),
    lookupOwnedPass: async () => null,
  });
  t.after(() => plain.close());
  assert.equal(await plain.committedGoogleChange(passId), false);
  assert.throws(() => openWalletService({
    origin, tokenDbPath: join(mkdtempSync(join(tmpdir(), 'wallet-google-bad-')), 'tokens.db'),
    lookupOwnedPass: async () => null,
    googleUpdates: { loadCommittedPass: async () => null },
  }), /Invalid Wallet service configuration/);
});

test('a recorded stamp refreshes the Google pass too', async (t) => {
  const googleCalls = [];
  const f = serviceFixture(t, googleCalls);
  f.setLedger(passId, 2, { passId, businessId: 'corner-cafe', stamps: 4 });
  const response = await f.service.handle(new Request(`${origin}/wallet/stamps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ stampId: 'r-1790000000000-g', passId, businessId: 'corner-cafe', createdAtMs: 1790000000000 }),
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { recorded: true, duplicate: false, stamps: 1, state: 'active' });
  for (let i = 0; i < 50 && googleCalls.length === 0; i++) await new Promise((r) => setImmediate(r));
  assert.equal(googleCalls.length, 1);
  assert.equal(googleCalls[0].stamps, 4);
});
