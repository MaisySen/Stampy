import { pathToFileURL } from 'node:url';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1000;
const FAILURE_CAP = 8;

// A wake is dead when it has failed 8 times, which is the dispatch cap, and
// the pass has not moved to a newer revision since. A newer revision revives
// delivery: the revision writer resets failures to 0 when it queues the new
// revision, so a dead wake at an older revision is left alone as a defensive
// guard against deleting a wake a concurrent writer is about to revive.
// The delete runs one statement, capped per run, so a large dead backlog is
// cleared a bounded batch at a time instead of one long lock.
export async function cleanupDeadAppleWakes({ pool, dryRun = false, limit = DEFAULT_LIMIT } = {}) {
  if (typeof pool?.query !== 'function') throw new Error('A private Wallet Postgres pool is required.');
  if (typeof dryRun !== 'boolean') throw new Error('Invalid Wallet wake cleanup mode.');
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new Error('Invalid Wallet wake cleanup limit.');
  const deadWhere = `FROM stampies_wallet.apple_wake AS w
    JOIN stampies_wallet.apple_pass AS p ON p.serial = w.serial
    WHERE w.failures >= $1 AND w.revision >= p.revision`;
  const counted = await pool.query(`SELECT count(*)::int AS n ${deadWhere}`, [FAILURE_CAP]);
  const dead = counted.rows[0]?.n ?? 0;
  if (dryRun) return Object.freeze({ removed: 0, dead });
  const removed = await pool.query(`WITH dead AS (
      SELECT w.device, w.serial ${deadWhere}
      ORDER BY w.ready_at, w.device, w.serial LIMIT $2
    ) DELETE FROM stampies_wallet.apple_wake AS w
      USING dead AS d WHERE w.device = d.device AND w.serial = d.serial`,
    [FAILURE_CAP, limit]);
  return Object.freeze({ removed: removed.rowCount, dead });
}

function loadCleanupConfig(env = process.env) {
  const missing = ['STAMPIES_WALLET_PG_HOST', 'STAMPIES_WALLET_PG_DATABASE', 'STAMPIES_WALLET_PG_USER', 'STAMPIES_WALLET_PG_PASSWORD']
    .filter((name) => !env[name]);
  if (missing.length) throw new Error(`Missing ${missing.join(', ')}.`);
  let limit = DEFAULT_LIMIT;
  if (env.STAMPIES_WALLET_WAKE_CLEANUP_LIMIT !== undefined && env.STAMPIES_WALLET_WAKE_CLEANUP_LIMIT !== '') {
    limit = Number(env.STAMPIES_WALLET_WAKE_CLEANUP_LIMIT);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new Error('STAMPIES_WALLET_WAKE_CLEANUP_LIMIT must be 1 to 1000.');
  }
  let dryRun = false;
  if (env.STAMPIES_WALLET_WAKE_CLEANUP_DRY_RUN !== undefined && env.STAMPIES_WALLET_WAKE_CLEANUP_DRY_RUN !== '') {
    if (env.STAMPIES_WALLET_WAKE_CLEANUP_DRY_RUN !== 'true' && env.STAMPIES_WALLET_WAKE_CLEANUP_DRY_RUN !== 'false') throw new Error('STAMPIES_WALLET_WAKE_CLEANUP_DRY_RUN must be true or false.');
    dryRun = env.STAMPIES_WALLET_WAKE_CLEANUP_DRY_RUN === 'true';
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
    dryRun,
    limit,
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

async function main() {
  try {
    const config = loadCleanupConfig(process.env);
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
      max: 2,
      connectionTimeoutMillis: 5000,
      query_timeout: 10000,
    });
    try {
      const { removed, dead } = await cleanupDeadAppleWakes({ pool, dryRun: config.dryRun, limit: config.limit });
      console.log(`Dead Apple wakes ${config.dryRun ? 'found' : 'removed'} ${config.dryRun ? dead : removed} of ${dead} dead.`);
    } finally {
      await pool.end();
    }
  } catch (error) {
    console.error(`Wallet wake cleanup failed: ${error.message}`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
