// Direct Fetch handler -> real signature verifier -> actual ledger -> restricted
// PostgreSQL. No listener, external IdP, production database or device is used.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,mkdirSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {generateKeyPairSync,sign} from 'node:crypto';
import pg from 'pg';
import {createLoyaltyHttpHandler} from '../server/api/loyalty-http.mjs';
import {createPostgresLoyaltyLedger} from '../server/loyalty/postgres/ledger.mjs';
import {createOidcAccessTokenVerifier} from '../server/auth/oidc-jwt.mjs';
const M='11111111-1111-4111-8111-111111111111',P='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333',L='44444444-4444-4444-8444-444444444444',OTHER='55555555-5555-4555-8555-555555555555';
const origin='https://api.example',issuer='https://identity.example/';
const bins=existsSync('/usr/lib/postgresql')?readdirSync('/usr/lib/postgresql').map(x=>'/usr/lib/postgresql/'+x+'/bin'):[];
const bin=process.env.PG_BIN||bins.find(x=>existsSync(join(x,'initdb')));
const executable=name=>bin?join(bin,name):name;
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('PG')));
function run(name,args){const x=spawnSync(executable(name),args,{encoding:'utf8',env,timeout:30000});assert.ifError(x.error);assert.equal(x.status,0,x.stdout+'\n'+x.stderr);return x.stdout;}

