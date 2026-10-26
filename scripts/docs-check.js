// The docs checker: `node scripts/docs-check.js` (docs/tooling.md, §5).
// Deterministic, fast, Node built-ins only. Adapted from the DeetsMusic
// repo's scripts/docs-check.mjs (DeetsMusic docs/DOCS-ORG.md), cut to what
// a flat static site needs.
//
// FACTS (any one fails the run, exit 1):
//   1. every markdown link in docs/, CLAUDE.md and README.md resolves
//      (a repo path, with an optional #anchor or :line); URLs are skipped
//   2. every doc in docs/ has front matter: a known status, an updated
//      date, and sources that exist
//   3. every `docs/<name>.md` a code comment cites exists (the games cite
//      their doc sections from engine.js, cities.js, …)
// WARNINGS (printed, never fail):
//   4. stale: a doc's sources have commits newer than its `updated` —
//      re-read the doc against them, then bump `updated`
//   5. a `<name>.md` mentioned in a doc's prose with no such file anywhere
//      here. Plans (idea, project, parked) and other repos' docs are
//      skipped: a plan names files not made yet.
//
// Fenced code blocks are skipped everywhere (examples, not claims).
//
//   node scripts/docs-check.js           report; exit 1 on any fact
//   node scripts/docs-check.js --quiet   facts only

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'docs');
const STATUS = ['live', 'built', 'designed', 'project', 'parked', 'idea', 'foundation', 'sop', 'archived'];
const PLAN = ['idea', 'project', 'parked', 'designed'];
const quiet = process.argv.includes('--quiet');

const facts = [];
const warns = [];
const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');

function unfence(src) {
  return src.replace(/^(```|~~~)[\s\S]*?^\1/gm, (m) => m.replace(/[^\n]/g, ' '));
}
function lineOf(src, at) { return src.slice(0, at).split('\n').length; }

function frontMatter(src) {
  const m = src.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  out.sources = (out.sources || '').replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean);
  return out;
}

function lastCommit(file) {
  try {
    return execFileSync('git', ['log', '-1', '--format=%cs', '--', file], { cwd: ROOT }).toString().trim();
  } catch (e) { return ''; }
}

// every file name in the tree, for check 5 (node_modules and .git skipped)
const names = new Set();
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs); else names.add(e.name.toLowerCase());
  }
})(ROOT);

// ── 1. links ──
const linked = [path.join(ROOT, 'CLAUDE.md'), path.join(ROOT, 'README.md')]
  .concat(fs.readdirSync(DOCS).filter((f) => f.endsWith('.md')).map((f) => path.join(DOCS, f)))
  .filter((f) => fs.existsSync(f));
for (const file of linked) {
  const src = unfence(fs.readFileSync(file, 'utf8'));
  for (const m of src.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = m[1];
    if (/^[a-z]+:/i.test(target) || target.startsWith('#') || target.startsWith('/')) continue;
    const bare = decodeURI(target.split('#')[0]).replace(/:\d+(-\d+)?$/, '');
    if (!bare) continue;
    if (!fs.existsSync(path.resolve(path.dirname(file), bare))) {
      facts.push(`${rel(file)}:${lineOf(src, m.index)}  broken link → ${target}`);
    }
  }
}

// ── 2, 4, 5. front matter, staleness, mentions ──
for (const f of fs.readdirSync(DOCS).filter((x) => x.endsWith('.md'))) {
  const abs = path.join(DOCS, f);
  const raw = fs.readFileSync(abs, 'utf8');
  const fm = frontMatter(raw);
  const where = 'docs/' + f;
  if (!fm) { facts.push(`${where}  no front matter (status, sources, updated)`); continue; }
  if (!STATUS.includes(fm.status)) facts.push(`${where}  status "${fm.status || ''}" is not one of ${STATUS.join(' | ')}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fm.updated || '')) facts.push(`${where}  updated "${fm.updated || ''}" is not a YYYY-MM-DD date`);
  for (const s of fm.sources) {
    if (!fs.existsSync(path.join(ROOT, s))) facts.push(`${where}  source ${s} does not exist`);
  }
  // a plan or an SOP goes stale by decision or process, which no commit shows
  if (fm.updated && ['live', 'built', 'foundation'].includes(fm.status)) {
    const newer = fm.sources.filter((s) => fs.existsSync(path.join(ROOT, s)) && lastCommit(s) > fm.updated);
    if (newer.length) warns.push(`${where}  stale? updated ${fm.updated}, newer commits in ${newer.join(', ')}`);
  }
  if (!PLAN.includes(fm.status)) {
    const src = unfence(raw);
    const seen = new Set();
    for (const m of src.matchAll(/(?<![\w/.-])([\w-]+\.md)\b/g)) {
      const name = m[1];
      if (seen.has(name) || names.has(name.toLowerCase())) continue;
      // another repo's doc: the paragraph names a sibling repo or a ../ path
      const para = src.slice(Math.max(0, src.lastIndexOf('\n\n', m.index)), src.indexOf('\n\n', m.index) >>> 0);
      if (/\.\.\/|Deets[A-Z]\w+|https?:\/\//.test(para)) continue;
      seen.add(name);
      warns.push(`${where}:${lineOf(src, m.index)}  mentions ${name}, which is not in this repo`);
    }
  }
}

// ── 3. code comments citing docs/<name>.md ──
const CODE = /\.(js|css|html|py|ps1|sh)$/;
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', '.claude'].includes(e.name)) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) { walk(abs); continue; }
    if (!CODE.test(e.name) || /deetsmusic[\\/]demo[\\/]app/.test(abs)) continue;
    const src = fs.readFileSync(abs, 'utf8');
    for (const m of src.matchAll(/(?<![\w./-])docs\/([\w-]+\.md)/g)) {
      // a line naming a sibling repo cites THAT repo's docs (DeetsMusic …)
      const line = src.slice(src.lastIndexOf('\n', m.index) + 1, src.indexOf('\n', m.index) >>> 0);
      if (/Deets(?!Solutions)[A-Z]\w+|\]\([A-Z-]+\.md\)/.test(line)) continue;
      if (!fs.existsSync(path.join(DOCS, m[1]))) facts.push(`${rel(abs)}:${lineOf(src, m.index)}  cites docs/${m[1]}, which does not exist`);
    }
  }
})(ROOT);

for (const x of facts) console.log('FACT  ' + x);
if (!quiet) for (const x of warns) console.log('warn  ' + x);
console.log(`docs-check: ${facts.length} fact${facts.length === 1 ? '' : 's'}, ${warns.length} warning${warns.length === 1 ? '' : 's'}`);
process.exit(facts.length ? 1 : 0);
