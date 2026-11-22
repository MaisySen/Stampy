// Transport-only tests use explicit stubs; real signatures/ledger/PG are in
// loyalty-http-postgres.test.mjs. These do not certify a deployed server.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createLoyaltyHttpHandler} from '../server/api/loyalty-http.mjs';
const origin='https://api.example';
const card='33333333-3333-4333-8333-333333333333',location='44444444-4444-4444-8444-444444444444';
const body={businessId:'merchant',membershipId:card,locationId:location};
const headers={'Content-Type':'application/json','Authorization':'Bearer e30.e30.test','Idempotency-Key':'request-0000000000000001'};
const request=(options={})=>new Request(origin+'/api/v1/loyalty/stamps',{method:'POST',headers,body:JSON.stringify(body),...options});
function fixture(options={}){
 const calls=[];
 const ledger={issueStamp:async x=>{calls.push(x);return {kind:'stamp',balance:1,duplicate:false,rewardReady:false,privateInternal:'must not leak'};},redeemReward:async()=>({kind:'redeem',balance:0,duplicate:false}),getMerchantPass:async()=>null};
 return {calls,ledger,make:extra=>createLoyaltyHttpHandler({origin,ledger,...options,...extra})};
}
async function status(handler,req,n,code){const r=await handler(req);assert.equal(r.status,n);if(code)assert.equal((await r.json()).error.code,code);return r;}

test('only bounded canonical commands reach ledger, response allowlist excludes internals',async()=>{
 const {calls,make}=fixture();const r=await make()(request());assert.equal(r.status,200);
 assert.deepEqual(calls,[{...body,accessToken:'e30.e30.test',idempotencyKey:headers['Idempotency-Key']}]);
 assert.deepEqual(await r.json(),{transaction:{kind:'stamp',balance:1,duplicate:false,rewardReady:false},idempotencyKey:headers['Idempotency-Key']});
 assert.equal(r.headers.get('cache-control'),'private, no-store');assert.equal(r.headers.get('x-content-type-options'),'nosniff');
});
test('rejects unknown/client-authority fields, ambiguous JSON and invalid identifiers before ledger',async()=>{
 const {calls,make}=fixture();const h=make();
 for(const extra of [{balance:100},{role:'owner'},{createdAtMs:1},{idempotencyKey:'body-key'},{passId:'not-authority'}])await status(h,request({body:JSON.stringify({...body,...extra})}),400,'INVALID_FIELDS');
 for(const text of [JSON.stringify(body).replace('"businessId":"merchant"','"businessId":"other","businessId":"merchant"'),JSON.stringify(body).replace('"businessId":"merchant"','"businessId":12,"businessId":"merchant"')])await status(h,request({body:text}),400,'DUPLICATE_FIELDS');
 await status(h,request({body:'[]'}),400,'INVALID_FIELDS');await status(h,request({body:'{bad'}),400,'INVALID_JSON');
 await status(h,request({body:JSON.stringify({...body,membershipId:'not-uuid'})}),400,'INVALID_FIELDS');assert.equal(calls.length,0);
});
test('exact method, origin, namespace and bearer contracts; no CORS/cookie fallback',async()=>{
 const {calls,make}=fixture();const h=make();
 await status(h,new Request(origin+'/wallet/stamps',{method:'POST',headers,body:JSON.stringify(body)}),404,'NOT_FOUND');
 await status(h,new Request(origin+'/v1/loyalty/stamps',{method:'POST',headers,body:JSON.stringify(body)}),404,'NOT_FOUND');
 await status(h,new Request('https://wrong.example/api/v1/loyalty/stamps',{method:'POST',headers,body:JSON.stringify(body)}),404,'NOT_FOUND');
 const method=await status(h,new Request(origin+'/api/v1/loyalty/stamps'),405,'METHOD_NOT_ALLOWED');assert.equal(method.headers.get('allow'),'POST');
 await status(h,request({headers:{...headers,Origin:'https://other.example'}}),403,'ORIGIN_NOT_ALLOWED');
 for(const auth of ['', 'Basic abc','Bearer a.b.c, Bearer d.e.f','Bearer a.b.c extra'])await status(h,request({headers:{...headers,Authorization:auth,Cookie:'session=not-an-identity'}}),401,'UNAUTHORIZED');
 await status(h,request({headers:{...headers,'Idempotency-Key':'short'}}),400,'INVALID_IDEMPOTENCY_KEY');assert.equal(calls.length,0);
});
test('body type, byte lengths, timeout, abort and normalized-header caps are finite',async()=>{
 const {make,calls}=fixture({maxBodyBytes:256,bodyTimeoutMs:10});const h=make();
 await status(h,request({headers:{...headers,'Content-Type':'application/jsonjunk'}}),415,'UNSUPPORTED_MEDIA_TYPE');
 await status(h,request({headers:{...headers,'Content-Encoding':'gzip'}}),415,'UNSUPPORTED_CONTENT_ENCODING');
 await status(h,request({headers:{...headers,'Content-Length':'999'}}),413,'BODY_TOO_LARGE');
 await status(h,request({headers:{...headers,'Content-Length':'2'}}),400,'INVALID_CONTENT_LENGTH');
 await status(h,request({body:' '.repeat(257)}),413,'BODY_TOO_LARGE');
 await status(h,request({headers:{...headers,'X-Large':'a'.repeat(9000)}}),431,'HEADERS_TOO_LARGE');
 let cancelled=false;
 const stream=new ReadableStream({cancel(){cancelled=true;}});
 await status(h,request({body:stream,duplex:'half'}),408,'REQUEST_TIMEOUT');assert.equal(cancelled,true);
 const controller=new AbortController();controller.abort();
 await status(h,request({signal:controller.signal}),400,'REQUEST_ABORTED');assert.equal(calls.length,0);
});
test('backend errors are stable and secrets/internal messages do not escape',async()=>{
 const {make,ledger}=fixture();
 for(const [code,n]of [['UNAUTHORIZED',401],['FORBIDDEN',403],['PASS_UNAVAILABLE',404],['COOLDOWN',409],['IDEMPOTENCY_CONFLICT',409]]){
  ledger.issueStamp=async()=>{const e=new Error('private backend message');e.name='LoyaltyError';e.code=code;throw e;};
  const r=await make()(request());assert.equal(r.status,n);assert.equal(JSON.stringify(await r.json()).includes('private'),false);
 }
 ledger.issueStamp=async()=>{throw new Error('database-password-must-not-leak');};
 const r=await make()(request());assert.deepEqual(await r.json(),{error:{code:'SERVICE_UNAVAILABLE',retryable:true}});assert.equal(r.status,503);
});
test('pass reads allow only one business query and no body/framing; malformed adapter result fails closed',async()=>{
 const {make,ledger}=fixture();const h=make();
 const get=tail=>new Request(origin+'/api/v1/loyalty/passes/'+card+tail,{headers:{Authorization:headers.Authorization}});
 await status(h,get('?businessId=merchant&businessId=other'),400,'INVALID_QUERY');
 await status(h,get('?businessId=merchant&extra=yes'),400,'INVALID_QUERY');
 await status(h,get(''),400,'INVALID_QUERY');
 await status(h,get('?businessId=merchant'),503,'SERVICE_UNAVAILABLE');
 ledger.issueStamp=async()=>({kind:'stamp',balance:'1',duplicate:false});await status(h,request(),503,'SERVICE_UNAVAILABLE');
});

