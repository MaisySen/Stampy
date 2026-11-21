import { createHash, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { isAbsolute } from 'node:path';
import { appleUpdateIdentity, openAppleUpdates } from './apple-updates.mjs';
import { createWalletIssueHandler } from './signing.mjs';
import { createStampIntakeHandler } from './stamp-intake.mjs';
import { openSqliteStampLedger } from './stamp-ledger.mjs';

const routes = new Map([['apple', '/wallet/apple'], ['google', '/wallet/google']]);
// Owner ids stay 22 to 80 characters. Pass ids are 8 to 80: the app
// sends pass ids like stampies-corner-cafe, and the stamp intake and
// stamp ledger already accept 8 to 80. The 22 floor used to reject
// those ids, so mint and the pass refresh never ran for a real pass.
const ownerIdPattern = /^[A-Za-z0-9_-]{22,80}$/;
const passIdPattern = /^[A-Za-z0-9_-]{8,80}$/;
const digestPattern = /^[a-f0-9]{64}$/;
const validOwnerId = (x) => typeof x === 'string' && ownerIdPattern.test(x);
const validPassId = (x) => typeof x === 'string' && passIdPattern.test(x);
const tokenDigest = (x) => createHash('sha256').update(x).digest('hex');
const state = (row, passId) => {
  if (!Number.isSafeInteger(row?.version) || row.version < 1 || row.record?.passId !== passId) return null;
  return row;
};
const response = (status) => new Response(null, {status,headers:{'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer'}});

// The core accepts asynchronous persistence while keeping the existing SQLite API.
// The injected adapters are private server code, not request input.
export function createWalletService({origin, apple, google, lookupOwnedPass, now = Date.now, grantStore, stampStore, openUpdates, googleUpdates}) {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.href !== `${url.origin}/` || typeof lookupOwnedPass !== 'function' ||
      typeof now !== 'function' || (google !== undefined && typeof google !== 'function') ||
      !['insertWithinCap','claim','close'].every((k) => typeof grantStore?.[k] === 'function') ||
      (stampStore !== undefined && !['record','count','find'].every((k) => typeof stampStore?.[k] === 'function')) ||
      (apple !== undefined && typeof openUpdates !== 'function') ||
      (googleUpdates !== undefined && (typeof googleUpdates.loadCommittedPass !== 'function' || typeof googleUpdates.updateObject !== 'function'))) throw new Error('Invalid Wallet service configuration.');
  let passStore, sender;
  if (apple !== undefined) {
    if (typeof apple.makeSigner !== 'function' || typeof apple.loadCommittedPass !== 'function' ||
        (apple.push !== undefined && (typeof apple.push.sendWake !== 'function' || typeof apple.push.close !== 'function'))) {
      throw new Error('Wallet updates require a committed merchant ledger and a signer.');
    }
    const auth = appleUpdateIdentity({origin:url.origin,rootKey:apple.rootKey});
    const signApple = apple.makeSigner(auth);
    if (typeof signApple !== 'function') throw new Error('Wallet signer is required.');
    passStore = openUpdates({origin:url.origin,rootKey:apple.rootKey,signApple});
    if (apple.push && typeof passStore?.sendPending!=='function') throw new Error('Wallet push dispatcher is not ready.');
    sender = apple.push;
    apple = { signApple, loadCommittedPass:apple.loadCommittedPass };
  }
  function seconds() {
    const x = now();
    if (!Number.isSafeInteger(x) || x < 0) throw new Error('Invalid Wallet clock.');
    return Math.floor(x / 1000);
  }
  let closed=false, flushing=null;
  async function mint({ownerId,passId,platform}) {
    const path=routes.get(platform);
    if (closed || !validOwnerId(ownerId) || !validPassId(passId) || !path ||
        (platform==='apple'&&!apple) || (platform==='google'&&!google)) return null;
    if (!state(await lookupOwnedPass({ownerId,passId,platform}),passId) || closed) return null;
    const t=seconds();
    const token=randomBytes(32).toString('base64url');
    const expiresAt=t+90;
    const inserted = await grantStore.insertWithinCap({digest:tokenDigest(token),owner:ownerId,serial:passId,path,expires:expiresAt,now:t});
    return inserted ? Object.freeze({token,expiresAt:new Date(expiresAt*1000).toISOString()}) : null;
  }
  async function project(row){
    await passStore.putPass(row.record,{sourceVersion:row.version});
    return passStore.getPass(row.record.passId);
  }
  const issue=createWalletIssueHandler({apple:apple?.signApple,google,lookup:async (digest,path)=>{
    if (closed || !digestPattern.test(digest)) return null;
    const token=await grantStore.claim({digest,path,now:seconds()});
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
    if (requested.pathname==='/wallet/stamps') {
      if (requested.search || requested.hash) return response(404);
      if (request.method!=='POST') return response(405);
      return stampIntake ? stampIntake(request) : response(503);
    }
    if (requested.pathname.startsWith('/v1/')) return passStore ? passStore.handle(request) : response(404);
    return response(404);
  }
  async function committedAppleChange(passId) {
    if (closed || !apple || !validPassId(passId)) return false;
    const row=state(await apple.loadCommittedPass(passId),passId);
    if (!row || closed) return false;
    return passStore.putPass(row.record,{sourceVersion:row.version});
  }
  // Google has no push. The committed record is PUT to the Google
  // Wallet API, and every device that saved the pass refreshes from
  // Google. Returns false when Google updates are not configured or
  // the pass is unknown, otherwise the updater status: updated,
  // not-found, denied, or retry.
  async function committedGoogleChange(passId) {
    if (closed || !googleUpdates || !validPassId(passId)) return false;
    const row=state(await googleUpdates.loadCommittedPass(passId),passId);
    if (!row || closed) return false;
    return googleUpdates.updateObject(row.record);
  }
  // Stamp intake needs the committed merchant ledger to verify the pass
  // and business, and the Apple update path to queue the pass refresh.
  // Without either, POST /wallet/stamps answers 503. The stamp itself is
  // recorded first; the refresh is best effort and never fails the stamp.
  // A recorded stamp refreshes both wallets: Apple through the wake
  // queue, Google through the Wallet API.
  const stampIntake = (stampStore && apple) ? createStampIntakeHandler({
    stampStore,
    loadCommittedPass: apple.loadCommittedPass,
    now,
    onRecorded: (passId) => {
      committedAppleChange(passId).catch(() => {});
      committedGoogleChange(passId).catch(() => {});
    },
  }) : null;
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
    finally { try { await passStore?.close(); } finally { await grantStore.close(); } }
  }
  return Object.freeze({mint,handle,committedAppleChange,committedGoogleChange,flushAppleWakes,close});
}

// Only the authenticated application may call mint. No public mint or stamp endpoint.
// The two authority adapters must consult the committed merchant ledger, never client state.
export function openWalletService({tokenDbPath, apple, ...options}) {
  if (typeof tokenDbPath !== 'string' || !(tokenDbPath === ':memory:' || isAbsolute(tokenDbPath))) throw new Error('A private Wallet capability store is required.');
  let db;
  try {
    db=new DatabaseSync(tokenDbPath);
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=1000;
      CREATE TABLE IF NOT EXISTS wallet_issue_token (digest TEXT PRIMARY KEY, owner TEXT NOT NULL, serial TEXT NOT NULL, path TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS wallet_issue_expiry ON wallet_issue_token(expires);
      CREATE INDEX IF NOT EXISTS wallet_issue_serial ON wallet_issue_token(owner, serial, path);`);
  } catch {
    db?.close(); throw new Error('Wallet capability store unavailable.');
  }
  const purge=db.prepare('DELETE FROM wallet_issue_token WHERE expires <= ?');
  const held=db.prepare('SELECT COUNT(*) AS n FROM wallet_issue_token WHERE owner=? AND serial=? AND path=?');
  const add=db.prepare('INSERT INTO wallet_issue_token(digest,owner,serial,path,expires) VALUES(?,?,?,?,?)');
  const claim=db.prepare('DELETE FROM wallet_issue_token WHERE digest=? AND path=? AND expires>? RETURNING owner,serial');
  const transaction=(f)=>{
    db.exec('BEGIN IMMEDIATE'); try{const x=f(); db.exec('COMMIT'); return x;} catch(e){db.exec('ROLLBACK'); throw e;}
  };
  const grantStore = {
    insertWithinCap:({digest,owner,serial,path,expires,now})=>transaction(()=>{
      purge.run(now);
      if (held.get(owner,serial,path).n>=5) return false;
      add.run(digest,owner,serial,path,expires); return true;
    }),
    claim:({digest,path,now})=>claim.get(digest,path,now),
    close:()=>db.close(),
  };
  try {
    return createWalletService({...options,apple,grantStore,stampStore:openSqliteStampLedger(db),openUpdates:(opts)=>openAppleUpdates({...opts,dbPath:apple.updateDbPath})});
  } catch (err) { db.close(); throw err; }
}
