import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { appleUpdateIdentity } from './apple-updates.mjs';
import { createAppleWalletPushSender } from './apple-push.mjs';
import { createAppleSigner } from './signing.mjs';
import { openPostgresWalletService } from './postgres/service.mjs';

const DEFAULT_INTERVAL_MS = 30000;
const REQUIRED = [
  'STAMPIES_WALLET_ORIGIN',
  'STAMPIES_WALLET_ROOT_KEY',
  'STAMPIES_WALLET_TEAM_ID',
  'STAMPIES_WALLET_CERT_PATH',
  'STAMPIES_WALLET_KEY_PATH',
  'STAMPIES_WALLET_INTERMEDIATE_PATH',
  'STAMPIES_WALLET_ROOT_PATH',
  'STAMPIES_WALLET_PG_HOST',
  'STAMPIES_WALLET_PG_DATABASE',
  'STAMPIES_WALLET_PG_USER',
  'STAMPIES_WALLET_PG_PASSWORD',
];

// Configuration comes from the environment only. Every variable is checked at
// startup and a missing one fails fast by name. No secret is ever written here.
// The Postgres names are new: the SQLite worker has no Postgres settings, so
// these reuse the same STAMPIES_WALLET prefix and nothing else.
export function loadPostgresWorkerConfig(env = process.env) {
  const missing = REQUIRED.filter((name) => !env[name]);
  if (missing.length) throw new Error(`Missing ${missing.join(', ')}.`);
  if (!/^[A-Za-z0-9_-]{43}$/.test(env.STAMPIES_WALLET_ROOT_KEY ?? '')) throw new Error('STAMPIES_WALLET_ROOT_KEY must be base64url of a 32-byte secret.');
  const rootKey = Buffer.from(env.STAMPIES_WALLET_ROOT_KEY, 'base64url');
  if (rootKey.length !== 32) throw new Error('STAMPIES_WALLET_ROOT_KEY must be base64url of a 32-byte secret.');
  let intervalMs = DEFAULT_INTERVAL_MS;
  if (env.STAMPIES_WALLET_PUSH_INTERVAL_MS !== undefined && env.STAMPIES_WALLET_PUSH_INTERVAL_MS !== '') {
    intervalMs = Number(env.STAMPIES_WALLET_PUSH_INTERVAL_MS);
    if (!Number.isInteger(intervalMs) || intervalMs < 1000 || intervalMs > 3600000) throw new Error('STAMPIES_WALLET_PUSH_INTERVAL_MS must be 1000 to 3600000.');
  }
  let pgPort = 5432;
  if (env.STAMPIES_WALLET_PG_PORT !== undefined && env.STAMPIES_WALLET_PG_PORT !== '') {
    pgPort = Number(env.STAMPIES_WALLET_PG_PORT);
    if (!Number.isInteger(pgPort) || pgPort < 1 || pgPort > 65535) throw new Error('STAMPIES_WALLET_PG_PORT must be 1 to 65535.');
  }
  let pgSsl = true;
  if (env.STAMPIES_WALLET_PG_SSL !== undefined && env.STAMPIES_WALLET_PG_SSL !== '') {
    if (env.STAMPIES_WALLET_PG_SSL !== 'true' && env.STAMPIES_WALLET_PG_SSL !== 'false') throw new Error('STAMPIES_WALLET_PG_SSL must be true or false.');
    pgSsl = env.STAMPIES_WALLET_PG_SSL === 'true';
  }
  return Object.freeze({
    origin: env.STAMPIES_WALLET_ORIGIN,
    rootKey,
    teamIdentifier: env.STAMPIES_WALLET_TEAM_ID,
    certificatePath: env.STAMPIES_WALLET_CERT_PATH,
    privateKeyPath: env.STAMPIES_WALLET_KEY_PATH,
    intermediatePath: env.STAMPIES_WALLET_INTERMEDIATE_PATH,
    rootPath: env.STAMPIES_WALLET_ROOT_PATH,
    assetsDir: env.STAMPIES_WALLET_ASSETS_DIR ?? 'assets',
    intervalMs,
    pg: Object.freeze({
      host: env.STAMPIES_WALLET_PG_HOST,
      port: pgPort,
      database: env.STAMPIES_WALLET_PG_DATABASE,
      user: env.STAMPIES_WALLET_PG_USER,
      password: env.STAMPIES_WALLET_PG_PASSWORD,
      ssl: pgSsl,
    }),
  });
}

