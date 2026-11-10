#!/usr/bin/env node
// Two generated things for search engines and AI crawlers. A visitor sees
// neither. Its sibling is scripts/stamp-strings.js; both run from
// .githooks/pre-commit, so nobody has to remember either.
//
// 1. PROJECT DATA on Cool Stuff. cool-stuff/index.html holds one hand-written
//    <article class="project"> card per project. This copies each card's
//    name, pitch, description, tags and links into a JSON-LD ItemList in the
//    page's <head>, between the `projects-ld` markers, so each project is a
//    named thing a crawler can cite. The cards stay the ONE place a project
//    is written: never edit the block, edit the card.
//
// 2. DATES in sitemap.xml. Each <url> carries a <lastmod>. In `--hook` mode a
//    page whose own files are staged in the commit gets today's date. A page
//    with no date yet gets its last commit's date. A wrong date is worse
//    than none, which is why only the commit hook moves one.
//    A page's "own files" are those under its directory (the home page:
//    index.html and js/home.js). Shared CSS and JS move no date.
//
//   node scripts/stamp-crawl.js           regenerate both, print what changed
//   node scripts/stamp-crawl.js --check   change nothing; exit 1 if the
//                                         project data is behind its cards
//   node scripts/stamp-crawl.js --hook    regenerate, date the staged pages,
//                                         and `git add` what changed (never a
//                                         file with other unstaged edits)

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const COOL = path.join(ROOT, 'cool-stuff', 'index.html');
const SITEMAP = path.join(ROOT, 'sitemap.xml');
const ORIGIN = 'https://deets.solutions';
const PERSON = ORIGIN + '/#person';
const BEGIN = '<!-- projects-ld:begin';
const END = '<!-- projects-ld:end -->';
const HOME_FILES = ['index.html', 'js/home.js'];

const git = (...args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });

// ── 1. project data ──────────────────────────────────────────────────────

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function text(html) {
  return html.replace(/<[^>]*>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(\w+);/g, (m, n) => (n in ENT ? ENT[n] : m))
    .replace(/\s+/g, ' ').trim();
}
const one = (card, cls) => {
  const m = card.match(new RegExp('<(\\w+)[^>]*class="' + cls + '"[^>]*>([\\s\\S]*?)</\\1>'));
  return m ? text(m[2]) : '';
};
const all = (card, cls) =>
  [...card.matchAll(new RegExp('<(\\w+)[^>]*class="' + cls + '"[^>]*>([\\s\\S]*?)</\\1>', 'g'))].map((m) => text(m[2]));

function projects(src) {
  const items = [];
  for (const m of src.matchAll(/<article class="project">([\s\S]*?)<\/article>/g)) {
    const card = m[1];
    const name = one(card, 'project__name');
    if (!name) continue;
    const links = [...card.matchAll(/<a[^>]*class="project__link"[^>]*href="([^"]+)"/g)]
      .map((l) => (l[1].startsWith('http') ? l[1] : new URL(l[1], ORIGIN + '/cool-stuff/').href));
    const repo = links.find((l) => /^https:\/\/github\.com\//.test(l));
    const page = links.find((l) => l.startsWith(ORIGIN));
    const item = { '@type': repo ? 'SoftwareSourceCode' : 'CreativeWork', name };
    const pitch = one(card, 'project__pitch');
    const desc = one(card, 'project__desc');
    if (pitch) item.abstract = pitch;
    if (desc || pitch) item.description = desc || pitch;
    const tags = all(card, 'project__chip');
    if (tags.length) item.keywords = tags.join(', ');
    const status = one(card, 'project__status');
    if (status) item.creativeWorkStatus = status;
    if (repo) item.codeRepository = repo;
    if (page || repo) item.url = page || repo;
    item.author = { '@id': PERSON };
    items.push(item);
  }
  return items;
}

function projectBlock(src) {
  const items = projects(src);
  const data = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    '@id': ORIGIN + '/cool-stuff/#projects',
    name: 'Cool Stuff I Did',
    url: ORIGIN + '/cool-stuff/',
    numberOfItems: items.length,
    itemListElement: items.map((item, i) => ({ '@type': 'ListItem', position: i + 1, item })),
  };
  // `<` never appears raw inside the block, so no card text can close it.
  const json = JSON.stringify(data, null, 2).replace(/</g, '\\u003c').split('\n').map((l) => '      ' + l).join('\n');
  return BEGIN + ' (generated from the cards below by scripts/stamp-crawl.js - edit a card, never this) -->\n'
    + '    <script type="application/ld+json">\n' + json + '\n    </script>\n    ' + END;
}

