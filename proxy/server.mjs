/* AlphaGrab relay — the smallest thing that unblocks a CORS-less graphics host.
 *
 * A browser may only read pixels a server agrees to share. Broadcast graphics
 * platforms (Flowics, Singular, Chyron cloud) serve their viz pages without
 * `Access-Control-Allow-Origin`, and they are third parties — the person using
 * AlphaGrab cannot add the header. Measured against Flowics 2026-09-11: no
 * `access-control-*` header of any kind.
 *
 * This relays those bytes back with the header attached, and does nothing else.
 * It does not render, screenshot, store, or log the content. Rendering, keying
 * and encoding all still happen in the visitor's own browser, which is what
 * keeps "local processing" true — the relay moves bytes, not pixels.
 *
 * It is OFF by default in the tool. A relay sees every URL routed through it,
 * so turning it on is the visitor's call, made once, with that said plainly.
 */
import http from 'node:http';

const PORT     = process.env.PORT || 8080;
const MAX_BYTES = 25 * 1024 * 1024;
const TIMEOUT   = 20000;

/* Who may use it. A browser sets Origin and cannot forge it; this is not a
 * defence against a script with curl, it is what stops the relay quietly
 * becoming everyone's open proxy. */
const ALLOWED = (process.env.ALLOWED_ORIGINS ||
  'https://alphagrab.knightaiav.com,https://knight-ai-av.github.io,https://www.knightaiav.com')
  .split(',').map(s => s.trim()).filter(Boolean);

/* Crude per-IP ceiling. The workflow is a person pressing Download, not a fleet. */
const hits = new Map();
const RATE = 240, WINDOW = 60000;
function overRate(ip){
  const now = Date.now();
  const e = hits.get(ip);
  if (!e || now - e.t > WINDOW) { hits.set(ip, { t: now, n: 1 }); return false; }
  e.n += 1;
  if (hits.size > 5000) hits.clear();
  return e.n > RATE;
}

const cors = (origin) => ({
  'access-control-allow-origin': origin && ALLOWED.includes(origin) ? origin : ALLOWED[0],
  'access-control-allow-methods': 'GET,OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
  'vary': 'origin'
});

http.createServer(async (rq, rs) => {
  const origin = rq.headers.origin || '';
  const ip = (rq.headers['x-forwarded-for'] || rq.socket.remoteAddress || '').split(',')[0].trim();

  if (rq.method === 'OPTIONS') { rs.writeHead(204, cors(origin)); return rs.end(); }
  if (rq.url === '/health')    { rs.writeHead(200, { 'content-type': 'text/plain' }); return rs.end('ok'); }

  const m = /^\/p\/(.+)$/.exec(rq.url || '');
  if (!m) { rs.writeHead(404, cors(origin)); return rs.end('relay: GET /p/<encoded url>'); }

  if (origin && !ALLOWED.includes(origin)) { rs.writeHead(403, cors(origin)); return rs.end('origin not allowed'); }
  if (overRate(ip))                        { rs.writeHead(429, cors(origin)); return rs.end('slow down'); }

  let target;
  try { target = new URL(decodeURIComponent(m[1])); } catch { rs.writeHead(400, cors(origin)); return rs.end('bad url'); }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') { rs.writeHead(400, cors(origin)); return rs.end('http(s) only'); }
  /* Never let the relay reach anything the public internet cannot. */
  if (/^(localhost$|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)/i.test(target.hostname)) {
    rs.writeHead(400, cors(origin)); return rs.end('private address refused');
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT);
  try {
    const r = await fetch(target.href, { redirect: 'follow', signal: ac.signal, headers: { 'user-agent': 'AlphaGrab-relay/1' } });
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_BYTES) { rs.writeHead(413, cors(origin)); return rs.end('too large'); }
    rs.writeHead(r.status, {
      ...cors(origin),
      'content-type': r.headers.get('content-type') || 'application/octet-stream',
      'cache-control': 'no-store'
    });
    rs.end(buf);
  } catch (e) {
    rs.writeHead(e && e.name === 'AbortError' ? 504 : 502, cors(origin));
    rs.end(e && e.name === 'AbortError' ? 'upstream timed out' : 'upstream unreachable');
  } finally { clearTimeout(timer); }
}).listen(PORT, () => console.log('alphagrab relay on ' + PORT + '; origins: ' + ALLOWED.join(' ')));
