// Runs a dev-driver recipe: a whole test flow in one call, headless by
// default, printing one JSON result. docs/tooling.md, "Recipes".
//
//   node scripts/dev-run.js                      lists the recipes
//   node scripts/dev-run.js <recipe> [k=v ...]   runs one
//
// Common args: port= (the dev server; default: found from 8787 up),
// tab= (drive that tab instead of opening a headless one), keep=1 (leave
// the headless tab open afterwards). Each recipe is scripts/recipes/<name>.js:
//   module.exports = { about: '…', args: { k: 'what it does' }, url: '/path' | (args) => '/path',
//                      run: async (ctx) => result }
// with ctx = { dev, tab, args, log, out } (out: a fresh folder in tmp for
// the recipe's files).

const fs = require('fs');
const os = require('os');
const path = require('path');
const client = require('./lib/dev-client');

const DIR = path.join(__dirname, 'recipes');

function recipes() {
  return fs.readdirSync(DIR).filter((f) => f.endsWith('.js')).map((f) => f.slice(0, -3)).sort();
}

async function main() {
  const [name, ...rest] = process.argv.slice(2);
  if (!name || name === 'help') {
    for (const r of recipes()) {
      const m = require(path.join(DIR, r));
      console.log(`${r.padEnd(10)} ${m.about}`);
      for (const [k, v] of Object.entries(m.args || {})) console.log(`${''.padEnd(12)}${k}= ${v}`);
    }
    return;
  }
  if (!recipes().includes(name)) throw new Error(`no recipe ${name} (have: ${recipes().join(', ')})`);
  const args = Object.fromEntries(rest.map((kv) => { const i = kv.indexOf('='); return i < 0 ? [kv, '1'] : [kv.slice(0, i), kv.slice(i + 1)]; }));
  const recipe = require(path.join(DIR, name));
  const dev = await client.connect({ port: Number(args.port) || null });
  const out = fs.mkdtempSync(path.join(os.tmpdir(), `deets-${name}-`));
  const log = (...m) => console.error(`[${name}]`, ...m);   // progress on stderr, the result on stdout
  const opened = !args.tab;
  const url = typeof recipe.url === 'function' ? recipe.url(args) : (recipe.url || '/');
  const tab = args.tab ? dev.tab(args.tab) : await dev.open(url, { w: args.w, h: args.h });
  log(`${opened ? 'headless ' : ''}tab ${tab.id} on :${dev.port}`);
  try {
    const result = await recipe.run({ dev, tab, args, log, out });
    console.log(JSON.stringify({ ok: true, recipe: name, tab: tab.id, out, result }, null, 2));
  } finally {
    if (opened && args.keep !== '1') await tab.close().catch(() => {});
  }
}

main().catch((e) => {
  console.log(JSON.stringify({ ok: false, error: String(e.message || e), body: e.body }, null, 2));
  process.exit(1);
});
