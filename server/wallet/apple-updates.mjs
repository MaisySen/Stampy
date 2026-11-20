import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { isAbsolute } from 'node:path';
import { PASS_TYPE_IDENTIFIER } from '../../src/lib/pass.ts';

const opaque = /^[A-Za-z0-9_-]{22,80}$/;
const deviceId = /^[A-Za-z0-9_-]{16,128}$/;
const pushId = /^(?:[0-9a-f]{2}){16,128}$/i;
const limit = 1024 * 2;
const fixedHeaders = {'Cache-Control':'private, no-store', 'X-Content-Type-Options':'nosniff'};
const empty = (status) => new Response(null, {status, headers:fixedHeaders});
const json = (data) => new Response(JSON.stringify(data), {status:200, headers:{...fixedHeaders,'Content-Type':'application/json'}});
const mac = (key, data, encoding) => createHmac('sha256',key).update(data).digest(encoding);
const limits = /^(?:0|[1-9]\d{0,14})$/;
function canonicalRoot(value) {
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') throw new Error('A dedicated HTTPS Wallet origin is required.');
  return parsed.origin;
}
export function appleUpdateIdentity({origin, rootKey}) {
  if (!Buffer.isBuffer(rootKey) || rootKey.length !== 32) throw new Error('A 32-byte private Wallet update key is required.');
  const url = new URL(canonicalRoot(origin));
  const key = mac(rootKey, 'stampies:apple-update-auth:v1');
  const tokenFor = (id) => {if (typeof id !== 'string' || !opaque.test(id)) throw new Error('Invalid pass ID.');return mac(key,id,'base64url');};
  return Object.freeze({url,tokenFor});
}
function authorized(headers, serial, tokenFor) {
  const input = headers.get('Authorization');
  const auth=/^ApplePass ([A-Za-z0-9_-]{43})$/.exec(input ?? '')?.[1];
  return auth !== undefined && timingSafeEqual(Buffer.from(auth),Buffer.from(tokenFor(serial)));
}
async function pushTokenOf(req) {
  if (!/^application\/json(?:\s*;[^\r\n]*)?$/i.test(req.headers.get('Content-Type') ?? '')) return null;
  const length = req.headers.get('Content-Length');
  if (length !== null && (!/^\d{1,4}$/.test(length) || Number(length) > limit)) return null;
  const reader = req.body?.getReader();
  if (!reader) return null;
  try {
    const chunks=[]; let size=0;
    for (;;) {
      const c=await reader.read();if(c.done)break;
      size+=c.value.length; if(size>limit){ await reader.cancel();return null; }
      chunks.push(Buffer.from(c.value));
    }
    const o=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return typeof o?.pushToken==='string' && pushId.test(o.pushToken) ? o.pushToken.toLowerCase() : null;
  } catch {return null;} finally {reader.releaseLock();}
}
// The caller supplies a private persistent database, update secret and the SAME signer used for issuance.
// putPass is a server-side integration point, not an HTTP route. Use committed changes from the merchant ledger.
export function openAppleUpdates({dbPath, origin, rootKey, signApple}) {
  if (typeof signApple!=='function' || typeof dbPath!=='string' || !(dbPath===':memory:' || isAbsolute(dbPath))) throw new Error('A private Wallet signer and database are required.');
  const identity=appleUpdateIdentity({origin,rootKey});
  const regKey=mac(rootKey,'stampies:apple-device:v1');
  const encKey=mac(rootKey,'stampies:apple-push-token:v1');
  const db=new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=1000; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS wallet_rev (key INTEGER PRIMARY KEY CHECK(key=1), n INTEGER NOT NULL);
    INSERT OR IGNORE INTO wallet_rev VALUES(1,0);
    CREATE TABLE IF NOT EXISTS wallet_pass (serial TEXT PRIMARY KEY, payload TEXT NOT NULL, rev INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS wallet_reg (device TEXT NOT NULL, serial TEXT NOT NULL REFERENCES wallet_pass(serial), push BLOB NOT NULL, PRIMARY KEY(device,serial));
    CREATE INDEX IF NOT EXISTS wallet_reg_by_serial ON wallet_reg(serial);
    CREATE TABLE IF NOT EXISTS wallet_wake (device TEXT NOT NULL, serial TEXT NOT NULL, rev INTEGER NOT NULL, PRIMARY KEY(device,serial), FOREIGN KEY(device,serial) REFERENCES wallet_reg(device,serial) ON DELETE CASCADE);`);
  const tick=db.prepare('UPDATE wallet_rev SET n=n+1 WHERE key=1 AND n<999999999999999 RETURNING n');
  const state=db.prepare('SELECT payload FROM wallet_pass WHERE serial=?');
  const save=db.prepare('INSERT INTO wallet_pass(serial,payload,rev) VALUES(?,?,?) ON CONFLICT(serial) DO UPDATE SET payload=excluded.payload, rev=excluded.rev');
  const attached=db.prepare('SELECT 1 FROM wallet_reg WHERE device=? AND serial=?');
  const upreg=db.prepare('INSERT INTO wallet_reg(device,serial,push) VALUES(?,?,?) ON CONFLICT(device,serial) DO UPDATE SET push=excluded.push');
  const unreg=db.prepare('DELETE FROM wallet_reg WHERE device=? AND serial=?');
  const changes=db.prepare('SELECT wallet_pass.serial, rev FROM wallet_reg JOIN wallet_pass USING(serial) WHERE device=? AND rev>? ORDER BY rev, wallet_pass.serial');
  const queue=db.prepare('INSERT INTO wallet_wake(device,serial,rev) SELECT device,serial,? FROM wallet_reg WHERE serial=? ON CONFLICT(device,serial) DO UPDATE SET rev=excluded.rev');
  const ready=db.prepare('SELECT wallet_wake.device, wallet_wake.serial, wallet_wake.rev, push FROM wallet_wake JOIN wallet_reg USING(device,serial) ORDER BY wallet_wake.rev LIMIT ?');
  const ack=db.prepare('DELETE FROM wallet_wake WHERE device=? AND serial=? AND rev=?');
  const transaction=(f)=>{
    db.exec('BEGIN IMMEDIATE'); try{ const x=f();db.exec('COMMIT');return x; } catch(e){db.exec('ROLLBACK');throw e;}
  };
  // Token encryption is authenticated against the exact hashed Apple device and pass, never logged.
  function seal(device,serial,push){ const iv=randomBytes(12), c=createCipheriv('aes-256-gcm',encKey,iv);c.setAAD(Buffer.from(`${device}:${serial}`));const ciphertext=Buffer.concat([c.update(push,'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),ciphertext]); }
  function open(device,serial,blob){const b=Buffer.from(blob),c=createDecipheriv('aes-256-gcm',encKey,b.subarray(0,12));c.setAAD(Buffer.from(`${device}:${serial}`));c.setAuthTag(b.subarray(12,28));return Buffer.concat([c.update(b.subarray(28)),c.final()]).toString('utf8');}
  const getPass=(serial)=>{const row=state.get(serial);return row?JSON.parse(row.payload):null;};
  function putPass(record) {
    if (!record || typeof record.passId!=='string' || !opaque.test(record.passId)) throw new Error('Invalid pass ID.');
    const payload=JSON.stringify(record);
    if (Buffer.byteLength(payload)>limit*8) throw new Error('Pass record too large.');
    return transaction(()=>{
      if(state.get(record.passId)?.payload===payload) return false;
      const version=tick.get()?.n;if(version===undefined) throw new Error('Wallet update counter exhausted.');
      save.run(record.passId,payload,version);queue.run(version,record.passId);return true;
    });
  }
  async function handle(req) {
    try {
      const u=new URL(req.url);const p=u.pathname.split('/');
      if (u.protocol!=='https:' || u.origin!==identity.url.origin || p[1]!=='v1') return empty(404);
      if (p[2]==='passes' && p.length===5 && p[3]===PASS_TYPE_IDENTIFIER && opaque.test(p[4])) {
        if(req.method!=='GET')return empty(405);
        if(!authorized(req.headers,p[4],identity.tokenFor))return empty(401);
        const row=getPass(p[4]);if(!row)return empty(404);
        return new Response(signApple(row),{headers:{...fixedHeaders,'Content-Type':'application/vnd.apple.pkpass'}});
      }
      if(p[2]==='log' && p.length===3 && req.method==='POST')return empty(200); // Drop diagnostic payloads; never retain Apple device data.
      if(p[2]!=='devices' || !deviceId.test(p[3] ?? '') || p[4]!=='registrations' || p[5]!==PASS_TYPE_IDENTIFIER) return empty(404);
      const dev=mac(regKey,p[3],'hex');
      if(p.length===6) {
        if(req.method!=='GET')return empty(405);
        const observed=u.searchParams.getAll('passesUpdatedSince');
        if(observed.length>1 || observed.length===1&&!limits.test(observed[0]))return empty(400);
        const found=changes.all(dev,observed.length?Number(observed[0]):0);
        return found.length===0?empty(204):json({serialNumbers:found.map((x)=>x.serial),lastUpdated:String(found.at(-1).rev)});
      }
      const serial=p[6];if(p.length!==7||!opaque.test(serial ?? ''))return empty(404);
      if(req.method!=='POST' && req.method!=='DELETE')return empty(405);
      if(!authorized(req.headers,serial,identity.tokenFor))return empty(401);
      if(!state.get(serial))return empty(404);
      if(req.method==='DELETE'){unreg.run(dev,serial);return empty(200);}
      const push=await pushTokenOf(req);if(!push)return empty(400);
      return empty(transaction(()=>{const exists=attached.get(dev,serial);upreg.run(dev,serial,seal(dev,serial,push));return exists?200:201;}));
    }catch{return empty(503);}
  }
  // Call only from an opted-in Wallet APNs worker. Retries are at-least-once and revision safe.
  async function sendPending(sendWake,max=25) {
    if(typeof sendWake!=='function'||!Number.isInteger(max)||max<1||max>100)throw new Error('Invalid Wallet push dispatcher.');
    let sent=0;
    for(const row of ready.all(max)){
      const status=await sendWake({topic:PASS_TYPE_IDENTIFIER,pushToken:open(row.device,row.serial,row.push)});
      if(status==='accepted'){ack.run(row.device,row.serial,row.rev);sent++;}
      // A conservative retry keeps failed or ambiguous deliveries queued; caller uses a bounded cadence.
    }
    return sent;
  }
  return Object.freeze({handle,putPass,getPass,sendPending,close:()=>db.close()});
}
