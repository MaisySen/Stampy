import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync, sign} from 'node:crypto';
import {createOidcAccessTokenVerifier} from '../server/auth/oidc-jwt.mjs';
import {createMerchantStampAuthorizer} from '../server/auth/merchant-stamp-authorizer.mjs';
import {createPostgresMerchantMembershipStore} from '../server/auth/postgres/membership-store.mjs';

const issuer = 'https://auth.stampies.example/';
const audience = 'https://api.stampies.example';
const jwksUri = issuer + '.well-known/jwks.json';
const time = 2000000000;
const now = () => time * 1000;
const {publicKey, privateKey} = generateKeyPairSync('rsa', {modulusLength: 2048});
const publicJwk = {...publicKey.export({format: 'jwk'}), kid: 'test-1', alg: 'RS256', use: 'sig'};
const defaultClaims = () => ({iss: issuer, aud: audience, sub: 'oidc|cashier1', iat: time - 30, exp: time + 300});

function token(claims = defaultClaims(), header = {}, key = privateKey) {
  const headerPart = Buffer.from(JSON.stringify({typ: 'JWT', alg: 'RS256', kid: 'test-1', ...header})).toString('base64url');
  const payloadPart = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const input = headerPart + '.' + payloadPart;
  return input + '.' + sign('RSA-SHA256', Buffer.from(input), key).toString('base64url');
}

function verifierFixture() {
  let count = 0;
  let keys = [publicJwk];
  const verifyAccessToken = createOidcAccessTokenVerifier({
    issuer, audience, jwksUri, clock: now,
    fetchImpl: async () => {
      count++;
      return Response.json({keys});
    },
  });
  return {verifyAccessToken, calls: () => count, setKeys: (value) => { keys = value; }};
}

test('OIDC verifier accepts a signed, issuer-pinned, correctly scoped short-lived RS256 access token', async () => {
  const f = verifierFixture();
  const claims = await f.verifyAccessToken(token());
  assert.equal(claims.sub, 'oidc|cashier1');
  assert.equal(f.calls(), 1);
  assert.equal((await f.verifyAccessToken(token())).sub, 'oidc|cashier1');
  assert.equal(f.calls(), 1, 'fresh JWKS is cached');
});

test('OIDC verifier rejects bad signature, payload tampering and unsafe JOSE algorithms/headers', async () => {
  const f = verifierFixture();
  assert.equal(await f.verifyAccessToken(token(defaultClaims(), {alg: 'none'})), null);
  assert.equal(await f.verifyAccessToken(token(defaultClaims(), {jku: 'https://attacker.invalid/jwks'})), null);
  const signed = token();
  const parts = signed.split('.');
  parts[1] = Buffer.from(JSON.stringify({...defaultClaims(), sub: 'oidc|other'})).toString('base64url');
  assert.equal(await f.verifyAccessToken(parts.join('.')), null);
  const otherKey = generateKeyPairSync('rsa', {modulusLength: 2048}).privateKey;
  assert.equal(await f.verifyAccessToken(token(defaultClaims(), {}, otherKey)), null);
  assert.equal(await f.verifyAccessToken('not.a.jwt'), null);
});

test('OIDC verifier refuses expired, future, long-lived, wrong issuer or wrong audience tokens', async () => {
  const f = verifierFixture();
  const rejected = [
    {iss: 'https://evil.example/'},
    {aud: 'https://different.example'},
    {exp: time - 120},
    {iat: time + 120},
    {iat: time - 6000, exp: time + 100},
    {nbf: time + 120},
    {sub: ''},
  ];
  for (const change of rejected) {
    assert.equal(await f.verifyAccessToken(token({...defaultClaims(), ...change})), null, JSON.stringify(change));
  }
});

test('OIDC verifier refreshes for rotated key IDs, and fails closed on missing JWKS keys', async () => {
  const f = verifierFixture();
  assert.equal((await f.verifyAccessToken(token())).sub, 'oidc|cashier1');
  f.setKeys([{...publicJwk, kid: 'test-2'}]);
  assert.equal(await f.verifyAccessToken(token(defaultClaims(), {kid: 'unknown'})), null);
  assert.equal(f.calls(), 2);
  // A missing key never becomes valid merely because it names the same issuer.
  assert.equal(await f.verifyAccessToken(token(defaultClaims(), {kid: 'unknown'})), null);
});

