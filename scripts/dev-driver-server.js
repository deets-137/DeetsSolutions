// The dev driver's server half (scripts/dev.js wires it in). Lets curl drive
// a real browser tab: each page gets the page half (scripts/dev-driver/*.js,
// joined by pageScript below) injected, which
// holds an EventSource to a SIDE port (its own origin, so its long-lived
// connections never eat the page's six-per-host HTTP/1.1 pool). A curl to
// /__dev/<cmd> on the main port is relayed down that stream; the page
// POSTs its answer back and that becomes the HTTP response.
//
// Localhost only: both ports bind 127.0.0.1, every request's Host must be
// localhost/127.0.0.1 (no DNS rebinding), and the side port only answers
// pages from the main port's origin. Nothing here is in the served tree.
// API: docs/architecture.md, "Dev driver".

const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');

const headless = require('./dev-headless');

// the page half, joined in this order inside one function scope (core.js
// says how the parts share it). Every games/*.js joins between the
// commands and the wire. Read on every request, so an edit needs only a reload.
const PARTS_DIR = path.join(__dirname, 'dev-driver');
const PARTS = ['core.js', 'mock.js', 'look.js', 'anims.js', 'clock.js', 'games/*', 'wire.js'];
function pageScript(sidePort) {
  const files = PARTS.flatMap((p) => p === 'games/*'
    ? fs.readdirSync(path.join(PARTS_DIR, 'games')).filter((f) => f.endsWith('.js')).sort().map((f) => 'games/' + f)
    : [p]);
  const body = files.map((f) => `/* ═══ ${f} ═══ */\n` + fs.readFileSync(path.join(PARTS_DIR, f), 'utf8')).join('\n');
  return '(function () {\n"use strict";\nif (!/^(localhost|127\\.0\\.0\\.1)$/.test(location.hostname)) return;\n' +
    body.replace('__SIDE_PORT__', String(sidePort)) + '\n})();\n';
}
// ── the dev trace (scripts/dev-trace.js, the page half) ──
// Every page posts its events to the side port's /trace. They are kept in
// memory (the last TRACE_MAX) and appended to a JSONL file in the temp dir,
// so a server restart keeps the history. Read with GET /__dev/trace.
const os = require('os');
const TRACE_FILE = path.join(os.tmpdir(), 'deets-site-dev', 'trace.jsonl');
const TRACE_MAX = 5000;
const TRACE_FILE_MAX = 5 * 1024 * 1024;
const trace = [];
function traceScript(sidePort) {
  return fs.readFileSync(path.join(__dirname, 'dev-trace.js'), 'utf8').replace('__SIDE_PORT__', String(sidePort));
}
function keepTrace(events) {
  const ok = events.filter((e) => e && typeof e.kind === 'string' && typeof e.page === 'string').slice(0, 200);
  for (const e of ok) {
    trace.push(e);
    if (trace.length > TRACE_MAX) trace.shift();
    // one console line for what matters at a glance: each arrival's transition
    if (e.kind === 'reveal' || e.kind === 'vt-skipped' || e.kind === 'bfcache-miss') {
      const d = e.data || {};
      const what = e.kind === 'reveal'
        ? `transition ${d.vt ? 'yes' : 'NO'}${d.names && d.names.duplicates.length ? ' DUPLICATE ' + d.names.duplicates.join(',') : ''}`
        : e.kind === 'vt-skipped' ? `transition SKIPPED: ${d.reason}` : `not from bfcache: ${(d.reasons || []).join(', ')}`;
      console.log(`[trace] ${e.tab || '-'} ${e.page} ${what}`);
    }
  }
  try {
    fs.mkdirSync(path.dirname(TRACE_FILE), { recursive: true });
    if (fs.existsSync(TRACE_FILE) && fs.statSync(TRACE_FILE).size > TRACE_FILE_MAX) fs.renameSync(TRACE_FILE, TRACE_FILE + '.old');
    fs.appendFileSync(TRACE_FILE, ok.map((e) => JSON.stringify(e)).join('\n') + (ok.length ? '\n' : ''));
  } catch (e) { /* the log in memory still works */ }
}
// One line per event: time, tab, page, kind, then the data as key=value.
function traceLine(e) {
  const flat = (v) => (v && typeof v === 'object' ? JSON.stringify(v) : String(v));
  const kv = Object.entries(e.data || {}).filter(([, v]) => v !== null && v !== undefined)
    .map(([k, v]) => `${k}=${flat(v)}`).join(' ');
  return `${e.at.slice(11, 23)} ${e.tab || '-'} ${e.visit} ${e.page} ${e.kind} ${kv}`;
}
// One line per page visit: how it arrived, its transition, frames, shifts,
// long frames, fonts and loading. Visits are in arrival order.
function traceSummary(events) {
  const visits = new Map();
  for (const e of events) {
    if (!visits.has(e.visit)) visits.set(e.visit, { tab: e.tab, page: e.page, at: e.at, ev: [] });
    visits.get(e.visit).ev.push(e);
  }
  return [...visits.values()].map((v) => {
    const one = (k) => v.ev.find((e) => e.kind === k);
    const all = (k) => v.ev.filter((e) => e.kind === k);
    const arrive = one('arrive'), reveal = one('reveal'), skipped = one('vt-skipped');
    const fr = all('frames'), res = one('resources'), fcp = all('paint').find((p) => p.data.name === 'first-contentful-paint');
    const loafs = all('loaf'), shifts = all('shift').filter((s) => !s.data.input), lags = all('lag');
    const lateFonts = all('fonts').filter((f) => fcp && f.data.ms > fcp.data.ms);
    const parts = [];
    if (arrive) parts.push(`${arrive.data.type}${arrive.data.activation ? '/' + arrive.data.activation : ''} from ${arrive.data.from || '?'}` +
      (arrive.data.sinceClickMs != null ? ` click→page ${arrive.data.sinceClickMs}ms` : ''));
    if (one('bfcache-restore')) parts.push('restored from bfcache');
    const miss = one('bfcache-miss');
    if (miss) parts.push(`bfcache miss: ${miss.data.reasons.join(', ') || '?'}`);
    if (reveal) parts.push(`transition ${skipped ? 'SKIPPED (' + skipped.data.reason + ')' : reveal.data.vt ? 'ran' : 'none'}` +
      (reveal.data.names.duplicates.length ? ` DUPLICATE names ${reveal.data.names.duplicates.join(',')}` : '') +
      (reveal.data.vt && !reveal.data.names.tile ? ' (no tile on this page)' : '') +
      (reveal.data.fonts.loading.length ? ` fonts loading at first frame: ${reveal.data.fonts.loading.join(', ')}` : ''));
    for (const f of fr) parts.push(`${f.data.label} frames ${f.data.frames}@${f.data.hz || '?'}hz dropped ${f.data.dropped} worst ${f.data.worstMs}ms`);
    if (fcp) parts.push(`FCP ${fcp.data.ms}ms`);
    if (lateFonts.length) parts.push(`fonts after FCP: ${lateFonts.map((f) => f.data.loaded.join('+') + '@' + f.data.ms + 'ms').join(', ')}`);
    if (shifts.length) parts.push(`shifts ${shifts.length} (CLS ${shifts.reduce((s, x) => s + x.data.value, 0).toFixed(3)}: ${[...new Set(shifts.flatMap((s) => s.data.moved))].slice(0, 3).join(', ')})`);
    if (loafs.length) parts.push(`long frames ${loafs.length}, worst ${Math.max(...loafs.map((l) => l.data.ms))}ms`);
    if (lags.length) parts.push(`main thread late ${lags.length}x, worst ${Math.max(...lags.map((l) => l.data.lateMs))}ms`);
    const cpu = all('cpu').filter((c) => c.data.state && c.data.state !== 'nominal');
    if (cpu.length) parts.push(`cpu ${[...new Set(cpu.map((c) => c.data.state))].join('/')}`);
    if (res) parts.push(`resources ${res.data.total}: cache ${res.data.cache}, 304 ${res.data.revalidated}, network ${res.data.network}` +
      (res.data.blocking.length ? `; slowest blocking ${res.data.blocking[0].src} ${res.data.blocking[0].ms}ms` : ''));
    const errs = all('error');
    if (errs.length) parts.push(`errors ${errs.length}: ${errs[0].data.text}`);
    return `${v.at.slice(11, 19)} ${v.tab || '-'} ${v.page}\n    ${parts.join('\n    ')}`;
  });
}

