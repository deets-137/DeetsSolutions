/* Dev driver, page half — core: the tab's id, its info, shared helpers and
   the command table every other part adds to.

   The page half is one script built from parts (scripts/dev-driver/*.js):
   scripts/dev-driver-server.js joins them, in its PARTS order, inside one
   function scope, so a part can use what an earlier part defines and
   anything a later part defines once commands run. Each part adds commands
   to C. A game's own knowledge (what "my turn" means, which rolls start a
   hand) lives in games/<ns>.js and registers itself in GAMES; the generic
   commands ask it through game(). Injected by scripts/dev.js on localhost
   only — never in the served tree, never on Pages. API: docs/tooling.md. */
var SIDE = "http://" + location.hostname + ":__SIDE_PORT__";
var ID_KEY = "deets-dev-tab";
var LOOK_KEY = "deets-dev-look-prev";
var id = null;
try { id = sessionStorage.getItem(ID_KEY); } catch (e) {}
var activeAt = document.hasFocus() ? Date.now() : 0;

// the page's own uncaught errors and rejections, newest last (errors?clear=1)
var pageErrors = [];
function noteError(text) { pageErrors.push({ at: new Date().toISOString(), text: String(text) }); if (pageErrors.length > 50) pageErrors.shift(); }
window.addEventListener("error", function (e) { noteError((e.message || "error") + (e.filename ? " @ " + e.filename.replace(location.origin, "") + ":" + e.lineno : "")); });
window.addEventListener("unhandledrejection", function (e) { noteError("unhandled rejection: " + (e.reason && e.reason.message || e.reason)); });

/* ── the title prefix, kept on through the page's own retitles ── */
function stamp() {
  if (!id) return;
  var bare = document.title.replace(/^\[t-[0-9a-f]{4}\] /, "");
  var want = "[" + id + "] " + bare;
  if (document.title !== want) document.title = want;
}
var titleEl = document.querySelector("title");
if (!titleEl) { titleEl = document.createElement("title"); document.head.appendChild(titleEl); }
new MutationObserver(stamp).observe(titleEl, { childList: true, characterData: true, subtree: true });

function info() {
  var s = null;
  try { s = stateOf(); } catch (e) {}
  var root = document.documentElement;
  return {
    url: location.href, title: document.title,
    code: s && s.code, phase: s && s.phase,
    skin: root.getAttribute("data-skin"), theme: root.getAttribute("data-theme"),
    focused: document.hasFocus(), visible: document.visibilityState === "visible",
    activeAt: activeAt || null, frozen: !!held, clock: !!clk,
    viewport: [window.innerWidth, window.innerHeight], dpr: window.devicePixelRatio
  };
}

/* ── helpers ─────────────────────────────────────────────────── */
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function until(fn, ms, what) {
  var end = Date.now() + (ms || 8000);
  return (function loop() {
    var v; try { v = fn(); } catch (e) { v = null; }
    if (v) return Promise.resolve(v);
    if (Date.now() > end) return Promise.reject(new Error("timed out waiting for " + what));
    return sleep(60).then(loop);
  })();
}
function safe(v) {
  var seen = [];
  return JSON.parse(JSON.stringify(v === undefined ? null : v, function (k, x) {
    if (x instanceof Element) return "<" + x.tagName.toLowerCase() + (x.id ? "#" + x.id : "") + (x.className ? "." + String(x.className).split(" ").join(".") : "") + ">";
    if (typeof x === "function") return "[function]";
    if (x && typeof x === "object") { if (seen.indexOf(x) >= 0) return "[circular]"; seen.push(x); }
    return x;
  }));
}

/* ── commands ────────────────────────────────────────────────── */
var C = {};

/* ── games: per-game hooks (games/<ns>.js) ─────────────────────
   GAMES[ns] = { mock: "MahjongTransport", ... } — every hook optional:
     rolls                 message types autoroll sends, comma-joined
     waitsOnMe(g, seat, type)  is the game waiting on this seat for `type`?
     myTurn(g, seat)       this seat must act now (draw done, nothing pending)
     claimWaits(g, seat)   a claim window waits on this seat
     pass(send)            answer that window with a pass
     idle()                the page shows the game as it stands (no tile,
                           chip or card still on its way)
   game() is this page's entry, found by its mock transport's global name. */
var GAMES = {};
function game() {
  var m = mock();
  if (m) for (var ns in GAMES) if (GAMES[ns].mock === m.name) return GAMES[ns];
  return {};
}

C.info = function () { return info(); };
C.state = function () { return stateOf(); };

C.eval = function (a) {
  var src = String(a.js || "");
  var AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
  var fn;
  try { fn = new AsyncFn("return (" + src + "\n)"); } catch (e) { fn = new AsyncFn(src); }
  return fn().then(safe);
};

C.errors = function (a) {
  var out = pageErrors.slice();
  if (a.clear === "1") pageErrors = [];
  return { count: out.length, errors: out };
};

C.reload = function () {
  setTimeout(function () { location.reload(); }, 50);
  return { reloading: true };
};

// rect?sel=&shotw=1293 — viewport rects of the matches, plus the same
// rects in a screenshot's coordinates when you pass its frame width
// (the Chrome tool's screenshot frame is narrower than the CSS viewport)
C.rect = function (a) {
  if (!a.sel) throw new Error("rect needs ?sel=");
  var k = a.shotw ? Number(a.shotw) / window.innerWidth : null, pad = Number(a.pad) || 0;
  var out = [].slice.call(document.querySelectorAll(a.sel), 0, 20).map(function (e) {
    var r = e.getBoundingClientRect();
    var v = { x0: r.left - pad, y0: r.top - pad, x1: r.right + pad, y1: r.bottom + pad };
    var row = { el: safe(e), css: [Math.round(v.x0), Math.round(v.y0), Math.round(v.x1), Math.round(v.y1)] };
    if (k) row.shot = [Math.round(v.x0 * k), Math.round(v.y0 * k), Math.round(v.x1 * k), Math.round(v.y1 * k)];
    return row;
  });
  return { innerWidth: window.innerWidth, innerHeight: window.innerHeight, scale: k, rects: out };
};