test('OIDC verifier rejects duplicate JWKS key IDs and unusable JWKS bodies', async () => {
  const duplicate = createOidcAccessTokenVerifier({
    issuer, audience, jwksUri, clock: now,
    fetchImpl: async () => Response.json({keys: [publicJwk, publicJwk]}),
  });
  assert.equal(await duplicate(token()), null);
  const malformed = createOidcAccessTokenVerifier({
    issuer, audience, jwksUri, clock: now,
    fetchImpl: async () => new Response('{not-valid-json'),
  });
  assert.equal(await malformed(token()), null);
});

test('OIDC verifier rejects unsafe issuer / JWKS configuration and untrusted fetch failure', async () => {
  assert.throws(() => createOidcAccessTokenVerifier({
    issuer, audience, jwksUri: 'https://evil.example/jwks',
  }), /Invalid OIDC/);
  assert.throws(() => createOidcAccessTokenVerifier({
    issuer: 'http://auth.example/', audience, jwksUri: 'http://auth.example/jwks',
  }), /Invalid OIDC/);
  const failed = createOidcAccessTokenVerifier({
    issuer, audience, jwksUri, clock: now,
    fetchImpl: async () => { throw new Error('Provider down'); },
  });
  assert.equal(await failed(token()), null);
});

test('merchant identity store uses parameterised, active-state-aware merchant lookup', async () => {
  const queries = [];
  const store = createPostgresMerchantMembershipStore({
    pool: {query: async (sql, params) => {
      queries.push({sql, params});
      return {rows: [{businessId: 'cafe-1', merchantStatus: 'active', memberStatus: 'active', role: 'staff'}]};
    }},
  });
  const member = await store.lookupMembership({issuer, subject: 'oidc|cashier1', businessId: 'cafe-1'});
  assert.deepEqual(member, {businessId: 'cafe-1', merchantStatus: 'active', memberStatus: 'active', role: 'staff'});
  assert.deepEqual(queries[0].params, [issuer, 'oidc|cashier1', 'cafe-1']);
  assert.match(queries[0].sql, /ms\.issuer = \$1 AND ms\.subject = \$2 AND m\.business_id = \$3/);
  assert.equal(await store.lookupMembership({issuer, subject: 'oidc|cashier1', businessId: 'bad!id'}), null);
  assert.equal(queries.length, 1);
  assert.throws(() => createPostgresMerchantMembershipStore(), /read-only Postgres/);
});

test('merchant stamp authorizer requires the verified identity and current staff role for the exact merchant', async () => {
  const f = verifierFixture();
  const queries = [];
  const pool = {query: async (sql, params) => {
    queries.push(params);
    return {rows: [{
      businessId: params[2], merchantStatus: 'active', memberStatus: 'active', role: 'staff',
    }]};
  }};
  const {lookupMembership} = createPostgresMerchantMembershipStore({pool});
  const authorizeStamp = createMerchantStampAuthorizer({
    verifyAccessToken: f.verifyAccessToken, lookupMembership,
  });
  const request = new Request('https://wallet.example/wallet/stamps', {
    headers: {Authorization: 'Bearer ' + token()},
  });
  assert.equal(await authorizeStamp({request, stamp: {businessId: 'cafe-1'}}), true);
  assert.deepEqual(queries[0], [issuer, 'oidc|cashier1', 'cafe-1']);
  assert.equal(await authorizeStamp({request: new Request(request.url), stamp: {businessId: 'cafe-1'}}), false);
  assert.equal(await authorizeStamp({request, stamp: {businessId: 'bad!id'}}), false);
  assert.equal(queries.length, 1, 'invalid caller and business never query database');
});