test('HTTP contract through actual verifier, ledger and restricted PostgreSQL', {timeout:45000},async t=>{
 const dir=mkdtempSync(join(tmpdir(),'stampy-http-pg-')),data=join(dir,'data'),socket=join(dir,'socket');mkdirSync(socket,{mode:0o700});
 let admin,runtime,started=false;
 try{
  run('initdb',['-D',data,'-U','http_test_migration','-A','trust','--no-locale','-E','UTF8']);
  run('pg_ctl',['-D',data,'-l',join(dir,'server.log'),'-o',`-h "" -k ${socket} -c max_connections=16 -c shared_buffers=16MB`,'-w','start']);started=true;
  const config={host:socket,database:'postgres',port:5432,max:5,connectionTimeoutMillis:3000,idleTimeoutMillis:1000,options:'-c statement_timeout=10000 -c lock_timeout=7000'};
  admin=new pg.Pool({...config,user:'http_test_migration'});
  for(const path of ['server/auth/postgres/001-merchant-identities.sql','server/loyalty/postgres/001-loyalty-ledger.sql','server/loyalty/postgres/provision-loyalty-runtime.sql','server/loyalty/postgres/002-transactional-authority.sql'])await admin.query(readFileSync(new URL('../'+path,import.meta.url),'utf8'));
  await admin.query('CREATE ROLE http_test_runtime LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS; GRANT stampies_loyalty_runtime TO http_test_runtime');
  runtime=new pg.Pool({...config,user:'http_test_runtime',application_name:'stampy-http-runtime'});
  assert.equal((await runtime.query('SELECT current_user,session_user')).rows[0].session_user,'http_test_runtime');
  t.diagnostic((await admin.query('SELECT version()')).rows[0].version);
  const at=new Date('2026-11-22T00:00:00Z');
  const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const jwk={...publicKey.export({format:'jwk'}),kid:'local-test-key',use:'sig',alg:'RS256'};
  const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
  function access(claims={},signer=privateKey){
   const first=encode({alg:'RS256',kid:'local-test-key',typ:'at+jwt'})+'.'+encode({iss:issuer,sub:'staff-1',aud:'stampy-test-api',iat:at.getTime()/1000,exp:at.getTime()/1000+3600,...claims});
   return first+'.'+sign('RSA-SHA256',Buffer.from(first),signer).toString('base64url');
  }
  const verifyAccessToken=createOidcAccessTokenVerifier({issuer,audience:'stampy-test-api',jwksUri:issuer+'keys',clock:()=>at.getTime(),fetchImpl:async()=>({ok:true,text:async()=>JSON.stringify({keys:[jwk]})})});
  const make=(pool=runtime)=>createLoyaltyHttpHandler({origin,ledger:createPostgresLoyaltyLedger({pool,verifyAccessToken,now:()=>new Date(at)})});
  const handler=make(),good=access();
  const body={businessId:'http-merchant',membershipId:C,locationId:L};
  const idempotencyKey=n=>'http-command-'+String(n).padStart(16,'0');
  const post=(path='stamps',n=1,more={},token=good)=>new Request(origin+'/api/v1/loyalty/'+path,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','Idempotency-Key':idempotencyKey(n)},body:JSON.stringify({...body,...more})});
  const get=(businessId='http-merchant',token=good)=>new Request(origin+'/api/v1/loyalty/passes/'+C+'?businessId='+businessId,{headers:{Authorization:'Bearer '+token}});
  async function seed(){
   await admin.query('TRUNCATE stampies_identity.merchants CASCADE');
   await admin.query("INSERT INTO stampies_identity.merchants(id,business_id,name) VALUES($1,'http-merchant','HTTP Test'),($2,'other-merchant','Other')",[M,OTHER]);
   await admin.query("INSERT INTO stampies_identity.merchant_memberships(merchant_id,issuer,subject,role,status) VALUES($1,$2,'staff-1','owner','active')",[M,issuer]);
   await admin.query("INSERT INTO stampies_loyalty.programs(id,merchant_id,public_code,reward_text,target,daily_limit,cooldown_seconds,time_zone) VALUES($1,$2,'http-program-test-00000000001','Free item',2,20,0,'Australia/Sydney')",[P,M]);
   await admin.query("INSERT INTO stampies_loyalty.locations(id,merchant_id,code,name) VALUES($1,$2,'one','One')",[L,M]);
   await admin.query("INSERT INTO stampies_loyalty.memberships(id,merchant_id,program_id,pass_id) VALUES($1,$2,$3,$4)",[C,M,P,'stp_'+'a'.repeat(32)]);
  }
  async function outcome(request,status,code,h=handler){const r=await h(request);assert.equal(r.status,status);const b=await r.json();if(code)assert.equal(b.error.code,code);return b;}
  async function events(){return Number((await admin.query('SELECT count(*) AS n FROM stampies_loyalty.events')).rows[0].n);}

  await t.test('signed identity plus actual transaction loop, concurrent retry and server-confirmed read',async()=>{
   await seed();assert.equal((await outcome(get(),200)).membership.balance,0);
   const results=await Promise.all([outcome(post('stamps',1),200),outcome(post('stamps',2),200),outcome(post('stamps',1),200)]);
   assert.equal(results.filter(x=>x.transaction.duplicate).length,1);assert.equal(await events(),2);
   assert.equal((await outcome(get(),200)).membership.balance,2);
   await outcome(post('stamps',3),409,'REWARD_READY');
   assert.equal((await outcome(post('redemptions',3),200)).transaction.balance,0);
   assert.equal((await outcome(post('redemptions',3),200)).transaction.duplicate,true);
   assert.equal((await outcome(get(),200)).membership.rewardsRedeemed,1);assert.equal(await events(),3);
  });
  await t.test('invalid signature/audience/expiry, canonical revocation, tenant mismatch and client authority fields fail closed',async()=>{
   await seed();const {privateKey:wrong}=generateKeyPairSync('rsa',{modulusLength:2048});
   for(const token of [access({},wrong),access({aud:'other-api'}),access({iat:at.getTime()/1000-7200,exp:at.getTime()/1000-3600})])await outcome(post('stamps',1,{},token),401,'UNAUTHORIZED');
   await outcome(post('stamps',1,{businessId:'other-merchant'}),403,'FORBIDDEN');
   await outcome(post('stamps',1,{balance:100}),400,'INVALID_FIELDS');
   await admin.query("UPDATE stampies_identity.merchant_memberships SET status='revoked' WHERE merchant_id=$1",[M]);
   await outcome(post(),403,'FORBIDDEN');await outcome(get(),403,'FORBIDDEN');assert.equal(await events(),0);
  });
  await t.test('handler waits on canonical permission lock; committed revocation denies without event',async()=>{
   await seed();const c=await admin.connect();
   try{
    await c.query('BEGIN');await c.query("UPDATE stampies_identity.merchant_memberships SET status='revoked' WHERE merchant_id=$1",[M]);
    const pending=handler(post());let blocked=false;const deadline=Date.now()+4000;
    while(Date.now()<deadline){
     const rows=(await admin.query("SELECT $1::int=ANY(pg_catalog.pg_blocking_pids(pid)) AS blocked FROM pg_catalog.pg_stat_activity WHERE application_name='stampy-http-runtime'",[c.processID])).rows;
     if(rows.some(x=>x.blocked)){blocked=true;break;}await delay(5);
    }
    assert.equal(blocked,true,'actual PostgreSQL permission-lock wait required');
    await c.query('COMMIT');assert.equal((await pending).status,403);assert.equal(await events(),0);
   }finally{await c.query('ROLLBACK');c.release();}
  });
  await t.test('post-event DB failure rolls back, returns sanitized retryable503; same key retry commits only once',async()=>{
   await seed();const failing={async connect(){const c=await runtime.connect();return {release:()=>c.release(),query:async(sql,params)=>{if(sql.startsWith('UPDATE stampies_loyalty.memberships'))throw new Error('internal-db-secret');return c.query(sql,params);}};}};
   const b=await outcome(post(),503,'SERVICE_UNAVAILABLE',make(failing));assert.equal(b.error.retryable,true);assert.equal(JSON.stringify(b).includes('secret'),false);assert.equal(await events(),0);
   assert.equal((await outcome(get(),200)).membership.balance,0);
   assert.equal((await outcome(post(),200)).transaction.balance,1);
   assert.equal((await outcome(post(),200)).transaction.duplicate,true);assert.equal(await events(),1);
  });
  await t.test('idempotency identity cannot be reused for different command; legacy/PassKit namespaces do not dispatch',async()=>{
   await seed();await outcome(post(),200);
   await outcome(post('redemptions'),409,'IDEMPOTENCY_CONFLICT');
   for(const path of ['/wallet/stamps','/v1/loyalty/stamps'])assert.equal((await handler(new Request(origin+path,{method:'POST',headers:{Authorization:'Bearer '+good},body:'{}'}))).status,404);
   assert.equal(await events(),1);
  });
 }finally{
  if(runtime)await runtime.end();if(admin)await admin.end();
  if(started)run('pg_ctl',['-D',data,'-m','immediate','-w','stop']);
  rmSync(dir,{recursive:true,force:true});assert.equal(existsSync(dir),false);t.diagnostic('Private disposable HTTP-test database stopped and directory removed. No network listener or external IdP was used.');
 }
});
