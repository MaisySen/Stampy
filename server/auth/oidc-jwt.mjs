// Server-only OIDC access token verification. No identity or membership is
// inferred from client-supplied business IDs, Wallet passes, or display names.
// Supports RS256 access tokens with issuer-pinned HTTPS JWKS and short TTLs.
// Instantiate once per server; never call this from the Expo client.
import { createPublicKey, verify as verifySignature } from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {readBoundedStream} from '../api/bounded-stream.mjs';

const jwtPattern = /^[A-Za-z0-9_-]{1,2048}\.[A-Za-z0-9_-]{1,8192}\.[A-Za-z0-9_-]{1,2048}$/;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function parseObject(encoded) {
  const value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  if (!isObject(value)) throw new Error('Invalid token payload.');
  return value;
}

function validClaims(claims, {issuer, audience, clock, skew, maxAge}) {
  const now = Math.floor(clock() / 1000);
  if (!Number.isSafeInteger(now) || claims.iss !== issuer ||
      !(claims.aud === audience || (Array.isArray(claims.aud) && claims.aud.includes(audience))) ||
      typeof claims.sub !== 'string' || claims.sub.length < 1 || claims.sub.length > 255 ||
      !Number.isSafeInteger(claims.exp) || !Number.isSafeInteger(claims.iat) ||
      claims.iat < 0 || claims.iat > now + skew ||
      claims.exp <= now - skew || claims.exp <= claims.iat ||
      claims.exp - claims.iat > maxAge ||
      now - claims.iat > maxAge + skew ||
      (claims.nbf !== undefined && (!Number.isSafeInteger(claims.nbf) || claims.nbf > now + skew))) {
    return false;
  }
  return true;
}

