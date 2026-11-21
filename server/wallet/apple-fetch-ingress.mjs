import { PASS_TYPE_IDENTIFIER } from '../../src/lib/pass.ts';

export const APPLE_WALLET_ORIGIN = 'https://stampies.multies.si';
const serial = /^[A-Za-z0-9_-]{22,80}$/;
const device = /^[A-Za-z0-9_-]{16,128}$/;
const quiet = {'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff'};
const requestHeaders = ['authorization','content-type','if-modified-since'];
const responseHeaders = ['allow','content-disposition','content-type','last-modified'];
const empty = (status, fields) => new Response(null,{status,headers:{...quiet,...fields}});
const methods = {
  issue: ['POST'], pass: ['GET'], list: ['GET'], registration: ['POST', 'DELETE'], diagnostics: ['POST'],
};
function route({pathname:p, search}) {
  if (p === '/wallet/apple') return search ? null : 'issue';
  if (p === '/v1/log') return search ? null : 'diagnostics';
  const parts = p.split('/');
  if (parts[1] !== 'v1') return null;
  if (parts[2] === 'passes' && parts.length === 5 && parts[3] === PASS_TYPE_IDENTIFIER && serial.test(parts[4])) return search ? null : 'pass';
  if (parts[2] !== 'devices' || !device.test(parts[3] ?? '') || parts[4] !== 'registrations' || parts[5] !== PASS_TYPE_IDENTIFIER) return null;
  if (parts.length === 6) return !search || /^\?passesUpdatedSince=(?:0|[1-9]\d{0,14})$/.test(search) ? 'list' : null;
  return parts.length === 7 && serial.test(parts[6]) && !search ? 'registration' : null;
}
async function readAtMost(stream, n) {
  if (!stream) return {body:undefined};
  const reader = stream.getReader();
  const buffer = new Uint8Array(n);
  let size = 0;
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) return {body:buffer.slice(0,size)};
      if (!(value instanceof Uint8Array)) return {error:400};
      if (value.byteLength > n-size) {
        void reader.cancel().catch(() => {});
        return {error:413};
      }
      buffer.set(value,size); size+=value.byteLength;
    }
  } catch { return {error:400}; }
  finally { reader.releaseLock(); }
}
// Fetch-style Functions boundary. It does not load a signer, initialise a database,
// add a domain, grant passes, emit logs or enable a public deployment.
export function createAppleFetchIngress(service) {
  if (typeof service?.handle !== 'function') throw new TypeError('Wallet service is required.');
  return async (request) => {
    try {
      const url = new URL(request.url);
      if (url.origin !== APPLE_WALLET_ORIGIN || url.username || url.password || url.hash) return empty(404);
      const kind = route(url);
      if (!kind) return empty(404);
      if (!methods[kind].includes(request.method)) return empty(405,{Allow:methods[kind].join(', ')});
      const acceptBody = request.method === 'POST' && (kind === 'registration' || kind === 'diagnostics');
      const length = request.headers.get('content-length');
      if (length !== null && !/^(?:0|[1-9]\d*)$/.test(length)) return empty(400);
      if (!acceptBody && (request.body || Number(length) > 0)) return empty(400);
      if (kind === 'diagnostics') return empty(200); // Deliberately discard without reading or relaying.
      if (length !== null && Number(length)>2048) return empty(413);
      const headers = new Headers();
      for (const key of requestHeaders) {
        const value = request.headers.get(key);
        if (value !== null) {
          if (value.length>1024 || (key === 'authorization' && value.includes(','))) return empty(400);
          headers.set(key,value);
        }
      }
      const {body,error} = acceptBody ? await readAtMost(request.body,2048) : {};
      if (error) return empty(error);
      if (body) {
        if (length !== null && Number(length)!==body.byteLength) return empty(400);
        headers.set('content-length',String(body.byteLength));
      }
      const result = await service.handle(new Request(url,{method:request.method,headers,body,signal:request.signal}));
      if (!(result instanceof Response) || (result.status >= 300 && result.status < 400 && result.status !== 304)) return empty(503);
      const outgoing = new Headers(quiet);
      for (const h of responseHeaders) { const v = result.headers.get(h); if (v !== null) outgoing.set(h,v); }
      return new Response(result.body,{status:result.status,headers:outgoing});
    } catch { return empty(503); }
  };
}
