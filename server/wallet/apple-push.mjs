import { X509Certificate, createPrivateKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { connect, constants } from 'node:http2';
import { PASS_TYPE_IDENTIFIER } from '../../src/lib/pass.ts';

const walletAPNs = 'https://api.push.apple.com';
const tokenShape = /^(?:[0-9a-f]{2}){16,128}$/i;
const payload = Buffer.from('{}', 'ascii');
const responseCap = 1024;
const subject = (certificate) => new Map(certificate.subject.split('\n').map((line) => {
  const pos = line.indexOf('='); return [line.slice(0, pos), line.slice(pos + 1)];
}));

// One deadline covers connecting, response headers and body. Never report acceptance
// on a timeout or reset: the durable queue can retry an ambiguous wake.
export function sendAppleWalletWake(session, wake, { timeoutMs = 5000, now = Date.now() } = {}) {
  const { topic, pushToken } = wake ?? {};
  if (topic !== PASS_TYPE_IDENTIFIER || typeof pushToken !== 'string' || !tokenShape.test(pushToken) ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 10000 ||
      !Number.isSafeInteger(now) || now < 0) return Promise.resolve('retry');
  return new Promise((resolve) => {
    let req, finished = false, status = null, bytes = 0;
    const chunks = [];
    const finish = (value, cancel = false) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (cancel && req && !req.destroyed && !req.closed) {
        try { req.close(constants.NGHTTP2_CANCEL); } catch { /* transport already closed */ }
      }
      resolve(value);
    };
    const timer = setTimeout(() => finish('retry', true), timeoutMs);
    try {
      req = session.request({
        ':method': 'POST', ':path': `/3/device/${pushToken.toLowerCase()}`,
        'apns-topic': PASS_TYPE_IDENTIFIER, 'apns-priority': '5',
        'apns-expiration': String(Math.floor(now / 1000) + 3600),
        'content-type': 'application/json', 'content-length': String(payload.length),
      });
      req.on('error', () => finish('retry'));
      req.on('aborted', () => finish('retry'));
      req.on('close', () => finish('retry'));
      req.on('response', (h) => { status = h[':status']; });
      req.on('data', (buf) => {
        bytes += buf.length;
        if (bytes > responseCap) finish('retry', true);
        else chunks.push(buf);
      });
      req.on('end', () => {
        if (status === 200) return finish('accepted');
        if (status === 410 && bytes > 0) {
          try {
            if (JSON.parse(Buffer.concat(chunks)).reason === 'Unregistered') return finish('unregistered');
          } catch { /* keep the wake, because the refusal is not conclusive */ }
        }
        finish('retry');
      });
      req.end(payload);
    } catch { finish('retry', true); }
  });
}

export function createAppleWalletPushSender({ teamIdentifier, certificatePath, privateKeyPath, intermediatePath, rootPath }) {
  if (!/^[A-Z0-9]{10}$/.test(teamIdentifier ?? '')) throw new Error('Invalid Wallet push configuration.');
  let leaf, issuer, root, key;
  try {
    leaf = new X509Certificate(readFileSync(certificatePath));
    issuer = new X509Certificate(readFileSync(intermediatePath));
    root = new X509Certificate(readFileSync(rootPath));
    key = createPrivateKey(readFileSync(privateKeyPath));
    const fields = subject(leaf);
    const now = Date.now();
    const active = [leaf, issuer, root].every((x) => Date.parse(x.validFrom) <= now && now < Date.parse(x.validTo));
    if (!active || fields.get('UID') !== PASS_TYPE_IDENTIFIER || fields.get('OU') !== teamIdentifier ||
        leaf.ca || !issuer.ca || !root.ca || !leaf.checkIssued(issuer) || !leaf.verify(issuer.publicKey) ||
        !issuer.checkIssued(root) || !issuer.verify(root.publicKey) || !root.checkIssued(root) ||
        !root.verify(root.publicKey) || !leaf.checkPrivateKey(key)) throw new Error();
  } catch { throw new Error('Wallet push certificate, key or issuer chain did not verify.'); }
  // Node's standard TLS trust verifies api.push.apple.com. The mounted Apple root
  // above validates our client certificate; it is not a substitute for server trust.
  const cert = `${leaf.toString()}\n${issuer.toString()}`;
  // Node's TLS options take PEM, not a KeyObject. This value stays in server memory.
  const keyPEM = key.export({ type: 'pkcs8', format: 'pem' });
  let session = null, stopped = false;
  const activeSession = () => {
    if (session && !session.closed && !session.destroyed) return session;
    const s = connect(walletAPNs, { cert, key: keyPEM, minVersion: 'TLSv1.2', rejectUnauthorized: true });
    session = s;
    const clear = () => { if (session === s) session = null; };
    s.on('error', clear);
    s.on('close', clear);
    s.on('goaway', () => { clear(); s.close(); });
    s.setTimeout(60_000, () => { clear(); s.close(); });
    return s;
  };
  const sendWake = async (wake) => {
    if (stopped || wake?.topic !== PASS_TYPE_IDENTIFIER || typeof wake?.pushToken !== 'string' || !tokenShape.test(wake.pushToken)) return 'retry';
    try { return await sendAppleWalletWake(activeSession(), wake); }
    catch { return 'retry'; }
  };
  return Object.freeze({sendWake, close() { stopped = true; session?.destroy(); session = null; }});
}
