// SQLite stamp ledger. Shares the Wallet service database created by
// openWalletService. One row per stamp, deduped by stamp id, so a retry
// after a lost response never double stamps. The store never trusts a
// count from a caller: count() derives it from the recorded rows.
//
// The interface is {record, count}. The Postgres store in
// server/wallet/postgres/stamp-ledger.mjs implements the same interface
// with the same semantics: record returns 'recorded' for a fresh stamp,
// 'duplicate' when the identical stamp is already recorded, and
// 'conflict' when the stamp id is already used for another pass or
// business. The service owns the database handle; this store has no close.
export function openSqliteStampLedger(db) {
  if (!db || typeof db.exec !== 'function' || typeof db.prepare !== 'function') {
    throw new Error('A Wallet stamp ledger database is required.');
  }
  db.exec(`CREATE TABLE IF NOT EXISTS wallet_stamp (
      stamp_id TEXT PRIMARY KEY CHECK (length(stamp_id) BETWEEN 8 AND 80),
      pass_id TEXT NOT NULL CHECK (length(pass_id) BETWEEN 8 AND 80),
      business_id TEXT NOT NULL CHECK (length(business_id) BETWEEN 1 AND 60),
      created_at_ms INTEGER NOT NULL CHECK (created_at_ms > 0),
      recorded_at_ms INTEGER NOT NULL CHECK (recorded_at_ms > 0)
    );
    CREATE INDEX IF NOT EXISTS wallet_stamp_pass ON wallet_stamp(pass_id, created_at_ms);`);
  const insert = db.prepare('INSERT OR IGNORE INTO wallet_stamp(stamp_id,pass_id,business_id,created_at_ms,recorded_at_ms) VALUES(?,?,?,?,?)');
  const existing = db.prepare('SELECT pass_id,business_id FROM wallet_stamp WHERE stamp_id=?');
  const countByPass = db.prepare('SELECT COUNT(*) AS n FROM wallet_stamp WHERE pass_id=?');
  const transaction = (f) => {
    db.exec('BEGIN IMMEDIATE');
    try { const x = f(); db.exec('COMMIT'); return x; }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  function record({stampId, passId, businessId, createdAtMs}) {
    return transaction(() => {
      const result = insert.run(stampId, passId, businessId, createdAtMs, Date.now());
      const stamps = countByPass.get(passId).n;
      if (result.changes === 1) return {status: 'recorded', stamps};
      const row = existing.get(stampId);
      if (!row || row.pass_id !== passId || row.business_id !== businessId) return {status: 'conflict', stamps};
      return {status: 'duplicate', stamps};
    });
  }
  function count(passId) {
    return countByPass.get(passId).n;
  }
  return Object.freeze({record, count});
}
