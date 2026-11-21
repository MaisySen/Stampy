import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createAppleWalletPushWorker, loadWorkerConfig } from '../server/wallet/apple-push-worker.mjs';
import { openAppleUpdates, appleUpdateIdentity } from '../server/wallet/apple-updates.mjs';

const passId = 'fixture_pass_opaque_value_001';
const record = {passId, stamps: 3, timeZone: 'Australia/Sydney', program:{businessName:'Test Cafe', reward:'One coffee', target:9, brandColor:'#c9b8ff', cover:'solid', expiryIso:'2099-11-20'}};
const origin = 'https://wallet.example';
const rootKey = Buffer.alloc(32, 7);
const pushToken = 'ab'.repeat(32);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const shell = (bin, args, opt={}) => execFileSync(bin, args, {...opt, timeout: 8000, maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']});

// One registered device and one queued wake, using the same store calls the
// update service uses. No APNs contact, no certificate, no network.
async function queuedStore(t) {
  const store = openAppleUpdates({origin, rootKey, dbPath: ':memory:', signApple: () => Buffer.alloc(0)});
  t.after(() => store.close());
  store.putPass(record);
  const token = appleUpdateIdentity({origin, rootKey}).tokenFor(passId);
  const register = new Request(`${origin}/v1/devices/fixture_device_alfa/registrations/pass.au.fintex.stampies/${passId}`, {method: 'POST', headers: {Authorization: `ApplePass ${token}`, 'Content-Type': 'application/json'}, body: JSON.stringify({pushToken})});
  assert.equal((await store.handle(register)).status, 201);
  assert.equal(store.putPass({...record, stamps: 4}), true);
  return store;
}

const validEnv = () => ({
  STAMPIES_WALLET_DB_PATH: '/tmp/stampies-wallet.sqlite',
  STAMPIES_WALLET_ORIGIN: 'https://wallet.example',
  STAMPIES_WALLET_ROOT_KEY: Buffer.alloc(32, 9).toString('base64url'),
  STAMPIES_WALLET_TEAM_ID: 'TEST123456',
  STAMPIES_WALLET_CERT_PATH: '/tmp/stampies-cert.pem',
  STAMPIES_WALLET_KEY_PATH: '/tmp/stampies-key.pem',
  STAMPIES_WALLET_INTERMEDIATE_PATH: '/tmp/stampies-intermediate.pem',
  STAMPIES_WALLET_ROOT_PATH: '/tmp/stampies-root.pem',
});

test('worker drains queued wakes and stops after an accepted wake', async (t) => {
  const store = await queuedStore(t);
  let calls = 0;
  const worker = createAppleWalletPushWorker({store, sendWake: async (wake) => { calls++; assert.equal(wake.topic, 'pass.au.fintex.stampies'); assert.equal(wake.pushToken, pushToken); return 'accepted'; }, intervalMs: 50, log: () => {}});
  assert.equal(await worker.runOnce(), 1);
  assert.equal(calls, 1);
  assert.equal(await store.sendPending(async () => assert.fail('No duplicate wake should remain after receipt')), 0);
});

test('worker leaves a retry wake queued', async (t) => {
  const store = await queuedStore(t);
  const worker = createAppleWalletPushWorker({store, sendWake: async () => 'retry', intervalMs: 50, log: () => {}});
  assert.equal(await worker.runOnce(), 0);
  assert.equal(await store.sendPending(async (wake) => { assert.equal(wake.pushToken, pushToken); return 'accepted'; }), 1);
  assert.equal(await store.sendPending(async () => assert.fail('Accepted wake must not remain')), 0);
});

test('worker drains on start and stops cleanly', async (t) => {
  const store = await queuedStore(t);
  let calls = 0;
  const worker = createAppleWalletPushWorker({store, sendWake: async () => { calls++; return 'accepted'; }, intervalMs: 20, log: () => {}});
  worker.start();
  assert.equal(worker.running, true);
  for (let i = 0; i < 50 && calls === 0; i++) await sleep(10);
  assert.equal(calls, 1);
  await worker.stop();
  await worker.stop();
  assert.equal(worker.running, false);
  await sleep(80);
  assert.equal(calls, 1);
});

test('worker runs one drain at a time', async (t) => {
  const store = await queuedStore(t);
  let calls = 0, concurrent = 0, peak = 0;
  const worker = createAppleWalletPushWorker({store, sendWake: async () => { calls++; concurrent++; peak = Math.max(peak, concurrent); await sleep(30); concurrent--; return 'accepted'; }, intervalMs: 50, log: () => {}});
  const [first, second] = await Promise.all([worker.runOnce(), worker.runOnce()]);
  assert.equal(first, 1);
  assert.equal(second, 0);
  assert.equal(calls, 1);
  assert.equal(peak, 1);
});

test('worker config names the missing variable', () => {
  assert.throws(() => loadWorkerConfig({}), /STAMPIES_WALLET_DB_PATH/);
  const noKey = validEnv(); delete noKey.STAMPIES_WALLET_ROOT_KEY;
  assert.throws(() => loadWorkerConfig(noKey), /STAMPIES_WALLET_ROOT_KEY/);
  assert.throws(() => loadWorkerConfig({...validEnv(), STAMPIES_WALLET_ROOT_KEY: 'short'}), /STAMPIES_WALLET_ROOT_KEY/);
  assert.throws(() => loadWorkerConfig({...validEnv(), STAMPIES_WALLET_DB_PATH: 'relative/path.sqlite'}), /STAMPIES_WALLET_DB_PATH/);
  assert.throws(() => loadWorkerConfig({...validEnv(), STAMPIES_WALLET_PUSH_INTERVAL_MS: 'soon'}), /STAMPIES_WALLET_PUSH_INTERVAL_MS/);
  const config = loadWorkerConfig({...validEnv(), STAMPIES_WALLET_PUSH_INTERVAL_MS: '5000'});
  assert.equal(config.intervalMs, 5000);
  assert.equal(config.rootKey.length, 32);
  assert.equal(loadWorkerConfig(validEnv()).intervalMs, 30000);
});

test('worker fails fast with no configuration', async (t) => {
  const workerPath = fileURLToPath(new URL('../server/wallet/apple-push-worker.mjs', import.meta.url));
  const child = spawn(process.execPath, [workerPath], {env: {PATH: process.env.PATH}});
  let output = '';
  child.stderr.on('data', (chunk) => { output += chunk; });
  const code = await new Promise((resolve) => { child.on('exit', resolve); setTimeout(() => { child.kill('SIGKILL'); resolve(null); }, 10000); });
  assert.equal(code, 1);
  assert.match(output, /STAMPIES_WALLET_DB_PATH/);
});

test('worker starts with fixture certificates and shuts down on SIGTERM', async (t) => {
  const folder = mkdtempSync(join(tmpdir(), 'wallet-worker-')); t.after(() => rmSync(folder, {recursive: true, force: true}));
  const p = (n) => join(folder, n);
  const run = (args) => shell('openssl', args);
  // Local throwaway test trust only. No real Apple key or certificate is read.
  run(['req', '-new', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2', '-subj', '/CN=Fixture root', '-addext', 'basicConstraints=critical,CA:TRUE', '-keyout', p('rk'), '-out', p('rc')]);
  run(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=Fixture intermediate', '-keyout', p('ik'), '-out', p('ir')]);
  writeFileSync(p('ica'), 'basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\n');
  run(['x509', '-req', '-in', p('ir'), '-CA', p('rc'), '-CAkey', p('rk'), '-set_serial', '2', '-days', '2', '-extfile', p('ica'), '-out', p('ic')]);
  run(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-subj', '/UID=pass.au.fintex.stampies/OU=TEST123456/CN=Fixture wallet', '-keyout', p('sk'), '-out', p('sr')]);
  writeFileSync(p('sca'), 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\n');
  run(['x509', '-req', '-in', p('sr'), '-CA', p('ic'), '-CAkey', p('ik'), '-set_serial', '3', '-days', '2', '-extfile', p('sca'), '-out', p('sc')]);
  const workerPath = fileURLToPath(new URL('../server/wallet/apple-push-worker.mjs', import.meta.url));
  const env = {
    PATH: process.env.PATH,
    STAMPIES_WALLET_DB_PATH: p('updates.sqlite'),
    STAMPIES_WALLET_ORIGIN: 'https://wallet.example',
    STAMPIES_WALLET_ROOT_KEY: Buffer.alloc(32, 9).toString('base64url'),
    STAMPIES_WALLET_TEAM_ID: 'TEST123456',
    STAMPIES_WALLET_CERT_PATH: p('sc'),
    STAMPIES_WALLET_KEY_PATH: p('sk'),
    STAMPIES_WALLET_INTERMEDIATE_PATH: p('ic'),
    STAMPIES_WALLET_ROOT_PATH: p('rc'),
    STAMPIES_WALLET_PUSH_INTERVAL_MS: '1000',
  };
  const child = spawn(process.execPath, [workerPath], {env});
  t.after(() => { try { child.kill('SIGKILL'); } catch { /* already exited */ } });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  for (let i = 0; i < 100 && !output.includes('started'); i++) await sleep(100);
  assert.match(output, /Apple Wallet push worker started, interval 1000 ms\./);
  child.kill('SIGTERM');
  const code = await new Promise((resolve) => { child.on('exit', resolve); setTimeout(() => { child.kill('SIGKILL'); resolve(null); }, 10000); });
  assert.equal(code, 0);
  assert.match(output, /Apple Wallet push worker stopped\./);
  assert.match(output, /Apple Wallet push worker shut down\./);
});
