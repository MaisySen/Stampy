// Actual raw HTTP over disposable 127.0.0.1:0 only. Ledger is explicitly a
// transport stub here; actual verifier/restricted PG composition is separate.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {connect} from 'node:net';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {createLoyaltyHttpHost} from '../server/api/http-host.mjs';
import {createLoyaltyHttpHandler} from '../server/api/loyalty-http.mjs';
const origin='https://api.example',card='33333333-3333-4333-8333-333333333333',place='44444444-4444-4444-8444-444444444444';
const body=JSON.stringify({businessId:'merchant',membershipId:card,locationId:place});
const raw=(target='/api/v1/loyalty/stamps',extra='',payload=body)=>`POST ${target} HTTP/1.1\r\nHost: api.example\r\nAuthorization: Bearer a.b.c\r\nContent-Type: application/json\r\nIdempotency-Key: request-0000000000000001\r\nContent-Length: ${Buffer.byteLength(payload)}\r\n${extra}\r\n${payload}`;
async function start(options={}){
 const calls=[];const ledger={issueStamp:async x=>{calls.push(x);return {kind:'stamp',balance:1,duplicate:false};},redeemReward:async()=>null,getMerchantPass:async()=>null};
 const host=createLoyaltyHttpHost({origin,handler:createLoyaltyHttpHandler({origin,ledger}),...options});
 assert.equal(host.server.listening,false);host.server.listen(0,'127.0.0.1');await once(host.server,'listening');
 assert.equal(host.server.address().address,'127.0.0.1');return {host,calls,port:host.server.address().port};
}
function exchange(port,text,{end=false}={}){
 return new Promise((resolve,reject)=>{
  const socket=connect({host:'127.0.0.1',port});let result='';const timer=setTimeout(()=>{socket.destroy();reject(new Error('Raw test deadline'));},2000);
  socket.on('data',x=>result+=x.toString());socket.once('connect',()=>{socket.write(text);if(end)socket.end();});
  socket.once('error',error=>{if(error.code!=='ECONNRESET'){clearTimeout(timer);reject(error);}});
  socket.once('close',()=>{clearTimeout(timer);resolve(result);});
 });
}
const code=text=>Number(/^HTTP\/1\.1 (\d+)/.exec(text)?.[1]??0);
async function idle(host){for(let i=0;i<100&&host.inspect().active;i++)await delay(5);assert.equal(host.inspect().active,0);}

