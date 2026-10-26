// A Node client for the dev driver's curl API (docs/tooling.md, §3), for
// recipes (scripts/dev-run.js) and anything else that drives a tab from a
// script instead of from curl.
//
//   const dev = await require('./lib/dev-client').connect();   // finds the server
//   const tab = await dev.open('/mahjong/?mock');               // a headless tab
//   await tab.cmd('table', { code: 'x1', bots: 3, start: 1, autoroll: 1 });
//   await tab.cmd('turn');
//   const { file } = await tab.cmd('shot', { sel: '.mj-bento' });
//
// cmd() resolves with the command's `result` (or the whole body for the
// server's own commands) and throws on { ok: false }.

const START = 8787, SPAN = 40;

async function probe(port) {
  try {
    const r = await fetch(`http://localhost:${port}/__dev/tabs`, { signal: AbortSignal.timeout(800) });
    return r.ok && (await r.json()).ok === true;
  } catch (e) { return false; }
}

// the dev server on `port`, else the first one answering from 8787 up
async function find(port) {
  if (port) { if (await probe(port)) return port; throw new Error(`no dev server on ${port}`); }
  for (let p = START; p < START + SPAN; p++) if (await probe(p)) return p;
  throw new Error('no dev server found from 8787 up (npm run dev)');
}

async function connect(opts = {}) {
  const port = await find(opts.port || Number(process.env.DEETS_DEV_PORT) || null);
  const base = `http://localhost:${port}/__dev/`;
  async function call(cmd, args = {}, tab) {
    // every argument as a string, the way a query string carries it: the
    // page's commands test flags as "1" / "0"
    const q = {};
    for (const k in args) if (args[k] != null) q[k] = String(args[k]);
    if (tab) q.tab = tab;
    // POST JSON: no quoting trouble for `js`, `when`, `do`
    const r = await fetch(base + cmd, { method: 'POST', body: JSON.stringify(q) });
    const body = await r.json();
    if (!body.ok) {
      const err = new Error(`${cmd}: ${body.error || r.status}`);
      err.body = body;
      throw err;
    }
    return 'result' in body ? body.result : body;
  }
  function tabApi(id) {
    return {
      id,
      cmd: (c, a) => call(c, a, id),
      eval: (js) => call('eval', { js }, id),
      shot: (a) => call('shot', a, id),
      close: () => call('close', {}, id),
    };
  }
  return {
    port,
    call,
    tab: tabApi,
    tabs: async () => (await call('tabs')).tabs,
    // a new headless tab at `url` (a path on this server)
    async open(url, size = {}) {
      const r = await call('open', { url, w: size.w, h: size.h });
      return tabApi(r.tab);
    },
  };
}

module.exports = { connect, find };
