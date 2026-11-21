import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openWalletService } from '../server/wallet/service.mjs';

const origin='https://wallet.example', passId='fixture_pass_opaque_value_001', ownerId='fixture_owner_opaque_value_001';
const getState=(version, stamps)=>({version,record:{passId,stamps}});
const raw=(path,method='GET',auth,b)=>new Request(origin+path,{method,headers:{...(auth?{Authorization:auth}:{}),...(b?{'Content-Type':'application/json'}:{})},body:b?JSON.stringify(b):undefined});
const issue=(versionToken, platform='apple', path)=>raw(path??`/wallet/${platform}`,'POST',`Bearer ${versionToken}`,{passId:'ignore_me',stamps:50});

function fixture(t){
  const p=mkdtempSync(join(tmpdir(),'wallet-live-fixture-')); t.after(()=>rmSync(p,{force:true,recursive:true}));
  const tokenDbPath=join(p,'tokens.db');
  let at=100_000, own=true, ledger=getState(1,3), optsRef=null;
  const pushes=[]; let complete;
  const push={sendWake:(wake)=>{ pushes.push(wake);return new Promise(r=>{complete=r;});},close:()=>complete?.('retry')};
  const cfg={origin,tokenDbPath,now:()=>at,google:(r)=>`https://fixture.invalid/${r.stamps}`,
    lookupOwnedPass:async(o)=>o.ownerId===ownerId&&o.passId===passId&&own?ledger:null,
    apple:{rootKey:Buffer.alloc(32,17),updateDbPath:join(p,'updates.db'),push,loadCommittedPass:async(id)=>id===passId?ledger:null,
      makeSigner:(options)=>{optsRef=options;return (r)=>Buffer.from(JSON.stringify({count:r.stamps}));}}};
  return {cfg,tokenDbPath,pushes,complete:(s)=>complete?.(s),identity:()=>optsRef,goTo:(x)=>{at=x;},set:(x)=>{ledger=x;},revoke:()=>{own=false;}};
}

test('Wallet issues from the authenticated merchant ledger, not the body; scopes and replays fail closed',async(t)=>{
  const f=fixture(t);const s=openWalletService(f.cfg); t.after(()=>s.close());
  assert.equal(await s.mint({ownerId:ownerId+'z',passId,platform:'apple'}),null);
  assert.equal((await s.handle(raw('/wallet/apple','POST'))).status,401);
  assert.equal((await s.handle(raw('/v1/mint','POST',undefined,{passId}))).status,404);
  const {token}=await s.mint({ownerId,passId,platform:'apple'});
  assert.equal((await s.handle(issue(token,'google'))).status,404);
  assert.equal((await s.handle(issue(token,'apple','/wallet/apple?x=other'))).status,404);
  assert.equal((await s.handle(new Request('https://not-the-wallet.example/wallet/apple',{method:'POST',headers:{Authorization:`Bearer ${token}`}}))).status,404);
  const accepted=await s.handle(issue(token)); assert.equal(accepted.status,200);
  assert.equal(accepted.headers.get('Content-Type'),'application/vnd.apple.pkpass'); assert.deepEqual(await accepted.json(),{count:3});
  assert.equal((await s.handle(issue(token))).status,404);
  const g=await s.mint({ownerId,passId,platform:'google'});
  assert.equal((await s.handle(issue(g.token))).status,404);
  const gs=await s.handle(issue(g.token,'google'));assert.equal(gs.status,200);assert.deepEqual(await gs.json(),{saveUrl:'https://fixture.invalid/3'});
});

test('Wallet one-time grants survive restart hashed, expire exactly and recheck ownership at use',async(t)=>{
  const f=fixture(t);const s=openWalletService(f.cfg); const grant={ownerId,passId,platform:'apple'};
  const g=await s.mint(grant), expires=await s.mint(grant), willRevoke=await s.mint(grant);
  await s.mint(grant); await s.mint(grant); assert.equal(await s.mint(grant),null);
  for(const fn of [f.tokenDbPath,`${f.tokenDbPath}-wal`]) if(existsSync(fn)) assert.equal(readFileSync(fn).includes(Buffer.from(g.token)),false);
  await s.close();const restart=openWalletService(f.cfg);t.after(()=>restart.close());
  assert.equal((await restart.handle(issue(g.token))).status,200);
  f.revoke(); assert.equal((await restart.handle(issue(willRevoke.token))).status,404);
  f.goTo(Date.parse(expires.expiresAt)); assert.equal((await restart.handle(issue(expires.token))).status,404);
  assert.equal(await restart.mint(grant),null);
});