test('raw host forwards exact canonical command/idempotency, health only, no legacy namespaces',async()=>{
 const f=await start();try{
  const ok=await exchange(f.port,raw());assert.equal(code(ok),200);assert.equal(f.calls.length,1);assert.equal(f.calls[0].idempotencyKey,'request-0000000000000001');assert.equal(f.calls[0].accessToken,'a.b.c');
  assert.match(ok,/connection: close/i);assert.match(ok,/no-store/i);
  for(const path of ['/wallet/stamps','/wallet/apple','/wallet/google','/v1/devices/example','/api/v1/loyalty/stamps/extra','/'])assert.equal(code(await exchange(f.port,raw(path))),404,path);
  assert.equal(f.calls.length,1);
  assert.equal(code(await exchange(f.port,'GET /healthz HTTP/1.1\r\nHost: api.example\r\n\r\n')),204);
  assert.equal(code(await exchange(f.port,raw('/api/v1/loyalty/stamps','Origin: https://other.example\r\n'))),403);assert.equal(f.calls.length,1);
 }finally{await f.host.close();assert.deepEqual(f.host.inspect(),{active:0,connections:0,closing:true});}
});
test('raw header duplicates, framing, target/host and unsupported negotiation reject before dispatch',async()=>{
 const f=await start();try{
  const bad=[
   [raw().replace('Host: api.example','Host: wrong.example'),404],
   [raw('https://api.example/api/v1/loyalty/stamps'),404],
   [raw('/api/v1/loyalty/%73tamps'),404],
   [raw('/api/v1/loyalty/../loyalty/stamps'),404],
   [raw().replace('Host: api.example','Host: api.example\r\nHost: api.example'),400],
   [raw('/api/v1/loyalty/stamps','Authorization: Bearer d.e.f\r\n'),400],
   [raw('/api/v1/loyalty/stamps','Idempotency-Key: request-0000000000000002\r\n'),400],
   [raw('/api/v1/loyalty/stamps','Content-Length: 1\r\n'),400],
   [raw('/api/v1/loyalty/stamps','Transfer-Encoding: chunked\r\n'),400],
   [raw().replace(/Content-Length: \d+\r\n/,''),411],
   [raw().replace(/Content-Length: \d+\r\n/,'Transfer-Encoding: chunked\r\n'),400],
   [raw('/api/v1/loyalty/stamps','Expect: 100-continue\r\n'),417],
   [raw('/api/v1/loyalty/stamps','Connection: Upgrade\r\nUpgrade: websocket\r\n'),400],
   ['CONNECT api.example:443 HTTP/1.1\r\nHost: api.example\r\n\r\n',405],
   [raw().replace(/Content-Length: \d+/,'Content-Length: 8193'),413],
   [raw('/api/v1/loyalty/stamps','X-Large: '+'a'.repeat(9000)+'\r\n'),431],
  ];for(const [input,expected]of bad)assert.equal(code(await exchange(f.port,input)),expected,input.slice(0,80));assert.equal(f.calls.length,0);
 }finally{await f.host.close();}
});
test('stalled body absolute timeout, incomplete header and disconnect cannot dispatch',async()=>{
 const f=await start({bodyTimeoutMs:30,headerTimeoutMs:40});try{
  const partial=raw().slice(0,-body.length)+'{';assert.equal(code(await exchange(f.port,partial)),408);
  assert.equal(await exchange(f.port,'POST /api/v1/loyalty/stamps HTTP/1.1\r\nHost: api'), '');
  const socket=connect({host:'127.0.0.1',port:f.port});await once(socket,'connect');socket.write(partial);await delay(5);socket.destroy();await once(socket,'close');await idle(f.host);assert.equal(f.calls.length,0);
  assert.equal(code(await exchange(f.port,raw())),200);
 }finally{await f.host.close();}
});
test('overload has no waiting queue; timed-out operation retains slot until actual settlement',async()=>{
 let release,entered;const inside=new Promise(r=>entered=r);let count=0;
 const f=await start({maxInFlight:1,maxConnections:4,operationTimeoutMs:30,handler:async()=>{count++;entered();await new Promise(r=>release=r);return Response.json({ok:true});}});
 try{
  const first=exchange(f.port,raw());await inside;assert.equal(f.host.inspect().active,1);
  assert.equal(code(await exchange(f.port,raw())),503);assert.equal(count,1);
  assert.equal(code(await first),503);assert.equal(f.host.inspect().active,1);
  assert.equal(code(await exchange(f.port,raw())),503);assert.equal(count,1);
  release();await idle(f.host);
 }finally{release?.();await f.host.close();}
});
test('response stream byte/work budgets reject and cancel; internal headers never escape',async()=>{
 let cancelled=false;const f=await start({handler:async()=>new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array(4097));},cancel(){cancelled=true;}}),{headers:{'X-Internal-Secret':'must-not-leak','Set-Cookie':'bad=value'}})});
 try{const text=await exchange(f.port,raw());assert.equal(code(text),503);assert.equal(cancelled,true);assert.equal(text.includes('must-not-leak'),false);assert.equal(text.includes('bad=value'),false);}finally{await f.host.close();}
});
test('connection cap and explicit close remove sockets and settle partial-body jobs',async()=>{
 const f=await start({maxInFlight:1,maxConnections:2,headerTimeoutMs:1000});const held=[];
 try{
  for(let i=0;i<2;i++){const s=connect({host:'127.0.0.1',port:f.port});held.push(s);await once(s,'connect');}
  const overflow=connect({host:'127.0.0.1',port:f.port});overflow.on('error',()=>{});await once(overflow,'close');assert.equal(f.host.inspect().connections,2);
  for(const s of held)s.destroy();await delay(10);
  const s=connect({host:'127.0.0.1',port:f.port});held.push(s);await once(s,'connect');s.write(raw().slice(0,-body.length)+'{');await delay(5);assert.equal(f.host.inspect().active,1);
  await f.host.close();assert.deepEqual(f.host.inspect(),{active:0,connections:0,closing:true});assert.equal(f.host.server.listening,false);
 }finally{for(const s of held)s.destroy();await f.host.close();}
});

test('host monotonic operation deadline catches timer-starved handler; untrusted forwarding/cookie headers stay out',async()=>{
 let seen;const f=await start({operationTimeoutMs:10,handler:async req=>{seen=req;const end=performance.now()+25;while(performance.now()<end){}return Response.json({ok:true});}});
 try{assert.equal(code(await exchange(f.port,raw('/api/v1/loyalty/stamps','Cookie: session=fake\r\nForwarded: host=evil.example\r\nX-Forwarded-Host: evil.example\r\n'))),503);for(const k of ['cookie','forwarded','x-forwarded-host'])assert.equal(seen.headers.has(k),false);}finally{await f.host.close();}
});

test('pipelining while a write is in flight destroys connection, not an unbounded response queue',async()=>{
 for(const next of [raw(),raw('/api/v1/loyalty/stamps','Expect: 100-continue\r\n')]){
  let entered,release,calls=0;const inside=new Promise(r=>entered=r);
  const f=await start({handler:async()=>{calls++;entered();await new Promise(r=>release=r);return Response.json({ok:true});}});
  const socket=connect({host:'127.0.0.1',port:f.port});socket.on('error',()=>{});
  try{await once(socket,'connect');socket.write(raw());await inside;const closed=once(socket,'close');socket.write(next.repeat(200));await closed;assert.equal(calls,1);assert.equal(f.host.inspect().active,1);release();await idle(f.host);}finally{release?.();socket.destroy();await f.host.close();}
 }
});
