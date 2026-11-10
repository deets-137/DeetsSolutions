#!/usr/bin/env node
// Stamp each page's strings.js text into its HTML, for readers that run no JS.
//
// WHY. Some pages (the DeetsMusic page, its demo) ship empty [data-s] nodes
// and fill them from strings.js at load. Search engines that run JS see the
// words; AI crawlers (GPTBot, ClaudeBot, PerplexityBot) do not, and read a
// page of empty boxes. This script copies each string into its node in the
// HTML. The page's own JS still fills the same words over them at load, so
// strings.js stays the ONE place a string is written and a visitor sees no
// difference. Never edit stamped text in the HTML: edit strings.js.
//
// WHAT IT STAMPS. In every public page that has [data-s] nodes:
//   <p data-s="key"></p>   →   <p data-s="key">the string</p>
// and it leaves a node alone when
//   - it, or anything it sits inside, is `hidden` or `inert` (the page's JS
//     decides when that shows; a crawler has no use for a closed form);
//   - it carries `data-s-live` (shown or hidden per visitor at load, e.g. the
//     install steps for one browser: stamping all three would flash them);
//   - its string has a {token} (filled at run time);
//   - its key is not in strings.js (reported, never invented).
// Only text is stamped. data-s-alt / -ph / -label / -title stay JS-only.
// Pages marked noindex are skipped, as are build copies and dot-directories.
//
// IT RUNS ITSELF. Nobody has to remember it:
//   - .githooks/pre-commit runs `--hook` on every commit (one-time setup per
//     clone: `git config core.hooksPath .githooks`);
//   - scripts/dev.js runs it after the copy editor saves a string;
//   - scripts/docs-check.js reports a page that is out of date as a fact.
//
//   node scripts/stamp-strings.js           stamp, print what changed
//   node scripts/stamp-strings.js --check   change nothing; exit 1 if stale
//   node scripts/stamp-strings.js --hook    stamp, and `git add` a page it
//                                           changed (only one with no other
//                                           unstaged edits of its own)

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', 'scripts', 'docs', 'assets']);
const SKIP_PATHS = ['deetsmusic/demo/app'];   // a build copied from the DeetsMusic repo
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

const rel = (abs) => path.relative(ROOT, abs).split(path.sep).join('/');

// Every public page with [data-s] nodes.
function pages() {
  const out = [];
  (function walk(dir) {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name.startsWith('.') || SKIP_DIRS.has(ent.name)) continue;
        if (SKIP_PATHS.includes(rel(abs))) continue;
        walk(abs);
      } else if (ent.name.endsWith('.html')) {
        const src = fs.readFileSync(abs, 'utf8');
        if (!/\sdata-s="/.test(src)) continue;
        if (/<meta\s+name="robots"\s+content="[^"]*noindex/i.test(src)) continue;
        out.push(abs);
      }
    }
  })(ROOT);
  return out.sort();
}

// The page's strings: run each strings.js it loads against an empty window,
// and take the table that knows the most of the page's keys.
function stringsFor(abs, src) {
  const keys = [...src.matchAll(/\sdata-s="(\w+)"/g)].map((m) => m[1]);
  let best = null, bestScore = 0;
  for (const m of src.matchAll(/<script\b[^>]*\bsrc="([^"?]*strings\.js)[^"]*"/g)) {
    const file = m[1].startsWith('/') ? path.join(ROOT, m[1]) : path.resolve(path.dirname(abs), m[1]);
    if (!fs.existsSync(file)) continue;
    const win = {};
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), { window: win }, { filename: file });
    for (const table of Object.values(win)) {
      if (!table || typeof table !== 'object') continue;
      const score = keys.filter((k) => typeof table[k] === 'string').length;
      if (score > bestScore) { best = table; bestScore = score; }
    }
  }
  return best;
}

const escapeText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const hasAttr = (attrs, name) => new RegExp('\\s' + name + '(?=[\\s=/]|$)').test(attrs);

// One page's HTML, stamped. Returns { out, missing }.
function stampSource(src, S) {
  const TAG = /<!--[\s\S]*?-->|<(script|style)\b[\s\S]*?<\/\1\s*>|<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  const stack = [];          // open elements: { tag, off }
  const missing = [];
  let out = '', last = 0, m;
  while ((m = TAG.exec(src))) {
    const tag = m[3] && m[3].toLowerCase();
    if (!tag) continue;                                  // a comment, script or style
    if (m[2]) {                                          // a closing tag
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) { stack.length = i; break; }
      }
      continue;
    }
    const attrs = m[4] || '';
    const inside = stack.length ? stack[stack.length - 1].off : false;
    const off = inside || hasAttr(attrs, 'hidden') || hasAttr(attrs, 'inert');
    const selfClosed = /\/\s*$/.test(attrs) || VOID.has(tag);
    if (!selfClosed) stack.push({ tag, off });

    const key = (attrs.match(/\sdata-s="(\w+)"/) || [])[1];
    if (!key || selfClosed) continue;
    // Only a node holding plain text (or nothing) is a slot.
    const end = TAG.lastIndex;
    const body = src.slice(end).match(/^([^<]*)<\/([a-zA-Z][\w-]*)\s*>/);
    if (!body || body[2].toLowerCase() !== tag) continue;
    const value = S[key];
    let text;
    if (typeof value !== 'string') { missing.push(key); continue; }
    if (off || hasAttr(attrs, 'data-s-live') || /\{\w+\}/.test(value)) text = '';
    else text = escapeText(value);
    out += src.slice(last, end) + text;
    last = end + body[1].length;
  }
  return { out: out + src.slice(last), missing };
}

// Stamp every page. Returns [{ file, changed, missing }]; writes unless check.
function stampAll(opts) {
  const check = opts && opts.check;
  const results = [];
  for (const abs of pages()) {
    const src = fs.readFileSync(abs, 'utf8');
    const S = stringsFor(abs, src);
    if (!S) continue;
    const { out, missing } = stampSource(src, S);
    const changed = out !== src;
    if (changed && !check) fs.writeFileSync(abs, out);
    results.push({ file: rel(abs), changed, missing });
  }
  return results;
}

module.exports = { stampAll };

if (require.main === module) {
  const arg = process.argv[2];
  const git = (...args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });

  if (arg === '--hook') {
    // Which pages already carry unstaged edits of their own? Those are never
    // added here: `git add` would sweep the unrelated edits into the commit.
    const dirty = new Set(pages().map(rel).filter((f) => git('diff', '--quiet', '--', f).status !== 0));
    for (const r of stampAll()) {
      if (!r.changed) continue;
      if (dirty.has(r.file)) {
        console.log(`stamp-strings: ${r.file} restamped but NOT added (it has other unstaged edits); it rides your next commit of that file`);
      } else {
        git('add', '--', r.file);
        console.log(`stamp-strings: ${r.file} restamped from its strings.js and added to this commit`);
      }
    }
    process.exit(0);                                     // a stamp never blocks a commit
  }

  const check = arg === '--check';
  const results = stampAll({ check });
  let stale = 0;
  for (const r of results) {
    if (r.missing.length) console.log(`${r.file}: no string for ${[...new Set(r.missing)].join(', ')}`);
    if (r.changed) { stale++; console.log(`${r.file}: ${check ? 'OUT OF DATE (run node scripts/stamp-strings.js)' : 'stamped'}`); }
  }
  console.log(`stamp-strings: ${results.length} page${results.length === 1 ? '' : 's'}, ${stale} ${check ? 'out of date' : 'changed'}`);
  process.exit(check && stale ? 1 : 0);
}