// Same lazy signer as the SQLite worker: the worker never serves the /v1 pass
// fetch route, so it never signs a pass. Building the signer eagerly would
// force icon artwork to be mounted for a process that never signs.
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

// Single dispatcher over the Postgres-backed Wallet service. One drain runs at
// a time; overlapping calls share the same flight instead of starting a second
// drain. Logs carry counts and statuses only, never device tokens, push
// tokens, pass IDs or provider payloads.
export function createPostgresWalletPushWorker({ service, intervalMs = DEFAULT_INTERVAL_MS, log = () => {} }) {
  if (!service || typeof service.flushAppleWakes !== 'function') throw new Error('A Postgres Wallet service with flushAppleWakes is required.');
  if (!Number.isInteger(intervalMs) || intervalMs < 1 || intervalMs > 3600000) throw new Error('Invalid Wallet push interval.');
  let timer = null, stopped = false, current = null;
  // Not async on purpose: overlapping callers get the exact same in-flight
  // promise back, so a second drain shares the first drain's flight.
  function runOnce() {
    if (stopped) return Promise.resolve(0);
    if (current) return current;
    current = (async () => {
      try {
        const sent = await service.flushAppleWakes();
        log(`Postgres Wallet push cycle sent ${sent} wake${sent === 1 ? '' : 's'}.`);
        return sent;
      } catch {
        log('Postgres Wallet push cycle failed, will retry.');
        return 0;
      } finally { current = null; }
    })();
    return current;
  }
  function start() {
    if (timer || stopped) return;
    log(`Postgres Wallet push worker started, interval ${intervalMs} ms.`);
    timer = setInterval(() => { void runOnce(); }, intervalMs);
    void runOnce();
  }
  async function stop() {
    if (stopped) return;
    stopped = true;
    if (timer) { clearInterval(timer); timer = null; }
    if (current) await current;
    log('Postgres Wallet push worker stopped.');
  }
  return Object.freeze({ start, stop, runOnce, get running() { return timer !== null; } });
}

async function main() {
  try {
    const config = loadPostgresWorkerConfig(process.env);
    let Pool;
    try {
      ({ Pool } = await import('pg'));
    } catch {
      throw new Error('The Wallet Postgres driver (pg) is not installed on this host.');
    }
    const pool = new Pool({
      host: config.pg.host,
      port: config.pg.port,
      database: config.pg.database,
      user: config.pg.user,
      password: config.pg.password,
      ssl: config.pg.ssl,
      max: 5,
      connectionTimeoutMillis: 5000,
      query_timeout: 10000,
    });
    const identity = appleUpdateIdentity({ origin: config.origin, rootKey: config.rootKey });
    const sender = createAppleWalletPushSender({
      teamIdentifier: config.teamIdentifier,
      certificatePath: config.certificatePath,
      privateKeyPath: config.privateKeyPath,
      intermediatePath: config.intermediatePath,
      rootPath: config.rootPath,
    });
    // The worker never mints, issues or reads the merchant ledger. It only
    // drains wakes the issuing service already queued, so both ledger adapters
    // are inert functions. The service still validates their shape at open.
    // Opening through openPostgresWalletService verifies the restricted
    // runtime role first; a wrongly privileged login fails fast here.
    const service = await openPostgresWalletService({
      pool,
      origin: config.origin,
      lookupOwnedPass: async () => null,
      apple: {
        rootKey: config.rootKey,
        push: sender,
        loadCommittedPass: async () => null,
        makeSigner: (auth) => lazyAppleSigner(config, auth),
      },
    });
    const worker = createPostgresWalletPushWorker({ service, intervalMs: config.intervalMs, log: (message) => console.log(message) });
    let stopping = false;
    const shutdown = async () => {
      if (stopping) return;
      stopping = true;
      await worker.stop();
      await service.close();
      await pool.end();
      console.log('Postgres Wallet push worker shut down.');
      process.exit(0);
    };
    process.on('SIGINT', () => { void shutdown(); });
    process.on('SIGTERM', () => { void shutdown(); });
    worker.start();
  } catch (error) {
    console.error(`Postgres Wallet push worker failed to start: ${error.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
