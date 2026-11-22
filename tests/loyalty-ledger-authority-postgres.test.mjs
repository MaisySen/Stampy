import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync,mkdtempSync,mkdirSync,readFileSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import pg from 'pg';
import {createHash} from 'node:crypto';
import {createPostgresLoyaltyLedger} from '../server/loyalty/postgres/ledger.mjs';

const M='11111111-1111-4111-8111-111111111111';
const P='22222222-2222-4222-8222-222222222222';
const C='33333333-3333-4333-8333-333333333333';
const L='44444444-4444-4444-8444-444444444444';
const OTHER='55555555-5555-4555-8555-555555555555';
const issuer='https://identity.example/';
const publicCode='public-program-fixture-00000001';
const token='A'.repeat(43);
const hash=(x)=>createHash('sha256').update(x).digest('hex');
const args=(n=1)=>({accessToken:'verified-test-token',businessId:'test-merchant',membershipId:C,locationId:L,idempotencyKey:'transaction-'+String(n).padStart(16,'0')});
const systemBins=existsSync('/usr/lib/postgresql')?readdirSync('/usr/lib/postgresql').map(x=>'/usr/lib/postgresql/'+x+'/bin'):[];
const bin=process.env.PG_BIN || systemBins.find(p=>existsSync(join(p,'initdb')));
const executable=(name)=>bin?join(bin,name):name;
const cleanEnv=Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.startsWith('PG')));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function run(command,argv){
  const x=spawnSync(command,argv,{encoding:'utf8',timeout:30000,env:cleanEnv});
  assert.ifError(x.error);assert.equal(x.status,0,x.stdout+'\n'+x.stderr);return x.stdout;
}
const denied=(f,code)=>assert.rejects(f,e=>e?.code===code);

