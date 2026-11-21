import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Pool} from 'pg';
import {openWalletService} from '../server/wallet/service.mjs';
import {openPostgresWalletService} from '../server/wallet/postgres/service.mjs';
const host=process.env.WALLET_FIXTURE_PG_SOCKET;
assert.match(host,/^\/dev\/shm\/stampies-pg-proof\.[A-Za-z0-9]+\/socket$/);
const read=(path)=>readFileSync(new URL(path,import.meta.url),'utf8');
const opt={host,database:'wallet_service',max:3,connectionTimeoutMillis:1500,query_timeout:5000};
const origin='https://wallet.test.invalid';
const rootKey=Buffer.alloc(32,23);
const ownerId='synthetic_owner_00000000000001';
const passId='synthetic_pass_00000000000001';
// Deliberately synthetic signer, no live keys. Startup never signs a pass.
const makeSigner=()=> (record)=>Buffer.from(JSON.stringify(record));
const loadCommittedPass=async()=>null;
const lookupOwnedPass=async()=>null;
const settings=(pool)=>({pool,origin,lookupOwnedPass,apple:{rootKey,makeSigner,loadCommittedPass}});

// The exact grants from provision-runtime-role.sql, without the CREATE
// ROLE line. Roles are cluster-wide but grants are per database, so when
// another suite file already created the role, this file still needs the
// grants applied in its own database.
const runtimeGrants=`GRANT USAGE ON SCHEMA stampies_wallet TO stampies_wallet_runtime;
GRANT SELECT,INSERT,DELETE ON stampies_wallet.issue_grants TO stampies_wallet_runtime;
GRANT SELECT,UPDATE(revision) ON stampies_wallet.apple_clock TO stampies_wallet_runtime;
GRANT SELECT,INSERT,UPDATE(payload,source_version,revision) ON stampies_wallet.apple_pass TO stampies_wallet_runtime;
GRANT SELECT,INSERT,UPDATE(encrypted_push),DELETE ON stampies_wallet.apple_registration TO stampies_wallet_runtime;
GRANT SELECT,INSERT,UPDATE(revision,ready_at,lease_id,lease_until,failures),DELETE ON stampies_wallet.apple_wake TO stampies_wallet_runtime;
GRANT SELECT,INSERT ON stampies_wallet.stamp_ledger TO stampies_wallet_runtime;`;

const setup=async(t)=>{
  const admin=new Pool({...opt,database:'postgres',user:'fixture_owner'});t.after(()=>admin.end());
  await admin.query('CREATE DATABASE wallet_service');
  const owner=new Pool({...opt,user:'fixture_owner'});t.after(()=>owner.end());
  for(const f of ['001-issue-grants.sql','002-apple-updates.sql','003-apple-wake-retries.sql','004-stamp-intake.sql'])
    await owner.query(read(`../server/wallet/postgres/${f}`));
  const role=await admin.query(`SELECT 1 FROM pg_roles WHERE rolname='stampies_wallet_runtime'`);
  if (role.rowCount===0) {
    await owner.query(read('../server/wallet/postgres/provision-runtime-role.sql'));
  } else {
    await owner.query(runtimeGrants);
  }
  // Login only in this disposable, socket-only fixture; no network or password.
  await admin.query('ALTER ROLE stampies_wallet_runtime LOGIN;');
  const runtime=new Pool({...opt,user:'stampies_wallet_runtime'});
  t.after(()=>runtime.end());return {owner,runtime};
};

test('Postgres service startup verifies the restricted runtime role',async(t)=>{
  const {owner,runtime}=await setup(t);
  await t.test('a correctly provisioned role passes startup',async()=>{
    const service=await openPostgresWalletService(settings(runtime));
    t.after(()=>service.close());
    assert.equal(typeof service.mint,'function');
    assert.equal(typeof service.handle,'function');
    assert.equal(await service.mint({ownerId,passId,platform:'apple'}),null);
  });
  await t.test('a broadened grant fails startup with a clear error',async()=>{
    await owner.query('GRANT UPDATE ON stampies_wallet.issue_grants TO stampies_wallet_runtime');
    await assert.rejects(openPostgresWalletService(settings(runtime)),/^Error: Wallet database access is not restricted\.$/);
    await owner.query('REVOKE UPDATE ON stampies_wallet.issue_grants FROM stampies_wallet_runtime');
    const service=await openPostgresWalletService(settings(runtime));
    t.after(()=>service.close());
    assert.equal(typeof service.mint,'function');
  });
  await t.test('a missing pool fails startup with a clear error',async()=>{
    await assert.rejects(openPostgresWalletService({origin,lookupOwnedPass,apple:{rootKey,makeSigner,loadCommittedPass}}),/^Error: Wallet database access not configured\.$/);
  });
  await t.test('the SQLite path still opens without the verifier',async()=>{
    const service=openWalletService({tokenDbPath:':memory:',origin,lookupOwnedPass});
    t.after(()=>service.close());
    assert.equal(typeof service.mint,'function');
    assert.equal(await service.mint({ownerId,passId,platform:'apple'}),null);
  });
});
