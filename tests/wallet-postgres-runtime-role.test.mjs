import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Pool} from 'pg';
import {verifyWalletRuntimeRole} from '../server/wallet/postgres/runtime-role.mjs';
import {openPostgresStampLedger} from '../server/wallet/postgres/stamp-ledger.mjs';
import {openPostgresIssueGrants} from '../server/wallet/postgres/issue-grants.mjs';
import {openPostgresAppleRevisionStore} from '../server/wallet/postgres/apple-revisions.mjs';
const host=process.env.WALLET_FIXTURE_PG_SOCKET;
assert.match(host,/^\/dev\/shm\/stampies-pg-proof\.[A-Za-z0-9]+\/socket$/);
const read=(path)=>readFileSync(new URL(path,import.meta.url),'utf8');
const opt={host,database:'postgres',max:3,connectionTimeoutMillis:1500,query_timeout:5000};
const failScoped=(pool)=>assert.rejects(verifyWalletRuntimeRole(pool), /^Error: Wallet database access is not restricted\.$/);
const setup=async(t)=>{
  const admin=new Pool({...opt,user:'fixture_owner'});t.after(()=>admin.end());
  for(const f of ['001-issue-grants.sql','002-apple-updates.sql','003-apple-wake-retries.sql','004-stamp-intake.sql'])
    await admin.query(read(`../server/wallet/postgres/${f}`));
  await admin.query(read('../server/wallet/postgres/provision-runtime-role.sql'));
  // Login only in this disposable, socket-only fixture; no network or password.
  await admin.query(`ALTER ROLE stampies_wallet_runtime LOGIN; CREATE ROLE unrelated_reader LOGIN NOINHERIT;
    CREATE SCHEMA parallel_work; CREATE TABLE parallel_work.private_data(id int);`);
  const runtime=new Pool({...opt,user:'stampies_wallet_runtime'}),other=new Pool({...opt,user:'unrelated_reader'});
  t.after(()=>Promise.all([runtime.end(),other.end()]));return {admin,runtime,other};
};

test('exact restricted role runs real Wallet operations and refuses broadened authority',async(t)=>{
  const {admin,runtime,other}=await setup(t);
  await t.test('matches the real migrated six-table contract',async()=>assert.equal(await verifyWalletRuntimeRole(runtime),true));
  await t.test('denies owner and unrelated login',async()=>{await failScoped(admin); await failScoped(other);});
  await t.test('real Wallet grant inserts and selectively consumes',async()=>{
    const st=openPostgresIssueGrants({pool:runtime}); const digest='a'.repeat(64);
    const r=await st.insertWithinCap({digest,owner:'merchant_role_fixture_001',serial:'wallet_role_synthetic_001',path:'/wallet/apple',now:1000,expires:1090});
    assert.ok(r);assert.ok(await st.claim({digest,path:'/wallet/apple',now:1001})); assert.equal(await st.claim({digest,path:'/wallet/apple',now:1001}),null);
  });
  await t.test('real revision store writes only the granted columns', async()=>{
    const store=openPostgresAppleRevisionStore({pool:runtime}); const record={passId:'wallet_role_synthetic_001',stamps:2};
    assert.equal(await store.putPass(record,{sourceVersion:1}),true); assert.deepEqual(await store.getPass(record.passId),record);
  });
  await t.test('rejects DDL, truncate, other schema reads, and rewriting a pass serial',async()=>{
    for(const sql of ['CREATE TABLE stampies_wallet.extra(id int)','TRUNCATE stampies_wallet.issue_grants','SELECT * FROM parallel_work.private_data','UPDATE stampies_wallet.apple_pass SET serial=serial'])
      await assert.rejects(runtime.query(sql),e=>e?.code==='42501');
  });
  await t.test('runtime role records stamps exactly once',async()=>{
    const st=openPostgresStampLedger({pool:runtime});
    const stamp={stampId:'wallet_role_stamp_00000001',passId:'wallet_role_synthetic_001',businessId:'corner-cafe',createdAtMs:1000};
    assert.deepEqual(await st.record(stamp),{status:'recorded',stamps:1});
    assert.deepEqual(await st.record(stamp),{status:'duplicate',stamps:1});
    assert.deepEqual(await st.record({...stamp,passId:'wallet_role_synthetic_002'}),{status:'conflict',stamps:0});
    assert.equal(await st.count('wallet_role_synthetic_001'),1);
  });
  await t.test('refuses write permission broadening and restores after the exact grant is removed',async()=>{
    await admin.query('GRANT UPDATE ON stampies_wallet.issue_grants TO stampies_wallet_runtime');await failScoped(runtime);
    await admin.query('REVOKE UPDATE ON stampies_wallet.issue_grants FROM stampies_wallet_runtime');assert.equal(await verifyWalletRuntimeRole(runtime),true);
  });
  await t.test('refuses access outside the Wallet schema',async()=>{
    await admin.query('GRANT USAGE ON SCHEMA parallel_work TO stampies_wallet_runtime; GRANT SELECT ON parallel_work.private_data TO stampies_wallet_runtime');
    await failScoped(runtime);await admin.query('REVOKE SELECT ON parallel_work.private_data FROM stampies_wallet_runtime; REVOKE USAGE ON SCHEMA parallel_work FROM stampies_wallet_runtime');
  });
  await t.test('refuses unexpected column INSERT and schema creation even without extra tables',async()=>{
    await admin.query('GRANT INSERT(singleton) ON stampies_wallet.apple_clock TO stampies_wallet_runtime');await failScoped(runtime);
    await admin.query('REVOKE INSERT(singleton) ON stampies_wallet.apple_clock FROM stampies_wallet_runtime');
    await admin.query('GRANT CREATE ON SCHEMA parallel_work TO stampies_wallet_runtime');await failScoped(runtime);
    await admin.query('REVOKE CREATE ON SCHEMA parallel_work FROM stampies_wallet_runtime');assert.equal(await verifyWalletRuntimeRole(runtime),true);
  });
  await t.test('refuses missing revision privileges instead of serving a broken backend',async()=>{
    await admin.query('REVOKE UPDATE(revision) ON stampies_wallet.apple_clock FROM stampies_wallet_runtime');await failScoped(runtime);
    await admin.query('GRANT UPDATE(revision) ON stampies_wallet.apple_clock TO stampies_wallet_runtime');assert.equal(await verifyWalletRuntimeRole(runtime),true);
  });
});
