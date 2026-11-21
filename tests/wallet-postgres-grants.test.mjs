import { Pool } from 'pg';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createWalletService } from '../server/wallet/service.mjs';
import { openPostgresIssueGrants } from '../server/wallet/postgres/issue-grants.mjs';

const host=process.env.WALLET_FIXTURE_PG_SOCKET;
if (!/^\/dev\/shm\/stampies-pg-proof\.[A-Za-z0-9]+\/socket$/.test(host ?? '')) throw new Error('Disposable Unix socket required.');
const db={host, port:5432, database:'postgres', max:8, connectionTimeoutMillis:2000, query_timeout:8000};
const origin='https://wallet.example';
const ownerId='wallet_owner_synthetic_0001'; const passId='wallet_pass_synthetic_0002';
const req=(path,token)=>new Request(`${origin}${path}`,{method:'POST',headers:{Authorization:`Bearer ${token}`},body:'{"stamps":900}'});

// Real PostgreSQL, separate least-privilege role and independent connection pools. No hosted credentials.
test('Postgres grants survive reopening, cap across instances and are consumed once',async(t)=>{
 const admin=new Pool({...db,user:'fixture_owner'});
 t.after(()=>admin.end());
 const mig=readFileSync(new URL('../server/wallet/postgres/001-issue-grants.sql',import.meta.url),'utf8');
 await admin.query(mig); await admin.query(mig);
 await admin.query(`CREATE ROLE fixture_wallet LOGIN;
   GRANT USAGE ON SCHEMA stampies_wallet TO fixture_wallet;
   GRANT SELECT,INSERT,DELETE ON stampies_wallet.issue_grants TO fixture_wallet;`);
 const pool=()=>new Pool({...db,user:'fixture_wallet'});
 const left=pool(), right=pool();
 t.after(()=>Promise.all([left.end(),right.end()]));
 await assert.rejects(left.query('CREATE TABLE stampies_wallet.should_deny (id integer)'),{code:'42501'});
 let clock=1_000_000; let owned=true, stamps=2;
 const unit=(p)=>createWalletService({origin,now:()=>clock,grantStore:openPostgresIssueGrants({pool:p}),
   google:(r)=>`https://fixture.invalid/save/${r.stamps}`,lookupOwnedPass:async(req)=>
     owned&&req.ownerId===ownerId&&req.passId===passId?{version:1,record:{passId,stamps}}:null});
 const x=unit(left), y=unit(right);
 t.after(()=>Promise.all([x.close(),y.close()]));
 const mint=(s)=>s.mint({ownerId,passId,platform:'google'});
 assert.equal(await x.mint({ownerId:ownerId+'x',passId,platform:'google'}), null);
 assert.equal((await x.handle(req('/v1/mint','invalid'))).status, 404);
 const grants=(await Promise.all(Array.from({length:18},(_,i)=>mint(i%2?x:y)))).filter(Boolean);
 assert.equal(grants.length,5);
 const rows=(await admin.query('SELECT digest FROM stampies_wallet.issue_grants')).rows;
 assert.equal(rows.length,5); assert.ok(rows.every((r)=>/^[0-9a-f]{64}$/.test(r.digest)&&grants.every((x)=>x.token!==r.digest)));
 const d0=createHash('sha256').update(grants[0].token).digest('hex');
 assert.equal(await openPostgresIssueGrants({pool:right}).claim({digest:d0,path:'/wallet/apple',now:1000}),null);
 await x.close();
 const third=pool(), reopened=unit(third);
 t.after(async()=>{await reopened.close();await third.end();});
 stamps=4;
 const read=await Promise.all(Array.from({length:14},(_,i)=>(i%2?y:reopened).handle(req('/wallet/google',grants[0].token))));
 assert.equal(read.filter((r)=>r.status===200).length,1);
 assert.equal(read.filter((r)=>r.status===404).length,13);
 assert.deepEqual(await read.find((r)=>r.status===200).json(),{saveUrl:'https://fixture.invalid/save/4'});
 const taken=await mint(y); assert.ok(taken);
 owned=false;
 assert.equal((await reopened.handle(req('/wallet/google',taken.token))).status,404);
 owned=true;
 assert.equal((await reopened.handle(req('/wallet/google',taken.token))).status,404);
 clock+=90_000;
 assert.equal((await reopened.handle(req('/wallet/google',grants[1].token))).status,404);
 const later=await mint(y); assert.ok(later);
 assert.equal((await admin.query('SELECT COUNT(*)::integer AS rows FROM stampies_wallet.issue_grants')).rows[0].rows,1);
});
