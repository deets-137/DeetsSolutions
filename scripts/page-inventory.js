// The page inventory: `node scripts/page-inventory.js` writes docs/pages.md,
// one row per page of the site, read from the pages' own HTML (and their
// scripts, for what they fetch). Generated, never hand-edited, so it cannot
// drift: docs-check.js fails when it is behind the pages, and
// .githooks/pre-commit regenerates it.
//
// Why it exists (2026-11-23, docs/LESSONS.md "Page transitions"): the nav
// tile's page transition worked on Portfolio and Resume only. Their one
// difference, a render-blocking script, sat in two <head>s among twenty, and
// nothing listed the pages side by side. This table does: what each page's
// first frame waits for, its nav tile, its scripts, what it fetches, and the
// ?v= stamp on each stylesheet.
//
//   node scripts/page-inventory.js           write docs/pages.md
//   node scripts/page-inventory.js --check   exit 1 if docs/pages.md is behind
//   node scripts/page-inventory.js --hook    write it, and `git add` it unless
//                                            it has other unstaged edits

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'pages.md');
// Shared chrome every page loads; listed once in the legend, not per page.
const SHARED_JS = ['controls.js', 'account.js', 'toast.js', 'walkers.js'];
const TOKEN_CSS = ['fonts.css', 'palette.css', 'themes.css', 'skin.css'];

const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');
const git = (...args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });

