import { X509Certificate, createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { buildApplePass, buildGooglePass, PASS_TYPE_IDENTIFIER, validatePassProgram } from '../../src/lib/pass.ts';
import { passZip } from './zip.mjs';

const jsonBytes = (x) => Buffer.from(JSON.stringify(x));
const b64 = (x) => jsonBytes(x).toString('base64url');
const fields = (cert) => new Map(cert.subject.split('\n').map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
const localDate = (date, zone) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(date).map(({type,value}) => [type,value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const assetName = /^(?:icon|logo|strip|thumbnail|background|footer)(?:@[23]x)?\.png$/;
const opaque = /^[A-Za-z0-9_-]{22,80}$/;
const png = Buffer.from('89504e470d0a1a0a', 'hex');

// The lookup is trusted server state, never a payload or stamp count from a caller.
function record(input, now) {
  const { passId, program: p, stamps, redeemed = false, timeZone } = input ?? {};
  if (!opaque.test(passId ?? '') || typeof redeemed !== 'boolean' || !p || typeof timeZone !== 'string' || !timeZone || timeZone.length > 80 || !Number.isInteger(stamps) || stamps < 0 || stamps > p.target) throw new Error('Invalid pass record.');
  const program = { ...p, barcodeValue: passId };
  if (!Number.isFinite(now.getTime()) || validatePassProgram(program).length || program.reward.length > 160 || program.cover.length > 64 || [program.latitude, program.longitude].some((v) => v !== undefined && !Number.isFinite(v))) throw new Error('Invalid pass record.');
  if (program.expiryIso !== undefined) {
    const iso = new Date(`${program.expiryIso}T00:00:00.000Z`);
    if (!Number.isFinite(iso.getTime()) || iso.toISOString().slice(0, 10) !== program.expiryIso) throw new Error('Invalid pass date.');
  }
  return { passId, program, stamps, options: { redeemed, todayIso: localDate(now, timeZone) } };
}

// Configuration and mounted PEM paths are supplied ONLY by the signing service operator.
// Use the official Apple trust root and matching WWDR certificate, not the App Store Connect key.
export function createAppleSigner({ teamIdentifier, certificatePath, privateKeyPath, intermediatePath, rootPath, assets, appleUpdates }) {
  if (!/^[A-Z0-9]{10}$/.test(teamIdentifier ?? '')) throw new Error('Invalid Apple Wallet signing configuration.');
  if (appleUpdates !== undefined && (!(appleUpdates.url instanceof URL) || appleUpdates.url.protocol !== 'https:' || typeof appleUpdates.tokenFor !== 'function')) throw new Error('Invalid Apple Wallet update configuration.');
  const signer = new X509Certificate(readFileSync(certificatePath));
  const intermediate = new X509Certificate(readFileSync(intermediatePath));
  const root = new X509Certificate(readFileSync(rootPath));
  const subject = fields(signer);
  if (subject.get('UID') !== PASS_TYPE_IDENTIFIER || subject.get('OU') !== teamIdentifier || signer.ca || !intermediate.ca || !root.ca || !signer.checkIssued(intermediate) || !signer.verify(intermediate.publicKey) || !intermediate.checkIssued(root) || !intermediate.verify(root.publicKey)) throw new Error('Apple Wallet certificate does not match the pass type or trust chain.');
  if (!signer.checkPrivateKey(createPrivateKey(readFileSync(privateKeyPath)))) throw new Error('Apple Wallet certificate and key do not match.');
  const art = Object.entries(assets ?? {}).map(([key, bytes]) => {
    if (!assetName.test(key) || !Buffer.isBuffer(bytes) || bytes.length < 32 || bytes.length > 1024 * 1024 || !png.equals(bytes.subarray(0,8))) throw new Error('Invalid Apple Wallet artwork.');
    return [key, Buffer.from(bytes)];
  });
  if (!art.some(([key]) => key === 'icon.png') || !art.some(([key]) => key === 'icon@2x.png')) throw new Error('Apple Wallet icons are required.');
  art.sort(([a], [b]) => a.localeCompare(b));
  return (trustedRecord, now = new Date()) => {
    if ([signer, intermediate, root].some((x) => now < new Date(x.validFrom) || now >= new Date(x.validTo))) throw new Error('Apple Wallet certificates are outside their validity period.');
    const { program, stamps, options } = record(trustedRecord, now);
    const p = buildApplePass(program, stamps, options);
    p.teamIdentifier = teamIdentifier;
    if (appleUpdates !== undefined) {
      p.webServiceURL = appleUpdates.url.href;
      p.authenticationToken = appleUpdates.tokenFor(trustedRecord.passId);
    }
    p.backgroundColor = 'rgb(' + p.backgroundColor.slice(1).match(/../g).map((x) => Number.parseInt(x, 16)).join(', ') + ')';
    p.barcodes = [p.barcode];
    if (p.expirationDate) p.expirationDate = `${p.expirationDate}T23:59:59` + zonedOffset(p.expirationDate, trustedRecord.timeZone);
    const contents = [['pass.json', jsonBytes(p)], ...art];
    const manifest = jsonBytes(Object.fromEntries(contents.map(([name, data]) => [name, createHash('sha1').update(data).digest('hex')])));
    let cms;
    try {
      // PassKit requires SHA-1 file hashes in manifest.json; the detached CMS signature uses SHA-256.
      cms = execFileSync('openssl', ['cms', '-sign', '-binary', '-md', 'sha256', '-signer', certificatePath, '-inkey', privateKeyPath, '-passin', 'pass:', '-certfile', intermediatePath, '-outform', 'DER'], { input: manifest, timeout: 5000, maxBuffer: 65536, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch { throw new Error('Apple Wallet signing failed.'); }
    if (cms.length < 128) throw new Error('Apple Wallet signing failed.');
    return passZip([...contents, ['manifest.json', manifest], ['signature', cms]]);
  };
}

function zonedOffset(day, zone) {
  const hour = `${day}T23:59:59`;
  const df = new Intl.DateTimeFormat('en', {timeZone: zone, timeZoneName: 'longOffset'});
  let seconds = Date.parse(hour + 'Z');
  let previous = null;
  for (let i = 0; i < 4; i++) {
    const value = df.formatToParts(seconds).find((x) => x.type === 'timeZoneName')?.value;
    const offset = value === 'GMT' ? '+00:00' : /^GMT[+-][0-9]{2}:[0-9]{2}$/.test(value ?? '') ? value.slice(3) : null;
    if (!offset) break;
    if (offset === previous) return offset;
    previous = offset;
    seconds = Date.parse(hour + offset);
  }
  throw new Error('Invalid pass timezone.');
}

// The loyalty class must already exist under this issuer. This does not create, publish or update it.
export function createGoogleSigner({ issuerId, classId, clientEmail, privateKeyPath, origin }) {
  if (!/^[0-9]{8,40}$/.test(issuerId ?? '') || !classId?.startsWith(`${issuerId}.`) || !/^[0-9]+\.[A-Za-z0-9_.-]{1,106}$/.test(classId) || !/^[a-z0-9-]{3,64}@[a-z0-9-]{3,100}\.iam\.gserviceaccount\.com$/.test(clientEmail ?? '')) throw new Error('Invalid Google Wallet issuer configuration.');
  const u = new URL(origin);
  if (u.protocol !== 'https:' || u.origin !== origin) throw new Error('Invalid Google Wallet origin.');
  const key = createPrivateKey(readFileSync(privateKeyPath));
  if (key.asymmetricKeyType !== 'rsa' || (createPublicKey(key).asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new Error('A 2048-bit or larger RSA service key is required.');
  return (trustedRecord, now = new Date()) => {
    const { passId, program, stamps, options } = record(trustedRecord, now);
    const p = buildGooglePass(program, stamps, options);
    p.id = `${issuerId}.stampies-${passId}`;
    p.classId = classId;
    p.linksModuleData.uris = [{uri: `${origin}/p/${passId}`, description: 'Open Stampies', id: 'pass-page'}];
    if (program.expiryIso) p.validTimeInterval.end.date = `${program.expiryIso}T23:59:59${zonedOffset(program.expiryIso, trustedRecord.timeZone)}`;
    const enc = b64({alg: 'RS256', typ: 'JWT'}) + '.' + b64({iss: clientEmail, aud: 'google', typ: 'savetowallet', iat: Math.floor(now.getTime()/1000), origins: [origin], payload: {loyaltyObjects: [p]}});
    return 'https://pay.google.com/gp/v/save/' + enc + '.' + sign('RSA-SHA256', Buffer.from(enc), key).toString('base64url');
  };
}

// Host adapter: short-lived opaque mint token -> authorised pass record. The lookup must check
// ownership, purpose and expiration; tokens must not be reused as pass IDs or logged.
export function createWalletIssueHandler({ lookup, apple, google }) {
  if (typeof lookup !== 'function') throw new Error('Wallet issue requires a trusted lookup.');
  const headers = {'Cache-Control':'private, no-store', 'Referrer-Policy':'no-referrer', 'X-Content-Type-Options':'nosniff'};
  return async (request) => {
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: {...headers, Allow:'POST'} });
    const platform = new URL(request.url).pathname;
    if (platform !== '/wallet/apple' && platform !== '/wallet/google') return new Response(null, {status: 404, headers});
    const match = /^Bearer ([A-Za-z0-9_-]{43,100})$/.exec(request.headers.get('authorization') ?? '');
    if (!match) return new Response(null, {status: 401, headers});
    const choose = platform.endsWith('/apple') ? apple : google;
    if (typeof choose !== 'function') return new Response(null, {status: 503, headers});
    try {
      const trusted = await lookup(createHash('sha256').update(match[1]).digest('hex'), platform);
      if (!trusted) return new Response(null, {status: 404, headers});
      const signed = choose(trusted);
      if (platform.endsWith('/apple')) return new Response(signed, {headers: {...headers,'Content-Type':'application/vnd.apple.pkpass','Content-Disposition':'attachment; filename="stampies.pkpass"'}});
      return Response.json({saveUrl: signed}, {headers});
    } catch { return new Response(null, {status: 503, headers}); }
  };
}
