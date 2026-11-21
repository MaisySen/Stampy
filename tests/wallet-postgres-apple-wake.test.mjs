import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { PASS_TYPE_IDENTIFIER } from '../src/lib/pass.ts';
import { openPostgresAppleUpdates } from '../server/wallet/postgres/apple-registrations.mjs';

const socket=process.env.WALLET_FIXTURE_PG_SOCKET;
if(!/^\/dev\/shm\/stampies-pg-proof\.[A-Za-z0-9]+\/socket$/.test(socket??''))throw new Error('Disposable Postgres socket only.');
const origin='https://wallet.fixture.invalid', rootKey=Buffer.alloc(32,31);
const device='fixture_iphone_00000001', other='fixture_iphone_00000002';
const serial='fixture_synthetic_000001', token='cb'.repeat(32), rotated='56'.repeat(32);
const wake='stampies_wallet.apple_wake'; const registrations='stampies_wallet.apple_registration';
const opts={host:socket,port:5432,max:5,connectionTimeoutMillis:1800,query_timeout:4800};
const pending=()=>{let resolve; const promise=new Promise(r=>{resolve=r}); return {promise,resolve};};

async function setup(t){
 const control=new Pool({...opts,database:'postgres',user:'fixture_owner'}); t.after(()=>control.end());
 await control.query('CREATE DATABASE wallet_wake');
 const config={...opts,database:'wallet_wake'}, owner=new Pool({...config,user:'fixture_owner'}); t.after(()=>owner.end());
 for(const m of ['002-apple-updates','003-apple-wake-retries','003-apple-wake-retries'])await owner.query(readFileSync(new URL(`../server/wallet/postgres/${m}.sql`,import.meta.url),'utf8'));
 await owner.query(`CREATE ROLE wallet_wake_runtime LOGIN;
  GRANT USAGE ON SCHEMA stampies_wallet TO wallet_wake_runtime;
  GRANT SELECT,UPDATE(revision) ON stampies_wallet.apple_clock TO wallet_wake_runtime;
  GRANT SELECT,INSERT,UPDATE ON stampies_wallet.apple_pass TO wallet_wake_runtime;
  GRANT SELECT,INSERT,UPDATE(encrypted_push),DELETE ON ${registrations} TO wallet_wake_runtime;
  GRANT SELECT,INSERT,UPDATE(revision,ready_at,lease_id,lease_until,failures),DELETE ON ${wake} TO wallet_wake_runtime;`);
 const a=new Pool({...config,user:'wallet_wake_runtime'}), b=new Pool({...config,user:'wallet_wake_runtime'});
 t.after(()=>Promise.all([a.end(),b.end()]));
 const settings={origin,rootKey,signApple:()=>Buffer.from('synthetic')};
 const first=openPostgresAppleUpdates({pool:a,...settings}), second=openPostgresAppleUpdates({pool:b,...settings});
 const wrongKey=openPostgresAppleUpdates({pool:b,...settings,rootKey:Buffer.alloc(32,32)});
 const record=(n)=>({passId:serial,stamps:n});
 const auth=(await import('../server/wallet/apple-update-protocol.mjs')).appleUpdateIdentity({origin,rootKey}).tokenFor(serial);
 const register=async(id,key)=>first.handle(new Request(`${origin}/v1/devices/${id}/registrations/${PASS_TYPE_IDENTIFIER}/${serial}`,{
  method:'POST',headers:{Authorization:`ApplePass ${auth}`,'Content-Type':'application/json'},body:JSON.stringify({pushToken:key})
 }));
 const rows=()=>owner.query(`SELECT revision::int AS rev,failures,lease_id,round(EXTRACT(EPOCH FROM ready_at-clock_timestamp()))::int AS due FROM ${wake}`);
 const bypassClock=()=>owner.query(`UPDATE ${wake} SET ready_at=clock_timestamp()-interval '1 second'`);
 return {owner,a,b,first,second,wrongKey,record,register,rows,bypassClock};
}

