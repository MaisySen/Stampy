import pg from 'pg';
import {createOidcAccessTokenVerifier} from '../auth/oidc-jwt.mjs';
import {verifyLoyaltyRuntimeRole} from '../loyalty/postgres/runtime-role.mjs';
import {createPostgresLoyaltyLedger} from '../loyalty/postgres/ledger.mjs';
import {createLoyaltyHttpHandler} from './loyalty-http.mjs';
import {createLoyaltyHttpHost} from './http-host.mjs';

// Explicit server-only config, no environment fallback, fake tenant, default
// provider, migration, bind or start command. The caller must provide secrets
// through its deployment secret manager, never a client bundle.
export async function openLoyaltyApplication({origin,database,oidc,fetchImpl=globalThis.fetch,clock=Date.now,now=()=>new Date(),limits={}}={}) {
 if(!database||typeof database.host!=='string'||!database.host||typeof database.user!=='string'||!database.user||
   typeof database.database!=='string'||!database.database||!Number.isInteger(database.port)||database.port<1||database.port>65535||
   (database.password!==undefined&&typeof database.password!=='string')||
   Object.keys(database).some(k=>!['host','port','user','database','password','ssl'].includes(k))||
   (!database.host.startsWith('/')&&database.ssl?.rejectUnauthorized!==true)||
   (database.ssl&&Object.keys(database.ssl).some(k=>!['rejectUnauthorized','ca','cert','key'].includes(k)))||
   !oidc||typeof oidc.clientId!=='string'||!oidc.clientId||oidc.audience===oidc.clientId||
   typeof clock!=='function'||typeof now!=='function'||typeof limits!=='object'||!limits||
   Object.keys(limits).some(k=>!['maxInFlight','maxConnections','maxBodyBytes','headerTimeoutMs','bodyTimeoutMs','operationTimeoutMs','maxResponseBytes'].includes(k)))throw new Error('Explicit private database and API-only OIDC configuration required');
 const max=limits.maxInFlight??8;
 if(!Number.isInteger(max)||max<1||max>32)throw new Error('Invalid pool admission limit');
 const verifyAccessToken=createOidcAccessTokenVerifier({...oidc,fetchImpl,clock});
 const pool=new pg.Pool({...database,ssl:database.ssl??false,password:()=>Promise.resolve(database.password??''),application_name:'stampy-loyalty-api',max,query_timeout:6000,allowExitOnIdle:true,connectionTimeoutMillis:2000,idleTimeoutMillis:1000,
   options:'-c statement_timeout=5000 -c lock_timeout=4000 -c idle_in_transaction_session_timeout=6000 -c search_path=pg_catalog'});
 // pg emits background pool errors after an idle socket failure. Fail new
 // requests closed without exposing driver errors or crashing unhandled.
 let unhealthy=false,host;pool.on('error',()=>{unhealthy=true;});
 try {
   await verifyLoyaltyRuntimeRole(pool);
   // Destroy a failed checked-out connection rather than returning an active
   // timed-out query/aborted transaction to the pool. Rollback then rejects
   // immediately on that closed wrapper. A lost COMMIT reply is still unknown.
   const ledgerPool={async connect(){
     const client=await pool.connect();let released=false;
     return {async query(...args){
       if(released)throw new Error('Database connection closed');
       try{return await client.query(...args);}catch(error){released=true;client.release(error);throw error;}
     },release(){if(!released){released=true;client.release();}}};
   }};
   const ledger=createPostgresLoyaltyLedger({pool:ledgerPool,verifyAccessToken,now});
   const handle=createLoyaltyHttpHandler({origin,ledger,maxBodyBytes:limits.maxBodyBytes,bodyTimeoutMs:limits.bodyTimeoutMs});
   host=createLoyaltyHttpHost({origin,...limits,handler:request=>unhealthy?new Response(null,{status:503}):handle(request)});
   let closePromise;
   return Object.freeze({server:host.server,inspect:host.inspect,close(){if(!closePromise)closePromise=(async()=>{try{await host.close();}finally{await pool.end();}})();return closePromise;}});
 }catch(error){await host?.close();await pool.end();throw error;}
}
