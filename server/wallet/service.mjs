import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { isAbsolute } from 'node:path';
import { appleUpdateIdentity, openAppleUpdates } from './apple-updates.mjs';
import { createWalletIssueHandler } from './signing.mjs';

const routes = new Map([['apple', '/wallet/apple'], ['google', '/wallet/google']]);
const opaque = /^[A-Za-z0-9_-]{22,80}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const validId = (x) => typeof x === 'string' && opaque.test(x);
const tokenDigest = (x) => createHash('sha256').update(x).digest('hex');
const state = (row, passId) => {
  if (!Number.isSafeInteger(row?.version) || row.version < 1 || row.record?.passId !== passId) return null;
  return row;
};
const response = (status) => new Response(null, {status,headers:{'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}});

// Only the authenticated application may call mint. No public mint or stamp endpoint.
// The two authority adapters must consult the committed merchant ledger, never client state.
export function openWalletService({ origin, tokenDbPath, apple, google, lookupOwnedPass, now = Date.now }) {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.href !== `${url.origin}/` || typeof lookupOwnedPass !== 'function' ||
      typeof tokenDbPath !== 'string' || !(tokenDbPath === ':memory:' || isAbsolute(tokenDbPath)) || typeof now !== 'function' ||
      (google !== undefined && typeof google !== 'function')) throw new Error('Invalid Wallet service configuration.');
  let passStore, sender;
  if (apple !== undefined) {
    if (typeof apple.makeSigner !== 'function' || typeof apple.loadCommittedPass !== 'function' ||
        (apple.push !== undefined && (typeof apple.push.sendWake !== 'function' || typeof apple.push.close !== 'function'))) {
      throw new Error('Wallet updates require a committed merchant ledger and a signer.');
    }
    const auth = appleUpdateIdentity({origin:url.origin,rootKey:apple.rootKey});
    const signApple = apple.makeSigner(auth);
    if (typeof signApple !== 'function') throw new Error('Wallet signer is required.');
    passStore = openAppleUpdates({dbPath:apple.updateDbPath,origin:url.origin,rootKey:apple.rootKey,signApple});
    sender = apple.push;
    apple = { signApple, loadCommittedPass:apple.loadCommittedPass };
  }
  let db;
  function seconds() {
    const x = now();
    if (!Number.isSafeInteger(x) || x < 0) throw new Error('Invalid Wallet clock.');
    return Math.floor(x / 1000);
  }
  try {
    db=new DatabaseSync(tokenDbPath);
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=1000;
      CREATE TABLE IF NOT EXISTS wallet_issue_token (digest TEXT PRIMARY KEY, owner TEXT NOT NULL, serial TEXT NOT NULL, path TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS wallet_issue_expiry ON wallet_issue_token(expires);
      CREATE INDEX IF NOT EXISTS wallet_issue_serial ON wallet_issue_token(owner, serial, path);`);
  } catch {
    db?.close(); passStore?.close(); sender?.close(); throw new Error('Wallet capability store unavailable.');
  }
  const purge=db.prepare('DELETE FROM wallet_issue_token WHERE expires <= ?');
  const held=db.prepare('SELECT COUNT(*) AS n FROM wallet_issue_token WHERE owner=? AND serial=? AND path=?');
  const add=db.prepare('INSERT INTO wallet_issue_token(digest,owner,serial,path,expires) VALUES(?,?,?,?,?)');
  const claim=db.prepare('DELETE FROM wallet_issue_token WHERE digest=? AND path=? AND expires>? RETURNING owner,serial');
  const transaction=(f)=>{
    db.exec('BEGIN IMMEDIATE'); try{const x=f(); db.exec('COMMIT'); return x;} catch(e){db.exec('ROLLBACK'); throw e;}
  };
  let closed=false, flushing=null;
  async function mint({ownerId,passId,platform}) {
    const path=routes.get(platform);
    if (closed || !validId(ownerId) || !validId(passId) || !path ||
        (platform==='apple'&&!apple) || (platform==='google'&&!google)) return null;
    if (!state(await lookupOwnedPass({ownerId,passId,platform}),passId) || closed) return null;
    const t=seconds();
    return transaction(()=>{
      purge.run(t);
      if (held.get(ownerId,passId,path).n>=5) return null;
      const token=randomBytes(32).toString('base64url');
      const expiresAt=t+90;
      add.run(tokenDigest(token),ownerId,passId,path,expiresAt);
      return Object.freeze({token,expiresAt:new Date(expiresAt*1000).toISOString()});
    });
  }
  function project(row){
    passStore.putPass(row.record,{sourceVersion:row.version});
    return passStore.getPass(row.record.passId);
  }
  const issue=createWalletIssueHandler({apple:apple?.signApple,google,lookup:async (digest,path)=>{
    if (closed || !digestPattern.test(digest)) return null;
    const token=claim.get(digest,path,seconds());
    if (!token) return null;
    const platform=path==='/wallet/apple'?'apple':'google';
    const row=state(await lookupOwnedPass({ownerId:token.owner,passId:token.serial,platform}),token.serial);
    return !row || closed ? null : platform==='apple' ? project(row) : row.record;
  }});
  async function handle(request) {
    if (closed) return response(503);
    const requested=new URL(request.url);
    if (requested.origin!==url.origin || requested.username || requested.password) return response(404);
    if (requested.pathname==='/wallet/apple' || requested.pathname==='/wallet/google') {
      if (requested.search || requested.hash) return response(404);
      return issue(request);
    }
    if (requested.pathname.startsWith('/v1/')) return passStore ? passStore.handle(request) : response(404);
    return response(404);
  }
  async function committedAppleChange(passId) {
    if (closed || !apple || !validId(passId)) return false;
    const row=state(await apple.loadCommittedPass(passId),passId);
    if (!row || closed) return false;
    return passStore.putPass(row.record,{sourceVersion:row.version});
  }
  // Call from one bounded scheduler. Overlapping calls share the same flight.
  const flushAppleWakes=()=>{
    if (closed || !sender) return Promise.resolve(0);
    if (flushing) return flushing;
    flushing=passStore.sendPending(sender.sendWake).finally(()=>{flushing=null;});
    return flushing;
  };
  async function close(){
    if (closed) return;
    closed=true;
    try { sender?.close(); await flushing; }
    finally { try { passStore?.close(); } finally { db.close(); } }
  }
  return Object.freeze({mint,handle,committedAppleChange,flushAppleWakes,close});
}