test('empty immediate chunks hit a finite work cap with cancellation and zero dispatch',async()=>{
 const maxBodyBytes=256;const {calls,make}=fixture({maxBodyBytes});let emitted=0,cancelled=false;
 const stream=new ReadableStream({pull(c){emitted++;c.enqueue(new Uint8Array(0));},cancel(){cancelled=true;}});
 await status(make(),request({body:stream,duplex:'half'}),413,'BODY_WORK_LIMIT');
 assert.ok(emitted<=maxBodyBytes+35,'read budget plus finite stream prefetch');assert.equal(cancelled,true);assert.equal(calls.length,0);
});
test('absolute deadline rejects immediately fulfilled reads even while timer callback is starved',async()=>{
 const {calls,make}=fixture({bodyTimeoutMs:1});let cancelled=false;
 const payload=new TextEncoder().encode(JSON.stringify(body));
 const stream=new ReadableStream({pull(c){const until=performance.now()+6;while(performance.now()<until){} c.enqueue(payload);},cancel(){cancelled=true;}});
 await status(make(),request({body:stream,duplex:'half'}),408,'REQUEST_TIMEOUT');assert.equal(cancelled,true);assert.equal(calls.length,0);
});
test('immediate producer yields for asynchronous abort instead of monopolizing microtasks',async()=>{
 const {calls,make}=fixture();let emitted=0,cancelled=false;const controller=new AbortController();
 const stream=new ReadableStream({pull(c){emitted++;c.enqueue(new Uint8Array(0));},cancel(){cancelled=true;}});
 setImmediate(()=>controller.abort());
 await status(make(),request({body:stream,duplex:'half',signal:controller.signal}),400,'REQUEST_ABORTED');
 assert.ok(emitted<1000,'abort runs at a bounded yield, before the full work budget');assert.equal(cancelled,true);assert.equal(calls.length,0);
});
test('legitimate one-byte fragmentation is accepted and URL budget rejects before route dispatch',async()=>{
 const {calls,make}=fixture({maxBodyBytes:256});const payload=new TextEncoder().encode(JSON.stringify(body));let i=0;
 const stream=new ReadableStream({pull(c){if(i===payload.length)c.close();else {c.enqueue(payload.slice(i,i+1));i++;}}});
 await status(make(),request({body:stream,duplex:'half'}),200);assert.equal(calls.length,1);
 await status(make(),new Request(origin+'/api/v1/loyalty/stamps?x='+'x'.repeat(8192),{method:'POST',headers,body:JSON.stringify(body)}),414,'URI_TOO_LONG');assert.equal(calls.length,1);
});