test('A committed Wallet stamp update pushes once, with no regression or replay across stale revisions',async(t)=>{
  const f=fixture(t);const s=openWalletService(f.cfg); t.after(()=>s.close());
  const install=await s.mint({ownerId,passId,platform:'apple'});assert.equal((await s.handle(issue(install.token))).status,200);
  const auth=`ApplePass ${f.identity().tokenFor(passId)}`;
  const reg=`/v1/devices/fixture_device_alfa/registrations/pass.au.fintex.stampies/${passId}`;
  const get=`/v1/passes/pass.au.fintex.stampies/${passId}`;
  assert.equal((await s.handle(raw(reg,'POST',auth,{pushToken:'a9'.repeat(32)}))).status,201);
  f.set(getState(2,4));assert.equal(await s.committedAppleChange(passId),true);
  const flush=s.flushAppleWakes();assert.equal(flush,s.flushAppleWakes());assert.equal(f.pushes.length,1);f.complete('accepted');assert.equal(await flush,1);
  f.set(getState(3,4));assert.equal(await s.committedAppleChange(passId),false);
  f.set(getState(2,2));assert.equal(await s.committedAppleChange(passId),false);
  const g=await s.mint({ownerId,passId,platform:'apple'});assert.deepEqual(await (await s.handle(issue(g.token))).json(),{count:4});
  assert.deepEqual(await (await s.handle(raw(get,'GET',auth))).json(),{count:4});
  f.set(getState(3,2)); await assert.rejects(s.committedAppleChange(passId),/Conflicting pass source version/);
  assert.equal(await s.flushAppleWakes(),0);
});

// The app builds pass ids as stampies-<business-slug>, for example
// stampies-corner-cafe. The server used to require 22 characters,
// which rejected every real pass id: mint returned null and the Apple
// refresh never fired. This test proves the app shape works end to
// end: mint, issue, register, stamp refresh, and pass fetch.
test('Wallet refresh works for the app pass id shape, stampies-corner-cafe', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'wallet-short-id-')); t.after(() => rmSync(dir, { force: true, recursive: true }));
  const shortPassId = 'stampies-corner-cafe';
  let ledger = { version: 1, record: { passId: shortPassId, stamps: 3 } };
  const pushes = []; let complete;
  const push = { sendWake: (wake) => { pushes.push(wake); return new Promise((r) => { complete = r; }); }, close: () => complete?.('retry') };
  let identity;
  const s = openWalletService({
    origin, tokenDbPath: join(dir, 'tokens.db'), now: () => 100_000,
    lookupOwnedPass: async (o) => (o.ownerId === ownerId && o.passId === shortPassId ? ledger : null),
    apple: {
      rootKey: Buffer.alloc(32, 17), updateDbPath: join(dir, 'updates.db'), push,
      loadCommittedPass: async (id) => (id === shortPassId ? ledger : null),
      makeSigner: (options) => { identity = options; return (r) => Buffer.from(JSON.stringify({ count: r.stamps })); },
    },
  });
  t.after(() => s.close());
  const grant = await s.mint({ ownerId, passId: shortPassId, platform: 'apple' });
  assert.notEqual(grant, null);
  const issued = await s.handle(raw('/wallet/apple', 'POST', `Bearer ${grant.token}`, { passId: 'ignore_me', stamps: 50 }));
  assert.equal(issued.status, 200);
  assert.deepEqual(await issued.json(), { count: 3 });
  const auth = `ApplePass ${identity.tokenFor(shortPassId)}`;
  const reg = `/v1/devices/fixture_device_alfa/registrations/pass.au.fintex.stampies/${shortPassId}`;
  assert.equal((await s.handle(raw(reg, 'POST', auth, { pushToken: 'a9'.repeat(32) }))).status, 201);
  ledger = { version: 2, record: { passId: shortPassId, stamps: 4 } };
  assert.equal(await s.committedAppleChange(shortPassId), true);
  const flush = s.flushAppleWakes();
  assert.equal(pushes.length, 1);
  complete('accepted');
  assert.equal(await flush, 1);
  const get = await s.handle(raw(`/v1/passes/pass.au.fintex.stampies/${shortPassId}`, 'GET', auth));
  assert.equal(get.status, 200);
  assert.deepEqual(await get.json(), { count: 4 });
});