test('actual JS ledger adapter with restricted PostgreSQL login and deterministic lifecycle barriers', {timeout:90000}, async t=>{
  const dir=mkdtempSync(join(tmpdir(),'stampy-authority-pg-'));
  const data=join(dir,'data'),socket=join(dir,'socket');mkdirSync(socket,{mode:0o700});
  let started=false,admin,runtime;
  try {
    run(executable('initdb'),['-D',data,'-U','stampy_test_migration','-A','trust','--no-locale','-E','UTF8']);
    run(executable('pg_ctl'),['-D',data,'-l',join(dir,'server.log'),'-o',`-h "" -k ${socket} -c max_connections=20 -c shared_buffers=16MB`,'-w','start']);started=true;
    const config={host:socket,port:5432,database:'postgres',max:8,connectionTimeoutMillis:3000,idleTimeoutMillis:1000,options:'-c statement_timeout=10000 -c lock_timeout=7000'};
    admin=new pg.Pool({...config,user:'stampy_test_migration'});
    for(const path of ['server/auth/postgres/001-merchant-identities.sql','server/loyalty/postgres/001-loyalty-ledger.sql','server/loyalty/postgres/provision-loyalty-runtime.sql','server/loyalty/postgres/002-transactional-authority.sql']){
      await admin.query(readFileSync(new URL('../'+path,import.meta.url),'utf8'));
    }
    await admin.query('CREATE ROLE stampy_js_runtime LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS; GRANT stampies_loyalty_runtime TO stampy_js_runtime');
    runtime=new pg.Pool({...config,user:'stampy_js_runtime'});
    const version=(await admin.query('SELECT version()')).rows[0].version;t.diagnostic(version);
    let at=new Date('2026-11-22T00:00:00Z');
    const verifyAccessToken=async x=>x==='verified-test-token'?{iss:issuer,sub:'staff-1'}:null;
    const make=(pool=runtime)=>createPostgresLoyaltyLedger({pool,verifyAccessToken,now:()=>new Date(at)});
    const ledger=make();
    async function seed({role='staff',balance=0,target=10,dailyLimit=20,cooldown=0,card=true}={}){
      at=new Date('2026-11-22T00:00:00Z');
      await admin.query('TRUNCATE stampies_identity.merchants CASCADE');
      await admin.query("INSERT INTO stampies_identity.merchants(id,business_id,name) VALUES($1,'test-merchant','Test'),($2,'other-tenant','Other')",[M,OTHER]);
      await admin.query("INSERT INTO stampies_identity.merchant_memberships(merchant_id,issuer,subject,role,status) VALUES($1,$2,'staff-1',$3,'active')",[M,issuer,role]);
      await admin.query("INSERT INTO stampies_loyalty.programs(id,merchant_id,public_code,reward_text,target,daily_limit,cooldown_seconds,time_zone) VALUES($1,$2,$3,'Free item',$4,$5,$6,'Australia/Sydney')",[P,M,publicCode,target,dailyLimit,cooldown]);
      await admin.query("INSERT INTO stampies_loyalty.locations(id,merchant_id,code,name) VALUES($1,$2,'one','One')",[L,M]);
      if(card)await admin.query('INSERT INTO stampies_loyalty.memberships(id,merchant_id,program_id,pass_id,balance) VALUES($1,$2,$3,$4,$5)',[C,M,P,'stp_'+'a'.repeat(32),balance]);
    }
    async function blocked(pid,blocker){
      const end=Date.now()+4000;
      while(Date.now()<end){
        const r=await admin.query('SELECT $2::int = ANY(pg_catalog.pg_blocking_pids($1::int)) AS blocked',[pid,blocker]);
        if(r.rows[0].blocked)return;
        await delay(5);
      }
      assert.fail(`No DB-confirmed lock wait for pid ${pid} on ${blocker}`);
    }
    // A test-only wrapper observes actual SQL boundaries. It cannot grant authority.
    function observed({pauseAfter,failBefore}={}){
      const connected=deferred(),acquired=deferred(),release=deferred();
      let used=false;
      const pool={async connect(){
        const c=await runtime.connect();connected.resolve(c.processID);
        return {release:()=>c.release(),async query(sql,params){
          if(failBefore?.(sql))throw new Error('Injected post-event rollback');
          const r=await c.query(sql,params);
          if(!used&&pauseAfter?.(sql)){used=true;acquired.resolve();await release.promise;}
          return r;
        }};
      }};
      return {pool,connected,acquired,release};
    }
    async function count(table){return Number((await admin.query('SELECT count(*) AS n FROM stampies_loyalty.'+table)).rows[0].n);}

    await t.test('restricted login, helper ACL/owner/search_path and denied identity/schema mutation',async()=>{
      await seed();
      const who=(await runtime.query('SELECT current_user,session_user')).rows[0];
      assert.equal(who.current_user,'stampy_js_runtime');assert.equal(who.session_user,'stampy_js_runtime');
      const f=(await admin.query("SELECT p.proname,r.rolname,p.prosecdef,p.proconfig FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_roles r ON r.oid=p.proowner JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='stampies_identity' ORDER BY p.proname")).rows;
      assert.equal(f.length,2);
      for(const x of f){assert.equal(x.rolname,'stampies_permission_locker');assert.equal(x.prosecdef,true);assert.deepEqual(x.proconfig,['search_path=pg_catalog, pg_temp']);}
      const permissions=(await admin.query("SELECT has_function_privilege('public','stampies_identity.lock_staff_authority(text,text,text,text)','EXECUTE') AS pub, has_schema_privilege('stampy_js_runtime','stampies_identity','CREATE') AS create, has_column_privilege('stampy_js_runtime','stampies_identity.merchant_memberships','status','UPDATE') AS mutate")).rows[0];
      assert.deepEqual(permissions,{pub:false,create:false,mutate:false});
      for(const sql of ["UPDATE stampies_identity.merchant_memberships SET role='owner'", "DELETE FROM stampies_identity.merchant_memberships", "UPDATE stampies_identity.merchants SET updated_at=now()", "SET ROLE stampies_permission_locker", "ALTER FUNCTION stampies_identity.lock_staff_authority(text,text,text,text) SET search_path=public", "ALTER FUNCTION stampies_identity.lock_staff_authority(text,text,text,text) OWNER TO stampy_js_runtime", "CREATE TABLE stampies_identity.forbidden(id int)"]){
        await denied(()=>runtime.query(sql),'42501');
      }
      await denied(()=>runtime.query('SELECT stampies_identity.lock_staff_authority($1,$2,$3,NULL)',['test-merchant',issuer,'staff-1']),'42501');
      await runtime.query('CREATE TEMP TABLE merchants(id uuid,status text)');
      // Explicitly qualified relations cannot be shadowed by temp names.
      assert.equal((await ledger.issueStamp(args())).balance,1);
    });

    await t.test('all staff-controlled methods deny canonical viewer despite valid JWT',async()=>{
      await seed({role:'viewer'});
      for(const fn of [()=>ledger.createLocation({...args(),code:'two',name:'Two'}),()=>ledger.createProgram({...args(),rewardText:'Item',target:2,timeZone:'Australia/Sydney'}),()=>ledger.createEnrollmentGrant({...args(),programId:P}),()=>ledger.issueStamp(args()),()=>ledger.redeemReward(args()),()=>ledger.getMerchantPass(args())])await denied(fn,'FORBIDDEN');
      assert.equal(await count('events'),0);assert.equal(await count('enrollment_grants'),0);
    });

    const changes=[
      {name:'role downgrade',sql:"UPDATE stampies_identity.merchant_memberships SET role='viewer' WHERE merchant_id=$1",params:[M]},
      {name:'membership revoke',sql:"UPDATE stampies_identity.merchant_memberships SET status='revoked' WHERE merchant_id=$1",params:[M]},
      {name:'membership delete',sql:'DELETE FROM stampies_identity.merchant_memberships WHERE merchant_id=$1',params:[M]},
      {name:'merchant suspend',sql:"UPDATE stampies_identity.merchants SET status='suspended' WHERE id=$1",params:[M]},
      {name:'program pause',sql:"UPDATE stampies_loyalty.programs SET status='paused' WHERE id=$1",params:[P],code:'PROGRAM_UNAVAILABLE'},
      {name:'location close',sql:"UPDATE stampies_loyalty.locations SET status='closed' WHERE id=$1",params:[L],code:'LOCATION_UNAVAILABLE'},
      {name:'card block',sql:"UPDATE stampies_loyalty.memberships SET status='blocked' WHERE id=$1",params:[C],code:'PASS_UNAVAILABLE'},
    ];
    for(const change of changes){
      await t.test(change.name+' commits first: waiter denied with zero event',async()=>{
        await seed();const c=await admin.connect();const o=observed();
        try{
          await c.query('BEGIN');await c.query(change.sql,change.params);
          const result=make(o.pool).issueStamp(args()).then(x=>({x}),e=>({e}));
          await blocked(await o.connected.promise,c.processID);
          await c.query('COMMIT');
          const {e}=await result;assert.equal(e?.code,change.code||'FORBIDDEN');assert.equal(await count('events'),0);
        }finally{await c.query('ROLLBACK');c.release();o.release.resolve();}
      });
      await t.test('operation locks first: '+change.name+' waits for its commit',async()=>{
        await seed();const c=await admin.connect();const o=observed({pauseAfter:s=>s.includes('FOR UPDATE')&&s.includes('memberships')});
        try{
          const result=make(o.pool).issueStamp(args());await o.acquired.promise;
          const pending=c.query(change.sql,change.params);
          await blocked(c.processID,await o.connected.promise);
          o.release.resolve();assert.equal((await result).balance,1);await pending;assert.equal(await count('events'),1);
        }finally{o.release.resolve();c.release();}
      });
    }

    await t.test('same-card concurrent stamps/replay and changed-request conflict use real row locks',async()=>{
      await seed();const result=await Promise.all([ledger.issueStamp(args(1)),ledger.issueStamp(args(2)),ledger.issueStamp(args(1))]);
      assert.equal(result.filter(x=>x.duplicate).length,1);assert.equal(await count('events'),2);
      assert.equal((await ledger.getMerchantPass(args())).balance,2);
      await denied(()=>ledger.redeemReward(args(1)),'IDEMPOTENCY_CONFLICT');
    });
    await t.test('concurrent redemptions cannot redeem twice',async()=>{
      await seed({balance:2,target:2});
      const outcomes=await Promise.allSettled([ledger.redeemReward(args(1)),ledger.redeemReward(args(2))]);
      assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
      assert.equal(outcomes.find(x=>x.status==='rejected').reason.code,'REWARD_NOT_READY');
      assert.equal(await count('events'),1);
    });
    await t.test('cross-tenant card/location fail and post-event failure rolls back everything',async()=>{
      await seed();await denied(()=>ledger.issueStamp({...args(),businessId:'other-tenant'}),'FORBIDDEN');
      await admin.query('UPDATE stampies_loyalty.locations SET merchant_id=$1 WHERE id=$2',[OTHER,L]);
      await denied(()=>ledger.issueStamp(args()),'LOCATION_UNAVAILABLE');assert.equal(await count('events'),0);
      await seed();const o=observed({failBefore:s=>s.startsWith('UPDATE stampies_loyalty.memberships')});
      await assert.rejects(()=>make(o.pool).issueStamp(args()),/Injected post-event rollback/);
      assert.equal(await count('events'),0);assert.equal((await ledger.getMerchantPass(args())).balance,0);
    });

    await t.test('clock sampled after card-lock wait across local midnight and cooldown',async()=>{
      await seed({dailyLimit:1,cooldown:60});
      at=new Date('2026-11-22T12:59:50Z');await ledger.issueStamp(args(1));
      at=new Date('2026-11-22T12:59:55Z');const c=await admin.connect(),o=observed();
      try{
        await c.query('BEGIN');await c.query('SELECT id FROM stampies_loyalty.memberships WHERE id=$1 FOR UPDATE',[C]);
        const pending=make(o.pool).issueStamp(args(2));await blocked(await o.connected.promise,c.processID);
        at=new Date('2026-11-22T13:01:00Z');await c.query('COMMIT');assert.equal((await pending).balance,2);
        const days=(await admin.query('SELECT local_day::text AS day,created_at FROM stampies_loyalty.events ORDER BY created_at')).rows;
        assert.deepEqual(days.map(x=>x.day),['2026-11-22','2026-11-23']);assert.equal(days[1].created_at.toISOString(),at.toISOString());
      }finally{await c.query('ROLLBACK');c.release();o.release.resolve();}
    });

    async function grant(){await admin.query('INSERT INTO stampies_loyalty.enrollment_grants(digest,merchant_id,program_id,expires_at) VALUES($1,$2,$3,$4)',[hash(token),M,P,new Date(at.getTime()+300000)]);}
    const enrollment=()=>({publicCode,enrollmentToken:token});
    await t.test('one-time enrollment and grant expiry after blocking deletion lock',async()=>{
      await seed({card:false});await grant();
      const c=await admin.connect(),o=observed();
      try{
        await c.query('BEGIN');await c.query('SELECT digest FROM stampies_loyalty.enrollment_grants WHERE digest=$1 FOR UPDATE',[hash(token)]);
        const result=make(o.pool).enrollCustomer(enrollment()).then(x=>({x}),e=>({e}));await blocked(await o.connected.promise,c.processID);
        at=new Date(at.getTime()+300001);await c.query('COMMIT');assert.equal((await result).e?.code,'ENROLLMENT_EXPIRED');
        assert.equal(await count('memberships'),0);assert.equal(await count('enrollment_grants'),1);
      }finally{await c.query('ROLLBACK');c.release();o.release.resolve();}
      await seed({card:false});await grant();
      const r=await Promise.allSettled([ledger.enrollCustomer(enrollment()),ledger.enrollCustomer(enrollment())]);
      assert.equal(r.filter(x=>x.status==='fulfilled').length,1);assert.equal(await count('memberships'),1);assert.equal(await count('enrollment_grants'),0);
    });
    for(const scope of ['merchant','program']){
      await t.test('nonstaff enrollment: '+scope+' suspension first denies, operation first blocks suspension',async()=>{
        const sql=scope==='merchant'?"UPDATE stampies_identity.merchants SET status='suspended' WHERE id=$1":"UPDATE stampies_loyalty.programs SET status='paused' WHERE id=$1";
        const id=scope==='merchant'?M:P;
        await seed({card:false});await grant();let c=await admin.connect(),o=observed();
        try{
          await c.query('BEGIN');await c.query(sql,[id]);
          const pending=make(o.pool).enrollCustomer(enrollment()).then(x=>({x}),e=>({e}));await blocked(await o.connected.promise,c.processID);
          await c.query('COMMIT');assert.equal((await pending).e?.code,'PROGRAM_UNAVAILABLE');assert.equal(await count('memberships'),0);
        }finally{await c.query('ROLLBACK');c.release();}
        await seed({card:false});await grant();c=await admin.connect();o=observed({pauseAfter:s=>s.startsWith('DELETE FROM stampies_loyalty.enrollment_grants')});
        try{
          const pending=make(o.pool).enrollCustomer(enrollment());await o.acquired.promise;
          const update=c.query(sql,[id]);await blocked(c.processID,await o.connected.promise);o.release.resolve();
          assert.match((await pending).passId,/^stp_/);await update;
        }finally{o.release.resolve();c.release();}
      });
    }
    await t.test('grant creation TTL sampled after program lock and program deletion orderings',async()=>{
      await seed({card:false});const c=await admin.connect(),o=observed();
      try{
        await c.query('BEGIN');await c.query('SELECT id FROM stampies_loyalty.programs WHERE id=$1 FOR UPDATE',[P]);
        const pending=make(o.pool).createEnrollmentGrant({...args(),programId:P});await blocked(await o.connected.promise,c.processID);
        at=new Date(at.getTime()+600000);await c.query('COMMIT');assert.equal((await pending).expiresAt,new Date(at.getTime()+300000).toISOString());
      }finally{await c.query('ROLLBACK');c.release();}
      await seed({card:false});await admin.query('DELETE FROM stampies_loyalty.programs WHERE id=$1',[P]);
      await denied(()=>ledger.createEnrollmentGrant({...args(),programId:P}),'PROGRAM_UNAVAILABLE');
    });
    await t.test('grant cancellation on either side of enrollment is serialized',async()=>{
      await seed({card:false});await grant();let c=await admin.connect(),o=observed();
      try{
        await c.query('BEGIN');await c.query('DELETE FROM stampies_loyalty.enrollment_grants WHERE digest=$1',[hash(token)]);
        const pending=make(o.pool).enrollCustomer(enrollment()).then(x=>({x}),e=>({e}));
        await blocked(await o.connected.promise,c.processID);await c.query('COMMIT');
        assert.equal((await pending).e?.code,'ENROLLMENT_EXPIRED');assert.equal(await count('memberships'),0);
      }finally{await c.query('ROLLBACK');c.release();}
      await seed({card:false});await grant();c=await admin.connect();o=observed({pauseAfter:s=>s.startsWith('DELETE FROM stampies_loyalty.enrollment_grants')});
      try{
        const pending=make(o.pool).enrollCustomer(enrollment());await o.acquired.promise;
        const cancel=c.query('DELETE FROM stampies_loyalty.enrollment_grants WHERE digest=$1',[hash(token)]);
        await blocked(c.processID,await o.connected.promise);o.release.resolve();
        await pending;assert.equal((await cancel).rowCount,0);assert.equal(await count('memberships'),1);
      }finally{o.release.resolve();c.release();}
    });
    await t.test('program deletion waits for grant creation then is refused by FK',async()=>{
      await seed({card:false});const c=await admin.connect(),o=observed({pauseAfter:s=>s.startsWith('SELECT id,status,target')});
      try{
        const pending=make(o.pool).createEnrollmentGrant({...args(),programId:P});await o.acquired.promise;
        const deletion=c.query('DELETE FROM stampies_loyalty.programs WHERE id=$1',[P]).then(x=>({x}),e=>({e}));
        await blocked(c.processID,await o.connected.promise);o.release.resolve();await pending;
        assert.equal((await deletion).e?.code,'23503');assert.equal(await count('enrollment_grants'),1);
      }finally{o.release.resolve();c.release();}
    });
    await t.test('location deletion orderings block safely and retain event FK',async()=>{
      await seed();let c=await admin.connect(),o=observed();
      try{
        await c.query('BEGIN');await c.query('DELETE FROM stampies_loyalty.locations WHERE id=$1',[L]);
        const pending=make(o.pool).issueStamp(args()).then(x=>({x}),e=>({e}));await blocked(await o.connected.promise,c.processID);
        await c.query('COMMIT');assert.equal((await pending).e?.code,'LOCATION_UNAVAILABLE');assert.equal(await count('events'),0);
      }finally{await c.query('ROLLBACK');c.release();}
      await seed();c=await admin.connect();o=observed({pauseAfter:s=>s.includes('FOR UPDATE')&&s.includes('memberships')});
      try{
        const pending=make(o.pool).issueStamp(args());await o.acquired.promise;
        const deletion=c.query('DELETE FROM stampies_loyalty.locations WHERE id=$1',[L]).then(x=>({x}),e=>({e}));
        await blocked(c.processID,await o.connected.promise);o.release.resolve();await pending;
        assert.equal((await deletion).e?.code,'23503');assert.equal(await count('events'),1);
      }finally{o.release.resolve();c.release();}
    });

  }finally{
    if(runtime)await runtime.end();if(admin)await admin.end();
    if(started){run(executable('pg_ctl'),['-D',data,'-m','immediate','-w','stop']);started=false;}
    rmSync(dir,{recursive:true,force:true});assert.equal(existsSync(dir),false);t.diagnostic('Disposable cluster stopped and directory removed; no existing database used.');
  }
});
