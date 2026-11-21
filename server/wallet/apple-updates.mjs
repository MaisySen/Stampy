import { DatabaseSync } from 'node:sqlite';
import { isAbsolute } from 'node:path';
import { PASS_TYPE_IDENTIFIER } from '../../src/lib/pass.ts';
import { appleRegistrationProtection, appleUpdateIdentity, createAppleUpdateHandler } from './apple-update-protocol.mjs';
export { appleUpdateIdentity } from './apple-update-protocol.mjs';

const opaque=/^[A-Za-z0-9_-]{22,80}$/;
const limit=2048;
// The caller supplies a private persistent database, update secret and the SAME signer used for issuance.
// putPass is a server-side integration point, not an HTTP route. Use committed changes from the merchant ledger.
export function openAppleUpdates({dbPath, origin, rootKey, signApple}) {
  if (typeof signApple!=='function' || typeof dbPath!=='string' || !(dbPath===':memory:' || isAbsolute(dbPath))) throw new Error('A private Wallet signer and database are required.');
  const identity=appleUpdateIdentity({origin,rootKey});
  const protection=appleRegistrationProtection(rootKey);
  const db=new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=1000; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS wallet_rev (key INTEGER PRIMARY KEY CHECK(key=1), n INTEGER NOT NULL);
    INSERT OR IGNORE INTO wallet_rev VALUES(1,0);
    CREATE TABLE IF NOT EXISTS wallet_pass (serial TEXT PRIMARY KEY, payload TEXT NOT NULL, rev INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS wallet_reg (device TEXT NOT NULL, serial TEXT NOT NULL REFERENCES wallet_pass(serial), push BLOB NOT NULL, PRIMARY KEY(device,serial));
    CREATE INDEX IF NOT EXISTS wallet_reg_by_serial ON wallet_reg(serial);
    CREATE TABLE IF NOT EXISTS wallet_wake (device TEXT NOT NULL, serial TEXT NOT NULL, rev INTEGER NOT NULL, PRIMARY KEY(device,serial), FOREIGN KEY(device,serial) REFERENCES wallet_reg(device,serial) ON DELETE CASCADE);`);
  const tick=db.prepare('UPDATE wallet_rev SET n=n+1 WHERE key=1 AND n<999999999999999 RETURNING n');
  const state=db.prepare('SELECT payload,rev FROM wallet_pass WHERE serial=?');
  const save=db.prepare('INSERT INTO wallet_pass(serial,payload,rev) VALUES(?,?,?) ON CONFLICT(serial) DO UPDATE SET payload=excluded.payload, rev=excluded.rev');
  const attached=db.prepare('SELECT 1 FROM wallet_reg WHERE device=? AND serial=?');
  const upreg=db.prepare('INSERT INTO wallet_reg(device,serial,push) VALUES(?,?,?) ON CONFLICT(device,serial) DO UPDATE SET push=excluded.push');
  const unreg=db.prepare('DELETE FROM wallet_reg WHERE device=? AND serial=?');
  const changes=db.prepare('SELECT wallet_pass.serial, rev FROM wallet_reg JOIN wallet_pass USING(serial) WHERE device=? AND rev>? ORDER BY rev, wallet_pass.serial');
  const queue=db.prepare('INSERT INTO wallet_wake(device,serial,rev) SELECT device,serial,? FROM wallet_reg WHERE serial=? ON CONFLICT(device,serial) DO UPDATE SET rev=excluded.rev');
  const ready=db.prepare('SELECT wallet_wake.device, wallet_wake.serial, wallet_wake.rev, push FROM wallet_wake JOIN wallet_reg USING(device,serial) ORDER BY wallet_wake.rev LIMIT ?');
  const ack=db.prepare('DELETE FROM wallet_wake WHERE device=? AND serial=? AND rev=? AND EXISTS (SELECT 1 FROM wallet_reg WHERE wallet_reg.device=wallet_wake.device AND wallet_reg.serial=wallet_wake.serial AND push=?)');
  const removeStaleReg=db.prepare('DELETE FROM wallet_reg WHERE device=? AND serial=? AND push=?');
  const transaction=(f)=>{
    db.exec('BEGIN IMMEDIATE'); try{ const x=f();db.exec('COMMIT');return x; } catch(e){db.exec('ROLLBACK');throw e;}
  };
  const getPass=(serial)=>{
    const row=state.get(serial);if(!row)return null;
    const {_walletSourceVersion,...visible}=JSON.parse(row.payload);return visible;
  };
  function putPass(record,{sourceVersion}={}) {
    if (!record || typeof record.passId!=='string' || !opaque.test(record.passId) || Object.hasOwn(record,'_walletSourceVersion') ||
        (sourceVersion!==undefined && (!Number.isSafeInteger(sourceVersion) || sourceVersion<1))) throw new Error('Invalid pass update record.');
    const value=JSON.stringify(record);
    const payload=sourceVersion===undefined?value:JSON.stringify({...record,_walletSourceVersion:sourceVersion});
    if (Buffer.byteLength(payload)>limit*8) throw new Error('Pass record too large.');
    return transaction(()=>{
      const prior=state.get(record.passId);
      if(prior?.payload===payload) return false;
      if(prior){
        const {_walletSourceVersion,...visible}=JSON.parse(prior.payload);
        if(_walletSourceVersion!==undefined && sourceVersion===undefined)throw new Error('Unversioned pass update refused.');
        if(_walletSourceVersion!==undefined && sourceVersion<_walletSourceVersion)return false;
        const sameVisible=JSON.stringify(visible)===value;
        if(_walletSourceVersion!==undefined && sourceVersion===_walletSourceVersion && !sameVisible) throw new Error('Conflicting pass source version.');
        if(sameVisible){save.run(record.passId,payload,prior.rev);return false;}
      }
      const version=tick.get()?.n;if(version===undefined) throw new Error('Wallet update counter exhausted.');
      save.run(record.passId,payload,version);queue.run(version,record.passId);return true;
    });
  }
  const handle=createAppleUpdateHandler({identity,protection,signApple,getPass,
    listChanges:(device,since)=>changes.all(device,since),
    register:(device,serial,push)=>transaction(()=>{
      if(!state.get(serial))return 404;
      const exists=attached.get(device,serial);upreg.run(device,serial,protection.seal(device,serial,push));return exists?200:201;
    }),
    unregister:(device,serial)=>transaction(()=>{
      if(!state.get(serial))return 404;
      unreg.run(device,serial);return 200;
    }),
  });
  // Call only from an opted-in Wallet APNs worker. Retries are at-least-once and revision safe.
  async function sendPending(sendWake,max=25) {
    if(typeof sendWake!=='function'||!Number.isInteger(max)||max<1||max>100)throw new Error('Invalid Wallet push dispatcher.');
    let sent=0;
    for(const row of ready.all(max)){
      const status=await sendWake({topic:PASS_TYPE_IDENTIFIER,pushToken:protection.open(row.device,row.serial,row.push)});
      if(status==='accepted'){ack.run(row.device,row.serial,row.rev,row.push);sent++;}
      if(status==='unregistered')removeStaleReg.run(row.device,row.serial,row.push);
      // Both updates compare the encrypted registration snapshot. A concurrent registration or
      // a newer revision stays queued. Other failures are retained for retry by a bounded dispatcher.
    }
    return sent;
  }
  return Object.freeze({handle,putPass,getPass,sendPending,close:()=>db.close()});
}
