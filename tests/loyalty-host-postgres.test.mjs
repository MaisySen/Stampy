// Real HTTP listener only on disposable 127.0.0.1:0, actual RS256 verification
// against synthetic in-process JWKS, owned bounded pool and restricted PG login.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,mkdirSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {once} from 'node:events';
import {request} from 'node:http';
import {generateKeyPairSync,sign} from 'node:crypto';
import pg from 'pg';
import {openLoyaltyApplication} from '../server/api/application.mjs';
const M='11111111-1111-4111-8111-111111111111',P='22222222-2222-4222-8222-222222222222',C='33333333-3333-4333-8333-333333333333',L='44444444-4444-4444-8444-444444444444';
const origin='https://api.example',issuer='https://identity.example/';
const bins=existsSync('/usr/lib/postgresql')?readdirSync('/usr/lib/postgresql').map(x=>'/usr/lib/postgresql/'+x+'/bin'):[];
const bin=process.env.PG_BIN||bins.find(x=>existsSync(join(x,'initdb'))),executable=name=>bin?join(bin,name):name;
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('PG')));
function run(name,args){const x=spawnSync(executable(name),args,{encoding:'utf8',env,timeout:30000});assert.ifError(x.error);assert.equal(x.status,0,x.stdout+'\n'+x.stderr);return x.stdout;}

