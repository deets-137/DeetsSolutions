// Local dev server: `npm run dev` (or `.claude/launch.json` → deets-site).
//
// Runs `wrangler pages dev` on the first free port from 8787 upward, since
// several Deets* apps often run on this PC at once. Unlike the old
// `python -m http.server`, it serves the repo root the way Cloudflare Pages
// does — `_headers` included — so cache behavior can be checked locally.
//
// Not `cf dev`: as of cf 1.0.0-beta.12 it dies on Windows with `spawn EFTYPE`,
// and it scaffolds the site as a Worker rather than a Pages project.
//
// Wrangler's local state goes outside the repo: kept inside, its writes
// land in the directory it watches.
//
// `node scripts/dev.js 8800` starts the probe at 8800 instead.

const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const START = Number(process.argv[2]) || 8787;
const STATE = path.join(os.tmpdir(), 'deets-site-dev');

function isFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => probe.close(() => resolve(true)))
      .listen(port, '127.0.0.1');
  });
}

(async () => {
  let port = START;
  while (!(await isFree(port))) port++;
  console.log(`deets-site → http://localhost:${port}`);
  const child = spawn(
    process.execPath,
    [path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
      'pages', 'dev', '.', '--port', String(port), '--persist-to', STATE],
    { cwd: ROOT, stdio: 'inherit' },
  );
  child.on('exit', (code) => process.exit(code ?? 0));
})();
