/* Dev driver, page half. Injected by scripts/dev.js on localhost only —
   never in the served tree, never on Pages. Holds an EventSource to the dev
   server's side port; each command it receives runs here and its answer is
   POSTed back as the curl response. Server half + API:
   scripts/dev-driver-server.js, docs/architecture.md "Dev driver".

   Mock games are driven through the in-page mock transport (the
   `<Game>Transport` the shell got as cfg.mock): the driver finds this tab's
   own connection on the table and sends it the same messages the shell's
   buttons send, so there's no clicking past confirm steps. */
(function () {
  "use strict";
  if (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) return;

  var SIDE = "http://" + location.hostname + ":__SIDE_PORT__";
  var ID_KEY = "deets-dev-tab";
  var LOOK_KEY = "deets-dev-look-prev";
  var id = null;
  try { id = sessionStorage.getItem(ID_KEY); } catch (e) {}
  var activeAt = document.hasFocus() ? Date.now() : 0;

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

  function info() {
    var s = null;
    try { s = stateOf(); } catch (e) {}
    var root = document.documentElement;
    return {
      url: location.href, title: document.title,
      code: s && s.code, phase: s && s.phase,
      skin: root.getAttribute("data-skin"), theme: root.getAttribute("data-theme"),
      focused: document.hasFocus(), visible: document.visibilityState === "visible",
      activeAt: activeAt || null, frozen: !!held
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

  C.info = function () { return info(); };
  C.state = function () { return stateOf(); };

  C.eval = function (a) {
    var src = String(a.js || "");
    var AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
    var fn;
    try { fn = new AsyncFn("return (" + src + "\n)"); } catch (e) { fn = new AsyncFn(src); }
    return fn().then(safe);
  };

  C.reload = function () {
    setTimeout(function () { location.reload(); }, 50);
    return { reloading: true };
  };

  // live bot pacing: ms between bot moves (the mock's own .phantomStep knob).
  // repace() also re-arms a bot step already waiting at the old pace, so a
  // long pace can be undone at once instead of waited out
  C.pace = function (a) {
    var m = mock();
    if (!m) throw new Error("no mock transport on this page (open it with ?mock)");
    var prev = m.api.phantomStep;
    if (a.ms != null) {
      if (m.api.repace) m.api.repace(a.ms);
      else m.api.phantomStep = Math.max(0, Number(a.ms));
    }
    return { prev: prev, botStep: m.api.phantomStep };
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

  // rejoin — after a reload: take the gate's pill (Rejoin / Sit down /
  // Spectate) for the table in the hash, as a person would
  C.rejoin = async function () {
    var x = mine();
    if (x && x.conn) return { rejoined: false, already: true, state: stateOf() };
    var go = await until(function () {
      var b = document.querySelector(".gt-gate__go");
      return b && !b.disabled && !b.closest("[hidden]") ? b : null;
    }, 8000, "the gate");
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
      // the shell peeks the code and draws its gate; take its first pill
      // (Create / Sit down / Rejoin) — the same path a person takes
      var go = await until(function () {
        var b = document.querySelector(".gt-gate__go");
        return b && !b.disabled && !b.closest("[hidden]") ? b : null;
      }, 8000, "the gate");
      var nameIn = document.querySelector(".gt-gate__name-input");
      if (nameIn && !nameIn.value.trim()) nameIn.value = a.name || "Driver";
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
    return stateOf();
  };

  // look?skin=&theme= → through the settings menu's own chips when the menu
  // has them (look-change cover and all), else DeetsAppearance.set. Reports
  // the previous values; look/restore puts back this tab's first look's prev.
  function lookNow() {
    var A = window.DeetsAppearance, root = document.documentElement, stored = {};
    if (A) Object.keys(A.axes).forEach(function (n) { stored[A.axes[n].key] = localStorage.getItem(A.axes[n].key); });
    return { skin: root.getAttribute("data-skin"), theme: root.getAttribute("data-theme"), stored: stored };
  }
  C.look = async function (a) {
    var prev = lookNow();
    try { if (!sessionStorage.getItem(LOOK_KEY)) sessionStorage.setItem(LOOK_KEY, JSON.stringify(prev)); } catch (e) {}
    var root = document.documentElement, axes = [["data-skin", "skin"], ["data-theme", "theme"]];
    for (var i = 0; i < axes.length; i++) {
      var p = axes[i], want = a[p[1]];
      if (!want || root.getAttribute(p[0]) === want) continue;
      var chip = document.querySelector(".flyout__item[" + p[0] + '="' + want + '"]');
      if (chip) chip.click();
      else if (window.DeetsAppearance) window.DeetsAppearance.set(p[1], want);
      else throw new Error("no appearance controls on this page");
      // the chip applies under the look-change cover, a beat later
      await until(function () { return root.getAttribute(p[0]) === want; }, 4000, p[1] + " " + want);
    }
    await sleep(Number(a.settle) || 50);
    return { prev: prev, now: lookNow() };
  };
  C["look/restore"] = function () {
    var raw = null;
    try { raw = sessionStorage.getItem(LOOK_KEY); } catch (e) {}
    if (!raw) return { restored: false, reason: "no look changed in this tab" };
    var prev = JSON.parse(raw), root = document.documentElement;
    Object.keys(prev.stored).forEach(function (k) {
      if (prev.stored[k] == null) localStorage.removeItem(k); else localStorage.setItem(k, prev.stored[k]);
    });
    if (prev.skin) root.setAttribute("data-skin", prev.skin);
    if (prev.theme) root.setAttribute("data-theme", prev.theme);
    document.dispatchEvent(new CustomEvent("deets:appearance", { detail: {} }));
    sessionStorage.removeItem(LOOK_KEY);
    return { restored: true, now: lookNow() };
  };

  /* ── animation stepping (document.getAnimations) ─────────────── */
  var caught = [], catcher = null, catchSel = null;
  function describe(an) {
    var tg = an.effect && an.effect.target, timing = an.effect ? an.effect.getComputedTiming() : {};
    return {
      name: an.animationName || an.transitionProperty || an.id || an.constructor.name,
      target: tg ? safe(tg) : null, playState: an.playState,
      currentTime: an.currentTime, duration: timing.duration, endTime: timing.endTime
    };
  }
  function grab() {
    document.getAnimations().forEach(function (an) {
      var tg = an.effect && an.effect.target;
      if (!tg || caught.indexOf(an) >= 0) return;
      var el = tg.nodeType === 1 ? tg : tg.parentElement;
      if (el && (el.matches(catchSel) || el.closest(catchSel))) { an.pause(); caught.push(an); }
    });
  }
  // anims/catch?sel=.mj-tile — pause matching animations the moment they start
  C["anims/catch"] = function (a) {
    if (!a.sel) throw new Error("anims/catch needs ?sel=");
    if (catcher) catcher.disconnect();
    caught = []; catchSel = a.sel;
    catcher = new MutationObserver(grab);
    catcher.observe(document.documentElement, { subtree: true, childList: true, attributes: true });
    grab();
    return { watching: catchSel, caught: caught.map(describe) };
  };
  // anims/until?sel=.mj-bento&until=<js>&do=<js>&freeze=1 — catch a moment
  // that a bot (or `do`) brings about: arm the catch, start `do` (not
  // awaited, so it can loop — clicking Roll until it lands, say), poll
  // `until` in the page every 10 ms, and the instant it's true freeze the
  // view (if asked) and seek everything caught to 0. The server's `wait`
  // polls every 400 ms, far too late to catch a 1 s transition.
  C["anims/until"] = async function (a) {
    if (!a.until) throw new Error("anims/until needs ?until=<js>");
    C["anims/catch"]({ sel: a.sel || "body" });
    var AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
    var cond = new AsyncFn("return (" + a.until + "\n)");
    var doErr = null;
    if (a.do) {
      var act;
      try { act = new AsyncFn("return (" + a.do + "\n)"); } catch (e) { act = new AsyncFn(a.do); }
      act().catch(function (e) { doErr = String(e && e.message || e); });
    }
    var end = Date.now() + Math.min(Number(a.timeout) || 30000, 590000) - 500, hit = false;
    while (Date.now() < end) {
      try { hit = !!(await cond()); } catch (e) { hit = false; }
      if (hit) break;
      await sleep(10);
    }
    var frozen = false;
    if (hit && (a.freeze === "1" || a.freeze === true)) { C.freeze(); frozen = true; }
    seekAll(0);
    return { hit: hit, frozen: frozen, caught: caught.length, doError: doErr };
  };
  C["anims/list"] = function () {
    if (catcher) grab();
    return { watching: catchSel, caught: caught.map(describe) };
  };
  // a painted frame after a seek, so a screenshot right after shows it (two
  // rAFs; a background tab may never fire them, hence the fallback)
  function painted() {
    return new Promise(function (resolve) {
      var done = false, fin = function (v) { if (!done) { done = true; resolve(v); } };
      requestAnimationFrame(function () { requestAnimationFrame(function () { fin(true); }); });
      setTimeout(function () { fin(false); }, 250);
    });
  }
  function seekAll(ms) {
    if (catcher) grab();
    caught.forEach(function (an) { an.currentTime = ms; });
  }
  // anims/seek?ms=120 — every caught animation to that local time, still
  // paused; returns once a frame has painted (`painted: false` = the tab is
  // in the background and a screenshot may lag). `list=1` for every animation.
  C["anims/seek"] = async function (a) {
    seekAll(Number(a.ms) || 0);
    var p = await painted();
    return a.list === "1" ? { painted: p, caught: caught.map(describe) } : { ms: Number(a.ms) || 0, caught: caught.length, painted: p };
  };
  // anims/sample?at=0,250,500&sel=.mj-tile * — seek through each time and
  // read what a viewer would see, from computed style (reliable where a
  // background tab's screenshot isn't): of the `sel` matches, how many are
  // still hidden (opacity < 0.05) or moving (translate/scale not at rest),
  // and every scroll box (inside `box`, default the whole page) that
  // overflows at that moment — a scrollbar flashing. `each=1` lists the
  // matches' own values (first 40).
  C["anims/sample"] = async function (a) {
    var times = String(a.at || "0").split(",").map(Number);
    var sel = a.sel || "*", boxSel = a.box || "body";
    var out = [];
    for (var i = 0; i < times.length; i++) {
      seekAll(times[i]);
      await painted();
      var els = [].slice.call(document.querySelectorAll(sel));
      var row = { ms: times[i], matched: els.length, hidden: 0, moving: 0, overflow: [] };
      var each = [];
      els.forEach(function (e) {
        var cs = getComputedStyle(e), op = +cs.opacity;
        var mv = (cs.translate && cs.translate !== "none" && !/^0px( 0px)?$/.test(cs.translate)) || (cs.scale && cs.scale !== "none" && cs.scale !== "1");
        if (op < 0.05) row.hidden++;
        if (mv) row.moving++;
        if (a.each === "1" && each.length < 40) each.push({ el: safe(e), opacity: +op.toFixed(3), translate: cs.translate, scale: cs.scale });
      });
      document.querySelectorAll(boxSel + " *").forEach(function (e) {
        var cs = getComputedStyle(e);
        if (/auto|scroll/.test(cs.overflowX + cs.overflowY) && (e.scrollHeight > e.clientHeight + 0.5 || e.scrollWidth > e.clientWidth + 0.5)) {
          row.overflow.push(safe(e));
        }
      });
      if (a.each === "1") row.each = each;
      out.push(row);
    }
    return { caught: caught.length, samples: out };
  };
  // anims/finish — jump caught animations to their end and stop watching
  // (anims/finish?play=1 lets them run on from where they are instead)
  C["anims/finish"] = function (a) {
    if (catcher) { grab(); catcher.disconnect(); catcher = null; }
    var out = caught.map(function (an) {
      try { if (a.play === "1") an.play(); else an.finish(); } catch (e) {}
      return describe(an);
    });
    caught = []; catchSel = null;
    return { released: out };
  };

  /* ── the wire ────────────────────────────────────────────────── */
  function post(path, body) {
    // text/plain keeps it a "simple" cross-origin request (no preflight)
    return fetch(SIDE + path, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify(body) })
      .catch(function () {});
  }
  function beat() { if (id) post("/beat", { id: id, info: info() }); }

  function connect() {
    var es = new EventSource(SIDE + "/stream?id=" + encodeURIComponent(id || ""));
    es.addEventListener("hello", function (e) {
      id = JSON.parse(e.data).id;
      try { sessionStorage.setItem(ID_KEY, id); } catch (er) {}
      stamp(); beat();
    });
    es.addEventListener("cmd", function (e) {
      var m = JSON.parse(e.data), fn = C[m.cmd];
      Promise.resolve()
        .then(function () { if (!fn) throw new Error("unknown command " + m.cmd + " (have: " + Object.keys(C).join(", ") + ")"); return fn(m.args || {}); })
        .then(function (r) { return post("/reply", { id: id, rid: m.rid, ok: true, result: safe(r), info: info() }); },
              function (err) { return post("/reply", { id: id, rid: m.rid, ok: false, error: String(err && err.message || err), info: info() }); });
    });
    // EventSource retries on its own; nothing to do on error
  }

  function touch() { activeAt = Date.now(); beat(); }
  window.addEventListener("focus", touch);
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") touch(); });
  window.addEventListener("pagehide", function () {
    if (id) navigator.sendBeacon(SIDE + "/bye", new Blob([id], { type: "text/plain" }));
  });
  window.addEventListener("hashchange", beat);
  setInterval(beat, 3000);
  connect();
})();
