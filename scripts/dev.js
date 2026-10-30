// Local dev server: `npm run dev` (or `.claude/launch.json` → deets-site).
//
// Runs `wrangler pages dev` behind a thin local proxy on the first free port
// from 8787 upward, since several Deets* apps often run on this PC at once.
// Unlike the old `python -m http.server`, it serves the repo root the way
// Cloudflare Pages does — `_headers` included — so cache behavior can be
// checked locally (the proxy passes headers through untouched).
//
// The proxy exists for the copy editor (scripts/copy-edit.js): it injects
// that script into every HTML page and answers its saves: /__copy/save
// rewrites one key's value in a page's strings.js, /__copy/save-html one
// text in a page's own HTML (/__copy/probe says which texts qualify).
// It also hosts the dev driver (scripts/dev-driver-server.js): curl
// /__dev/* to drive a real tab (docs/architecture.md, "Dev driver"), and
// it sends JS/CSS as no-store so a reload never runs a stale script.
// None of it is in the repo's served tree, so none of it can reach Pages.
//
// Not `cf dev`: as of cf 1.0.0-beta.12 it dies on Windows with `spawn EFTYPE`,
// and it scaffolds the site as a Worker rather than a Pages project.
//
// Wrangler's local state goes outside the repo: kept inside, its writes
// land in the directory it watches.
//
// `node scripts/dev.js 8800` starts the probe at 8800 instead.

const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const START = Number(process.argv[2]) || 8787;
const STATE = path.join(os.tmpdir(), 'deets-site-dev');
const EDITOR = path.join(__dirname, 'copy-edit.js');
const INJECT = '<script src="/__copy/edit.js" defer></script><script src="/__dev/driver.js" defer></script>';
const driver = require('./dev-driver-server');

function isFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => probe.close(() => resolve(true)))
      .listen(port, '127.0.0.1');
  });
}

async function freeFrom(port) {
  while (!(await isFree(port))) port++;
  return port;
}

