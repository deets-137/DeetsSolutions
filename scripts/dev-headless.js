// Headless tabs for the dev driver (scripts/dev-driver-server.js mounts
// this). One headless Edge, started on the first `open` and shared by every
// headless tab after it; it dies with the dev server.
//
// Why: a tab in the user's own Chrome is "hidden" whenever its window is
// covered, and a hidden tab runs no animation frames and throttles its
// timers to about one a minute. A headless page is never hidden, never
// covered, and screenshots straight from the renderer. A headless tab is an
// ordinary driver tab (its page runs the same injected driver), so every
// /__dev/* command works on it; it also gets the commands below, which need
// the browser itself. docs/tooling.md, "Headless".
//
//   open?url=/mahjong/?mock&w=1440&h=1000   a new headless tab → its driver id
//   shot?tab=&sel=&pad=&out=                PNG of the viewport, or of `sel`'s box
//   resize?tab=&w=&h=                       the tab's viewport
//   close?tab=                              closes it (headless/quit: the browser)

const fs = require('fs');
const os = require('os');
const path = require('path');
const cdp = require('./lib/cdp');

const SHOTS = path.join(os.tmpdir(), 'deets-dev-shots');
let browser = null, starting = null;
const pages = new Map();   // driver tab id → { page, url, shots }

async function ensureBrowser(q) {
  if (browser) return browser;
  if (!starting) {
    starting = cdp.launch({ width: Number(q.w) || 1440, height: Number(q.h) || 1000 })
      .then((b) => { browser = b; return b; })
      .finally(() => { starting = null; });
  }
  return starting;
}
process.on('exit', () => { if (browser) browser.proc.kill(); });
['SIGINT', 'SIGTERM'].forEach((s) => process.on(s, () => process.exit(0)));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// handlers: (q, ctx) → [status, body]. ctx.awaitTab(id) waits for the driver
// tab to connect; ctx.mainPort is the dev server's own port.
const H = {
  async open(q, ctx) {
    const b = await ensureBrowser(q);
    const url = new URL(q.url || '/', `http://localhost:${ctx.mainPort}`).href;
    const page = await b.open('about:blank');
    if (q.w || q.h) await page.resize(Number(q.w) || 1440, Number(q.h) || 1000);
    await page.goto(url);
    // the injected driver names the tab in sessionStorage once its stream says hello
    let id = null;
    for (let i = 0; i < 100 && !id; i++) {
      id = await page.eval("sessionStorage.getItem('deets-dev-tab')").catch(() => null);
      if (!id) await sleep(100);
    }
    if (!id) { page.close(); await b.closeTab(page.id); return [504, { ok: false, error: 'the page never joined the driver (is it on this dev server?)' }]; }
    pages.set(id, { page, url, shots: 0 });
    await ctx.awaitTab(id);
    return [200, { ok: true, tab: id, url, headless: true }];
  },
  async shot(q, ctx) {
    const h = pages.get(q.tab);
    if (!h) return [404, { ok: false, error: `${q.tab || 'no tab'} is not a headless tab (open one with /__dev/open)` }];
    let clip = null;
    if (q.sel) {
      const pad = Number(q.pad) || 0;
      clip = await h.page.eval(`(() => {
        const e = document.querySelector(${JSON.stringify(q.sel)});
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return { x: Math.max(0, r.left - ${pad}), y: Math.max(0, r.top - ${pad}), width: r.width + 2 * ${pad}, height: r.height + 2 * ${pad} };
      })()`);
      if (!clip) return [404, { ok: false, error: `nothing matches ${q.sel}` }];
    }
    const png = await h.page.shot(clip);
    fs.mkdirSync(SHOTS, { recursive: true });
    const out = q.out || path.join(SHOTS, `${q.tab}-${String(++h.shots).padStart(3, '0')}.png`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, png);
    return [200, { ok: true, tab: q.tab, file: out, bytes: png.length, clip }];
  },
  async resize(q) {
    const h = pages.get(q.tab);
    if (!h) return [404, { ok: false, error: `${q.tab || 'no tab'} is not a headless tab` }];
    await h.page.resize(Number(q.w) || 1440, Number(q.h) || 1000);
    return [200, { ok: true, tab: q.tab, viewport: [Number(q.w) || 1440, Number(q.h) || 1000] }];
  },
  async close(q) {
    const h = pages.get(q.tab);
    if (!h) return [404, { ok: false, error: `${q.tab || 'no tab'} is not a headless tab` }];
    h.page.close(); await browser.closeTab(h.page.id); pages.delete(q.tab);
    return [200, { ok: true, closed: q.tab }];
  },
  // slow?tab=&rate=0.1 — every CSS and Web Animation plays at `rate` (1 = real
  // time): watch a flight by eye. DeetsMusic's shots.mjs --slow, same call.
  async slow(q) {
    const h = pages.get(q.tab);
    if (!h) return [404, { ok: false, error: `${q.tab || 'no tab'} is not a headless tab` }];
    const rate = Number(q.rate) || 1;
    await h.page.send('Animation.enable');
    await h.page.send('Animation.setPlaybackRate', { playbackRate: rate });
    return [200, { ok: true, tab: q.tab, rate }];
  },
  // perf?tab=&js=<expression>&ms=1500 — what the main thread did on each
  // frame while `js` ran (awaited) and `ms` more passed: the frames drawn,
  // the slow ones (main-thread work over `budget`, default 12 ms) with what
  // filled them, and the totals by kind. After DeetsMusic's frame-why.mjs. A
  // composited animation (transform, opacity) needs no main-thread frame at
  // all, so a slow frame during one is the thing to explain.
  async perf(q) {
    const h = pages.get(q.tab);
    if (!h) return [404, { ok: false, error: `${q.tab || 'no tab'} is not a headless tab` }];
    const budget = Number(q.budget) || 12, events = [];
    const off = h.page.on('Tracing.dataCollected', (p) => events.push(...p.value));
    const done = h.page.once('Tracing.tracingComplete');
    await h.page.send('Tracing.start', {
      transferMode: 'ReportEvents',
      // RunTask (a whole main-thread task) rides the disabled-by-default category
      traceConfig: { includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline',
        'disabled-by-default-devtools.timeline.frame', 'blink.user_timing'] },
    });
    let value = null, error = null;
    try { if (q.js) value = await h.page.eval(q.js); } catch (e) { error = String(e.message || e); }
    await sleep(Number(q.ms) || 1500);
    await h.page.send('Tracing.end');
    await done; off();
    return [200, { ok: true, tab: q.tab, value, error, ...frameReport(events, budget) }];
  },
  async 'headless/quit'() {
    const n = pages.size;
    pages.clear();
    if (browser) { await browser.close(); browser = null; }
    return [200, { ok: true, closedTabs: n }];
  },
};

