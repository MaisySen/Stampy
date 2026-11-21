import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPostgresWalletPushWorker, loadPostgresWorkerConfig } from '../server/wallet/postgres-push-worker.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pending = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

const validEnv = () => ({
  STAMPIES_WALLET_ORIGIN: 'https://wallet.example',
  STAMPIES_WALLET_ROOT_KEY: Buffer.alloc(32, 9).toString('base64url'),
  STAMPIES_WALLET_TEAM_ID: 'TEST123456',
  STAMPIES_WALLET_CERT_PATH: '/tmp/stampies-cert.pem',
  STAMPIES_WALLET_KEY_PATH: '/tmp/stampies-key.pem',
  STAMPIES_WALLET_INTERMEDIATE_PATH: '/tmp/stampies-intermediate.pem',
  STAMPIES_WALLET_ROOT_PATH: '/tmp/stampies-root.pem',
  STAMPIES_WALLET_PG_HOST: 'wallet-db.example',
  STAMPIES_WALLET_PG_DATABASE: 'stampies_wallet',
  STAMPIES_WALLET_PG_USER: 'wallet_push_runtime',
  STAMPIES_WALLET_PG_PASSWORD: 'fixture-only-not-a-real-password',
});

// Fake Postgres-backed Wallet service. flushAppleWakes is the only method the
// worker calls. No live database, no live APNs.
function fakeService(flush) {
  let calls = 0;
  return {
    get calls() { return calls; },
    async flushAppleWakes() { calls += 1; return flush(); },
  };
}

test('worker drains on start and reports the flushed count', async () => {
  const service = fakeService(async () => 2);
  const worker = createPostgresWalletPushWorker({ service, intervalMs: 20, log: () => {} });
  worker.start();
  assert.equal(worker.running, true);
  for (let i = 0; i < 50 && service.calls === 0; i++) await sleep(10);
  assert.equal(service.calls, 1);
  await worker.stop();
  assert.equal(worker.running, false);
});

test('worker runOnce drains and returns the flushed count', async () => {
  const service = fakeService(async () => 3);
  const worker = createPostgresWalletPushWorker({ service, log: () => {} });
  assert.equal(await worker.runOnce(), 3);
  assert.equal(service.calls, 1);
});

test('overlapping drains share one flight', async () => {
  const gate = pending();
  let concurrent = 0, peak = 0;
  const service = fakeService(async () => {
    concurrent += 1;
    peak = Math.max(peak, concurrent);
    await gate.promise;
    concurrent -= 1;
    return 2;
  });
  const worker = createPostgresWalletPushWorker({ service, log: () => {} });
  const first = worker.runOnce();
  const second = worker.runOnce();
  assert.equal(first, second);
  gate.resolve();
  assert.deepEqual(await Promise.all([first, second]), [2, 2]);
  assert.equal(service.calls, 1);
  assert.equal(peak, 1);
});

test('worker stop is clean and idempotent', async () => {
  const service = fakeService(async () => 1);
  const worker = createPostgresWalletPushWorker({ service, intervalMs: 20, log: () => {} });
  worker.start();
  for (let i = 0; i < 50 && service.calls === 0; i++) await sleep(10);
  assert.equal(service.calls, 1);
  await worker.stop();
  await worker.stop();
  assert.equal(worker.running, false);
  assert.equal(await worker.runOnce(), 0);
  await sleep(80);
  assert.equal(service.calls, 1);
});

test('a failed send stays queued for retry', async () => {
  let attempts = 0;
  const service = fakeService(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('transient synthetic refusal');
    return 1;
  });
  const logs = [];
  const worker = createPostgresWalletPushWorker({ service, log: (message) => logs.push(message) });
  assert.equal(await worker.runOnce(), 0);
  assert.equal(service.calls, 1);
  assert.ok(logs.some((message) => message.includes('failed, will retry')));
  assert.equal(await worker.runOnce(), 1);
  assert.equal(service.calls, 2);
  assert.equal(attempts, 2);
});

test('worker config names the missing variable', () => {
  assert.throws(() => loadPostgresWorkerConfig({}), /STAMPIES_WALLET_ORIGIN/);
  const noHost = validEnv();
  delete noHost.STAMPIES_WALLET_PG_HOST;
  assert.throws(() => loadPostgresWorkerConfig(noHost), /STAMPIES_WALLET_PG_HOST/);
  const noPassword = validEnv();
  delete noPassword.STAMPIES_WALLET_PG_PASSWORD;
  assert.throws(() => loadPostgresWorkerConfig(noPassword), /STAMPIES_WALLET_PG_PASSWORD/);
  assert.throws(() => loadPostgresWorkerConfig({ ...validEnv(), STAMPIES_WALLET_ROOT_KEY: 'short' }), /STAMPIES_WALLET_ROOT_KEY/);
  assert.throws(() => loadPostgresWorkerConfig({ ...validEnv(), STAMPIES_WALLET_PUSH_INTERVAL_MS: 'soon' }), /STAMPIES_WALLET_PUSH_INTERVAL_MS/);
  assert.throws(() => loadPostgresWorkerConfig({ ...validEnv(), STAMPIES_WALLET_PG_PORT: '0' }), /STAMPIES_WALLET_PG_PORT/);
  assert.throws(() => loadPostgresWorkerConfig({ ...validEnv(), STAMPIES_WALLET_PG_SSL: 'yes' }), /STAMPIES_WALLET_PG_SSL/);
  const config = loadPostgresWorkerConfig({ ...validEnv(), STAMPIES_WALLET_PUSH_INTERVAL_MS: '5000' });
  assert.equal(config.intervalMs, 5000);
  assert.equal(config.rootKey.length, 32);
  assert.equal(config.pg.port, 5432);
  assert.equal(config.pg.ssl, true);
  assert.equal(loadPostgresWorkerConfig(validEnv()).intervalMs, 30000);
});

test('worker fails fast with no configuration', async () => {
  const workerPath = fileURLToPath(new URL('../server/wallet/postgres-push-worker.mjs', import.meta.url));
  const child = spawn(process.execPath, [workerPath], { env: { PATH: process.env.PATH } });
  let output = '';
  child.stderr.on('data', (chunk) => { output += chunk; });
  const code = await new Promise((resolve) => { child.on('exit', resolve); setTimeout(() => { child.kill('SIGKILL'); resolve(null); }, 10000); });
  assert.equal(code, 1);
  assert.match(output, /STAMPIES_WALLET_ORIGIN/);
});
