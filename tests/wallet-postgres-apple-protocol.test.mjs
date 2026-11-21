import { Pool } from 'pg';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PASS_TYPE_IDENTIFIER as type } from '../src/lib/pass.ts';
import { openPostgresAppleUpdates } from '../server/wallet/postgres/apple-registrations.mjs';
import { createWalletService } from '../server/wallet/service.mjs';
import { openPostgresIssueGrants } from '../server/wallet/postgres/issue-grants.mjs';

const host=process.env.WALLET_FIXTURE_PG_SOCKET;
if (!/^\/dev\/shm\/stampies-pg-proof\.[A-Za-z0-9]+\/socket$/.test(host ?? '')) throw new Error('Disposable Postgres socket only.');
const base={host,port:5432,max:4,connectionTimeoutMillis:2000,query_timeout:7000};
const origin='https://wallet.test.invalid', rootKey=Buffer.alloc(32,23), passId='synthetic_pass_number_0001', other='synthetic_pass_number_0002', merchant='synthetic_merchant_0000001';
const device='synthetic_iphone_0000000001', different='synthetic_iphone_0000000002';
const oldPush='01'.repeat(32), newPush='ab'.repeat(32);
const registerPath=(id=device)=>`/v1/devices/${id}/registrations/${type}`;
const getPath=(serial)=>`/v1/passes/${type}/${serial}`;
const req=(url,init)=>new Request(origin+url,init);
const credential=token=>({Authorization:`ApplePass ${token}`});

async function setup(t){
  const admin=new Pool({...base,database:'postgres',user:'fixture_owner'}); t.after(()=>admin.end());
  await admin.query('CREATE DATABASE wallet_protocol');
  const opt={...base,database:'wallet_protocol'};
  const owner=new Pool({...opt,user:'fixture_owner'}); t.after(()=>owner.end());
  for(const m of ['001-issue-grants','002-apple-updates']) await owner.query(readFileSync(new URL(`../server/wallet/postgres/${m}.sql`,import.meta.url),'utf8'));
  await owner.query(`CREATE ROLE wallet_protocol_runtime LOGIN;
    GRANT USAGE ON SCHEMA stampies_wallet TO wallet_protocol_runtime;
    GRANT SELECT,INSERT,DELETE ON stampies_wallet.issue_grants TO wallet_protocol_runtime;
    GRANT SELECT,UPDATE(revision) ON stampies_wallet.apple_clock TO wallet_protocol_runtime;
    GRANT SELECT,INSERT,UPDATE ON stampies_wallet.apple_pass,stampies_wallet.apple_wake TO wallet_protocol_runtime;
    GRANT SELECT,INSERT,UPDATE(encrypted_push),DELETE ON stampies_wallet.apple_registration TO wallet_protocol_runtime;`);
  const a=new Pool({...opt,user:'wallet_protocol_runtime'}), b=new Pool({...opt,user:'wallet_protocol_runtime'});
  t.after(()=>Promise.all([a.end(),b.end()])); return {owner,a,b};
}

