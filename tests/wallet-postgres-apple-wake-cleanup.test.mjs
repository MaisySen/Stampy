import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { Pool } from 'pg';
import { PASS_TYPE_IDENTIFIER } from '../src/lib/pass.ts';
import { openPostgresAppleUpdates } from '../server/wallet/postgres/apple-registrations.mjs';
import { cleanupDeadAppleWakes } from '../server/wallet/postgres/apple-wake-cleanup.mjs';

const socket = process.env.WALLET_FIXTURE_PG_SOCKET;
if (!/^\/dev\/shm\/stampies-pg-proof\.[A-Za-z0-9]+\/socket$/.test(socket ?? '')) throw new Error('Disposable Postgres socket only.');
const origin = 'https://wallet.fixture.invalid', rootKey = Buffer.alloc(32, 31);
// Stored device IDs are HMAC-SHA256 device keys, not the raw device string.
const regKey = createHmac('sha256', rootKey).update('stampies:apple-device:v1').digest();
const storedDevice = (id) => createHmac('sha256', regKey).update(id).digest('hex');
const wake = 'stampies_wallet.apple_wake';
const opts = { host: socket, port: 5432, max: 5, connectionTimeoutMillis: 1800, query_timeout: 4800 };

async function setup(t) {
  const control = new Pool({ ...opts, database: 'postgres', user: 'fixture_owner' });
  t.after(() => control.end());
  await control.query('DROP DATABASE IF EXISTS wallet_wake_cleanup');
  await control.query('DROP ROLE IF EXISTS wallet_wake_cleanup_runtime');
  await control.query('CREATE DATABASE wallet_wake_cleanup');
  const config = { ...opts, database: 'wallet_wake_cleanup' };
  const owner = new Pool({ ...config, user: 'fixture_owner' });
  t.after(() => owner.end());
  for (const m of ['002-apple-updates', '003-apple-wake-retries']) {
    await owner.query(readFileSync(new URL(`../server/wallet/postgres/${m}.sql`, import.meta.url), 'utf8'));
  }
  await owner.query(`CREATE ROLE wallet_wake_cleanup_runtime LOGIN;
    GRANT USAGE ON SCHEMA stampies_wallet TO wallet_wake_cleanup_runtime;
    GRANT SELECT,UPDATE(revision) ON stampies_wallet.apple_clock TO wallet_wake_cleanup_runtime;
    GRANT SELECT,INSERT,UPDATE ON stampies_wallet.apple_pass TO wallet_wake_cleanup_runtime;
    GRANT SELECT,INSERT,UPDATE(encrypted_push),DELETE ON stampies_wallet.apple_registration TO wallet_wake_cleanup_runtime;
    GRANT SELECT,INSERT,UPDATE(revision,ready_at,lease_id,lease_until,failures),DELETE ON ${wake} TO wallet_wake_cleanup_runtime;`);
  const runtime = new Pool({ ...config, user: 'wallet_wake_cleanup_runtime' });
  t.after(() => runtime.end());
  const updates = openPostgresAppleUpdates({ pool: runtime, origin, rootKey, signApple: () => Buffer.from('synthetic') });
  const auth = (await import('../server/wallet/apple-update-protocol.mjs')).appleUpdateIdentity({ origin, rootKey }).tokenFor;
  const token = 'cb'.repeat(32);
  const seed = async (serial, device) => {
    await updates.putPass({ passId: serial, stamps: 1 }, { sourceVersion: 1 });
    const status = (await updates.handle(new Request(`${origin}/v1/devices/${device}/registrations/${PASS_TYPE_IDENTIFIER}/${serial}`, {
      method: 'POST',
      headers: { Authorization: `ApplePass ${auth(serial)}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ pushToken: token }),
    }))).status;
    assert.ok(status === 201 || status === 200, `register ${device} on ${serial} returned ${status}`);
  };
  const fail = async (serial, device, failures) => {
    await owner.query(`UPDATE ${wake} SET failures=$3, ready_at=clock_timestamp()-interval '1 second' WHERE device=$1 AND serial=$2`, [storedDevice(device), serial, failures]);
  };
  const count = async () => (await owner.query(`SELECT count(*)::int AS n FROM ${wake}`)).rows[0].n;
  const rows = async () => (await owner.query(`SELECT device, serial, revision::int AS rev, failures FROM ${wake} ORDER BY device`)).rows;
  return { owner, runtime, seed, fail, count, rows };
}

test('dead Apple wakes are removed, live and revived wakes stay, dry run and cap hold', async (t) => {
  const { owner, runtime, seed, fail, count, rows } = await setup(t);
  const dead = 'fixture_cleanup_dead_000001';
  const live = 'fixture_cleanup_live_000001';
  const revived = 'fixture_cleanup_revived_000001';
  const capped = 'fixture_cleanup_capped_000001';
  const device = (n) => `fixture_cleanup_iphone_${String(n).padStart(8, '0')}`;

  await seed(dead, device(1));
  await fail(dead, device(1), 8);
  await seed(live, device(2));
  await seed(live, device(3));
  await fail(live, device(3), 7);
  assert.equal(await count(), 3);
  assert.deepEqual(await cleanupDeadAppleWakes({ pool: runtime }), { removed: 1, dead: 1 });
  assert.deepEqual((await rows()).map((r) => [r.device, r.serial, r.failures]), [
    [storedDevice(device(2)), live, 0],
    [storedDevice(device(3)), live, 7],
  ]);

  await seed(revived, device(4));
  await fail(revived, device(4), 8);
  await owner.query('UPDATE stampies_wallet.apple_pass SET revision = revision + 1 WHERE serial = $1', [revived]);
  assert.deepEqual(await cleanupDeadAppleWakes({ pool: runtime }), { removed: 0, dead: 0 });
  assert.equal((await rows()).find((r) => r.device === storedDevice(device(4)))?.failures, 8);

  await seed(dead, device(5));
  await fail(dead, device(5), 8);
  assert.deepEqual(await cleanupDeadAppleWakes({ pool: runtime, dryRun: true }), { removed: 0, dead: 1 });
  assert.equal((await rows()).find((r) => r.device === storedDevice(device(5)))?.failures, 8);
  assert.deepEqual(await cleanupDeadAppleWakes({ pool: runtime }), { removed: 1, dead: 1 });

  for (const n of [6, 7, 8]) {
    await seed(capped, device(n));
    await fail(capped, device(n), 8);
  }
  assert.deepEqual(await cleanupDeadAppleWakes({ pool: runtime, limit: 2 }), { removed: 2, dead: 3 });
  assert.equal(await count(), 4);
  assert.deepEqual(await cleanupDeadAppleWakes({ pool: runtime, limit: 2 }), { removed: 1, dead: 1 });
  assert.equal(await count(), 3);

  await assert.rejects(cleanupDeadAppleWakes({}), /private Wallet Postgres pool/);
  await assert.rejects(cleanupDeadAppleWakes({ pool: runtime, limit: 0 }), /Invalid Wallet wake cleanup limit/);
  await assert.rejects(cleanupDeadAppleWakes({ pool: runtime, limit: 1001 }), /Invalid Wallet wake cleanup limit/);
  await assert.rejects(cleanupDeadAppleWakes({ pool: runtime, dryRun: 'yes' }), /Invalid Wallet wake cleanup mode/);
});