test('Apple wake claims, rotation, retry caps and stale acknowledgements use durable exact Postgres state',async(t)=>{
 const {owner,a,first,second,wrongKey,record,register,rows,bypassClock}=await setup(t);
 await assert.rejects(a.query(`ALTER TABLE ${wake} ADD COLUMN forbidden text`),{code:'42501'});
 assert.equal(await first.putPass(record(1),{sourceVersion:1}),true);
 assert.equal((await register(device,token)).status,201);
 let unexpected=0; const notDue=async()=>{unexpected+=1;return 'retry';};
 const seen=pending(), resume=pending();
 const pendingDelivery=first.sendPending(async(req)=>{
  assert.deepEqual(req,{topic:PASS_TYPE_IDENTIFIER,pushToken:token}); seen.resolve(); await resume.promise; return 'unregistered';
 },1);
 await seen.promise;
 assert.deepEqual(await Promise.all(Array.from({length:6},()=>second.sendPending(notDue,1))),Array(6).fill(0));
 assert.equal(unexpected,0);
 assert.equal((await register(device,rotated)).status,200);
 resume.resolve(); assert.equal(await pendingDelivery,0);
 assert.equal((await rows()).rowCount,1);
 assert.equal((await owner.query(`SELECT count(*)::int AS n FROM ${registrations}`)).rows[0].n,1);
 assert.equal(await second.sendPending(async({pushToken})=>{assert.equal(pushToken,rotated);return 'accepted';},1),1);
 assert.equal((await rows()).rowCount,0);

 assert.equal(await first.putPass(record(2),{sourceVersion:2}),true);
 const sentOld=pending(), releaseOld=pending();
 const old=first.sendPending(async()=>{sentOld.resolve();await releaseOld.promise;return 'accepted';},1);
 await sentOld.promise;
 assert.equal(await second.putPass(record(3),{sourceVersion:3}),true);
 releaseOld.resolve();assert.equal(await old,0);
 assert.deepEqual((await rows()).rows.map(x=>x.rev),[3]);

 assert.equal(await wrongKey.sendPending(notDue,1),0);
 let row=(await rows()).rows[0]; assert.equal(row.failures,1);assert.ok(row.due>8&&row.due<=15);assert.equal(row.lease_id,null);
 assert.equal(await first.sendPending(notDue,1),0);
 for(let i=2;i<=8;i++){
  await bypassClock(); await first.sendPending(async()=>{throw new Error('transient synthetic refusal');},1);
  row=(await rows()).rows[0]; assert.equal(row.failures,i); assert.equal(row.lease_id,null);
  const expected=Math.min(900,15*(2**(i-1))); assert.ok(row.due>expected-7 && row.due<=expected);
 }
 await bypassClock();assert.equal(await second.sendPending(notDue,1),0);
 assert.equal(await first.putPass(record(4),{sourceVersion:4}),true);
 assert.equal((await rows()).rows[0].failures,0);

 const expiredSeen=pending(), expiredDone=pending(), newSeen=pending(), newDone=pending();
 const expired=first.sendPending(async()=>{expiredSeen.resolve();await expiredDone.promise;return 'accepted';},1);
 await expiredSeen.promise;
 await owner.query(`UPDATE ${wake} SET lease_until=clock_timestamp()-interval '1 second'`);
 const refire=second.sendPending(async()=>{newSeen.resolve();await newDone.promise;return 'accepted';},1);
 await newSeen.promise;expiredDone.resolve();assert.equal(await expired,0);
 newDone.resolve();assert.equal(await refire,1);
 assert.equal((await rows()).rowCount,0);

 assert.equal((await register(other,token)).status,201);
 await first.putPass(record(5),{sourceVersion:5});
 let count=0;
 assert.equal(await second.sendPending(async({pushToken})=>{
  count+=1; return pushToken===rotated?'unregistered':'accepted';
 },8),1);
 assert.equal(count,2);assert.equal((await rows()).rowCount,0);
 assert.equal((await owner.query(`SELECT count(*)::int AS n FROM ${registrations}`)).rows[0].n,1);
 assert.equal(await first.sendPending(notDue,1),0);
 assert.equal(unexpected,0);
 await assert.rejects(first.sendPending(async()=>{},9),/Invalid Wallet push dispatcher/);
});