function send(res, status, body, type) {
  res.writeHead(status, { 'content-type': type || 'application/json', 'cache-control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

// One key's value in one strings.js, swapped in place. Every value in those
// files is a one-line double-quoted literal, so the key's line is the edit.
function saveString(body) {
  const { file, key, value } = body;
  if (typeof file !== 'string' || !/^[\w/-]+\/strings\.js$/.test(file)) return [400, 'not a strings.js'];
  if (typeof key !== 'string' || !/^[A-Za-z_]\w*$/.test(key)) return [400, 'bad key'];
  if (typeof value !== 'string' || /[\r\n]/.test(value)) return [400, 'value must be one line'];
  const abs = path.join(ROOT, file);
  if (!abs.startsWith(ROOT + path.sep) || !fs.existsSync(abs)) return [404, 'no such file'];
  const src = fs.readFileSync(abs, 'utf8');
  const line = new RegExp('^(\\s*' + key + '\\s*:\\s*)"((?:[^"\\\\\\r\\n]|\\\\.)*)"', 'gm');
  const hits = src.match(line);
  if (!hits || hits.length !== 1) return [409, hits ? 'key appears twice' : 'key not found as a one-line string'];
  const literal = '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  fs.writeFileSync(abs, src.replace(line, (_, head) => head + literal));
  console.log(`copy-edit: ${file} › ${key}`);
  return [200, { ok: true }];
}

// Pages with no strings.js keep their copy in the HTML itself. A text node
// is found by its words, between one tag's `>` and the next `<`, in the
// page's own body: <head>, scripts, styles, comments and the shared site
// header are blanked first (the header repeats on 16 pages; one page's edit
// would fork it). Only text found exactly once is editable, so anything
// rendered from JSON — songs, films, league data — never matches.
const MASK = /<head[\s\S]*?<\/head>|<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->|<header class="site-header"[\s\S]*?<\/header>/gi;

function htmlFile(file) {
  if (typeof file !== 'string' || !/^[\w/.-]*\.html$/.test(file) || file.includes('..')) return null;
  if (/^resume\//.test(file) || /^deetsmusic\/demo\/app\//.test(file)) return null;
  const abs = path.join(ROOT, file);
  return fs.existsSync(abs) ? abs : null;
}

function textPattern(text) {
  const word = (w) => Array.from(w).map((c) => (/[A-Za-z0-9]/.test(c) ? c
    : '(?:' + c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '|&[#\\w]+;)')).join('');
  const words = text.trim().split(/\s+/).filter(Boolean).map(word);
  return new RegExp('(?<=>\\s*)' + words.join('(?:\\s|&nbsp;|&#160;)+') + '(?=\\s*<)', 'g');
}

function findText(src, text) {
  const blank = src.replace(MASK, (m) => ' '.repeat(m.length));
  return Array.from(blank.matchAll(textPattern(text)));
}

function probeHtml(body) {
  const abs = htmlFile(body.file);
  if (!abs || !Array.isArray(body.texts)) return [200, { ok: true, counts: [] }];
  const src = fs.readFileSync(abs, 'utf8');
  return [200, { ok: true, counts: body.texts.map((t) => (typeof t === 'string' && t.trim() ? findText(src, t).length : 0)) }];
}

function saveHtml(body) {
  const { file, old, value } = body;
  const abs = htmlFile(file);
  if (!abs) return [400, 'not an editable page'];
  if (typeof old !== 'string' || typeof value !== 'string' || !value.trim()) return [400, 'empty text'];
  const src = fs.readFileSync(abs, 'utf8');
  const hits = findText(src, old);
  if (hits.length !== 1) return [409, hits.length ? `text appears ${hits.length} times in ${file}` : `text not found in ${file}`];
  const at = hits[0].index;
  const safe = value.replace(/\s*\n\s*/g, ' ').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  fs.writeFileSync(abs, src.slice(0, at) + safe + src.slice(at + hits[0][0].length));
  console.log(`copy-edit: ${file} › "${old.slice(0, 40)}"`);
  return [200, { ok: true }];
}

const POSTS = { '/__copy/save': saveString, '/__copy/save-html': saveHtml, '/__copy/probe': probeHtml };

function copyRoute(req, res) {
  if (req.method === 'GET' && req.url.split('?')[0] === '/__copy/edit.js') {
    return send(res, 200, fs.readFileSync(EDITOR, 'utf8'), 'text/javascript; charset=utf-8');
  }
  const handler = req.method === 'POST' && POSTS[req.url];
  if (handler) {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let out;
      try { out = handler(JSON.parse(raw)); } catch (e) { out = [400, String(e.message)]; }
      send(res, out[0], out[0] === 200 ? out[1] : { ok: false, error: out[1] });
    });
    return;
  }
  send(res, 404, { ok: false, error: 'unknown copy route' });
}

/* A LOCAL DeetsSupport worker (DeetsMusic `npm run dev:app -- --support-local` starts this
   server with DEETS_SUPPORT_URL and DEETS_SUPPORT_SECRET; docs/support.md, "Local testing").
   Then every page gets /__support/env.js first in its <head>, which tells deetsmusic.js and
   admin.js to read that worker, and tells account.js to sign in as the LOCAL OWNER instead of
   through id.deets.solutions (whose cookie never reaches localhost). /__support/owner signs a
   `ds_sess` cookie for localhost with the run's secret, which only that local worker knows;
   the browser sends it to the worker's port too, since a cookie ignores the port. The live
   sign-in is never read, copied or needed. Without the two variables, none of this exists. */
const SUPPORT = process.env.DEETS_SUPPORT_URL || '';
const SUPPORT_SECRET = process.env.DEETS_SUPPORT_SECRET || '';
const SUPPORT_TAG = '<script src="/__support/env.js"></script>';

function ownerSig(payload) {
  return require('crypto').createHmac('sha256', SUPPORT_SECRET).update(payload).digest('base64url');
}
function ownerCookieValue() {
  const payload = Buffer.from(JSON.stringify({ u: 'local-owner', iat: Math.floor(Date.now() / 1000) })).toString('base64url');
  return encodeURIComponent(`${payload}.${ownerSig(payload)}`);
}
// Signed in only when the cookie is signed with THIS run's secret, as the worker checks it.
// A cookie from an earlier run is still in the browser, and the worker refuses it
// (2026-10-30: the page read "Aditya (local)" while the admin page said "owner only").
function ownerCookieValid(header) {
  const m = /(?:^|;\s*)ds_sess=([^;]+)/.exec(header || '');
  if (!m) return false;
  const [payload, sig] = decodeURIComponent(m[1]).split('.');
  const want = payload ? ownerSig(payload) : '';
  return !!sig && sig.length === want.length && require('crypto').timingSafeEqual(Buffer.from(sig), Buffer.from(want));
}

function supportRoute(req, res) {
  const route = req.url.split('?')[0];
  if (route === '/__support/env.js') {
    res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
    return res.end(`window.DEETS_SUPPORT_LOCAL = ${JSON.stringify({ base: SUPPORT })};\n`);
  }
  if (route === '/__support/owner') {
    if (req.method === 'POST') {
      res.setHeader('set-cookie', `ds_sess=${ownerCookieValue()}; Path=/; HttpOnly; SameSite=Lax`);
      return send(res, 200, { owner: true });
    }
    if (req.method === 'DELETE') {
      res.setHeader('set-cookie', 'ds_sess=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
      return send(res, 200, { owner: false });
    }
    return send(res, 200, { owner: ownerCookieValid(req.headers.cookie) });
  }
  send(res, 404, { ok: false, error: 'unknown support route' });
}

function proxy(inner, devRoute) {
  return (req, res) => {
    if (SUPPORT && req.url.startsWith('/__support/')) return supportRoute(req, res);
    if (req.url.startsWith('/__copy/')) return copyRoute(req, res);
    if (req.url.startsWith('/__dev/')) return devRoute(req, res);
    const headers = { ...req.headers };
    delete headers['accept-encoding'];   // keep HTML plain so the tag can go in
    const up = http.request(
      { host: '127.0.0.1', port: inner, path: req.url, method: req.method, headers },
      (ur) => {
        const isHtml = /text\/html/.test(ur.headers['content-type'] || '') && req.method === 'GET';
        if (!isHtml || ur.statusCode !== 200) {
          const out = { ...ur.headers };
          // local only: _headers' max-age=0 + must-revalidate still lets the
          // browser reuse a 304'd copy; no-store makes every reload fetch the
          // script it is about to run
          if (/javascript|text\/css/.test(out['content-type'] || '')) {
            out['cache-control'] = 'no-store';
            delete out['etag']; delete out['last-modified'];
          }
          res.writeHead(ur.statusCode, out);
          return ur.pipe(res);
        }
        const chunks = [];
        ur.on('data', (c) => chunks.push(c));
        ur.on('end', () => {
          let html = Buffer.concat(chunks).toString('utf8');
          html = html.includes('</body>') ? html.replace('</body>', INJECT + '</body>') : html + INJECT;
          // First in <head>, not deferred: it must run before account.js and the page scripts.
          if (SUPPORT) html = html.replace(/<head[^>]*>/i, (m) => m + SUPPORT_TAG);
          const out = { ...ur.headers };
          delete out['content-length'];
          delete out['etag'];
          // the driver's stream lives on its own port, which _headers' CSP
          // (rightly) doesn't know; let local pages reach it. Its `eval`
          // command needs 'unsafe-eval' — local only, Pages keeps the real CSP
          const csp = out['content-security-policy'];
          if (csp) {
            out['content-security-policy'] = csp
              .replace(/connect-src/, `connect-src http://localhost:${devRoute.sidePort} http://127.0.0.1:${devRoute.sidePort}`)
              .replace(/script-src/, "script-src 'unsafe-eval'");
          }
          res.writeHead(200, out);
          res.end(html);
        });
      },
    );
    up.on('error', () => send(res, 502, 'wrangler is still starting — reload in a moment', 'text/plain'));
    req.pipe(up);
  };
}

(async () => {
  const port = await freeFrom(START);
  const server = http.createServer();
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const inner = await freeFrom(port + 1);
  const side = await freeFrom(inner + 1);
  server.on('request', proxy(inner, driver.mount(port, side)));
  console.log(`deets-site → http://localhost:${port}  (wrangler on ${inner}, dev driver on ${side})`);
  const child = spawn(
    process.execPath,
    [path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
      'pages', 'dev', '.', '--port', String(inner), '--ip', '127.0.0.1', '--persist-to', STATE],
    { cwd: ROOT, stdio: 'inherit' },
  );
  child.on('exit', (code) => process.exit(code ?? 0));
})();
