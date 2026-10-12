// Local dev server: `npm run dev` (or `.claude/launch.json` → deets-site).
//
// Runs `wrangler pages dev` behind a thin local proxy on the first free port
// from 8787 upward, since several Deets* apps often run on this PC at once.
// Unlike the old `python -m http.server`, it serves the repo root the way
// Cloudflare Pages does — `_headers` included — so cache behavior can be
// checked locally (the proxy passes headers through untouched).
//
// The proxy exists for the copy editor (scripts/copy-edit.js): it injects
// that script into every HTML page and answers its saves at /__copy/save,
// rewriting one key's value in a page's strings.js. None of it is in the
// repo's served tree, so none of it can reach Pages.
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
const INJECT = '<script src="/__copy/edit.js" defer></script>';

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

function copyRoute(req, res) {
  if (req.method === 'GET' && req.url.split('?')[0] === '/__copy/edit.js') {
    return send(res, 200, fs.readFileSync(EDITOR, 'utf8'), 'text/javascript; charset=utf-8');
  }
  if (req.method === 'POST' && req.url === '/__copy/save') {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let out;
      try { out = saveString(JSON.parse(raw)); } catch (e) { out = [400, String(e.message)]; }
      send(res, out[0], out[0] === 200 ? out[1] : { ok: false, error: out[1] });
    });
    return;
  }
  send(res, 404, { ok: false, error: 'unknown copy route' });
}

function proxy(inner) {
  return (req, res) => {
    if (req.url.startsWith('/__copy/')) return copyRoute(req, res);
    const headers = { ...req.headers };
    delete headers['accept-encoding'];   // keep HTML plain so the tag can go in
    const up = http.request(
      { host: '127.0.0.1', port: inner, path: req.url, method: req.method, headers },
      (ur) => {
        const isHtml = /text\/html/.test(ur.headers['content-type'] || '') && req.method === 'GET';
        if (!isHtml || ur.statusCode !== 200) {
          res.writeHead(ur.statusCode, ur.headers);
          return ur.pipe(res);
        }
        const chunks = [];
        ur.on('data', (c) => chunks.push(c));
        ur.on('end', () => {
          let html = Buffer.concat(chunks).toString('utf8');
          html = html.includes('</body>') ? html.replace('</body>', INJECT + '</body>') : html + INJECT;
          const out = { ...ur.headers };
          delete out['content-length'];
          delete out['etag'];
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
  server.on('request', proxy(inner));
  console.log(`deets-site → http://localhost:${port}  (wrangler on ${inner})`);
  const child = spawn(
    process.execPath,
    [path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
      'pages', 'dev', '.', '--port', String(inner), '--ip', '127.0.0.1', '--persist-to', STATE],
    { cwd: ROOT, stdio: 'inherit' },
  );
  child.on('exit', (code) => process.exit(code ?? 0));
})();
