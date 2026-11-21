import { walletPgTransaction } from './issue-grants.mjs';
const serialPattern=/^[A-Za-z0-9_-]{22,80}$/;
const maxRevision=999999999999999;
const validSerial=(s)=>typeof s==='string' && serialPattern.test(s);

// NOT a public API. The application supplies only committed merchant records.
// Serialize commits on one clock row: an earlier allocated revision cannot commit
// after a higher one is already visible to Apple’s passesUpdatedSince cursor.
export function openPostgresAppleRevisionStore({pool}) {
  if (typeof pool?.connect!=='function'||typeof pool?.query!=='function') throw new Error('A private Wallet Postgres pool is required.');
  async function putPass(record,{sourceVersion}={}) {
    const serial=record?.passId;
    if (!validSerial(serial)||Object.hasOwn(record,'_walletSourceVersion')||!Number.isSafeInteger(sourceVersion)||sourceVersion<1)
      throw new Error('A committed Wallet revision is required.');
    const payload=JSON.stringify(record);
    if (Buffer.byteLength(payload)>16384) throw new Error('Pass record too large.');
    return walletPgTransaction(pool,async (db)=>{
      const state=await db.query('SELECT revision FROM stampies_wallet.apple_clock WHERE singleton FOR UPDATE');
      const cursor=Number(state.rows[0]?.revision);
      if (!Number.isSafeInteger(cursor)||cursor<0||cursor>maxRevision) throw new Error('Wallet revision clock unavailable.');
      const prior=(await db.query('SELECT payload,source_version FROM stampies_wallet.apple_pass WHERE serial=$1',[serial])).rows[0];
      if (prior) {
        const order=Number(prior.source_version);
        if (sourceVersion<order) return false;
        if (sourceVersion===order&&prior.payload!==payload) throw new Error('Conflicting pass source version.');
        if (prior.payload===payload) {
          if (sourceVersion>order) await db.query('UPDATE stampies_wallet.apple_pass SET source_version=$2 WHERE serial=$1',[serial,sourceVersion]);
          return false;
        }
      }
      if (cursor===maxRevision) throw new Error('Wallet update counter exhausted.');
      const revision=cursor+1;
      await db.query('UPDATE stampies_wallet.apple_clock SET revision=$1 WHERE singleton',[revision]);
      await db.query(`INSERT INTO stampies_wallet.apple_pass(serial,payload,source_version,revision)
        VALUES ($1,$2,$3,$4) ON CONFLICT(serial) DO UPDATE
        SET payload=EXCLUDED.payload,source_version=EXCLUDED.source_version,revision=EXCLUDED.revision`,[serial,payload,sourceVersion,revision]);
      await db.query(`INSERT INTO stampies_wallet.apple_wake(device,serial,revision)
        SELECT device,serial,$1 FROM stampies_wallet.apple_registration WHERE serial=$2
        ON CONFLICT(device,serial) DO UPDATE SET revision=EXCLUDED.revision,
        ready_at=EXCLUDED.ready_at,lease_id=NULL,lease_until=NULL,failures=0`,[revision,serial]);
      return true;
    });
  }
  async function getPass(serial) {
    if (!validSerial(serial)) return null;
    const row=(await pool.query('SELECT payload FROM stampies_wallet.apple_pass WHERE serial=$1',[serial])).rows[0];
    return row ? JSON.parse(row.payload) : null;
  }
  return Object.freeze({putPass,getPass});
}
