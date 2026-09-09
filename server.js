#!/usr/bin/env node
/* Inkling sync server. No dependencies.
   Serves the app and keeps one JSON document per install so every device sees the same page.

   PORT      port to listen on                      (default 3000)
   DATA      where the document lives               (default ~/.inkling/state.json)
   ORIGINS   comma-separated origins allowed to call /sync with credentials, besides this server's own
   TOKEN     optional bearer token; when set, /sync requires it (for deployments without an authenticating proxy)
*/
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = parseInt(process.env.PORT || '3000', 10);
const DATA = process.env.DATA || path.join(os.homedir(), '.inkling', 'state.json');
const ORIGINS = (process.env.ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const TOKEN = process.env.TOKEN || '';
const ROOT = __dirname;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.md': 'text/markdown; charset=utf-8' };

fs.mkdirSync(path.dirname(DATA), { recursive: true });
let doc = { rev: 0, state: null };
try { doc = JSON.parse(fs.readFileSync(DATA, 'utf8')); } catch (_) { /* first run */ }
function persist() {
  const tmp = DATA + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(doc));
  fs.renameSync(tmp, DATA);
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, If-Match');
  res.setHeader('Access-Control-Max-Age', '600');
}
function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 8 * 1024 * 1024) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  cors(req, res);
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (url.pathname === '/sync') {
    if (TOKEN && req.headers.authorization !== `Bearer ${TOKEN}`) return json(res, 401, { error: 'token' });
    if (req.method === 'GET') return json(res, 200, doc);
    if (req.method === 'PUT') {
      let body;
      try { body = JSON.parse(await readBody(req)); } catch (_) { return json(res, 400, { error: 'bad json' }); }
      if (!body || typeof body.baseRev !== 'number' || !body.state || !Array.isArray(body.state.todos)) return json(res, 400, { error: 'bad body' });
      if (body.baseRev !== doc.rev) return json(res, 409, doc); // someone else wrote first: here is theirs, merge and retry
      doc = { rev: doc.rev + 1, state: body.state, at: Date.now() };
      persist();
      return json(res, 200, { rev: doc.rev });
    }
    return json(res, 405, { error: 'method' });
  }
  if (url.pathname === '/sync.json') return json(res, 200, { url: '' }); // same origin

  // static app
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep) || path.basename(file).startsWith('.') || /^(server\.js|sync\.json)$/.test(path.basename(file))) { res.writeHead(404); return res.end('Not found'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
});
server.listen(PORT, () => console.log(`Inkling on :${PORT}, document at ${DATA}, origins ${ORIGINS.join(', ') || '(none)'}`));
