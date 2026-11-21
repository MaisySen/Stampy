// Google Wallet pass refresh. Apple refreshes a pass with an APNs
// wake and a device pull; Google has no push. The server updates the
// loyalty object in place through the Google Wallet API, and every
// device that saved the pass refreshes from Google.
//
// This is the Google half of the pass refresh, and it did not exist
// before: a stamp refreshed the Apple pass only, so a Google pass
// kept its old stamp count until it was reissued. The updater takes
// the same service account configuration as the Google signer, builds
// the same loyalty object, and PUTs it to the Wallet API.
//
// The updater never throws for a provider response. It returns a
// status: updated, not-found, denied, or retry. A bad local record
// throws, because that is a deployer bug, not a provider failure.
// No token, key, or pass payload is ever logged.
import { createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { googleLoyaltyObject } from './signing.mjs';

const tokenUrl = 'https://oauth2.googleapis.com/token';
const walletBase = 'https://walletobjects.googleapis.com/walletobjects/v1';
const scope = 'https://www.googleapis.com/auth/wallet_object.issuer';
const issuerPattern = /^[0-9]{8,40}$/;
const classPattern = /^[0-9]+\.[A-Za-z0-9_.-]{1,106}$/;
const emailPattern = /^[a-z0-9-]{3,64}@[a-z0-9-]{3,100}\.iam\.gserviceaccount\.com$/;
const b64 = (x) => Buffer.from(JSON.stringify(x)).toString('base64url');

// Configuration is the same shape as the Google signer in signing.mjs.
// fetchImpl is injectable so tests can fake Google without a network.
export function createGoogleWalletUpdater({issuerId, classId, clientEmail, privateKeyPath, origin, fetchImpl}) {
  if (!issuerPattern.test(issuerId ?? '') || !classId?.startsWith(`${issuerId}.`) || !classPattern.test(classId) ||
      !emailPattern.test(clientEmail ?? '')) throw new Error('Invalid Google Wallet issuer configuration.');
  const u = new URL(origin);
  if (u.protocol !== 'https:' || u.origin !== origin) throw new Error('Invalid Google Wallet origin.');
  const key = createPrivateKey(readFileSync(privateKeyPath));
  if (key.asymmetricKeyType !== 'rsa' || (createPublicKey(key).asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new Error('A 2048-bit or larger RSA service key is required.');
  const fetchFn = fetchImpl ?? globalThis.fetch;
  if (typeof fetchFn !== 'function') throw new Error('A Google Wallet HTTP transport is required.');
  let cached = null;
  async function accessToken(now) {
    const t = now.getTime();
    if (cached && cached.expiresAtMs > t + 60000) return cached.token;
    const iat = Math.floor(t / 1000);
    const header = b64({alg: 'RS256', typ: 'JWT'});
    const claims = b64({iss: clientEmail, scope, aud: tokenUrl, iat, exp: iat + 3600});
    const assertion = `${header}.${claims}.${sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), key).toString('base64url')}`;
    let response;
    try {
      response = await fetchFn(tokenUrl, {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: new URLSearchParams({grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion}),
        signal: AbortSignal.timeout(5000),
      });
    } catch { return null; }
    if (!response.ok) return null;
    const data = await response.json().catch(() => null);
    if (typeof data?.access_token !== 'string' || !data.access_token) return null;
    const lifetime = Number.isSafeInteger(data.expires_in) && data.expires_in > 0 ? Math.min(3600, data.expires_in) : 3600;
    cached = {token: data.access_token, expiresAtMs: t + lifetime * 1000};
    return cached.token;
  }
  async function updateObject(trustedRecord, now = new Date()) {
    let object;
    try {
      object = googleLoyaltyObject({issuerId, classId, origin}, trustedRecord, now);
    } catch {
      throw new Error('Invalid Google Wallet pass record.');
    }
    const token = await accessToken(now);
    if (!token) return 'retry';
    let response;
    try {
      response = await fetchFn(`${walletBase}/loyaltyObject/${encodeURIComponent(object.id)}`, {
        method: 'PUT',
        headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
        body: JSON.stringify(object),
        signal: AbortSignal.timeout(5000),
      });
    } catch { return 'retry'; }
    if (response.status === 200) return 'updated';
    if (response.status === 404) return 'not-found';
    if (response.status === 401 || response.status === 403) return 'denied';
    return 'retry';
  }
  return Object.freeze({updateObject});
}