/* A trace's main-thread story. Its renderer main thread is the
   CrRendererMain with the most events (a headless run has one page doing
   work). Long tasks are its top-level RunTask slices over `budget`; each
   lists the kinds of work inside it. Durations in ms. */
const KINDS = ['FunctionCall', 'EvaluateScript', 'TimerFire', 'FireAnimationFrame', 'EventDispatch',
  'UpdateLayoutTree', 'Layout', 'PrePaint', 'Paint', 'Layerize', 'UpdateLayer', 'ParseHTML', 'HitTest'];
function frameReport(events, budget) {
  const mains = events.filter((e) => e.ph === 'M' && e.name === 'thread_name' && e.args && e.args.name === 'CrRendererMain');
  const count = (pid, tid) => events.filter((e) => e.pid === pid && e.tid === tid).length;
  const main = mains.sort((a, b) => count(b.pid, b.tid) - count(a.pid, a.tid))[0];
  if (!main) return { frames: null, note: 'no renderer main thread in the trace' };
  const own = events.filter((e) => e.pid === main.pid && e.tid === main.tid && e.ph === 'X' && e.dur != null);
  const ms = (us) => +(us / 1000).toFixed(2);
  const inside = (task) => {
    const by = {};
    own.forEach((e) => {
      if (e === task || !KINDS.includes(e.name) || e.ts < task.ts || e.ts + e.dur > task.ts + task.dur) return;
      by[e.name] = (by[e.name] || 0) + e.dur;
    });
    return Object.fromEntries(Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, ms(v)]));
  };
  const tasks = own.filter((e) => e.name === 'RunTask' || e.name === 'ThreadControllerImpl::RunTask');
  const t0 = Math.min(...own.map((e) => e.ts));
  const long = tasks.filter((t) => t.dur > budget * 1000).sort((a, b) => b.dur - a.dur).slice(0, 12)
    .map((t) => ({ at: ms(t.ts - t0), ms: ms(t.dur), work: inside(t) }));
  const totals = {};
  own.forEach((e) => { if (KINDS.includes(e.name)) totals[e.name] = (totals[e.name] || 0) + e.dur; });
  const frames = events.filter((e) => e.name === 'DrawFrame').length;
  const mainFrames = own.filter((e) => e.name === 'BeginMainFrame' || e.name === 'Animation Frame Fired').length;
  return {
    frames, mainFrames, tasks: tasks.length, budgetMs: budget,
    longTasks: long,
    totals: Object.fromEntries(Object.entries(totals).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, ms(v)])),
  };
}

module.exports = {
  handles: (cmd) => Object.prototype.hasOwnProperty.call(H, cmd),
  run: (cmd, q, ctx) => H[cmd](q, ctx).catch((e) => [500, { ok: false, error: String(e.message || e) }]),
  isHeadless: (id) => pages.has(id),
};
