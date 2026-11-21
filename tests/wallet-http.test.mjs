import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createWalletHttpServer } from '../server/wallet/http.mjs';
import { openWalletService } from '../server/wallet/service.mjs';

const origin = 'https://wallet.example';
const host = 'wallet.example';
const ownerId = 'fixture_owner_opaque_value_001';
const passId = 'fixture_pass_opaque_value_001';

async function start(options) {
  const server = createWalletHttpServer(options);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const sock = server.address();
  return { close: () => new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve())),
    call: (path, { method = 'GET', headers = {}, body = undefined } = {}) => new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: sock.port, path, method, agent: false,
        headers: { host, ...headers }, timeout: 3000 }, async reply => {
        try {
          const parts = [];
          for await (const chunk of reply) parts.push(chunk);
          resolve({status: reply.statusCode, headers: reply.headers, body: Buffer.concat(parts).toString()});
        } catch (err) { reject(err); }
      });
      req.once('timeout', () => req.destroy(new Error('test request timeout')));
      req.once('error', reject);
      req.end(body);
    }) };
}

test('Node TLS ingress adapter routes actual Wallet issuance, registration and refresh and preserves state across restart', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wallet-http-proof-'));
  let s, h, options, current = {version:1, record:{passId,stamps:3}};
  const cfg = {origin, tokenDbPath:join(dir,'tokens.db'),
    lookupOwnedPass: async row => row.ownerId === ownerId && row.passId === passId ? current : null,
    apple: {rootKey:Buffer.alloc(32,9), updateDbPath:join(dir,'updates.db'), loadCommittedPass:async id => id===passId ? current : null,
      makeSigner: auth => {options=auth; return record => Buffer.from(JSON.stringify({count:record.stamps}));}}};
  try {
    s = openWalletService(cfg); h = await start({origin,service:s});
    assert.equal((await h.call('/healthz')).status,204);
    assert.equal((await h.call('/v1/mint',{method:'POST'})).status,404);
    assert.equal((await h.call('/wallet/apple',{method:'POST'})).status,401);
    const grant = await s.mint({ownerId,passId,platform:'apple'});
    const bearer = { authorization:`Bearer ${grant.token}` };
    assert.equal((await h.call('/wallet/apple',{method:'POST',headers:{...bearer,host:'other.example','x-forwarded-host':host}})).status,404);
    const issued = await h.call('/wallet/apple',{method:'POST',headers:bearer});
    assert.equal(issued.status,200); assert.equal(issued.headers['content-type'],'application/vnd.apple.pkpass');
    assert.equal(issued.headers['cache-control'],'private, no-store'); assert.deepEqual(JSON.parse(issued.body),{count:3});
    assert.equal((await h.call('/wallet/apple',{method:'POST',headers:bearer})).status,404);
    const auth = {authorization:`ApplePass ${options.tokenFor(passId)}`};
    const reg = `/v1/devices/fixture_device_opaque/registrations/pass.au.fintex.stampies/${passId}`;
    assert.equal((await h.call(reg,{method:'POST',headers:{...auth,'content-type':'application/json'},body:JSON.stringify({pushToken:'b6'.repeat(32)})})).status,201);
    const pass = `/v1/passes/pass.au.fintex.stampies/${passId}`;
    assert.equal((await h.call(pass)).status,401);
    await h.close(); h=undefined; await s.close(); s=undefined;
    s=openWalletService(cfg); h=await start({origin,service:s});
    assert.deepEqual(JSON.parse((await h.call(pass,{headers:auth})).body),{count:3});
    current = {version:2,record:{passId,stamps:5}};
    assert.equal(await s.committedAppleChange(passId),true);
    assert.deepEqual(JSON.parse((await h.call(pass,{headers:auth})).body),{count:5});
  } finally { if(h) await h.close(); if(s) await s.close(); await rm(dir,{force:true,recursive:true}); }
});

test('Host health and request limits are handled at ingress without leaking errors', async () => {
  let calls=0;
  const h=await start({origin,service:{handle(){calls++;throw new Error('private detail');}}});
  try {
    assert.equal((await h.call('/healthz')).status,204);
    assert.equal((await h.call('/healthz?x=1')).status,404);
    const big='x'.repeat(8193);
    const refused=await h.call('/v1/log',{method:'POST',headers:{'content-length':big.length},body:big});
    assert.equal(refused.status,413); assert.equal(calls,0);
    const failed=await h.call('/wallet/apple',{method:'POST'});
    assert.equal(failed.status,503); assert.equal(failed.body,''); assert.equal(calls,1);
  } finally { await h.close(); }
});
