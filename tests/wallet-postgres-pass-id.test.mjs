// Postgres short pass id test. The app builds pass ids as
// stampies-<business-slug>, for example stampies-corner-cafe. The
// first two migrations and the Postgres grant and revision code used
// to require 22 characters, which rejected every real pass id. This
// test proves the app shape works end to end against Postgres: mint,
// issue, register, Apple refresh, and pass fetch, with the grant row
// stored under the short serial.
import { Pool } from 'pg';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PASS_TYPE_IDENTIFIER as type } from '../src/lib/pass.ts';
import { openPostgresAppleUpdates } from '../server/wallet/postgres/apple-registrations.mjs';
import { createWalletService } from '../server/wallet/service.mjs';
import { openPostgresIssueGrants } from '../server/wallet/postgres/issue-grants.mjs';

const host = process.env.WALLET_FIXTURE_PG_SOCKET;
if (!/^\/dev\/shm\/stampies-pg-proof\.[A-Za-z0-9]+\/socket$/.test(host ?? '')) throw new Error('Disposable Postgres socket only.');
const base = { host, port: 5432, max: 4, connectionTimeoutMillis: 2000, query_timeout: 7000 };
const origin = 'https://wallet.test.invalid', rootKey = Buffer.alloc(32, 23);
const passId = 'stampies-corner-cafe', merchant = 'synthetic_merchant_0000001';
const device = 'synthetic_iphone_0000000001';
const req = (url, init) => new Request(origin + url, init);
const credential = (token) => ({ Authorization: `ApplePass ${token}` });

async function setup(t) {
  const admin = new Pool({ ...base, database: 'postgres', user: 'fixture_owner' }); t.after(() => admin.end());
  await admin.query('CREATE DATABASE wallet_pass_id');
  const opt = { ...base, database: 'wallet_pass_id' };
  const owner = new Pool({ ...opt, user: 'fixture_owner' }); t.after(() => owner.end());
  for (const m of ['001-issue-grants', '002-apple-updates', '003-apple-wake-retries', '005-pass-id-length']) await owner.query(readFileSync(new URL(`../server/wallet/postgres/${m}.sql`, import.meta.url), 'utf8'));
  await owner.query(`CREATE ROLE wallet_pass_id_runtime LOGIN;
    GRANT USAGE ON SCHEMA stampies_wallet TO wallet_pass_id_runtime;
    GRANT SELECT,INSERT,DELETE ON stampies_wallet.issue_grants TO wallet_pass_id_runtime;
    GRANT SELECT,UPDATE(revision) ON stampies_wallet.apple_clock TO wallet_pass_id_runtime;
    GRANT SELECT,INSERT,UPDATE ON stampies_wallet.apple_pass,stampies_wallet.apple_wake TO wallet_pass_id_runtime;
    GRANT SELECT,INSERT,UPDATE(encrypted_push),DELETE ON stampies_wallet.apple_registration TO wallet_pass_id_runtime;`);
  const runtime = new Pool({ ...opt, user: 'wallet_pass_id_runtime' });
  t.after(() => runtime.end());
  return { owner, runtime };
}

test('Postgres mint, issue, register, and refresh work for stampies-corner-cafe', async (t) => {
  const { owner, runtime } = await setup(t);
  const committed = new Map([[passId, { record: { passId, stamps: 1 }, version: 1 }]]);
  const load = (id) => committed.get(id);
  const lookup = ({ ownerId, passId: id }) => (ownerId === merchant ? load(id) : null);
  let auth;
  const service = createWalletService({
    origin,
    lookupOwnedPass: lookup,
    grantStore: openPostgresIssueGrants({ pool: runtime }),
    openUpdates: (opts) => openPostgresAppleUpdates({ pool: runtime, ...opts }),
    apple: { rootKey, makeSigner: (identity) => { auth = identity; return (record) => Buffer.from(JSON.stringify(record)); }, loadCommittedPass: load },
  });
  t.after(() => service.close());
  const minted = await service.mint({ ownerId: merchant, passId, platform: 'apple' });
  assert.notEqual(minted, null);
  const grants = await owner.query('SELECT owner, serial FROM stampies_wallet.issue_grants');
  assert.equal(grants.rows.length, 1);
  assert.equal(grants.rows[0].serial, passId);
  const issued = await service.handle(req('/wallet/apple', { method: 'POST', headers: { Authorization: `Bearer ${minted.token}` } }));
  assert.equal(issued.status, 200);
  assert.equal((await issued.json()).stamps, 1);
  assert.equal((await owner.query('SELECT COUNT(*) AS n FROM stampies_wallet.issue_grants')).rows[0].n, '0');
  const token = auth.tokenFor(passId);
  const register = `/v1/devices/${device}/registrations/${type}/${passId}`;
  assert.equal((await service.handle(req(register, { method: 'POST', headers: { ...credential(token), 'Content-Type': 'application/json' }, body: JSON.stringify({ pushToken: '01'.repeat(32) }) }))).status, 201);
  committed.set(passId, { record: { passId, stamps: 2 }, version: 2 });
  assert.equal(await service.committedAppleChange(passId), true);
  const list = await (await service.handle(req(`/v1/devices/${device}/registrations/${type}`))).json();
  assert.deepEqual(list.serialNumbers, [passId]);
  const updated = await service.handle(req(`/v1/passes/${type}/${passId}`, { headers: credential(token) }));
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).stamps, 2);
});
