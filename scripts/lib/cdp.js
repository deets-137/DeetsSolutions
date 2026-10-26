// A headless browser over the DevTools protocol, with no dependencies: it
// drives the Edge that ships with Windows (or a Chrome, if there is one)
// through Node's own fetch and WebSocket.
//
// Used by scripts/capture-og-shots.js (link-preview screenshots) and the dev
// driver's headless tabs (scripts/dev-headless.js). docs/tooling.md, "Headless".
//
//   const cdp = require('./lib/cdp');
//   const b = await cdp.launch({ width: 1440, height: 900 });
//   const page = await b.open('http://localhost:8787/');
//   await page.send('Runtime.evaluate', { expression: '1 + 1' });
//   fs.writeFileSync('x.png', await page.shot());
//   await b.close();

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const CANDIDATES = [
  process.env.DEETS_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/microsoft-edge',
].filter(Boolean);

function findBrowser() {
  const hit = CANDIDATES.find((p) => fs.existsSync(p));
  if (!hit) throw new Error('no Edge or Chrome found (set DEETS_BROWSER to one)');
  return hit;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function freePort(from) {
  return new Promise((resolve) => {
    const probe = net.createServer()
      .once('error', () => resolve(freePort(from + 1)))
      .once('listening', () => probe.close(() => resolve(from)))
      .listen(from, '127.0.0.1');
  });
}

// One DevTools connection to one target (a tab). send() resolves with the
// command's result; on(method, fn) hears events; once(method) waits for one.
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method) listeners.slice().forEach((fn) => fn(msg));
  };
  ws.onclose = () => pending.forEach(({ reject }) => reject(new Error('DevTools connection closed')));
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const on = (method, fn) => {
    const l = (msg) => { if (msg.method === method) fn(msg.params); };
    listeners.push(l);
    return () => listeners.splice(listeners.indexOf(l), 1);
  };
  const once = (method) => new Promise((resolve) => { const off = on(method, (p) => { off(); resolve(p); }); });
  return new Promise((resolve, reject) => {
    ws.onopen = () => resolve({ send, on, once, close: () => ws.close() });
    ws.onerror = () => reject(new Error('could not reach DevTools at ' + wsUrl));
  });
}

// A page the browser opened, with the few calls every caller wanted.
function pageApi(target, conn, size) {
  return {
    id: target.id, send: conn.send, on: conn.on, once: conn.once,
    // the page's own value of `expression` (awaited), or a thrown Error
    async eval(expression) {
      const r = await conn.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    async goto(url) {
      const loaded = conn.once('Page.loadEventFired');
      await conn.send('Page.navigate', { url });
      await loaded;
    },
    // PNG bytes: the viewport, or `clip` = { x, y, width, height } in CSS px
    async shot(clip) {
      // a clip may run past the viewport's edge (a tall panel): render it whole
      const p = { format: 'png', captureBeyondViewport: !!clip };
      if (clip) p.clip = { ...clip, scale: 1 };
      return Buffer.from((await conn.send('Page.captureScreenshot', p)).data, 'base64');
    },
    async resize(width, height) {
      size.width = width; size.height = height;
      await conn.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    },
    close: () => conn.close(),
  };
}

/* Starts a headless browser on a free port with a throwaway profile.
   opts: width, height (the viewport, default 1440×900), port (first to
   try, default 9333), profile (a directory; default a fresh one in tmp),
   scheme ('light' | 'dark' | null for the OS's). */
async function launch(opts = {}) {
  const size = { width: opts.width || 1440, height: opts.height || 900 };
  const port = await freePort(opts.port || 9333);
  const profile = opts.profile || fs.mkdtempSync(path.join(os.tmpdir(), 'deets-headless-'));
  const proc = spawn(findBrowser(), [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    // a headless page is never hidden, but keep timers and frames at full
    // speed even so: the dev driver steps animations and bots in real time
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
    `--window-size=${size.width},${size.height}`, 'about:blank',
  ], { stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 75 && !ready; i++) {
    try { ready = (await fetch(`${base}/json/version`)).ok; } catch (e) { await wait(200); }
  }
  if (!ready) { proc.kill(); throw new Error('the browser never opened its DevTools port'); }

  async function attach(target) {
    const conn = await connect(target.webSocketDebuggerUrl);
    await conn.send('Page.enable');
    await conn.send('Runtime.enable');
    await conn.send('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: 1, mobile: false });
    await conn.send('Emulation.setFocusEmulationEnabled', { enabled: true });   // every page acts focused
    if (opts.scheme) await conn.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: opts.scheme }] });
    return pageApi(target, conn, size);
  }

  return {
    port, profile, proc,
    // the tab the browser started with (about:blank)
    async first() {
      const list = await (await fetch(`${base}/json/list`)).json();
      return attach(list.find((t) => t.type === 'page'));
    },
    // a new tab at `url`, attached; resolves once it has loaded
    async open(url) {
      const target = await (await fetch(`${base}/json/new?about:blank`, { method: 'PUT' })).json();
      const page = await attach(target);
      if (url) await page.goto(url);
      return page;
    },
    async closeTab(id) { try { await fetch(`${base}/json/close/${id}`); } catch (e) {} },
    async close() {
      proc.kill();
      await wait(300);
      if (!opts.profile) fs.rmSync(profile, { recursive: true, force: true });
    },
  };
}

module.exports = { launch, connect, findBrowser, freePort };