const CMD_TIMEOUT = 30000;
const WAIT_CAP = 590000;           // a single Bash call allows 600 s
const GONE_MS = 120000;            // disconnected tabs drop off the list after this

const tabs = new Map();            // id → { id, res, info, seen, active, connected }
const pending = new Map();         // rid → { resolve, timer }

function okHost(req) {
  return /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '');
}

function json(res, status, body, extra) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra });
  res.end(JSON.stringify(body, null, 2) + '\n');
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (c) => { raw += c; });
    req.on('end', () => resolve(raw));
  });
}

function newId() { return 't-' + crypto.randomBytes(2).toString('hex'); }

function prune() {
  const now = Date.now();
  for (const [id, t] of tabs) if (!t.connected && now - t.seen > GONE_MS) tabs.delete(id);
}

function listing() {
  prune();
  return [...tabs.values()].map((t) => ({
    id: t.id, connected: t.connected, lastSeen: new Date(t.seen).toISOString(),
    lastActive: t.active ? new Date(t.active).toISOString() : null, headless: headless.isHeadless(t.id), ...t.info,
  }));
}

// ?tab= wins. Otherwise: the only connected tab, else the only focused one,
// else the most recently active by a clear margin. Ties refuse.
function pick(want) {
  prune();
  if (want) {
    const t = tabs.get(want);
    if (!t) return { error: `no tab ${want}`, status: 404 };
    if (!t.connected) return { error: `tab ${want} is not connected (reloading or closed)`, status: 409 };
    return { tab: t };
  }
  const live = [...tabs.values()].filter((t) => t.connected);
  if (!live.length) return { error: 'no tab attached — open a page on this dev server first', status: 503 };
  if (live.length === 1) return { tab: live[0] };
  const focused = live.filter((t) => t.info && t.info.focused);
  if (focused.length === 1) return { tab: focused[0] };
  const byActive = live.slice().sort((a, b) => (b.active || 0) - (a.active || 0));
  if ((byActive[0].active || 0) - (byActive[1].active || 0) > 2000) return { tab: byActive[0] };
  return { error: 'several tabs and none is clearly the active one — pass ?tab=', status: 409 };
}