test('owned raw host / verifier / restricted-pool actual PostgreSQL composition',{timeout:60000},async t=>{
 const dir=mkdtempSync(join(tmpdir(),'stampy-host-pg-')),data=join(dir,'data'),socket=join(dir,'socket');mkdirSync(socket,{mode:0o700});
 let admin,app,started=false;
 try {
  run('initdb',['-D',data,'-U','host_test_migration','-A','trust','--no-locale','-E','UTF8']);
  run('pg_ctl',['-D',data,'-l',join(dir,'server.log'),'-o',`-h "" -k ${socket} -c max_connections=16 -c shared_buffers=16MB`,'-w','start']);started=true;
  const config={host:socket,database:'postgres',port:5432,max:5,connectionTimeoutMillis:3000,idleTimeoutMillis:1000,options:'-c statement_timeout=10000 -c lock_timeout=7000'};
  admin=new pg.Pool({...config,user:'host_test_migration'});
  for(const path of ['server/auth/postgres/001-merchant-identities.sql','server/loyalty/postgres/001-loyalty-ledger.sql','server/loyalty/postgres/provision-loyalty-runtime.sql','server/loyalty/postgres/002-transactional-authority.sql'])await admin.query(readFileSync(new URL('../'+path,import.meta.url),'utf8'));
  await admin.query('CREATE ROLE host_test_runtime LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS; GRANT stampies_loyalty_runtime TO host_test_runtime');
  const at=new Date('2026-11-22T00:00:00Z');
  const {publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const jwk={...publicKey.export({format:'jwk'}),kid:'host-local-key',use:'sig',alg:'RS256'};
  const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
  const access=(claims={})=>{const input=encode({alg:'RS256',kid:'host-local-key',typ:'at+jwt'})+'.'+encode({iss:issuer,sub:'staff-1',aud:'host-api-only',iat:at.getTime()/1000,exp:at.getTime()/1000+3600,...claims});return input+'.'+sign('RSA-SHA256',Buffer.from(input),privateKey).toString('base64url');};
  let jwksCalls=0;
  const options={origin,database:{host:socket,database:'postgres',port:5432,user:'host_test_runtime'},oidc:{issuer,audience:'host-api-only',clientId:'host-browser-client',jwksUri:issuer+'keys'},clock:()=>at.getTime(),now:()=>new Date(at),limits:{maxInFlight:2,maxConnections:8},fetchImpl:async(url,opts)=>{jwksCalls++;assert.equal(url,issuer+'keys');assert.equal(opts.redirect,'error');return Response.json({keys:[jwk]});}};
  await t.test('startup rejects ambient DDL, privileged login and expanded effective grants',async()=>{
   await assert.rejects(openLoyaltyApplication(options),/privileges/);
   await admin.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
   await assert.rejects(openLoyaltyApplication({...options,database:{...options.database,user:'host_test_migration'}}),/privileges/);
   for(const [grant,revoke]of [
    ['GRANT UPDATE(id) ON stampies_loyalty.programs TO host_test_runtime','REVOKE UPDATE(id) ON stampies_loyalty.programs FROM host_test_runtime'],
    ['GRANT SELECT(name) ON stampies_identity.merchants TO host_test_runtime','REVOKE SELECT(name) ON stampies_identity.merchants FROM host_test_runtime'],
    ['GRANT SELECT ON stampies_identity.merchant_memberships TO host_test_runtime','REVOKE SELECT ON stampies_identity.merchant_memberships FROM host_test_runtime'],
    ["CREATE FUNCTION public.unexpected() RETURNS int LANGUAGE sql AS 'SELECT 1'",'DROP FUNCTION public.unexpected()'],
    ['CREATE SEQUENCE public.unexpected_seq; GRANT USAGE ON SEQUENCE public.unexpected_seq TO host_test_runtime','DROP SEQUENCE public.unexpected_seq'],
    ['GRANT EXECUTE ON FUNCTION stampies_identity.lock_staff_authority(text,text,text,text) TO PUBLIC','REVOKE EXECUTE ON FUNCTION stampies_identity.lock_staff_authority(text,text,text,text) FROM PUBLIC'],
   ]){await admin.query(grant);await assert.rejects(openLoyaltyApplication(options),/privileges/);await admin.query(revoke);}
   const good=await openLoyaltyApplication(options);assert.equal(good.server.listening,false);await good.close();
   await assert.rejects(openLoyaltyApplication({...options,oidc:{...options.oidc,audience:'host-browser-client'}}),/API-only/);
   await assert.rejects(openLoyaltyApplication({...options,database:{...options.database,host:'external.invalid',ssl:false}}),/configuration/);
  });
  app=await openLoyaltyApplication(options);app.server.listen(0,'127.0.0.1');await once(app.server,'listening');assert.equal(app.server.address().address,'127.0.0.1');const port=app.server.address().port;
  const body={businessId:'host-merchant',membershipId:C,locationId:L};
  function command(path='stamps',key=1,token=access(),more={}) {
   const payload=JSON.stringify({...body,...more});let req;
   const promise=new Promise((resolve,reject)=>{
    req=request({hostname:'127.0.0.1',port,path:'/api/v1/loyalty/'+path,method:'POST',headers:{Host:'api.example',Authorization:'Bearer '+token,'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload),'Idempotency-Key':'host-command-'+String(key).padStart(16,'0')}},res=>{let text='';res.on('data',c=>text+=c);res.on('end',()=>{try{resolve({status:res.statusCode,headers:res.headers,body:text?JSON.parse(text):null});}catch(e){reject(e);}});});
    req.setTimeout(12000,()=>req.destroy(new Error('Client deadline')));req.on('error',reject);req.end(payload);
   });return {promise,req};
  }
  async function seed(){
   await admin.query('TRUNCATE stampies_identity.merchants CASCADE');
   await admin.query("INSERT INTO stampies_identity.merchants(id,business_id,name) VALUES($1,'host-merchant','Host Test')",[M]);
   await admin.query("INSERT INTO stampies_identity.merchant_memberships(merchant_id,issuer,subject,role,status) VALUES($1,$2,'staff-1','owner','active')",[M,issuer]);
   await admin.query("INSERT INTO stampies_loyalty.programs(id,merchant_id,public_code,reward_text,target,daily_limit,cooldown_seconds,time_zone) VALUES($1,$2,'host-program-test-00000000001','Free item',2,20,0,'Australia/Sydney')",[P,M]);
   await admin.query("INSERT INTO stampies_loyalty.locations(id,merchant_id,code,name) VALUES($1,$2,'one','One')",[L,M]);
   await admin.query('INSERT INTO stampies_loyalty.memberships(id,merchant_id,program_id,pass_id) VALUES($1,$2,$3,$4)',[C,M,P,'stp_'+'b'.repeat(32)]);
  }
  async function events(){return Number((await admin.query('SELECT count(*) AS n FROM stampies_loyalty.events')).rows[0].n);}
  async function blocked(pid){const end=Date.now()+3000;while(Date.now()<end){const rows=(await admin.query("SELECT $1::int=ANY(pg_catalog.pg_blocking_pids(pid)) AS blocked FROM pg_catalog.pg_stat_activity WHERE application_name='stampy-loyalty-api'",[pid])).rows;if(rows.some(x=>x.blocked))return;await delay(5);}assert.fail('Actual PG lock barrier required');}
  await t.test('actual socket to canonical ledger supports concurrent retry and redemption exactly once',async()=>{
   await seed();const result=await Promise.all([command('stamps',1).promise,command('stamps',1).promise]);assert.deepEqual(result.map(x=>x.status),[200,200]);assert.equal(result.filter(x=>x.body.transaction.duplicate).length,1);assert.equal(await events(),1);
   assert.equal((await command('stamps',2).promise).status,200);assert.equal((await command('redemptions',3).promise).body.transaction.balance,0);assert.equal((await command('redemptions',3).promise).body.transaction.duplicate,true);assert.equal(await events(),3);assert.equal(jwksCalls,1);
  });
  await t.test('signed wrong audience, role revocation, cross-tenant and body authority remain denied',async()=>{
   await seed();const unauthorized=await command('stamps',1,access({aud:'host-browser-client'})).promise;assert.equal(unauthorized.status,401);assert.equal(unauthorized.headers['www-authenticate'],'Bearer realm="Stampy"');
   assert.equal((await command('stamps',1,access(),{businessId:'other-merchant'}).promise).status,403);
   assert.equal((await command('stamps',1,access(),{balance:100}).promise).status,400);
   await admin.query("UPDATE stampies_identity.merchant_memberships SET status='revoked' WHERE merchant_id=$1",[M]);assert.equal((await command().promise).status,403);assert.equal(await events(),0);
  });
  await t.test('actual socket operation waits for authority lock and sees committed revocation',async()=>{
   await seed();const c=await admin.connect();try{await c.query('BEGIN');await c.query("UPDATE stampies_identity.merchant_memberships SET status='revoked' WHERE merchant_id=$1",[M]);const pending=command().promise;await blocked(c.processID);await c.query('COMMIT');assert.equal((await pending).status,403);assert.equal(await events(),0);}finally{await c.query('ROLLBACK');c.release();}
  });
  await t.test('disconnect after dispatch can commit; same-key retry reconciles without another event',async()=>{
   await seed();const c=await admin.connect();try{
    await c.query('BEGIN');await c.query('SELECT id FROM stampies_loyalty.memberships WHERE id=$1 FOR UPDATE',[C]);const pending=command();pending.promise.catch(()=>{});await blocked(c.processID);pending.req.destroy();await assert.rejects(pending.promise);await c.query('COMMIT');
    const end=Date.now()+3000;while(await events()!==1&&Date.now()<end)await delay(5);assert.equal(await events(),1);
    const replay=await command().promise;assert.equal(replay.status,200);assert.equal(replay.body.transaction.duplicate,true);assert.equal(await events(),1);
   }finally{await c.query('ROLLBACK');c.release();}
  });
  t.diagnostic((await admin.query('SELECT version()')).rows[0].version);
 }finally{
  if(app){await app.close();assert.deepEqual(app.inspect(),{active:0,connections:0,closing:true});}if(admin)await admin.end();
  if(started)run('pg_ctl',['-D',data,'-m','immediate','-w','stop']);rmSync(dir,{recursive:true,force:true});assert.equal(existsSync(dir),false);
  t.diagnostic('Loopback HTTP sockets and owned pool closed; socket-only disposable PostgreSQL stopped and data removed. Only synthetic in-process JWKS used.');
 }
});
