import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAppleSigner, createGoogleSigner, createWalletIssueHandler } from '../server/wallet/signing.mjs';
import { createWalletTapBoundary } from '../server/wallet/tap.mjs';
const passId = 'fixture_pass_opaque_value_001';
const record = {passId, stamps: 3, timeZone: 'Australia/Sydney', program:{businessName:'Test Cafe', reward:'One coffee', target:9, brandColor:'#c9b8ff', cover:'solid', expiryIso:'2099-11-20'}};
const request = (path, token, method='POST') => new Request(`https://unit.example${path}`, {method, headers: token ? {Authorization:`Bearer ${token}`} : {}});
const shell = (bin, args, opt={}) => execFileSync(bin,args,{...opt,timeout:8000,maxBuffer:2*1024*1024,stdio:['ignore','pipe','pipe']});

test('Apple package hashes, signatures, format and chain verify independently', (t) => {
  const root = mkdtempSync(join(tmpdir(),'wallet-test-')); t.after(()=>rmSync(root,{recursive:true,force:true}));
  const p = (n)=>join(root,n), run = (args)=>shell('openssl',args);
  // Local throwaway test trust only. No real Apple key or certificate is read.
  run(['req','-new','-x509','-newkey','rsa:2048','-nodes','-days','2','-subj','/CN=Fixture root','-addext','basicConstraints=critical,CA:TRUE','-keyout',p('rk'),'-out',p('rc')]);
  run(['req','-new','-newkey','rsa:2048','-nodes','-subj','/CN=Fixture intermediate','-keyout',p('ik'),'-out',p('ir')]);
  writeFileSync(p('ica'),'basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign,cRLSign\n');
  run(['x509','-req','-in',p('ir'),'-CA',p('rc'),'-CAkey',p('rk'),'-set_serial','2','-days','2','-extfile',p('ica'),'-out',p('ic')]);
  run(['req','-new','-newkey','rsa:2048','-nodes','-subj','/UID=pass.au.fintex.stampies/OU=TEST123456/CN=Fixture wallet','-keyout',p('sk'),'-out',p('sr')]);
  writeFileSync(p('sca'),'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\n');
  run(['x509','-req','-in',p('sr'),'-CA',p('ic'),'-CAkey',p('ik'),'-set_serial','3','-days','2','-extfile',p('sca'),'-out',p('sc')]);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jKksAAAAASUVORK5CYII=','base64');
  const options={teamIdentifier:'TEST123456', certificatePath:p('sc'), privateKeyPath:p('sk'), intermediatePath:p('ic'),rootPath:p('rc'),assets:{'icon.png':png,'icon@2x.png':png}};
  const signApple=createAppleSigner(options);
  assert.throws(()=>createAppleSigner({...options,teamIdentifier:'WRONG12345'}),/trust chain/);
  assert.throws(()=>createAppleSigner({...options,privateKeyPath:p('ik')}),/do not match/);
  assert.throws(()=>signApple({...record,passId:'signed-by-guess'}),/Invalid pass/);
  assert.throws(()=>signApple(record,new Date('2000-01-01')),/validity/);
  writeFileSync(p('wallet.pkpass'), signApple(record));
  assert.match(shell('unzip',['-t',p('wallet.pkpass')]).toString(),/No errors detected/);
  const extract = (name) => shell('unzip',['-p',p('wallet.pkpass'),name]);
  const m=extract('manifest.json'); writeFileSync(p('manifest'),m);writeFileSync(p('sig'),extract('signature'));
  const flags=['cms','-verify','-inform','DER','-binary','-in',p('sig'),'-content',p('manifest'),'-CAfile',p('rc'),'-purpose','any'];
  assert.deepEqual(run(flags),m);
  const entries=JSON.parse(m); assert.deepEqual(Object.keys(entries).sort(),['icon.png','icon@2x.png','pass.json']);
  for (const [n,h] of Object.entries(entries)) assert.equal(h,createHash('sha1').update(extract(n)).digest('hex'));
  const pass=JSON.parse(extract('pass.json'));assert.equal(pass.teamIdentifier,'TEST123456');assert.equal(pass.backgroundColor,'rgb(201, 184, 255)');assert.equal(pass.barcodes[0].message,passId);assert.equal(pass.expirationDate,'2099-11-20T23:59:59+11:00');assert(!Object.hasOwn(pass,'nfc'));
  writeFileSync(p('manifest'),Buffer.concat([m,Buffer.from(' ')]));assert.throws(()=>run(flags),/verification failure/i);
});