function relay(tab, cmd, args, timeout) {
  return new Promise((resolve) => {
    const rid = crypto.randomBytes(6).toString('hex');
    const timer = setTimeout(() => {
      pending.delete(rid);
      resolve({ ok: false, error: `tab ${tab.id} did not answer ${cmd} within ${timeout} ms` });
    }, timeout);
    pending.set(rid, { resolve, timer });
    tab.res.write(`event: cmd\ndata: ${JSON.stringify({ rid, cmd, args })}\n\n`);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Waits out a tab's reload: same id, a NEW stream (connectedAt moves).
async function awaitReconnect(id, since, timeout) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const t = tabs.get(id);
    if (t && t.connected && t.connectedAt > since && t.info) return t;
    await sleep(100);
  }
  return null;
}

function matches(state, q) {
  if (!state) return false;
  if (q.phase && !String(q.phase).split(',').includes(state.phase)) return false;
  if (q.handOver === '1' && !state.handOver) return false;
  if (q.handOver === '0' && state.handOver) return false;
  if (q.wallBelow && !(state.wallLeft != null && state.wallLeft < Number(q.wallBelow))) return false;
  if (q.until) return false;   // `until` is judged page-side (see wait below)
  return true;
}

// wait runs HERE, polling the tab, so it outlives any one browser-tool call
// and survives the tab reloading underneath it.
async function wait(id, q) {
  const timeout = Math.min(Number(q.timeout) || 60000, WAIT_CAP);
  const every = Math.max(100, Number(q.every) || 400);
  const end = Date.now() + timeout;
  const t0 = Date.now();
  let last = null;
  while (Date.now() < end) {
    const t = tabs.get(id);
    if (t && t.connected) {
      const r = await relay(t, q.until ? 'eval' : 'state', q.until ? { js: q.until } : {}, 10000);
      if (r.ok) {
        last = r.result;
        if (q.until ? !!r.result : matches(r.result, q)) {
          return [200, { ok: true, tab: id, waitedMs: Date.now() - t0, result: r.result }];
        }
      }
    }
    await sleep(every);
  }
  return [408, { ok: false, tab: id, error: `timed out after ${timeout} ms`, last }];
}

function mount(mainPort, sidePort) {
  const origin = `http://localhost:${mainPort}`;
  const cors = (req) => {
    const o = req.headers.origin;
    return o === origin || o === `http://127.0.0.1:${mainPort}` ? { 'access-control-allow-origin': o } : null;
  };

  // ── side port: the pages' stream + their replies ──
  const side = http.createServer(async (req, res) => {
    const allow = cors(req);
    if (!okHost(req) || !allow) return json(res, 403, { ok: false, error: 'localhost pages only' });
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname === '/trace') {   // the dev trace's events
      try { keepTrace([].concat(JSON.parse(await readBody(req)))); } catch (e) { return json(res, 400, { ok: false }, allow); }
      return json(res, 200, { ok: true }, allow);
    }
    if (req.method === 'POST' && url.pathname === '/bye') {   // pagehide's beacon
      const id = (await readBody(req)).trim();
      const t = tabs.get(id);
      if (t && t.connected) { t.connected = false; t.seen = Date.now(); t.res.end(); }
      return json(res, 200, { ok: true }, allow);
    }
    if (req.method === 'GET' && url.pathname === '/stream') {
      let id = url.searchParams.get('id') || '';
      // a duplicated tab copies sessionStorage, so its id is already live.
      // A reload's old stream may close a beat after the new one opens (its
      // pagehide beacon usually beats it), so give it a moment first.
      for (let i = 0; i < 10 && tabs.get(id) && tabs.get(id).connected; i++) await sleep(100);
      const clash = tabs.get(id);
      if (!/^t-[0-9a-f]{4}$/.test(id) || (clash && clash.connected)) {
        do id = newId(); while (tabs.has(id));
      }
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', ...allow });
      const prev = tabs.get(id);
      const tab = { id, res, info: prev && prev.info, seen: Date.now(), active: prev && prev.active,
        connected: true, connectedAt: Date.now() };
      tabs.set(id, tab);
      res.write(`event: hello\ndata: ${JSON.stringify({ id })}\n\n`);
      const ping = setInterval(() => res.write(': ping\n\n'), 15000);
      req.on('close', () => {
        clearInterval(ping);
        if (tabs.get(id) === tab) { tab.connected = false; tab.seen = Date.now(); }
      });
      return;
    }
    if (req.method === 'POST' && (url.pathname === '/reply' || url.pathname === '/beat')) {
      let body;
      try { body = JSON.parse(await readBody(req)); } catch (e) { return json(res, 400, { ok: false }, allow); }
      const tab = tabs.get(body.id);
      if (tab) {
        tab.seen = Date.now();
        if (body.info) {
          tab.info = body.info;
          if (body.info.activeAt) tab.active = body.info.activeAt;
        }
      }
      if (url.pathname === '/reply') {
        const p = pending.get(body.rid);
        if (p) { clearTimeout(p.timer); pending.delete(body.rid); p.resolve(body); }
      }
      return json(res, 200, { ok: true }, allow);
    }
    json(res, 404, { ok: false }, allow);
  });
  side.listen(sidePort, '127.0.0.1');

  // ── main port: /__dev/* for curl ──
  devRoute.sidePort = sidePort;
  return devRoute;
  async function devRoute(req, res) {
    if (!okHost(req)) return json(res, 403, { ok: false, error: 'localhost only' });
    const url = new URL(req.url, 'http://x');
    const cmd = url.pathname.replace(/^\/__dev\//, '');
    if (cmd === 'driver.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(pageScript(sidePort));
    }
    if (cmd === 'trace.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(traceScript(sidePort));
    }
    // GET /__dev/trace — the dev trace (docs/tooling.md §3c). ?summary=1 one
    // block per page visit; ?json=1 the raw events; otherwise one line per
    // event. Filters: since= (ISO time, or minutes ago as 5m), tab=, page=,
    // kind= (comma list), limit= (default 300). ?clear=1 empties it.
    if (cmd === 'trace') {
      const p = Object.fromEntries(url.searchParams);
      if (p.clear === '1') { trace.length = 0; return json(res, 200, { ok: true, cleared: true }); }
      let since = 0;
      if (/^\d+m$/.test(p.since || '')) since = Date.now() - parseInt(p.since, 10) * 60000;
      else if (p.since) since = Date.parse(p.since) || 0;
      const kinds = p.kind ? p.kind.split(',') : null;
      const ev = trace.filter((e) => (!since || Date.parse(e.at) >= since) && (!p.tab || e.tab === p.tab) &&
        (!p.page || e.page.includes(p.page)) && (!kinds || kinds.includes(e.kind)));
      if (p.json === '1') return json(res, 200, { ok: true, events: ev.slice(-(Number(p.limit) || 300)) });
      const lines = p.summary === '1' ? traceSummary(ev).slice(-(Number(p.limit) || 40)) : ev.slice(-(Number(p.limit) || 300)).map(traceLine);
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      return res.end((lines.length ? lines.join('\n') : '(no trace events yet: open or click around a page on this dev server)') + '\n');
    }
    if (cmd === 'tabs') return json(res, 200, { ok: true, tabs: listing() });

    const q = Object.fromEntries(url.searchParams);
    if (req.method === 'POST') {
      const raw = await readBody(req);
      if (raw) {
        try { Object.assign(q, JSON.parse(raw)); } catch (e) { q.js = raw; }   // a bare body is eval's js
      }
    }
    // the browser's own commands (open, shot, resize, close): headless tabs only
    if (headless.handles(cmd)) {
      const t0 = Date.now();
      const [status, body] = await headless.run(cmd, q, {
        mainPort,
        awaitTab: (tid) => awaitReconnect(tid, 0, 10000),
      });
      console.log(`[dev] ${body.tab || q.tab || '-'} ${cmd} ${Date.now() - t0}ms ${status === 200 ? 'ok' : 'FAIL ' + body.error}`);
      return json(res, status, body);
    }
    const picked = pick(q.tab);
    if (picked.error) return json(res, picked.status, { ok: false, error: picked.error, tabs: listing() });
    const tab = picked.tab;
    delete q.tab;

    const t0 = Date.now();
    // one line per command on the dev server's console: which tab, how
    // long, and how it ended — the trail when a run goes wrong
    const log = (ok, note) => console.log(`[dev] ${tab.id} ${cmd} ${Date.now() - t0}ms ${ok ? 'ok' : 'FAIL'}${note ? ' ' + note : ''}`);
    if (cmd === 'wait') {
      const [status, body] = await wait(tab.id, q);
      log(status === 200, status === 200 ? '' : 'status ' + status);
      return json(res, status, body);
    }
    if (cmd === 'reload') {
      const since = Date.now();
      const r = await relay(tab, 'reload', q, 5000);
      if (!r.ok) { log(false, r.error); return json(res, 502, { ...r, tab: tab.id }); }
      const back = await awaitReconnect(tab.id, since, Math.min(Number(q.timeout) || 20000, WAIT_CAP));
      if (!back) { log(false, 'no reconnect'); return json(res, 504, { ok: false, tab: tab.id, error: 'tab did not come back after reload' }); }
      // reload?rejoin=1 — and take the gate back into the table in the hash
      if (q.rejoin === '1') {
        const j = await relay(back, 'rejoin', {}, 15000);
        log(j.ok, j.ok ? 'rejoined' : j.error);
        return json(res, j.ok ? 200 : 500, { ok: j.ok, tab: back.id, info: back.info, result: j.result, error: j.error });
      }
      log(true);
      return json(res, 200, { ok: true, tab: back.id, info: back.info });
    }
    const timeout = Math.min(Number(q.timeout) || CMD_TIMEOUT, WAIT_CAP);
    const r = await relay(tab, cmd, q, timeout);
    log(r.ok, r.ok ? '' : r.error);
    json(res, r.ok ? 200 : 500, { ok: r.ok, tab: tab.id, result: r.result, error: r.error });
  }
}

module.exports = { mount };
