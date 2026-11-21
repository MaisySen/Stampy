// Postgres stamp ledger. One row per stamp, deduped by stamp id, so a
// retry after a lost response never double stamps. The store never trusts
// a count from a caller: count() derives it from the recorded rows.
//
// The table is created by 004-stamp-intake.sql. The runtime role holds
// SELECT and INSERT on it, nothing else, and the role verifier in
// runtime-role.mjs checks that exact contract.
//
// The interface is {record, count}. The SQLite store in
// server/wallet/stamp-ledger.mjs implements the same interface with the
// same semantics: record returns 'recorded' for a fresh stamp,
// 'duplicate' when the identical stamp is already recorded, and
// 'conflict' when the stamp id is already used for another pass or
// business. The caller owns pool lifecycle; this store has no close.
export function openPostgresStampLedger({pool}) {
  if (typeof pool?.query !== 'function') throw new Error('A private Wallet Postgres pool is required.');
  async function count(passId) {
    const result = await pool.query('SELECT COUNT(*)::int AS n FROM stampies_wallet.stamp_ledger WHERE pass_id=$1', [passId]);
    return result.rows[0]?.n ?? 0;
  }
  async function record({stampId, passId, businessId, createdAtMs}) {
    const inserted = await pool.query(
      `INSERT INTO stampies_wallet.stamp_ledger(stamp_id,pass_id,business_id,created_at_ms)
       VALUES ($1,$2,$3,$4) ON CONFLICT (stamp_id) DO NOTHING RETURNING stamp_id`,
      [stampId, passId, businessId, createdAtMs]);
    const stamps = await count(passId);
    if (inserted.rowCount === 1) return {status: 'recorded', stamps};
    const row = (await pool.query(
      'SELECT pass_id,business_id FROM stampies_wallet.stamp_ledger WHERE stamp_id=$1', [stampId])).rows[0];
    if (!row || row.pass_id !== passId || row.business_id !== businessId) return {status: 'conflict', stamps};
    return {status: 'duplicate', stamps};
  }
  return Object.freeze({record, count});
}