/** Every page: git-tracked .html files, less the DeetsMusic demo's build copy. */
function pages() {
  const r = git('ls-files', '*.html');
  const files = r.status === 0 ? r.stdout.split('\n').filter(Boolean) : [];
  return files.filter((f) => !/^deetsmusic\/demo\/app\//.test(f)).sort((a, b) => urlOf(a).localeCompare(urlOf(b)));
}
function urlOf(file) {
  return '/' + file.replace(/(^|\/)index\.html$/, '$1').replace(/^\//, '');
}
const base = (src) => src.split('?')[0].split('/').pop();
const stamp = (src) => (src.match(/\?v=([\w-]+)/) || [])[1] || null;
const attr = (tag, name) => {
  const m = tag.match(new RegExp(`\\s${name}(?:\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+)))?`, 'i'));
  return m ? (m[2] ?? m[3] ?? m[4] ?? '') : null;
};
const md = (s) => String(s).replace(/\|/g, '\\|');

/** What one page is made of. */
function inspect(file) {
  const html = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const head = (html.match(/<head[^>]*>([\s\S]*?)<\/head>/i) || [, ''])[1];
  const body = html.slice(html.search(/<body/i));
  const dir = path.dirname(path.join(ROOT, file));

  // the first frame waits for: head stylesheets, head scripts that are
  // neither defer nor async nor modules, anything marked blocking="render"
  const blocking = [];
  const sheets = [];
  for (const tag of head.match(/<link\b[^>]*>/gi) || []) {
    const relv = (attr(tag, 'rel') || '').toLowerCase();
    const href = attr(tag, 'href') || '';
    if (relv === 'stylesheet') {
      sheets.push({ name: base(href), stamp: stamp(href) });
      if (!/print/.test(attr(tag, 'media') || '')) blocking.push(base(href));
    }
    if (relv === 'expect' && /render/.test(attr(tag, 'blocking') || '')) blocking.push(`<${href}> parsed`);
  }
  let inline = 0;
  const scripts = [];
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const tag = '<script' + m[1] + '>';
    const src = attr(tag, 'src');
    const type = (attr(tag, 'type') || '').toLowerCase();
    if (type && !/javascript|module/.test(type)) continue;   // JSON-LD and the like
    const inHead = head.includes(m[0]);
    const deferred = attr(tag, 'defer') !== null || attr(tag, 'async') !== null || type === 'module';
    const renderBlock = /render/.test(attr(tag, 'blocking') || '');
    if (!src) { if (inHead && !deferred) inline++; continue; }
    scripts.push({ src, name: base(src) });
    if ((inHead && !deferred) || renderBlock) blocking.push(base(src) + (renderBlock ? ' (blocking=render)' : ''));
  }
  if (inline) blocking.push(`inline script${inline > 1 ? ' ×' + inline : ''}`);

  // the pre-paint theme script: the first inline <script> in <head>
  const prepaint = (head.match(/<script>([\s\S]*?)<\/script>/i) || [])[1];
  const prepaintHash = prepaint ? crypto.createHash('sha256').update(prepaint).digest('base64').slice(0, 10) : null;

  // the nav: is there one, and which item is this page's tile
  const nav = (body.match(/<nav class="site-nav"[\s\S]*?<\/nav>/) || [])[0];
  let tile = 'no nav';
  if (nav) {
    const cur = nav.match(/<a\b[^>]*aria-current="page"[^>]*>([^<]*)/);
    tile = cur ? cur[1].trim() : '— (not in the nav)';
  }

  // what its own scripts fetch: string-literal fetch() targets and worker hosts
  const fetches = new Set();
  for (const s of scripts) {
    if (/^https?:|^\/\//.test(s.src) || SHARED_JS.includes(s.name)) continue;
    const abs = s.src.startsWith('/') ? path.join(ROOT, s.src.split('?')[0]) : path.join(dir, s.src.split('?')[0]);
    if (!fs.existsSync(abs)) continue;
    const js = fs.readFileSync(abs, 'utf8');
    for (const f of js.matchAll(/fetch\(\s*["'`]([^"'`$]+)/g)) fetches.add(f[1].replace(/^\.\.?\//, ''));
    for (const h of js.matchAll(/["'`](?:https?|wss?):\/\/([a-z0-9-]+\.deets\.solutions)/g)) fetches.add(h[1]);
  }

  const main = (body.match(/<main\b([^>]*)>/) || [])[1] || null;
  return {
    file, url: urlOf(file),
    title: ((html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '').trim(),
    tile, blocking, sheets, prepaintHash,
    own: scripts.filter((s) => !SHARED_JS.includes(s.name) && !/^https?:/.test(s.src)).map((s) => s.name),
    shared: SHARED_JS.filter((n) => scripts.some((s) => s.name === n)),
    fetches: [...fetches].sort(),
    main: main === null ? 'none' : (main.match(/class="([^"]*)"/) || [, ''])[1] + (/\bid="main"/.test(main) ? ' #main' : ''),
    sectionNav: /class="section-nav"/.test(body),
    stamped: (body.match(/\sdata-s="/g) || []).length,
  };
}

function render(rows) {
  const hashes = {};
  rows.forEach((r) => { if (r.prepaintHash) hashes[r.prepaintHash] = (hashes[r.prepaintHash] || 0) + 1; });
  const common = Object.entries(hashes).sort((a, b) => b[1] - a[1])[0];
  const out = [];
  out.push('# Page inventory');
  out.push('');
  out.push('**Generated by `node scripts/page-inventory.js` from the pages themselves. Never edit it by hand.**');
  out.push('`node scripts/docs-check.js` fails when it is behind the pages, and the pre-commit hook');
  out.push('regenerates it. Why it exists: [LESSONS.md](LESSONS.md), "Page transitions".');
  out.push('');
  out.push(`Shared chrome on every page, left out of the rows: ${SHARED_JS.map((n) => '`' + n + '`').join(', ')}, and the`);
  out.push(`token sheets ${TOKEN_CSS.map((n) => '`' + n + '`').join(', ')} (\`chrome.css\` imports them). A row says so when a page lacks one.`);
  out.push('');
  out.push('## Pages');
  out.push('');
  out.push('| Page | Nav tile | First frame waits for | Its own scripts | Fetches | `<main>` |');
  out.push('| --- | --- | --- | --- | --- | --- |');
  for (const r of rows) {
    const missing = SHARED_JS.filter((n) => !r.shared.includes(n));
    const scripts = r.own.join(', ') + (missing.length ? `${r.own.length ? '; ' : ''}no ${missing.join(', ')}` : '');
    const mainCell = r.main + (r.sectionNav ? ', section nav' : '') + (r.stamped ? `, ${r.stamped} stamped strings` : '');
    out.push(`| [${md(r.url)}](../${r.file}) | ${md(r.tile)} | ${md(r.blocking.join(', ') || '—')} | ${md(scripts || '—')} | ${md(r.fetches.join(', ') || '—')} | ${md(mainCell)} |`);
  }
  out.push('');
  out.push('## Stylesheet stamps');
  out.push('');
  out.push('The `?v=` on each stylesheet link. A sheet with no stamp is cached 4 hours by the zone');
  out.push('after a deploy ([architecture.md](architecture.md), "Token stamps").');
  out.push('');
  out.push('| Page | Stylesheets (`name@stamp`; `—` = no stamp) | Pre-paint script |');
  out.push('| --- | --- | --- |');
  for (const r of rows) {
    const css = r.sheets.map((s) => `${s.name}@${s.stamp || '—'}`).join(', ');
    const pp = !r.prepaintHash ? 'none' : r.prepaintHash === (common && common[0]) ? 'shared' : `DIFFERENT (${r.prepaintHash})`;
    out.push(`| ${md(r.url)} | ${md(css || '—')} | ${pp} |`);
  }
  out.push('');
  out.push('"Pre-paint script" is the inline theme script that must be byte-identical on every page,');
  out.push('with its hash in `_headers`\' CSP (CLAUDE.md, "Never").');
  out.push('');
  return out.join('\n');
}

function build() { return render(pages().map(inspect)); }

/** The doc's body without its front matter, to compare without the date. */
function bodyOf(text) { return text.replace(/^---[\s\S]*?---\n/, ''); }

function write() {
  const body = build();
  const old = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (old && bodyOf(old) === body) return false;
  const today = new Date().toISOString().slice(0, 10);
  const sources = ['scripts/page-inventory.js'];
  fs.writeFileSync(OUT, `---\nstatus: sop\nsources: [${sources.join(', ')}]\nupdated: ${today}\n---\n` + body);
  return true;
}
function behind() {
  if (!fs.existsSync(OUT)) return true;
  return bodyOf(fs.readFileSync(OUT, 'utf8')) !== build();
}

module.exports = { build, behind, write };

if (require.main === module) {
  const arg = process.argv[2];
  if (arg === '--check') {
    const b = behind();
    console.log('page-inventory: docs/pages.md ' + (b ? 'OUT OF DATE (run node scripts/page-inventory.js)' : 'current'));
    process.exit(b ? 1 : 0);
  }
  if (arg === '--hook') {
    try {
      const f = rel(OUT);
      const dirty = fs.existsSync(OUT) && git('diff', '--quiet', '--', f).status !== 0;
      if (write()) {
        if (dirty) console.log(`page-inventory: ${f} regenerated but NOT added (it has other unstaged edits)`);
        else { git('add', '--', f); console.log(`page-inventory: ${f} regenerated and added to this commit`); }
      }
    } catch (e) { console.log('page-inventory failed: ' + e.message); }
    process.exit(0);                                     // never blocks a commit
  }
  console.log('page-inventory: docs/pages.md ' + (write() ? 'written' : 'already current'));
}
