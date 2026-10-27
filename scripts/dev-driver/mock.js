/* Dev driver, page half — mock tables: finding this tab's table and
   connection on a ?mock page, and driving it with the same messages the
   shell's buttons send (no clicking past confirm steps). */

/* ── mock tables ─────────────────────────────────────────────── */
function mock() {
  var keys = Object.keys(window);
  for (var i = 0; i < keys.length; i++) {
    var v = window[keys[i]];
    if (v && typeof v === "object" && v.kind === "mock" && typeof v.tables === "function") {
      return { name: keys[i], api: v };
    }
  }
  return null;
}
function myTokens() {
  var out = [];
  for (var i = 0; i < localStorage.length; i++) {
    var k = localStorage.key(i);
    if (/^deets-[\w-]+-token$/.test(k)) out.push(JSON.parse(localStorage.getItem(k) || "null") || localStorage.getItem(k));
  }
  return out;
}
function hashCode() { return (location.hash || "").replace(/^#/, "").trim().toLowerCase() || null; }
// this tab's table + its own live connection on it
function mine() {
  var m = mock();
  if (!m) return null;
  var all = m.api.tables(), toks = myTokens();
  var codes = Object.keys(all), code = hashCode();
  if (code && codes.indexOf(code) < 0) code = null;
  var pickConn = function (t) {
    return t.conns.filter(function (c) { return !c.closed && toks.indexOf(c.token) >= 0; })[0] || null;
  };
  if (!code) code = codes.filter(function (c) { return pickConn(all[c]); })[0] || null;
  var t = code ? all[code] : null;
  return { m: m, code: code, t: t, conn: t ? pickConn(t) : null };
}

function stateOf() {
  var x = mine();
  if (!x || !x.t) return { mock: x ? x.m.name : null, code: hashCode(), phase: null };
  var t = x.t, g = t.game;
  return {
    mock: x.m.name, code: x.code,
    phase: g ? g.phase : "lobby",
    mySeat: x.conn ? x.conn.seat : null, joined: !!x.conn,
    settings: t.settings,
    seats: t.seats.map(function (s, i) {
      return s ? { seat: i, name: s.name, bot: !!(s.phantom || s.bot), tier: s.tier || null } : null;
    }),
    spectators: t.conns.filter(function (c) { return !c.closed && c.seat == null; }).length,
    wallLeft: g && g.wall ? g.wall.length : null,
    round: g ? g.round : null,
    turn: g && g.turn ? g.turn.seat : null,
    handOver: g ? g.handOver || null : null,
    botStep: x.m.api.phantomStep
  };
}

// live bot pacing: ms between bot moves (the mock's own .phantomStep knob).
// repace() also re-arms a bot step already waiting at the old pace, so a
// long pace can be undone at once instead of waited out
// pace?hold=1 parks the bots (a step far beyond any test); pace?resume=1
// puts back the pace from before the hold
var HOLD_MS = 3600000, heldPace = null;
C.pace = function (a) {
  var m = mock();
  if (!m) throw new Error("no mock transport on this page (open it with ?mock)");
  var prev = m.api.phantomStep;
  if (a.hold === "1") {
    if (heldPace == null) heldPace = prev;
    a = { ms: HOLD_MS };
  } else if (a.resume === "1") {
    a = { ms: heldPace != null ? heldPace : prev };
    heldPace = null;
  }
  if (a.ms != null) {
    if (m.api.repace) m.api.repace(a.ms);
    else m.api.phantomStep = Math.max(0, Number(a.ms));
  }
  return { prev: prev, botStep: m.api.phantomStep, held: heldPace != null };
};

// freeze — hold every message to this tab's connection, so the view stays
// exactly as it is (bots play on server-side). thaw — deliver what was
// held, in order, and let messages through again. Unlike dropping them,
// the page never ends up stale: a game waiting on this seat sends nothing
// more, so the held messages are the only way back in sync.
var held = null;
C.freeze = function () {
  var x = mine();
  if (!x || !x.conn) throw new Error("no live mock connection for this tab");
  if (held) return { frozen: true, held: held.msgs.length };
  var conn = x.conn, orig = conn.handler;
  held = { conn: conn, orig: orig, msgs: [] };
  conn.handler = function (msg) { held.msgs.push(msg); };
  return { frozen: true, held: 0 };
};
C.thaw = function () {
  if (!held) return { frozen: false, delivered: 0 };
  var h = held;
  held = null;
  h.conn.handler = h.orig;
  h.msgs.forEach(function (msg) { if (!h.conn.closed) h.orig(msg); });
  return { frozen: false, delivered: h.msgs.length };
};

// The way in for the code the shell just read, as a person would take it:
// the gate's first pill (Create / Sit down / Rejoin), or — on a game with
// cfg.openButton (mahjong), which has no gate — the open button once Enter
// has opened it out. `name` fills the gate's field, or for the button is
// saved as this game's name first (else a signed-out tab joins as a guest
// and lands in the rename editor).
async function joinControl(name) {
  var b = await until(function () {
    var g = document.querySelector(".gt-gate__go");
    if (g && !g.disabled && !g.closest("[hidden]")) return g;
    var o = document.querySelector(".gt-go.is-open");
    return o && !o.hidden ? o : null;
  }, 8000, "the gate or the open button");
  var nameIn = document.querySelector(".gt-gate__name-input");
  if (nameIn && !nameIn.value.trim()) nameIn.value = name || "Driver";
  var m = mock();
  if (name && b.classList.contains("gt-go") && m) {
    var ns = m.name.replace(/Transport$/, "").toLowerCase();   // MahjongTransport → mahjong
    try { if (!JSON.parse(localStorage.getItem("deets-" + ns + "-name"))) localStorage.setItem("deets-" + ns + "-name", JSON.stringify(name)); } catch (e) {}
  }
  return b;
}

// rejoin — after a reload: take the way in (Rejoin / Sit down / Spectate)
// for the table in the hash, as a person would
C.rejoin = async function () {
  var x = mine();
  if (x && x.conn) return { rejoined: false, already: true, state: stateOf() };
  var go = await joinControl();
  go.click();
  await until(function () { var y = mine(); return y && y.conn ? y : null; }, 8000, "the join");
  await sleep(300);   // the snapshot's first paint
  return { rejoined: true, state: stateOf() };
};

// table?code=&name=&bots=3&tier=&set=winds:1,minFaan:3&spectate=1&start=1
C.table = async function (a) {
  var m = mock();
  if (!m) throw new Error("no mock transport on this page (open it with ?mock)");
  var code = String(a.code || ("drv" + Math.random().toString(36).slice(2, 6))).toLowerCase();
  // let the shell peek the new code first (mock latency 110 ms), or the
  // old code's gate is still up to be clicked
  if (hashCode() !== code) { location.hash = code; await sleep(400); }
  var x = mine();
  if (!(x && x.code === code && x.conn)) {
    // the shell peeks the code and offers its way in — the same path a
    // person takes
    var go = await joinControl(a.name);
    go.click();
    x = await until(function () { var y = mine(); return y && y.code === code && y.conn ? y : null; }, 8000, "the join");
  }
  var t = x.t, conn = x.conn;
  var send = function (msg) { conn.send(msg); };
  if (a.set) {
    var ss = { type: "setSettings" };
    String(a.set).split(",").forEach(function (kv) {
      var p = kv.split(":"), v = p.slice(1).join(":");
      ss[p[0]] = v === "" ? null : (isNaN(Number(v)) ? v : Number(v));
    });
    send(ss);
    await sleep(250);
  }
  // stand first, so the seat it frees can take a bot too
  if (a.spectate === "1" || a.spectate === true) {
    send({ type: "stand" });
    await until(function () { return conn.seat == null; }, 5000, "standing up");
  }
  var want = Number(a.bots || 0), added = 0;
  for (var i = 0; i < t.seats.length && added < want; i++) {
    if (t.seats[i]) continue;
    // the shell's Add Bot ✓ sends exactly this (games/table.js)
    send({ type: "addBot", seat: i, name: "Bot " + (i + 1), tier: a.tier || undefined });
    added++;
  }
  if (added) await until(function () { return t.seats.filter(function (s) { return s && (s.phantom || s.bot); }).length >= added; }, 5000, "the bots");
  if (a.start === "1" || a.start === true) {
    send({ type: "start" });
    await until(function () { return t.game; }, 5000, "the start");
  }
  // autoroll=1 — roll for this tab's seat through every pre-play roll until
  // a turn exists. `rolls=` names the message types (default: the game's
  // own, games/<ns>.js); each is sent only while the game hook says the
  // game waits on this seat for it (a type it can't judge is sent anyway:
  // the engine rejects it if early)
  if ((a.autoroll === "1" || a.autoroll === true) && t.game && conn.seat != null) {
    var G = game();
    var types = String(a.rolls || G.rolls || "").split(",").filter(Boolean);
    if (!types.length) throw new Error("autoroll: this game names no rolls (pass ?rolls=)");
    var sentAt = {};   // one send per type per 800 ms: the mock answers after ~110 ms
    await until(function () {
      var g = t.game;
      if (!g || g.turn) return true;
      types.forEach(function (ty) {
        if ((G.waitsOnMe && !G.waitsOnMe(g, conn.seat, ty)) || Date.now() - (sentAt[ty] || 0) < 800) return;
        sentAt[ty] = Date.now(); send({ type: ty });
      });
      return false;
    }, Number(a.rolltimeout) || 20000, "the rolls to reach a turn");
    await sleep(300);   // the first play broadcast's paint
  }
  return stateOf();
};

// turn?timeout=&pass=1&hold=1 — let the bots play until THIS seat must act
// and the page has caught up (no piece still on its way), then park the
// bots so the moment stays put. A claim window that waits on this seat is
// passed on the way (pass=0 to stop there instead: `claim: true`). The
// game hook decides what "must act" and "caught up" mean.
C.turn = async function (a) {
  var x = mine();
  if (!x || !x.conn || x.conn.seat == null) throw new Error("turn needs a seat at a mock table (table?…&autoroll=1 first)");
  var G = game(), conn = x.conn, t = x.t;
  if (!G.myTurn) throw new Error("this game has no myTurn hook (scripts/dev-driver/games/)");
  if (heldPace != null) C.pace({ resume: "1" });
  var end = Date.now() + Math.min(Number(a.timeout) || 60000, 590000) - 500, passes = 0;
  while (Date.now() < end) {
    var g = t.game;
    if (!g || g.phase !== "play" || g.handOver) return { reached: false, why: g ? (g.handOver ? "hand over" : g.phase) : "no game", state: stateOf() };
    var caught = !G.idle || G.idle();
    if (G.claimWaits && G.claimWaits(g, conn.seat) && caught) {
      if (a.pass === "0") { C.pace({ hold: "1" }); return { reached: true, claim: true, passes: passes, state: stateOf() }; }
      G.pass(function (m) { conn.send(m); }); passes++;
      await sleep(250);
      continue;
    }
    if (G.myTurn(g, conn.seat) && caught) {
      if (a.hold !== "0") C.pace({ hold: "1" });
      return { reached: true, passes: passes, state: stateOf() };
    }
    await sleep(20);
  }
  throw new Error("timed out waiting for this seat's turn");
};

// idle?timeout= — until the page shows the game as it stands (the hook's idle)
C.idle = async function (a) {
  var G = game();
  if (!G.idle) return { idle: true, hook: false };
  var t0 = Date.now();
  await until(function () { return G.idle(); }, Number(a.timeout) || 10000, "the page to settle");
  return { idle: true, waitedMs: Date.now() - t0 };
};

// mock/drop?code= — remove a mock table (its timers, its stored copy) and
// its code from this game's recents
C["mock/drop"] = function (a) {
  var m = mock();
  if (!m) throw new Error("no mock transport on this page (open it with ?mock)");
  if (!a.code) throw new Error("mock/drop needs ?code=");
  var code = String(a.code).toLowerCase();
  var had = !!m.api.tables()[code];
  if (had) m.api.drop(code);
  var dropped = [];
  for (var i = 0; i < localStorage.length; i++) {
    var k = localStorage.key(i);
    if (!/^deets-[\w-]+-recents$/.test(k)) continue;
    try {
      var r = JSON.parse(localStorage.getItem(k));
      if (Array.isArray(r) && r.indexOf(code) >= 0) {
        localStorage.setItem(k, JSON.stringify(r.filter(function (c) { return c !== code; })));
        dropped.push(k);
      }
    } catch (e) {}
  }
  return { dropped: had, recents: dropped, tables: Object.keys(m.api.tables()) };
};

/* ── End hand: the game's own `ends` hooks, as a command and as pills ── */
C.endhand = function (a) {
  var x = mine(), ends = game().ends || {};
  if (!x || !x.t) throw new Error("no mock table on this page (open it with ?mock)");
  var name = Object.keys(ends).filter(function (k) { return k.toLowerCase() === String(a.as || "").toLowerCase(); })[0];
  if (!name) throw new Error("endhand needs ?as= one of " + Object.keys(ends).join(", "));
  var g = x.t.game;
  if (!g || g.phase !== "play" || g.handOver || g.wall == null) throw new Error("no hand in play to end");
  var r = x.m.api.rig(x.code, ends[name]);
  if (r && r.error) throw new Error(r.error);
  return r;
};
// dev-only pills beside Edit copy (scripts/copy-edit.js), one per `ends`
// hook, on a ?mock page only. Not copy: dev chrome never reaches Pages.
function endPills() {
  var ends = game().ends;
  if (!ends || document.querySelector(".dv-pills")) return;
  var css = document.createElement("style");
  css.textContent =
    ".dv-pills{position:fixed;bottom:var(--space-3);z-index:2147483000;display:flex;gap:var(--space-2)}" +
    ".dv-pill{font:inherit;font-family:var(--font-body);color:var(--text);background:var(--surface);" +
    "border:1px solid var(--border);border-radius:var(--radius-control);padding:var(--space-1) var(--space-2);cursor:pointer;opacity:.6}" +
    ".dv-pill:hover{opacity:1}";
  document.head.appendChild(css);
  var bar = document.createElement("div");
  bar.className = "dv-pills";
  Object.keys(ends).forEach(function (name) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "dv-pill";
    b.title = "Dev only: end the hand in play on this mock table";
    b.textContent = "End hand: " + name;
    b.addEventListener("click", function () {
      try { C.endhand({ as: name }); }
      catch (e) { if (window.DeetsToast) window.DeetsToast.push({ kind: "error", text: e.message }); else console.warn("[dev]", e.message); }
    });
    bar.appendChild(b);
  });
  document.body.appendChild(bar);
  function place() {
    var ce = document.querySelector(".ce-pill"), r = ce && ce.getBoundingClientRect();
    bar.style.left = r ? "calc(" + Math.round(r.right) + "px + var(--space-2))" : "var(--space-3)";
  }
  place();
  window.addEventListener("resize", place);
}
if (document.readyState === "complete") setTimeout(endPills, 0);
else window.addEventListener("load", function () { setTimeout(endPills, 0); });