export function createOidcAccessTokenVerifier({
  issuer, audience, jwksUri, fetchImpl = globalThis.fetch,
  clock = Date.now, clockSkewSeconds = 30,
  maxTokenAgeSeconds = 3600, cacheSeconds = 300, jwksTimeoutMs = 5000,
} = {}) {
  if (typeof issuer !== 'string' || typeof audience !== 'string' ||
      !audience.trim() || typeof jwksUri !== 'string' ||
      typeof fetchImpl !== 'function' || typeof clock !== 'function' ||
      !Number.isInteger(clockSkewSeconds) || clockSkewSeconds < 0 || clockSkewSeconds > 60 ||
      !Number.isInteger(maxTokenAgeSeconds) || maxTokenAgeSeconds < 60 || maxTokenAgeSeconds > 3600 ||
      !Number.isInteger(cacheSeconds) || cacheSeconds < 1 || cacheSeconds > 300 ||
      !Number.isInteger(jwksTimeoutMs) || jwksTimeoutMs < 1 || jwksTimeoutMs > 5000) {
    throw new Error('Invalid OIDC verifier configuration.');
  }
  let issuerUrl, jwksUrl;
  try {
    issuerUrl = new URL(issuer);
    jwksUrl = new URL(jwksUri);
    if (issuerUrl.protocol !== 'https:' || jwksUrl.protocol !== 'https:' ||
        issuerUrl.origin !== jwksUrl.origin || issuerUrl.username || issuerUrl.password ||
        jwksUrl.username || jwksUrl.password || jwksUrl.hash ||
        issuerUrl.toString() !== issuer) {
      throw new Error('OIDC issuer and JWKS must use the same trusted HTTPS origin.');
    }
  } catch {
    throw new Error('Invalid OIDC issuer or JWKS URI.');
  }

  let keys = new Map();
  let cachedUntil = 0;
  let inflight = null;
  async function refresh() {
    // One shared refresh keeps a burst of requests from triggering unbounded
    // JWKS traffic. Fail closed on unavailable or malformed trusted metadata.
    if (inflight) return inflight;
    inflight = (async () => {
      const deadline=performance.now()+jwksTimeoutMs;
      const checkpoint=()=>{if(performance.now()>=deadline)throw new Error('Trusted JWKS deadline');};
      const controller=new AbortController();
      let timer;
      const failure=new Promise((_,bad)=>{timer=setTimeout(()=>{
        controller.abort();bad(new Error('Trusted JWKS deadline'));
      },jwksTimeoutMs);});failure.catch(()=>{});
      let body,response;
      try {
        // Explicitly refuse redirects, including redirects within the issuer's
        // origin. A pinned URL cannot silently turn into another endpoint.
        const fetched=Promise.resolve().then(()=>fetchImpl(jwksUrl.toString(),{
          headers:{Accept:'application/json'},redirect:'error',signal:controller.signal,
        }));
        fetched.then(late=>{if(controller.signal.aborted){try{late?.body?.cancel().catch(()=>{});}catch{}}},()=>{});
        response=await Promise.race([fetched,failure]);checkpoint();
        if(!(response instanceof Response)||!response.ok||response.redirected||
            (response.url&&response.url!==jwksUrl.toString())||!response.body)throw new Error('Trusted JWKS unavailable');
        const declared=response.headers.get('content-length');
        if(declared!==null&&(!/^(?:0|[1-9][0-9]*)$/.test(declared)||Number(declared)>65536))throw new Error('JWKS too large');
        const image=await Promise.race([readBoundedStream(response.body,{
          maxBytes:65536,timeoutMs:Math.max(1,Math.floor(deadline-performance.now())),signal:controller.signal,
        }),failure]);
        checkpoint();body=new TextDecoder('utf-8',{fatal:true}).decode(image);
      } finally {clearTimeout(timer);controller.abort();try{response?.body?.cancel().catch(()=>{});}catch{}}
      const parsed = JSON.parse(body);checkpoint();
      if (!isObject(parsed) || !Array.isArray(parsed.keys) || parsed.keys.length > 50) {
        throw new Error('Invalid trusted JWKS.');
      }
      const refreshed = new Map();
      for (const jwk of parsed.keys) {
        if (!isObject(jwk) || typeof jwk.n!=='string'||jwk.n.length>1400||typeof jwk.e!=='string'||jwk.e.length>8||jwk.kty !== 'RSA' || typeof jwk.kid !== 'string' ||
            jwk.kid.length < 1 || jwk.kid.length > 200 ||
            (jwk.use !== undefined && jwk.use !== 'sig') ||
            (jwk.alg !== undefined && jwk.alg !== 'RS256')) continue;
        // Ambiguous key IDs invalidate the entire key set. Taking whichever
        // matching key appears first would make issuer key rotation unsafe.
        if (refreshed.has(jwk.kid)) throw new Error('Duplicate JWKS key id.');
        try {
          const key = createPublicKey({key: jwk, format: 'jwk'});
          if (key.asymmetricKeyType !== 'rsa' ||
              (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048 ||
              (key.asymmetricKeyDetails?.modulusLength ?? 0) > 8192) continue;
          refreshed.set(jwk.kid, key);
        } catch {
          // Invalid keys never become trusted.
        }
      }
      if (refreshed.size === 0) throw new Error('No valid JWKS signing keys.');
      checkpoint();keys = refreshed;
      cachedUntil = clock() + cacheSeconds * 1000;
    })();
    try { await inflight; } finally { inflight = null; }
  }

  return async function verifyAccessToken(token) {
    if (typeof token !== 'string' || token.length > 12288 || !jwtPattern.test(token)) return null;
    try {
      const [headerPart, bodyPart, signaturePart] = token.split('.');
      const header = parseObject(headerPart);
      if (header.alg !== 'RS256' || typeof header.kid !== 'string' ||
          header.kid.length < 1 || header.kid.length > 200 ||
          header.crit !== undefined || header.jwk !== undefined ||
          header.jku !== undefined || header.x5u !== undefined ||
          (header.typ !== undefined && header.typ !== 'JWT' && header.typ !== 'at+jwt')) return null;
      if (clock() >= cachedUntil || !keys.has(header.kid)) await refresh();
      const publicKey = keys.get(header.kid);
      if (!publicKey) return null;
      const signature = Buffer.from(signaturePart, 'base64url');
      if (!verifySignature('RSA-SHA256',
        Buffer.from(headerPart + '.' + bodyPart),
        publicKey, signature)) return null;
      const claims = parseObject(bodyPart);
      return validClaims(claims, {
        issuer, audience, clock, skew: clockSkewSeconds, maxAge: maxTokenAgeSeconds,
      }) ? claims : null;
    } catch {
      return null;
    }
  };
}