test('merchant stamp authorizer denies revoked, suspended, invited, viewer and cross-merchant accounts', async () => {
  const f = verifierFixture();
  let record = {businessId: 'cafe-1', merchantStatus: 'active', memberStatus: 'active', role: 'manager'};
  const authorizeStamp = createMerchantStampAuthorizer({
    verifyAccessToken: f.verifyAccessToken,
    lookupMembership: async () => record,
  });
  const request = new Request('https://wallet.example/wallet/stamps', {
    headers: {Authorization: 'Bearer ' + token()},
  });
  const allowed = () => authorizeStamp({request, stamp: {businessId: 'cafe-1'}});
  assert.equal(await allowed(), true);
  for (const delta of [
    {role: 'viewer'}, {memberStatus: 'revoked'}, {memberStatus: 'suspended'},
    {memberStatus: 'invited'}, {merchantStatus: 'suspended'},
    {merchantStatus: 'closed'}, {businessId: 'other-cafe'},
  ]) {
    record = {...record, ...delta};
    assert.equal(await allowed(), false, JSON.stringify(delta));
    record = {businessId: 'cafe-1', merchantStatus: 'active', memberStatus: 'active', role: 'manager'};
  }
  const failedStore = createMerchantStampAuthorizer({
    verifyAccessToken: f.verifyAccessToken,
    lookupMembership: async () => {throw new Error('database unavailable');},
  });
  assert.equal(await failedStore({request, stamp: {businessId: 'cafe-1'}}), false);
  assert.throws(() => createMerchantStampAuthorizer({verifyAccessToken: f.verifyAccessToken}), /membership lookup/);
});

test('JWKS transport refuses redirects and caps actual streamed bytes/work with cancellation',async()=>{
 let options,cancelled=false;
 const large=createOidcAccessTokenVerifier({issuer,audience,jwksUri,clock:now,fetchImpl:async(_url,opts)=>{options=opts;return new Response(new ReadableStream({pull(c){c.enqueue(new Uint8Array(65537));},cancel(){cancelled=true;}}));}});
 assert.equal(await large(token()),null);assert.equal(options.redirect,'error');assert.equal(cancelled,true);
 const redirected=createOidcAccessTokenVerifier({issuer,audience,jwksUri,clock:now,fetchImpl:async()=>Response.redirect('https://other.example/keys',302)});
 assert.equal(await redirected(token()),null);
 let reads=0,emptyCancelled=false;
 const empty=createOidcAccessTokenVerifier({issuer,audience,jwksUri,clock:now,jwksTimeoutMs:1000,fetchImpl:async()=>new Response(new ReadableStream({pull(c){reads++;c.enqueue(new Uint8Array(0));},cancel(){emptyCancelled=true;}}))});
 assert.equal(await empty(token()),null);assert.ok(reads<=65571);assert.equal(emptyCancelled,true);
});
test('JWKS fetch and body stall expire even when custom fetch ignores AbortSignal',async()=>{
 let signal,cancelled=false;
 const fetchStall=createOidcAccessTokenVerifier({issuer,audience,jwksUri,clock:now,jwksTimeoutMs:20,fetchImpl:async(_url,opts)=>{signal=opts.signal;return new Promise(()=>{});}});
 assert.equal(await fetchStall(token()),null);assert.equal(signal.aborted,true);
 const bodyStall=createOidcAccessTokenVerifier({issuer,audience,jwksUri,clock:now,jwksTimeoutMs:20,fetchImpl:async()=>new Response(new ReadableStream({cancel(){cancelled=true;}}))});
 assert.equal(await bodyStall(token()),null);assert.equal(cancelled,true);
});

test('JWKS absolute deadline detects timer-starved fetch and cancels late ignored-abort responses',async()=>{
 let cancelled=false,release;
 const starved=createOidcAccessTokenVerifier({issuer,audience,jwksUri,clock:now,jwksTimeoutMs:10,fetchImpl:async()=>{const end=performance.now()+25;while(performance.now()<end){}return Response.json({keys:[publicJwk]});}});
 assert.equal(await starved(token()),null);
 const late=createOidcAccessTokenVerifier({issuer,audience,jwksUri,clock:now,jwksTimeoutMs:10,fetchImpl:()=>new Promise(r=>release=r)});
 assert.equal(await late(token()),null);release(new Response(new ReadableStream({cancel(){cancelled=true;}})));
 await new Promise(r=>setImmediate(r));assert.equal(cancelled,true);
});
