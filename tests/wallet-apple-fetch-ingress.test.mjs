import assert from 'node:assert/strict';
import {test} from 'node:test';
import {APPLE_WALLET_ORIGIN as origin,createAppleFetchIngress} from '../server/wallet/apple-fetch-ingress.mjs';
import {appleRegistrationProtection, appleUpdateIdentity, createAppleUpdateHandler} from '../server/wallet/apple-update-protocol.mjs';
import {PASS_TYPE_IDENTIFIER as type} from '../src/lib/pass.ts';
const id = 'A'.repeat(24), dev = 'B'.repeat(24), registration = `/v1/devices/${dev}/registrations/${type}/${id}`;
const listing = registration.slice(0, -(id.length+1));
const pass = `/v1/passes/${type}/${id}`;
const req = (path,init) => new Request(origin+path,init);
const noStore = r => { assert.equal(r.headers.get('cache-control'),'private, no-store'); assert.equal(r.headers.get('referrer-policy'),'no-referrer'); };
const pkpass = Uint8Array.of(80,75,3,4,0,255);

test('bound Functions route delegates only intended Apple methods and request headers', async () => {
 let count = 0;
 const fn=createAppleFetchIngress({async handle(q){
   count++; assert.equal(new URL(q.url).origin,origin);
   assert.equal(q.headers.get('authorization'),'Bearer synthetic');
   for (const k of ['cookie','x-forwarded-host','x-forwarded-proto','origin']) assert.equal(q.headers.get(k),null);
   return new Response(pkpass,{headers:{'content-type':'application/vnd.apple.pkpass','Cache-Control':'public','set-cookie':'synthetic=1','X-Debug':'private'}});
 }});
 const input={method:'POST',headers:{authorization:'Bearer synthetic',cookie:'synthetic=2','x-forwarded-host':'unrelated.invalid','x-forwarded-proto':'http',origin:'https://unrelated.invalid'}};
 const r=await fn(req('/wallet/apple', input)); assert.equal(r.status,200); assert.equal(r.headers.get('content-type'),'application/vnd.apple.pkpass');
 assert.deepEqual(new Uint8Array(await r.arrayBuffer()),pkpass); noStore(r); assert.equal(r.headers.get('set-cookie'),null); assert.equal(r.headers.get('x-debug'),null); assert.equal(count,1);
});

test('only the configured HTTPS origin and Apple routes can reach the service', async () => {
 const fn=createAppleFetchIngress({handle(){assert.fail('unexpected delegation');}});
 for (const u of [new Request('https://other.invalid/wallet/apple',{method:'POST'}),new Request('http://stampies.multies.si/wallet/apple',{method:'POST'}),
  req('/wallet/google',{method:'POST'}), req('/wallet/mint',{method:'POST'}), req('/healthz'), req('/.netlify/functions/apple-wallet'), req('/v1/'),
  req('/wallet/apple?test=1',{method:'POST'}), req(listing+'?passesUpdatedSince=0&passesUpdatedSince=1')]) {
   const r=await fn(u); assert.equal(r.status,404); noStore(r);
 }
 const wrong=await fn(req('/wallet/apple')); assert.equal(wrong.status,405); assert.equal(wrong.headers.get('allow'),'POST');
});

test('validates a registration body; never reads and never forwards diagnostic body', async () => {
 let calls=0;
 const fn=createAppleFetchIngress({async handle(q){calls++; assert.equal(q.headers.get('content-length'),'5'); assert.equal(await q.text(),'hello'); return new Response(null,{status:201});}});
 for (const [path,body,expect] of [[registration,'hello',201],[registration,'x'.repeat(2049),413],['/wallet/apple','hello',400],['/v1/log','diagnostic body',200]]) {
   const r=await fn(req(path,{method:'POST',headers:{'content-type':'application/json'},body})); assert.equal(r.status,expect); noStore(r);
 }
 assert.equal(calls,1);
});

test('Apple registration, refresh, download and unregister reach the existing protocol',async () => {
 const key=Buffer.alloc(32,9), identity=appleUpdateIdentity({origin,rootKey:key}), protection=appleRegistrationProtection(key); let reg=null;
 const seen=[];
 const handle=createAppleUpdateHandler({identity,protection,signApple:async row=>{assert.equal(row.passId,id);return pkpass;},
   getPass:async s=>s===id?{passId:id}:null,
   listChanges:async (d,since)=>{assert.equal(d,protection.deviceKey(dev));return reg&&since<7?[{serial:id,rev:7}]:[];},
   register:async (d,s,p)=>{assert.equal(d,protection.deviceKey(dev));assert.equal(s,id);reg=p;seen.push('registered');return 201;},
   unregister:async (d,s)=>{assert.equal(d,protection.deviceKey(dev));assert.equal(s,id);reg=null;seen.push('unregistered');return 200;}});
 const fn=createAppleFetchIngress({handle}); const h={authorization:'ApplePass '+identity.tokenFor(id)};
 assert.equal((await fn(req(registration,{method:'POST',headers:{'content-type':'application/json'},body:'{}'}))).status,401);
 assert.equal((await fn(req(registration,{method:'POST',headers:{...h,'content-type':'application/json'},body:JSON.stringify({pushToken:'c'.repeat(64)})}))).status,201);
 assert.deepEqual(await (await fn(req(listing+'?passesUpdatedSince=6'))).json(),{serialNumbers:[id],lastUpdated:'7'});
 assert.equal((await fn(req(listing+'?passesUpdatedSince=7'))).status,204);
 assert.equal((await fn(req(pass))).status,401);
 const r=await fn(req(pass,{headers:h})); assert.equal(r.status,200); assert.deepEqual(new Uint8Array(await r.arrayBuffer()),pkpass);
 assert.equal((await fn(req(registration,{method:'DELETE',headers:h}))).status,200);
 assert.equal((await fn(req(listing))).status,204); assert.deepEqual(seen,['registered','unregistered']);
});

test('generic failure without error disclosure or public redirects',async () => {
 for (const handle of [()=>{throw Error('synthetic detail');},()=>Response.redirect('https://example.invalid'),()=>null]) {
  const r=await createAppleFetchIngress({handle})(req(pass)); assert.equal(r.status,503); assert.equal(await r.text(),''); assert.equal(r.headers.get('location'),null); noStore(r);
 }
});
