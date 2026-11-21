import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Pool} from 'pg';
import {PASS_TYPE_IDENTIFIER} from '../src/lib/pass.ts';
import {APPLE_WALLET_ORIGIN as origin} from '../server/wallet/apple-fetch-ingress.mjs';
import {openAppleUpdateIngress} from '../server/wallet/apple-update-ingress-postgres.mjs';
import {appleUpdateIdentity} from '../server/wallet/apple-update-protocol.mjs';
import {openPostgresAppleRevisionStore} from '../server/wallet/postgres/apple-revisions.mjs';

const host=process.env.WALLET_FIXTURE_PG_SOCKET;
assert.match(host,/^\/dev\/shm\/stampies-pg-proof\.[A-Za-z0-9]+\/socket$/);
const pgOptions={host,database:'postgres',max:3,connectionTimeoutMillis:1500,query_timeout:5000};
const rootKey=Buffer.alloc(32,9); // Generated synthetic fixture value, never production.
const passId='sample_pass_apple_postgres_2026', devId='sample_device_postgres_2026', push='21'.repeat(32);
const reg=`/v1/devices/${devId}/registrations/${PASS_TYPE_IDENTIFIER}`;
const pass=`/v1/passes/${PASS_TYPE_IDENTIFIER}/${passId}`;
const auth='ApplePass '+appleUpdateIdentity({origin,rootKey}).tokenFor(passId);
const call=(path,init)=>new Request(origin+path,init);
const mobileRegister=()=>call(reg+'/'+passId,{method:'POST',headers:{authorization:auth,'content-type':'application/json'},body:JSON.stringify({pushToken:push})});
const migrate=(name)=>readFileSync(new URL(`../server/wallet/postgres/${name}`,import.meta.url),'utf8');

test('fixed origin Apple Wallet refresh through the scoped PostgreSQL role and real transactions',async t=>{
  const owner=new Pool({...pgOptions,user:'fixture_owner'}), unauth=new Pool({...pgOptions,user:'fixture_unrelated'}), runtime=new Pool({...pgOptions,user:'stampies_wallet_runtime'});
  t.after(()=>Promise.all([owner.end(),unauth.end(),runtime.end()]));
  for(const f of ['001-issue-grants.sql','002-apple-updates.sql','003-apple-wake-retries.sql','provision-runtime-role.sql']) await owner.query(migrate(f));
  await owner.query(`ALTER ROLE stampies_wallet_runtime LOGIN; CREATE ROLE fixture_unrelated LOGIN;`);
  const signed=[];const signApple=async record=>{signed.push(record.stamps);return Buffer.from(`local-synthetic-pass:${record.stamps}`)};
  const start=(pool=runtime)=>openAppleUpdateIngress({pool,rootKey,signApple});
  await t.test('disabled before a dedicated login and signer are verified',async()=>{
    await assert.rejects(start(owner),/not restricted/);
    await assert.rejects(start(unauth),/not restricted/);
    await assert.rejects(openAppleUpdateIngress({pool:runtime,rootKey,signApple:null}),/credentials not configured/);
    assert.deepEqual(signed,[]);
  });
  const r=await start();
  const store=openPostgresAppleRevisionStore({pool:runtime});
  assert.equal(await store.putPass({passId,stamps:1},{sourceVersion:1}),true);
  await t.test('alternate origin and mint path stay unavailable, no pass signed',async()=>{
    assert.equal((await r(new Request('https://sample.invalid'+pass,{headers:{authorization:auth}}))).status,404);
    assert.equal((await r(call('/wallet/apple',{method:'POST',headers:{authorization:auth}}))).status,404);
    assert.equal((await r(call(pass))).status,401);
    assert.deepEqual(signed,[]);
  });
  await t.test('iPhone protocol registers exactly once and fetches the signed synthetic revision',async()=>{
    assert.equal((await r(mobileRegister())).status,201);
    assert.equal((await r(mobileRegister())).status,200);
    const {rows}=await owner.query('SELECT encrypted_push FROM stampies_wallet.apple_registration');
    assert.equal(rows.length,1); assert.equal(rows[0].encrypted_push.includes(Buffer.from(push)),false);
    const listed=await (await r(call(reg))).json(); assert.deepEqual(listed.serialNumbers,[passId]); assert.match(listed.lastUpdated,/^[1-9]\d*$/);
    assert.equal((await r(call(reg+'?passesUpdatedSince='+listed.lastUpdated))).status,204);
    assert.equal(await store.putPass({passId,stamps:2},{sourceVersion:2}),true);
    const updated=await (await r(call(reg+'?passesUpdatedSince='+listed.lastUpdated))).json();
    assert.deepEqual(updated.serialNumbers,[passId]); assert.ok(Number(updated.lastUpdated)>Number(listed.lastUpdated));
    const download=await r(call(pass,{headers:{authorization:auth}}));
    assert.equal(download.headers.get('content-type'),'application/vnd.apple.pkpass');
    assert.equal(await download.text(),'local-synthetic-pass:2'); assert.deepEqual(signed,[2]);
  });
  await t.test('unregister deletes the device registration and outstanding wake',async()=>{
    assert.equal((await r(call(reg+'/'+passId,{method:'DELETE',headers:{authorization:auth}}))).status,200);
    assert.equal((await r(call(reg))).status,204);
    const {rows:[v]}=await owner.query('SELECT (SELECT count(*)::int FROM stampies_wallet.apple_registration) AS registrations,(SELECT count(*)::int FROM stampies_wallet.apple_wake) AS wakes');
    assert.deepEqual(v,{registrations:0,wakes:0});
  });
});