function stampProjects(check) {
  const src = fs.readFileSync(COOL, 'utf8');
  const eol = src.includes('\r\n') ? '\r\n' : '\n';
  const a = src.indexOf(BEGIN), b = src.indexOf(END);
  if (a < 0 || b < a) throw new Error('projects-ld markers not found in cool-stuff/index.html');
  const out = src.slice(0, a) + projectBlock(src).replace(/\n/g, eol) + src.slice(b + END.length);
  const changed = out !== src;
  if (changed && !check) fs.writeFileSync(COOL, out);
  return changed;
}

// ── 2. sitemap dates ─────────────────────────────────────────────────────

const today = () => {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

// "/sotd/" → "sotd/"; the home page → "".
const dirOf = (loc) => loc.replace(ORIGIN, '').replace(/^\//, '');

// Which sitemap URL does a repo file belong to? The deepest directory wins,
// so deetsmusic/demo/x is the demo's and never the DeetsMusic page's.
function ownerOf(file, dirs) {
  if (HOME_FILES.includes(file)) return '';
  let best = null;
  for (const d of dirs) if (d && file.startsWith(d) && (best === null || d.length > best.length)) best = d;
  return best;
}

function stampSitemap(staged) {
  const src = fs.readFileSync(SITEMAP, 'utf8');
  const dirs = [...src.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => dirOf(m[1]));
  const touched = new Set((staged || []).map((f) => ownerOf(f, dirs)).filter((d) => d !== null));
  const out = src.replace(/<url><loc>([^<]+)<\/loc>(?:<lastmod>([^<]*)<\/lastmod>)?<\/url>/g, (_, loc, had) => {
    const dir = dirOf(loc);
    let date = had;
    if (touched.has(dir)) date = today();
    else if (!date) {
      const paths = dir ? [dir] : HOME_FILES;
      date = git('log', '-1', '--format=%cs', '--', ...paths).stdout.trim() || today();
    }
    return `<url><loc>${loc}</loc><lastmod>${date}</lastmod></url>`;
  });
  const changed = out !== src;
  if (changed) fs.writeFileSync(SITEMAP, out);
  return changed;
}

module.exports = { stampProjects };

if (require.main === module) {
  const arg = process.argv[2];

  if (arg === '--check') {
    const behind = stampProjects(true);
    console.log('stamp-crawl: project data ' + (behind ? 'OUT OF DATE (run node scripts/stamp-crawl.js)' : 'current'));
    process.exit(behind ? 1 : 0);
  }

  if (arg === '--hook') {
    const files = ['cool-stuff/index.html', 'sitemap.xml'];
    const dirty = new Set(files.filter((f) => git('diff', '--quiet', '--', f).status !== 0));
    const done = [];
    try {
      if (stampProjects(false)) done.push('cool-stuff/index.html');
      // Staged AFTER the project stamp may have added to it: read the index now.
      for (const f of done) if (!dirty.has(f)) git('add', '--', f);
      const staged = git('diff', '--cached', '--name-only').stdout.split('\n').filter(Boolean);
      if (stampSitemap(staged)) done.push('sitemap.xml');
      for (const f of done) {
        if (dirty.has(f)) console.log(`stamp-crawl: ${f} regenerated but NOT added (it has other unstaged edits)`);
        else { git('add', '--', f); console.log(`stamp-crawl: ${f} regenerated and added to this commit`); }
      }
    } catch (e) { console.log('stamp-crawl failed: ' + e.message); }
    process.exit(0);                                     // never blocks a commit
  }

  const a = stampProjects(false);
  const b = stampSitemap([]);
  console.log(`stamp-crawl: project data ${a ? 'regenerated' : 'current'}, sitemap ${b ? 'dates filled' : 'unchanged'}`);
}
