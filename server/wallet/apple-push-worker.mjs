import { readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openAppleUpdates, appleUpdateIdentity } from './apple-updates.mjs';
import { createAppleWalletPushSender } from './apple-push.mjs';
import { createAppleSigner } from './signing.mjs';

const DEFAULT_INTERVAL_MS = 30000;
const DEFAULT_MAX_PER_CYCLE = 25;
const REQUIRED = [
  'STAMPIES_WALLET_DB_PATH',
  'STAMPIES_WALLET_ORIGIN',
  'STAMPIES_WALLET_ROOT_KEY',
  'STAMPIES_WALLET_TEAM_ID',
  'STAMPIES_WALLET_CERT_PATH',
  'STAMPIES_WALLET_KEY_PATH',
  'STAMPIES_WALLET_INTERMEDIATE_PATH',
  'STAMPIES_WALLET_ROOT_PATH',
];

// Configuration comes from the environment only. Every variable is checked at
// startup and a missing one fails fast by name. No secret is ever written here.
export function loadWorkerConfig(env = process.env) {
  const missing = REQUIRED.filter((name) => !env[name]);
  if (missing.length) throw new Error(`Missing ${missing.join(', ')}.`);
  const dbPath = env.STAMPIES_WALLET_DB_PATH;
  if (dbPath === ':memory:' || !isAbsolute(dbPath)) throw new Error('STAMPIES_WALLET_DB_PATH must be a persistent absolute path.');
  if (!/^[A-Za-z0-9_-]{43}$/.test(env.STAMPIES_WALLET_ROOT_KEY ?? '')) throw new Error('STAMPIES_WALLET_ROOT_KEY must be base64url of a 32-byte secret.');
  const rootKey = Buffer.from(env.STAMPIES_WALLET_ROOT_KEY, 'base64url');
  if (rootKey.length !== 32) throw new Error('STAMPIES_WALLET_ROOT_KEY must be base64url of a 32-byte secret.');
  let intervalMs = DEFAULT_INTERVAL_MS;
  if (env.STAMPIES_WALLET_PUSH_INTERVAL_MS !== undefined && env.STAMPIES_WALLET_PUSH_INTERVAL_MS !== '') {
    intervalMs = Number(env.STAMPIES_WALLET_PUSH_INTERVAL_MS);
    if (!Number.isInteger(intervalMs) || intervalMs < 1000 || intervalMs > 3600000) throw new Error('STAMPIES_WALLET_PUSH_INTERVAL_MS must be 1000 to 3600000.');
  }
  return Object.freeze({
    dbPath,
    origin: env.STAMPIES_WALLET_ORIGIN,
    rootKey,
    teamIdentifier: env.STAMPIES_WALLET_TEAM_ID,
    certificatePath: env.STAMPIES_WALLET_CERT_PATH,
    privateKeyPath: env.STAMPIES_WALLET_KEY_PATH,
    intermediatePath: env.STAMPIES_WALLET_INTERMEDIATE_PATH,
    rootPath: env.STAMPIES_WALLET_ROOT_PATH,
    assetsDir: env.STAMPIES_WALLET_ASSETS_DIR ?? 'assets',
    intervalMs,
  });
}

// The worker never serves the /v1 pass fetch route, so it never signs a pass.
// The signer is built on first use from the same mounted certificate paths and
// the same update identity as the issuing service, so the store keeps one real
// signer. Building it eagerly would force icon artwork to be mounted for a
// process that never signs.
function lazyAppleSigner(config, identity) {
  let signer = null;
  return (record, now) => {
    if (!signer) {
      const assets = {};
      for (const name of ['icon.png', 'icon@2x.png']) assets[name] = readFileSync(join(config.assetsDir, name));
      signer = createAppleSigner({
        teamIdentifier: config.teamIdentifier,
        certificatePath: config.certificatePath,
        privateKeyPath: config.privateKeyPath,
        intermediatePath: config.intermediatePath,
        rootPath: config.rootPath,
        assets,
        appleUpdates: identity,
      });
    }
    return signer(record, now);
  };
}

// Single dispatcher. One drain runs at a time; a tick that lands while a drain
// is running is skipped, never queued twice. Logs carry counts and statuses
// only, never device tokens, push tokens, pass IDs or provider payloads.
export function createAppleWalletPushWorker({ store, sendWake, intervalMs = DEFAULT_INTERVAL_MS, maxPerCycle = DEFAULT_MAX_PER_CYCLE, log = () => {} }) {
  if (!store || typeof store.sendPending !== 'function' || typeof sendWake !== 'function') throw new Error('A Wallet update store and push sender are required.');
  if (!Number.isInteger(intervalMs) || intervalMs < 1 || intervalMs > 3600000) throw new Error('Invalid Wallet push interval.');
  if (!Number.isInteger(maxPerCycle) || maxPerCycle < 1 || maxPerCycle > 100) throw new Error('Invalid Wallet push batch size.');
  let timer = null, busy = false, stopped = false, current = null;
  async function runOnce() {
    if (busy || stopped) return 0;
    busy = true;
    current = (async () => {
      try {
        const sent = await store.sendPending(sendWake, maxPerCycle);
        log(`Apple Wallet push cycle sent ${sent} wake${sent === 1 ? '' : 's'}.`);
        return sent;
      } catch {
        log('Apple Wallet push cycle failed, will retry.');
        return 0;
      } finally { busy = false; }
    })();
    return current;
  }
  function start() {
    if (timer || stopped) return;
    log(`Apple Wallet push worker started, interval ${intervalMs} ms.`);
    timer = setInterval(() => { void runOnce(); }, intervalMs);
    void runOnce();
  }
  async function stop() {
    if (stopped) return;
    stopped = true;
    if (timer) { clearInterval(timer); timer = null; }
    if (current) await current;
    log('Apple Wallet push worker stopped.');
  }
  return Object.freeze({ start, stop, runOnce, get running() { return timer !== null; } });
}

function main() {
  try {
    const config = loadWorkerConfig(process.env);
    const identity = appleUpdateIdentity({ origin: config.origin, rootKey: config.rootKey });
    const store = openAppleUpdates({ dbPath: config.dbPath, origin: config.origin, rootKey: config.rootKey, signApple: lazyAppleSigner(config, identity) });
    const sender = createAppleWalletPushSender({
      teamIdentifier: config.teamIdentifier,
      certificatePath: config.certificatePath,
      privateKeyPath: config.privateKeyPath,
      intermediatePath: config.intermediatePath,
      rootPath: config.rootPath,
    });
    const worker = createAppleWalletPushWorker({ store, sendWake: sender.sendWake, intervalMs: config.intervalMs, log: (message) => console.log(message) });
    let stopping = false;
    const shutdown = async () => {
      if (stopping) return;
      stopping = true;
      await worker.stop();
      sender.close();
      store.close();
      console.log('Apple Wallet push worker shut down.');
      process.exit(0);
    };
    process.on('SIGINT', () => { void shutdown(); });
    process.on('SIGTERM', () => { void shutdown(); });
    worker.start();
  } catch (error) {
    console.error(`Apple Wallet push worker failed to start: ${error.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
