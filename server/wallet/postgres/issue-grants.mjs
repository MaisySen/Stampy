const hex = /^[a-f0-9]{64}$/;
// Owner ids stay 22 to 80 characters. Serial is a pass id, 8 to 80,
// the same rule as the stamp intake and the stamp ledger. The app
// sends pass ids like stampies-corner-cafe, which the 22 floor rejected.
const ownerId = /^[A-Za-z0-9_-]{22,80}$/;
const serialId = /^[A-Za-z0-9_-]{8,80}$/;
const paths = new Set(['/wallet/apple', '/wallet/google']);
const positiveClock = (x) => Number.isSafeInteger(x) && x >= 0;

export async function walletPgTransaction(pool, fn) {
  const connection = await pool.connect();
  let unsafe = false;
  try {
    await connection.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await connection.query("SET LOCAL statement_timeout = '3000ms'");
    await connection.query("SET LOCAL lock_timeout = '2000ms'");
    await connection.query("SET LOCAL idle_in_transaction_session_timeout = '4000ms'");
    const answer = await fn(connection);
    await connection.query('COMMIT');
    return answer;
  } catch (error) {
    try { await connection.query('ROLLBACK'); } catch { unsafe = true; }
    throw error;
  } finally { connection.release(unsafe); }
}

// Caller owns the dedicated TLS pool. Apply the migration with a separate owner first.
// Use a database role restricted to Wallet tables; never create data or tables at a public request.
export function openPostgresIssueGrants({pool}) {
  if (typeof pool?.connect !== 'function') throw new Error('A private Wallet Postgres pool is required.');
  let closed = false;
  return Object.freeze({
    async insertWithinCap({digest,owner,serial,path,expires,now}) {
      if (closed) return false;
      if (!hex.test(digest) || !ownerId.test(owner) || !serialId.test(serial) || !paths.has(path) ||
          !positiveClock(now) || !positiveClock(expires) || expires - now !== 90) {
        throw new Error('Invalid Wallet grant.');
      }
      return walletPgTransaction(pool, async (con) => {
        // Serialize this exact grant bucket across function instances. Hash collisions only serialize more callers.
        // These are separate commands under READ COMMITTED, so counts see the previous holder’s commit.
        await con.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [JSON.stringify(['stampies-issue-v1',owner,serial,path])]);
        // One opportunistic, bounded cleanup at a time. A separate advisory key space avoids
        // requiring UPDATE rights on grants merely to lock their rows during expiry cleanup.
        const janitor = await con.query('SELECT pg_try_advisory_xact_lock(1937006960, 1) AS held');
        if (janitor.rows[0]?.held) {
          await con.query(`WITH expired AS (
              SELECT digest FROM stampies_wallet.issue_grants WHERE expires <= $1
              ORDER BY expires, digest LIMIT 64
            ) DELETE FROM stampies_wallet.issue_grants AS g USING expired AS e
              WHERE g.digest = e.digest AND g.expires <= $1`, [now]);
        }
        const remaining = await con.query(`SELECT digest FROM stampies_wallet.issue_grants
          WHERE owner=$1 AND serial=$2 AND path=$3 AND expires>$4 LIMIT 5`, [owner,serial,path,now]);
        if (remaining.rowCount >= 5 || closed) return false;
        await con.query('INSERT INTO stampies_wallet.issue_grants (digest,owner,serial,path,expires) VALUES ($1,$2,$3,$4,$5)',
          [digest,owner,serial,path,expires]);
        return true;
      });
    },
    async claim({digest,path,now}) {
      if (closed || !hex.test(digest) || !paths.has(path) || !positiveClock(now)) return null;
      // Atomic consume. In-flight duplicates, mismatched audience and expired grants cannot return a row.
      return walletPgTransaction(pool,async (con) => {
        const result = await con.query(`DELETE FROM stampies_wallet.issue_grants
          WHERE digest=$1 AND path=$2 AND expires>$3 RETURNING owner, serial`,[digest,path,now]);
        return result.rows[0] ?? null;
      });
    },
    close() { closed = true; },
  });
}
