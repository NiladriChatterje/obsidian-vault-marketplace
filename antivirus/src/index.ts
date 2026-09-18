/**
 * The vault scanner's HTTP front.
 *
 *   POST /scan     the raw bytes of an upload -> { clean } or { clean: false, signature }
 *   GET  /health   { ok } -- false until clamd has finished loading its signatures
 *
 * clamd speaks its own protocol on a socket with no authentication of any kind, which is why
 * it is never exposed directly: this sits in front of it, in the same container, and is the
 * only thing the API talks to. Deploy it somewhere private all the same -- SCANNER_TOKEN is a
 * shared secret, not a login, and the bytes cross unencrypted.
 *
 * The request body is streamed straight through to clamd, so a 70 MB vault never has to fit
 * in this process's memory.
 */
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { ping, scanStream } from './clamd.ts';

const PORT = Number(process.env.PORT || 8080);
/** Optional shared secret. Unset means anything that can reach the port may scan. */
const TOKEN = process.env.SCANNER_TOKEN || '';
/** Refused outright past this: the API's own ceiling is 70 MB, and this is not a file host. */
const MAX_BYTES = Number(process.env.MAX_SCAN_BYTES || 100 * 1024 * 1024);

function send(res: http.ServerResponse, code: number, body: object): void {
  const payload = JSON.stringify(body);
  res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
}

function authorised(header: string | undefined): boolean {
  if (!TOKEN) return true;
  const given = Buffer.from(header ?? '');
  const expected = Buffer.from(`Bearer ${TOKEN}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The body, refused the moment it grows past the cap rather than after it has all arrived. */
async function* capped(req: http.IncomingMessage): AsyncGenerator<Uint8Array> {
  let total = 0;
  for await (const chunk of req) {
    total += chunk.byteLength;
    if (total > MAX_BYTES) throw Object.assign(new Error(`Upload is larger than ${MAX_BYTES} bytes`), { tooLarge: true });
    yield chunk;
  }
}

const server = http.createServer(async (req, res) => {
  const path = (req.url ?? '').split('?')[0];

  if (req.method === 'GET' && path === '/health') {
    const ok = await ping();
    return send(res, ok ? 200 : 503, { ok, clamd: ok ? 'ready' : 'not answering' });
  }

  if (req.method !== 'POST' || path !== '/scan') return send(res, 404, { error: 'POST /scan or GET /health' });
  if (!authorised(req.headers.authorization)) return send(res, 401, { error: 'Bad or missing scanner token' });
  if (Number(req.headers['content-length'] ?? 0) > MAX_BYTES) return send(res, 413, { error: `Upload is larger than ${MAX_BYTES} bytes` });

  try {
    const verdict = await scanStream(capped(req));
    if (!verdict.clean) console.warn(`scan: ${verdict.signature} found`);
    return send(res, 200, verdict);
  } catch (e) {
    const err = e as Error & { tooLarge?: boolean };
    if (err.tooLarge) return send(res, 413, { error: err.message });
    // Not scanned, which is not the same as clean: say so plainly and let the caller refuse.
    console.error('scan failed:', err.message);
    return send(res, 502, { error: `Scan did not complete: ${err.message}` });
  }
});

// Long enough for the slowest legitimate upload; without it Node would hang up at two minutes.
server.requestTimeout = 300_000;
server.headersTimeout = 60_000;

server.listen(PORT, () => console.log(`vault scanner on :${PORT} (token ${TOKEN ? 'required' : 'not set'}, max ${MAX_BYTES} bytes)`));

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
