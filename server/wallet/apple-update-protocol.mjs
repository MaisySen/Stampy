import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { PASS_TYPE_IDENTIFIER } from '../../src/lib/pass.ts';

const opaque = /^[A-Za-z0-9_-]{22,80}$/;
const deviceId = /^[A-Za-z0-9_-]{16,128}$/;
const pushId = /^(?:[0-9a-f]{2}){16,128}$/i;
const limit = 1024 * 2;
const fixedHeaders = {'Cache-Control':'private, no-store', 'X-Content-Type-Options':'nosniff'};
const empty = (status) => new Response(null, {status, headers:fixedHeaders});
const json = (data) => new Response(JSON.stringify(data), {status:200, headers:{...fixedHeaders,'Content-Type':'application/json'}});
const mac = (key, data, encoding) => createHmac('sha256',key).update(data).digest(encoding);
const limits = /^(?:0|[1-9]\d{0,14})$/;
function canonicalRoot(value) {
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') throw new Error('A dedicated HTTPS Wallet origin is required.');
  return parsed.origin;
}
export function appleUpdateIdentity({origin, rootKey}) {
  if (!Buffer.isBuffer(rootKey) || rootKey.length !== 32) throw new Error('A 32-byte private Wallet update key is required.');
  const url = new URL(canonicalRoot(origin));
  const key = mac(rootKey, 'stampies:apple-update-auth:v1');
  const tokenFor = (id) => {if (typeof id !== 'string' || !opaque.test(id)) throw new Error('Invalid pass ID.');return mac(key,id,'base64url');};
  return Object.freeze({url,tokenFor});
}
function authorized(headers, serial, tokenFor) {
  const input = headers.get('Authorization');
  const auth=/^ApplePass ([A-Za-z0-9_-]{43})$/.exec(input ?? '')?.[1];
  return auth !== undefined && timingSafeEqual(Buffer.from(auth),Buffer.from(tokenFor(serial)));
}
async function pushTokenOf(req) {
  if (!/^application\/json(?:\s*;[^\r\n]*)?$/i.test(req.headers.get('Content-Type') ?? '')) return null;
  const length = req.headers.get('Content-Length');
  if (length !== null && (!/^\d{1,4}$/.test(length) || Number(length) > limit)) return null;
  const reader = req.body?.getReader();
  if (!reader) return null;
  try {
    const chunks=[]; let size=0;
    for (;;) {
      const c=await reader.read();if(c.done)break;
      size+=c.value.length; if(size>limit){ await reader.cancel();return null; }
      chunks.push(Buffer.from(c.value));
    }
    const o=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return typeof o?.pushToken==='string' && pushId.test(o.pushToken) ? o.pushToken.toLowerCase() : null;
  } catch {return null;} finally {reader.releaseLock();}
}
// Cryptographic domains are separate, with each ciphertext bound to its device/pass pair.
export function appleRegistrationProtection(rootKey){
  if (!Buffer.isBuffer(rootKey) || rootKey.length!==32) throw new Error('A 32-byte private Wallet update key is required.');
  const regKey=mac(rootKey,'stampies:apple-device:v1');
  const encKey=mac(rootKey,'stampies:apple-push-token:v1');
  function seal(device,serial,push){const iv=randomBytes(12), c=createCipheriv('aes-256-gcm',encKey,iv);c.setAAD(Buffer.from(`${device}:${serial}`));const encrypted=Buffer.concat([c.update(push,'utf8'),c.final()]);return Buffer.concat([iv,c.getAuthTag(),encrypted]);}
  function open(device,serial,blob){const b=Buffer.from(blob),c=createDecipheriv('aes-256-gcm',encKey,b.subarray(0,12));c.setAAD(Buffer.from(`${device}:${serial}`));c.setAuthTag(b.subarray(12,28));const push=Buffer.concat([c.update(b.subarray(28)),c.final()]).toString('utf8');if(!pushId.test(push))throw new Error('Invalid stored push token.');return push;}
  return Object.freeze({deviceKey:(id)=>mac(regKey,id,'hex'),seal,open});
}
export function createAppleUpdateHandler({identity,protection,signApple,getPass,listChanges,register,unregister}){
  async function handle(req) {
    try {
      const u=new URL(req.url);const p=u.pathname.split('/');
      if (u.protocol!=='https:' || u.origin!==identity.url.origin || p[1]!=='v1') return empty(404);
      if (p[2]==='passes' && p.length===5 && p[3]===PASS_TYPE_IDENTIFIER && opaque.test(p[4])) {
        if(req.method!=='GET')return empty(405);
        if(!authorized(req.headers,p[4],identity.tokenFor))return empty(401);
        const row=await getPass(p[4]);if(!row)return empty(404);
        return new Response(await signApple(row),{headers:{...fixedHeaders,'Content-Type':'application/vnd.apple.pkpass'}});
      }
      if(p[2]==='log' && p.length===3 && req.method==='POST')return empty(200); // Drop diagnostic payloads; never retain Apple device data.
      if(p[2]!=='devices' || !deviceId.test(p[3] ?? '') || p[4]!=='registrations' || p[5]!==PASS_TYPE_IDENTIFIER) return empty(404);
      const dev=protection.deviceKey(p[3]);
      if(p.length===6) {
        if(req.method!=='GET')return empty(405);
        const observed=u.searchParams.getAll('passesUpdatedSince');
        if(observed.length>1 || observed.length===1&&!limits.test(observed[0]))return empty(400);
        const found=await listChanges(dev,observed.length?Number(observed[0]):0);
        return found.length===0?empty(204):json({serialNumbers:found.map((x)=>x.serial),lastUpdated:String(found.at(-1).rev)});
      }
      const serial=p[6];if(p.length!==7||!opaque.test(serial ?? ''))return empty(404);
      if(req.method!=='POST' && req.method!=='DELETE')return empty(405);
      if(!authorized(req.headers,serial,identity.tokenFor))return empty(401);
      if(req.method==='DELETE')return empty(await unregister(dev,serial));
      const push=await pushTokenOf(req);if(!push)return empty(400);
      return empty(await register(dev,serial,push));
    }catch{return empty(503);}
  }
  return handle;
}