test('Google Save JWT uses issuer class, opaque ID and a verifiable RS256 signature', (t) => {
  const root = mkdtempSync(join(tmpdir(),'wallet-test-'));t.after(()=>rmSync(root,{recursive:true,force:true}));const key=join(root,'key.pem');shell('openssl',['genpkey','-algorithm','RSA','-pkeyopt','rsa_keygen_bits:2048','-out',key]);
  const config={issuerId:'123456789', classId:'123456789.fixture', clientEmail:'fixture@project-example.iam.gserviceaccount.com', privateKeyPath:key,origin:'https://stampies.example'};
  assert.throws(()=>createGoogleSigner({...config,classId:'543216789.other'}),/issuer config/);
  const signGoogle=createGoogleSigner(config);
  const href=signGoogle(record,new Date('2026-11-20T00:00:00Z'));assert(href.startsWith('https://pay.google.com/gp/v/save/'));
  const [h,b,s] = href.split('/').at(-1).split('.'); assert(verify('RSA-SHA256',Buffer.from(`${h}.${b}`),createPublicKey(readFileSync(key)),Buffer.from(s,'base64url')));
  assert.equal(JSON.parse(Buffer.from(h,'base64url')).alg,'RS256');const data=JSON.parse(Buffer.from(b,'base64url'));assert.equal(data.aud,'google');assert.equal(data.typ,'savetowallet');assert.equal(data.payload.loyaltyObjects[0].classId,config.classId);assert.equal(data.payload.loyaltyObjects[0].id,`123456789.stampies-${passId}`);assert(!Object.hasOwn(data.payload.loyaltyObjects[0],'smartTapRedemptionValue'));
});

test('Wallet handler fails closed and only signs a trusted server record', async () => {
  const token='T'.repeat(43); let lookups=0, signs=0;
  const handler=createWalletIssueHandler({lookup:async (digest,platform)=>{ lookups++; assert.equal(digest,createHash('sha256').update(token).digest('hex'));assert.equal(platform,'/wallet/apple'); return record;},apple:(r)=>{signs++;assert.equal(r,record);return Buffer.from('fixture');}});
  assert.equal((await handler(request('/wallet/apple',null))).status,401);
  assert.equal((await handler(request('/wallet/apple',token,'GET'))).status,405);
  assert.equal((await handler(request('/wallet/google',token))).status,503);
  const good=await handler(request('/wallet/apple',token));assert.equal(good.status,200);assert.equal(good.headers.get('Content-Type'),'application/vnd.apple.pkpass');assert.equal(good.headers.get('Cache-Control'),'private, no-store');assert.equal(await good.text(),'fixture');assert.equal(lookups,1);assert.equal(signs,1);
  const noRecord=createWalletIssueHandler({lookup:async()=>null,apple:()=>assert.fail('No record must not be signed')});assert.equal((await noRecord(request('/wallet/apple',token))).status,404);
});

test('NFC defaults off; proof, time and transactional replay gate every stamp', async () => {
  const provider='apple-vas', issuedAt=60_000;const proof={provider, readerId:'fixture_reader_one', merchantId:'fixture_merchant_one', passId,eventId:'fixture_event_once',issuedAt};
  assert.throws(()=>createWalletTapBoundary({approved:[provider]}),/verified reader/);
  assert.equal((await createWalletTapBoundary({})(provider,proof)).status,'unavailable');
  let seen=false,redemptions=0;
  const tap=createWalletTapBoundary({approved:[provider],now:()=>issuedAt,verifyReader:async(p,x)=>x.authenticated===true ? x.fields : null,redeemOnce:async(v)=>{redemptions++;assert.equal(v.merchantId,proof.merchantId);if(seen)return 'already-processed';seen=true;return 'stamped';}});
  assert.equal((await tap(provider,proof)).status,'denied');
  assert.equal((await tap(provider,{authenticated:true,fields:{...proof,issuedAt:0}})).status,'denied');
  assert.equal((await tap('google-smart-tap',{authenticated:true,fields:proof})).status,'unavailable');
  const signed={authenticated:true,fields:proof}; assert.equal((await tap(provider,signed)).status,'stamped');assert.equal((await tap(provider,signed)).status,'already-processed');assert.equal(redemptions,2);
});
