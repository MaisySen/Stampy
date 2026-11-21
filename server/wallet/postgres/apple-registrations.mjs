import { appleRegistrationProtection, appleUpdateIdentity, createAppleUpdateHandler } from '../apple-update-protocol.mjs';
import { openPostgresAppleRevisionStore } from './apple-revisions.mjs';
import { walletPgTransaction } from './issue-grants.mjs';

const maxDevicePasses=128;

// Opt-in Apple PassKit web service. The caller owns the TLS pool and trusted signer.
// The stamp writer is internal and only accepts a committed source version. No stamp API is exposed.
export function openPostgresAppleUpdates({pool, origin, rootKey, signApple}) {
  if(typeof signApple!=='function') throw new Error('A private Wallet signer is required.');
  const identity=appleUpdateIdentity({origin,rootKey});
  const protection=appleRegistrationProtection(rootKey);
  const {getPass,putPass}=openPostgresAppleRevisionStore({pool});

  async function lockClock(db){
    // Same ordering point as a revision: either registration sees the latest pass,
    // or the later writer sees the registration. No missed wake across the race.
    if((await db.query('SELECT revision FROM stampies_wallet.apple_clock WHERE singleton FOR UPDATE')).rowCount!==1)
      throw new Error('Wallet revision clock unavailable.');
  }
  const passRevision=async(db,serial)=>(await db.query('SELECT revision FROM stampies_wallet.apple_pass WHERE serial=$1',[serial])).rows[0]?.revision;
  async function register(device,serial,push){
    return walletPgTransaction(pool,async(db)=>{
      await lockClock(db);
      const revision=await passRevision(db,serial); if(revision===undefined)return 404;
      const previous=(await db.query('SELECT encrypted_push FROM stampies_wallet.apple_registration WHERE device=$1 AND serial=$2',[device,serial])).rows[0];
      if(previous && protection.open(device,serial,previous.encrypted_push)===push)return 200;
      if(!previous && (await db.query('SELECT count(*)::int AS n FROM stampies_wallet.apple_registration WHERE device=$1',[device])).rows[0].n>=maxDevicePasses)return 429;
      await db.query(`INSERT INTO stampies_wallet.apple_registration(device,serial,encrypted_push) VALUES ($1,$2,$3)
        ON CONFLICT(device,serial) DO UPDATE SET encrypted_push=EXCLUDED.encrypted_push`,[device,serial,protection.seal(device,serial,push)]);
      // Initial/rotated registration reconciles a pass changed between Issue and Add.
      await db.query(`INSERT INTO stampies_wallet.apple_wake(device,serial,revision) VALUES ($1,$2,$3)
        ON CONFLICT(device,serial) DO UPDATE SET revision=EXCLUDED.revision,
        ready_at=EXCLUDED.ready_at,lease_id=NULL,lease_until=NULL`,[device,serial,revision]);
      return previous?200:201;
    });
  }
  async function unregister(device,serial){
    return walletPgTransaction(pool,async(db)=>{
      await lockClock(db);
      if(await passRevision(db,serial)===undefined)return 404;
      // The FK also removes any pending/leased wake for this device and pass.
      await db.query('DELETE FROM stampies_wallet.apple_registration WHERE device=$1 AND serial=$2',[device,serial]);
      return 200;
    });
  }
  async function listChanges(device,since){
    const {rows}=await pool.query(`SELECT apple_pass.serial,apple_pass.revision AS rev
      FROM stampies_wallet.apple_registration JOIN stampies_wallet.apple_pass USING(serial)
      WHERE device=$1 AND apple_pass.revision>$2 ORDER BY apple_pass.revision,apple_pass.serial LIMIT $3`,[device,since,maxDevicePasses+1]);
    if(rows.length>maxDevicePasses)throw new Error('Wallet registration limit exceeded.');
    return rows;
  }
  const handle=createAppleUpdateHandler({identity,protection,signApple,getPass,register,unregister,listChanges});
  return Object.freeze({handle,getPass,putPass,close:()=>{}});
}