test('Apple HTTP issue, register, list, refresh and unsubscribe are durable and race safe in Postgres',async(t)=>{
  const {owner,a,b}=await setup(t); let auth;
  const committed=new Map([passId,other].map(id=>[id,{record:{passId:id,stamps:1},version:1}]));
  const load=(id)=>committed.get(id), lookup=({ownerId,passId})=>ownerId===merchant?load(passId):null;
  const makeSigner=(identity)=>{auth=identity; return (record)=>Buffer.from(JSON.stringify(record));}; // Deliberately synthetic signer, no live keys.
  const settings=(pool)=>({origin,lookupOwnedPass:lookup,grantStore:openPostgresIssueGrants({pool}),openUpdates:opts=>openPostgresAppleUpdates({pool,...opts}),apple:{rootKey,makeSigner,loadCommittedPass:load}});
  const l=createWalletService(settings(a)), r=createWalletService(settings(b)); t.after(()=>Promise.all([l.close(),r.close()]));
  const bad=settings(a); bad.apple.push={sendWake:async()=>{throw Error('must not dispatch');},close:()=>{}};
  assert.throws(()=>createWalletService(bad),/push dispatcher is not ready/);
  await assert.rejects(a.query('CREATE TABLE stampies_wallet.forbidden_test(id int)'),{code:'42501'});
  const minted=await l.mint({ownerId:merchant,passId,platform:'apple'}); assert.match(minted.token,/^[A-Za-z0-9_-]{43}$/);
  const issue=()=>r.handle(req('/wallet/apple',{method:'POST',headers:{Authorization:`Bearer ${minted.token}`}}));
  const issued=await issue(); assert.equal(issued.status,200); assert.equal((await issued.json()).stamps,1); assert.equal((await issue()).status,404);
  assert.equal(await l.committedAppleChange(other),true);
  const tok=auth.tokenFor(passId), otherTok=auth.tokenFor(other);
  function post(id=device,push=oldPush, token=tok,serial=passId,mime='application/json'){
    return req(`${registerPath(id)}/${serial}`,{method:'POST',headers:{...credential(token),'Content-Type':mime},body:JSON.stringify({pushToken:push})});
  }
  assert.equal((await l.handle(post(device,oldPush,otherTok))).status,401);
  assert.equal((await l.handle(post(device,'not-a-token'))).status,400);
  assert.equal((await l.handle(post(device,oldPush,tok,passId,'text/plain'))).status,400);
  assert.equal((await l.handle(post(device,oldPush,tok,passId,'application/json'))).status,201);
  const stores=async()=>(await owner.query('SELECT device,serial,encrypted_push FROM stampies_wallet.apple_registration ORDER BY serial')).rows;
  const wires=async()=>(await owner.query('SELECT device,serial,revision,lease_id FROM stampies_wallet.apple_wake ORDER BY serial')).rows;
  let rows=await stores(); assert.equal(rows.length,1); assert.match(rows[0].device,/^[a-f0-9]{64}$/); assert.equal(rows[0].encrypted_push.includes(Buffer.from(oldPush)),false);
  assert.equal((await l.handle(post())).status,200); assert.deepEqual(await stores(),rows); // repeated registration leaves lease and cipher unchanged
  assert.equal((await l.handle(req(registerPath(different)))).status,204);
  assert.equal((await l.handle(req(`${registerPath()}?passesUpdatedSince=0&passesUpdatedSince=1`))).status,400);
  let list=await (await r.handle(req(registerPath()))).json(); assert.deepEqual(list.serialNumbers,[passId]); const cursor=Number(list.lastUpdated);
  assert.equal((await l.handle(req(`${registerPath()}?passesUpdatedSince=${cursor}`))).status,204);
  committed.set(passId,{record:{passId,stamps:2},version:2});
  assert.deepEqual((await Promise.all([r.handle(post(device,newPush)),l.committedAppleChange(passId)])).map(x=>x.status??x),[200,true]);
  rows=await stores(); assert.equal(rows.length,1); assert.equal(rows[0].encrypted_push.includes(Buffer.from(newPush)),false);
  list=await (await r.handle(req(`${registerPath()}?passesUpdatedSince=${cursor}`))).json(); assert.deepEqual(list.serialNumbers,[passId]); assert.ok(Number(list.lastUpdated)>cursor);
  assert.equal((await wires())[0].revision,list.lastUpdated); assert.equal((await l.handle(req(getPath(passId),{headers:credential(otherTok)}))).status,401);
  const updated=await r.handle(req(getPath(passId),{headers:credential(tok)})); assert.equal(updated.headers.get('content-type'),'application/vnd.apple.pkpass'); assert.equal((await updated.json()).stamps,2);
  const replay=await Promise.all([r.handle(post(different,newPush)),l.handle(post(different,newPush))]); assert.deepEqual(replay.map(x=>x.status).sort(),[200,201]);
  const closeRoute=()=>req(`${registerPath()}/${passId}`,{method:'DELETE',headers:credential(tok)});
  assert.equal((await r.handle(closeRoute())).status,200); assert.equal((await l.handle(closeRoute())).status,200);
  assert.equal((await l.handle(req(registerPath()))).status,204); assert.equal((await stores()).length,1); assert.equal((await wires()).length,1);
  await r.close(); // released logical instance does not destroy the common durable database
  const again=createWalletService(settings(b)); t.after(()=>again.close());
  assert.equal((await (await again.handle(req(getPath(passId),{headers:credential(tok)}))).json()).stamps,2);
});
