import { createServer } from 'node:http';

const maxBody = 8192;
const forwardedHeaders = ['authorization', 'content-type', 'if-modified-since'];
const blockedMethods = new Set(['CONNECT', 'TRACE', 'TRACK']);
const safeResponseHeaders = new Set(['allow', 'content-disposition', 'content-type', 'last-modified']);
const quiet = {'Cache-Control': 'private, no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff'};

// Bind only behind the deployment's TLS-terminating ingress. The trusted
// origin is configured, not read from forwarding headers. This is not an
// authenticated app or a mint, stamp, merchant or diagnostics endpoint.
export function createWalletHttpServer({ origin, service }) {
  const publicURL = new URL(origin);
  if (publicURL.protocol !== 'https:' || publicURL.href !== `${publicURL.origin}/` || !(typeof service?.handle === 'function')) {
    throw new TypeError('Wallet requires a configured HTTPS origin and service');
  }
  const fail = (res, status) => {
    if (!res.closed && !res.headersSent) res.writeHead(status, quiet).end();
  };
  const server = createServer({maxHeaderSize: 8192, headersTimeout: 5000, requestTimeout: 10000, keepAliveTimeout: 3000}, async (req, res) => {
    try {
      const { method = '', url: target = '', headersDistinct: fields } = req;
      if (fields.host?.length !== 1 || fields.host[0].toLowerCase() !== publicURL.host ||
          !target.startsWith('/') || target.startsWith('//') || /[#\\]/.test(target)) return fail(res, 404);
      const rawPath = target.split('?')[0];
      const parsed = new URL(target, publicURL);
      if (parsed.origin !== publicURL.origin || parsed.pathname !== rawPath) return fail(res, 404);
      if (blockedMethods.has(method)) return fail(res, 405);
      const length = fields['content-length']?.[0];
      if (length !== undefined && (!/^(?:0|[1-9][0-9]*)$/.test(length) || Number(length) > maxBody)) {
        res.setHeader('Connection', 'close'); return fail(res, 413);
      }
      const hasFraming = Boolean(fields['transfer-encoding'] || (length && length !== '0'));
      if (target === '/healthz' && method === 'GET' && !hasFraming) return fail(res, 204);
      const issuance = rawPath === '/wallet/apple' || rawPath === '/wallet/google';
      if (!issuance && !rawPath.startsWith('/v1/')) return fail(res, 404);
      const headers = new Headers();
      for (const key of forwardedHeaders) {
        if (fields[key]?.length === 1) headers.set(key, fields[key][0]);
        else if (fields[key]?.length > 1) return fail(res, 400);
      }
      if (hasFraming && (method === 'GET' || method === 'HEAD' || issuance)) {
        // Consume no unsolicited payload on bearer-based issuance or reads.
        res.setHeader('Connection', 'close'); return fail(res, 400);
      }
      let body;
      if (hasFraming) {
        try {
          let bytes = 0; const parts = [];
          for await (const chunk of req.iterator({destroyOnReturn:false})) {
            bytes += chunk.length;
            if (bytes > maxBody) {
              res.setHeader('Connection', 'close'); return fail(res, 413);
            }
            parts.push(chunk);
          }
          body = Buffer.concat(parts, bytes);
          headers.set('content-length', String(bytes));
        } catch { return fail(res, 400); }
      }
      const reply = await service.handle(new Request(parsed, {method, headers, body}));
      const fieldsOut = {...quiet};
      for (const [k, v] of reply.headers) if (safeResponseHeaders.has(k)) fieldsOut[k] = v;
      const responseBytes = reply.body ? Buffer.from(await reply.arrayBuffer()) : undefined;
      if (!res.closed && !res.headersSent) res.writeHead(reply.status, fieldsOut).end(responseBytes);
    } catch {
      fail(res, 503);
    }
  });
  server.on('checkContinue', (_, res) => { res.setHeader('Connection', 'close'); fail(res, 417); });
  server.on('clientError', (_, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); });
  return server;
}
