/* Deets games — the MOCK table (docs/games.md, "The pieces").

   An in-page fake of a game's table Worker that speaks the wire protocol
   VERBATIM (peek / connect → conn with send / onMessage / onStatus / close)
   and runs the REAL rules engine locally, so a full hot-seat game is playable
   with no worker at all. A game page must not be able to tell this apart from
   the WebSocket client beyond `kind`.

   It is a DEV TOOL, selected with ?mock — both games default to prod. What it
   deliberately does NOT model (the worker's job, and why rejoin behavior can
   only be tested live):
     - disconnects: no grace window, no bot takeover, no reconnect
     - tables live in localStorage rather than a Durable Object
     - randomness is Math.random; the worker uses crypto in the DO

   What it DOES model exactly, because these are contract:
     - the message envelope and every refusal code
     - HIDDEN INFO: each connection gets its own view, and maskEvent scrubs
       events per seat before delivery
     - the lobby verbs, host fallback, seat colors, and bot drive

   Cities and mahjong each carried a full copy of this; ~380 lines were
   identical. This is that half, once — the same subclass contract the worker
   base uses (games/table-do.js), so the two read as one design.

   USE
     window.<Game>Transport = DeetsTableMock.create({ ns, Engine, Colors, ...hooks });

   window.DeetsTableMock. */
(function () {
  "use strict";

  var LATENCY = 110;        // fake round-trip
  var BOT_STEP = 650;       // ms between bot actions (watchable)
  var LOG_MAX = 200;
  var MAX_CONNS = 30;
  var EXPIRE_MS = 3600000;  // idle + empty this long → the table is dropped on boot

  function now() { return Date.now(); }
  function uid() { return Math.random().toString(36).slice(2, 10); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  function create(spec) {
    var Engine = spec.Engine, Colors = spec.Colors || window.DeetsColors;
    var STORE_KEY = "deets-" + spec.ns + "-mock-v1";
    var EXTRA = spec.extraState || {};
    var EXTRA_KEYS = Object.keys(EXTRA);
    var GAME_CMDS = spec.gameVerbs || {};
    var LOBBY_CMDS = { sit: 1, stand: 1, addBot: 1, shuffle: 1, recolor: 1, setSettings: 1, start: 1 };

    var TABLES = {};   // code -> table
    function ctx() { return { rand: Math.random, now: now() }; }
    function capacity(t) { return spec.capacity ? spec.capacity(t) : t.settings.capacity; }

    /* ── persistence ────────────────────────────────────────────── */
    function persistable() {
      var out = {};
      Object.keys(TABLES).forEach(function (code) {
        var t = TABLES[code];
        var rec = {
          code: t.code, createdAt: t.createdAt, creatorToken: t.creatorToken,
          settings: t.settings, seats: t.seats, game: t.game,
          log: t.log.slice(-LOG_MAX), v: t.v, touched: t.touched
        };
        EXTRA_KEYS.forEach(function (k) { rec[k] = t[k]; });
        out[code] = rec;
      });
      return out;
    }
    function save() {
      try { localStorage.setItem(STORE_KEY, JSON.stringify({ tables: persistable() })); } catch (e) {}
    }
    function boot() {
      var saved;
      try { saved = (JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {}).tables || {}; }
      catch (e) { saved = {}; }
      Object.keys(saved).forEach(function (code) {
        var s = saved[code];
        var running = s.game && s.game.phase !== "over";
        // the 1 h idle+empty expiry, mock edition (the worker's alarm for real)
        if (!running && now() - (s.touched || 0) > EXPIRE_MS) return;
        var t = {
          code: s.code, createdAt: s.createdAt, creatorToken: s.creatorToken,
          settings: s.settings, seats: s.seats || [], game: s.game || null,
          log: s.log || [], v: s.v || 1, touched: s.touched || 0,
          conns: [], timer: null, timerFor: null, turnEndsAt: null, driving: false
        };
        EXTRA_KEYS.forEach(function (k) { t[k] = s[k] == null ? EXTRA[k]() : s[k]; });
        // legacy saves carried color NAMES ("red"); seats are hex now
        t.seats.forEach(function (st) {
          if (st && st.color && Colors.LEGACY[st.color]) st.color = Colors.LEGACY[st.color];
        });
        TABLES[code] = t;
      });
    }
    boot();

    /* ── seats / host / identity ────────────────────────────────── */
    function seatOfToken(t, token) {
      for (var i = 0; i < t.seats.length; i++) if (t.seats[i] && t.seats[i].token === token) return i;
      return null;
    }
    function tokenConnected(t, token) {
      return t.conns.some(function (c) { return c.token === token && !c.closed; });
    }
    function hostToken(t) {
      if (t.creatorToken && tokenConnected(t, t.creatorToken)) return t.creatorToken;
      // fallback: longest-seated connected human
      for (var i = 0; i < t.seats.length; i++) {
        var s = t.seats[i];
        if (s && !s.phantom && tokenConnected(t, s.token)) return s.token;
      }
      return t.conns.length ? t.conns[0].token : t.creatorToken;
    }
    function isHost(t, token) { return token && token === hostToken(t); }
    function openSeatIndex(t) {
      for (var i = 0; i < t.seats.length; i++) if (!t.seats[i]) return i;
      return -1;
    }
    function seatedCount(t) { return t.seats.filter(function (s) { return !!s; }).length; }
    // grow/shrink the lobby seat array to capacity with nulls, trimming only
    // trailing empties — the worker's resize, verbatim
    function resizeSeats(t) {
      if (t.game) return;
      var cap = capacity(t);
      while (t.seats.length < cap) t.seats.push(null);
      while (t.seats.length > cap && !t.seats[t.seats.length - 1]) t.seats.pop();
    }
    // every other seat's color (null holes for empties + the excluded seat)
    function otherColors(t, except) {
      return t.seats.map(function (s) { return s && s !== except ? s.color : null; });
    }
    function spectatorCount(t) {
      return t.conns.filter(function (c) { return !c.closed && seatOfToken(t, c.token) == null; }).length;
    }

    /* ── views (hidden-info enforced, exactly as the worker must) ── */
    function baseView(t, conn) {
      var token = conn.token, seat = seatOfToken(t, token);
      var hostTok = hostToken(t);
      return {
        code: t.code,
        phase: t.game ? t.game.phase : "lobby",
        settings: t.settings,
        host: token === hostTok,
        hostSeat: seatOfToken(t, hostTok),
        seats: t.seats.map(function (s, i) {
          if (!s) return { seat: i, name: null, color: Colors.PRESETS[i], connected: false, empty: true };
          return {
            seat: i, name: s.name, color: s.color,
            connected: s.phantom ? true : tokenConnected(t, s.token),
            phantom: !!s.phantom, bot: !!s.bot
          };
        }),
        spectators: spectatorCount(t),
        you: { seat: seat, host: token === hostTok }
      };
    }
    function buildView(t, conn) {
      var seat = seatOfToken(t, conn.token);
      return spec.buildView(baseView(t, conn), t, conn, seat);
    }
    function maskEvent(e, seat) { return spec.maskEvent ? spec.maskEvent(e, seat) : e; }

    /* ── delivery ───────────────────────────────────────────────── */
    function deliver(conn, msg) {
      setTimeout(function () {
        if (conn.closed || !conn.handler) return;
        conn.handler(clone(msg));
      }, LATENCY);
    }
    function broadcast(t, events) {
      t.v++; t.touched = now();
      t.conns.forEach(function (c) {
        if (c.closed) return;
        var view = buildView(t, c);
        var ev = (events || []).map(function (e) { return maskEvent(e, view.you.seat); });
        deliver(c, Object.assign({ type: "state", v: t.v, serverNow: now(), ev: ev }, view));
      });
      save();
    }
    function sendSnapshot(t, conn) {
      var view = buildView(t, conn);
      deliver(conn, Object.assign({ type: "snapshot", v: t.v, serverNow: now() }, view));
    }
    function errTo(conn, code) { deliver(conn, { type: "error", code: code }); }

    /* ── engine bridge ──────────────────────────────────────────── */
    function applyEngine(t, action) {
      var res = Engine.applyAction(t.game, action, ctx());
      if (res.error) return res;
      t.game = res.game;
      (res.events || []).forEach(function (e) { t.log.push(e); });
      if (t.log.length > LOG_MAX) t.log.splice(0, t.log.length - LOG_MAX);
      if (t.game.phase === "over") {
        if (spec.onGameOver) spec.onGameOver(t);
        disarmTimer(t);
      }
      return res;
    }

    /* ── the table deadline (the DO's alarm, setTimeout edition) ─── */
    function disarmTimer(t) {
      if (t.timer) { clearTimeout(t.timer); t.timer = null; }
      t.turnEndsAt = null; t.timerFor = null;
    }
    function armTimer(t) {
      var g = t.game;
      var ms = (g && g.phase !== "over" && spec.deadlineFor) ? spec.deadlineFor(t) : null;
      if (ms == null) { disarmTimer(t); return; }
      // re-arm only when the obligation itself changed, so unrelated
      // broadcasts don't reset a running countdown (the worker's dlSig rule)
      var sig = spec.dlSig ? spec.dlSig(t) : null;
      if (t.timer && t.timerFor === sig) return;
      if (t.timer) clearTimeout(t.timer);
      t.timerFor = sig;
      t.turnEndsAt = now() + ms;
      t.timer = setTimeout(function () {
        t.timer = null; t.turnEndsAt = null; t.timerFor = null;
        var r = applyEngine(t, { type: "timerExpire" });
        if (!r.error) { broadcast(t, r.events); postApply(t); }
      }, ms);
    }

    /* ── bot drive (engine validates every attempt) ─────────────── */
    function postApply(t) { armTimer(t); scheduleDrive(t); }
    function scheduleDrive(t) {
      if (t.driving) return;
      var g = t.game;
      if (!g || g.phase === "over") return;
      if (!spec.needsPhantom(t)) return;
      t.driving = true;
      setTimeout(function () { t.driving = false; driveStep(t); }, API.phantomStep);
    }
    function tryAct(t, action) {
      var res = Engine.applyAction(t.game, action, ctx());
      if (res.error) return false;
      var applied = applyEngine(t, action);
      // stash so driveStep can broadcast them — clients need bot events too
      // (log lines, toasts), exactly as the worker broadcasts every action's
      t._ev = applied.events || [];
      return true;
    }
    function driveStep(t) {
      var g = t.game;
      if (!g || g.phase === "over") return;
      if (spec.phantomOne(t, HELPERS)) { broadcast(t, t._ev || []); t._ev = null; }
      postApply(t);
    }

    // what a game's spec gets handed for its own branches
    var HELPERS = {
      tryAct: tryAct, broadcast: broadcast, errTo: errTo, postApply: postApply,
      seatOfToken: seatOfToken, isHost: isHost, seatedCount: seatedCount,
      resizeSeats: resizeSeats, ctx: ctx, uid: uid, now: now, save: save
    };

    /* ── command dispatch (client → table) ──────────────────────── */
    function handle(t, conn, msg) {
      var token = conn.token, type = msg.type;

      if (type === "closeTable") {
        if (!isHost(t, token)) return errTo(conn, "perm");
        t.conns.slice().forEach(function (c) { deliver(c, { type: "closed", serverNow: now() }); });
        disarmTimer(t); delete TABLES[t.code]; save();
        return;
      }
      if (type === "kickSeat") {
        if (!isHost(t, token)) return errTo(conn, "perm");
        var s = msg.seat;
        if (s == null || !t.seats[s]) return;
        if (!t.game || t.game.phase === "over") {        // lobby: just open the seat
          var kickedTok = t.seats[s].token;
          t.seats[s] = null; resizeSeats(t);
          var kc = t.conns.filter(function (c) { return c.token === kickedTok; })[0];
          if (kc) deliver(kc, { type: "kicked", serverNow: now() });
          return broadcast(t, []);
        }
        // running game: a kick is a forced leave — the seat converts to a bot
        // (the worker's takeover rule). phantom:true is what the drive keys
        // on; bot:true is the client's tag.
        t.seats[s].bot = true; t.seats[s].phantom = true;
        var kcg = t.conns.filter(function (c) { return c.token === t.seats[s].token; })[0];
        if (kcg) deliver(kcg, { type: "kicked", serverNow: now() });
        broadcast(t, [{ t: "takeover", seat: s }]);
        return postApply(t);                             // the drive picks the seat up
      }

      if (spec.extraCommand && spec.extraCommand(t, conn, msg, HELPERS)) return;

      if (LOBBY_CMDS[type]) {
        if (t.game) return errTo(conn, "phase");
        if (type === "sit") {
          if (seatOfToken(t, token) != null) return;         // already seated
          var idx = -1;
          if (msg.seat != null && !t.seats[msg.seat]) idx = msg.seat;
          else idx = openSeatIndex(t);
          if (idx < 0) return errTo(conn, "full");
          var occupied = t.seats.map(function (s, si) { return s && si !== idx ? s.color : null; });
          t.seats[idx] = { token: token, name: conn.name, color: Colors.freePreset(occupied), connected: true, phantom: false };
          resizeSeats(t);
          return broadcast(t, []);
        }
        if (type === "stand") {
          var mi = seatOfToken(t, token);
          if (mi != null) { t.seats[mi] = null; resizeSeats(t); broadcast(t, []); }
          return;
        }
        // host adds (or renames — re-adding at a bot's seat) a named bot in
        // the lobby; the drive plays it from Start. Removal is kickSeat.
        if (type === "addBot") {
          if (!isHost(t, token)) return errTo(conn, "perm");
          var bi = msg.seat | 0;
          var bname = String(msg.name || "").trim().slice(0, 24);
          if (!bname) return errTo(conn, "perm");
          if (bi < 0 || bi >= capacity(t)) return errTo(conn, "full");
          var bs = t.seats[bi];
          if (bs && !bs.phantom) return errTo(conn, "full");   // a human holds it
          var blower = bname.toLowerCase();
          var taken = t.seats.some(function (s, si) { return s && si !== bi && s.name.toLowerCase() === blower; }) ||
                      t.conns.some(function (c) { return !c.closed && c.name.toLowerCase() === blower; });
          if (taken) return errTo(conn, "name-taken");
          if (bs) bs.name = bname;
          else {
            var bocc = t.seats.map(function (s, si) { return s && si !== bi ? s.color : null; });
            t.seats[bi] = { token: "phantom:" + uid(), name: bname, color: Colors.freePreset(bocc), connected: true, phantom: true };
          }
          resizeSeats(t);
          return broadcast(t, []);
        }
        // host shuffles the seated players' order — Fisher-Yates over the
        // occupied entries, reassigned into the same slots
        if (type === "shuffle") {
          if (!isHost(t, token)) return errTo(conn, "perm");
          var occ = [];
          t.seats.forEach(function (s, si) { if (s) occ.push(si); });
          if (occ.length >= 2) {
            var pool = occ.map(function (si) { return t.seats[si]; });
            for (var fi = pool.length - 1; fi > 0; fi--) {
              var fj = Math.floor(Math.random() * (fi + 1));
              var ftmp = pool[fi]; pool[fi] = pool[fj]; pool[fj] = ftmp;
            }
            occ.forEach(function (slot, k) { t.seats[slot] = pool[k]; });
          }
          return broadcast(t, []);
        }
        // lobby-only by registration (colors LOCK at Start, by decision):
        // your own seat, or the host recoloring a bot. Validation is the
        // colors.js contract — the DO runs this branch byte-identically.
        if (type === "recolor") {
          var target = msg.seat != null ? msg.seat : seatOfToken(t, token);
          var ts = target != null ? t.seats[target] : null;
          if (!ts) return errTo(conn, "perm");
          var own = seatOfToken(t, token) === target;
          if (!own && !(ts.phantom && isHost(t, token))) return errTo(conn, "perm");
          var hex = Colors.norm(msg.color);
          if (!hex) return errTo(conn, "color");
          if (Colors.clash(hex, otherColors(t, ts)) >= 0) return errTo(conn, "color-taken");
          ts.color = hex;
          return broadcast(t, []);
        }
        if (type === "setSettings") {
          if (!isHost(t, token)) return errTo(conn, "perm");
          var bad = spec.applySettings(t, msg, HELPERS);
          if (bad) return errTo(conn, bad);
          resizeSeats(t);
          return broadcast(t, []);
        }
        if (type === "start") {
          if (!isHost(t, token)) return errTo(conn, "perm");
          resizeSeats(t);
          var seated = t.seats.filter(function (s) { return !!s; });
          if (seated.length < spec.minSeats()) return errTo(conn, "phase");
          t.seats = seated;   // COMPACT: seat index now === engine player index
          t.game = spec.createGame(t, seated, ctx());
          var extra = (spec.onStart ? spec.onStart(t) : []) || [];
          broadcast(t, extra);
          return postApply(t);
        }
        return;
      }

      if (GAME_CMDS[type]) {
        if (!t.game || t.game.phase === "over") return errTo(conn, "phase");
        var seat = seatOfToken(t, token);
        if (seat == null) return errTo(conn, "perm");        // spectators can't act
        var action = clone(msg); action.seat = seat;         // server injects the actor
        var res = applyEngine(t, action);
        if (res.error) return errTo(conn, res.error.code);
        broadcast(t, res.events);
        return postApply(t);
      }
    }

    /* ── public API (the shape games/transport.js mirrors) ───────── */
    var API = {
      kind: "mock",
      phantomStep: BOT_STEP,

      peek: function (code) {
        return new Promise(function (resolve) {
          setTimeout(function () {
            var t = TABLES[code];
            if (!t) return resolve({ exists: false });
            resolve({
              exists: true,
              phase: t.game ? t.game.phase : "lobby",
              seated: seatedCount(t),
              capacity: capacity(t),
              spectators: spectatorCount(t)
            });
          }, LATENCY);
        });
      },

      connect: function (code, opts) {
        return new Promise(function (resolve, reject) {
          setTimeout(function () {
            var t = TABLES[code];
            if (!t && !opts.create) return reject({ code: "no-table" });
            var token = typeof opts.token === "string" ? opts.token.slice(0, 64) : "";
            var name = String(opts.name || "?").slice(0, 24);
            if (!t) {
              t = TABLES[code] = {
                code: code, createdAt: now(), creatorToken: token,
                settings: spec.defaultSettings(),
                seats: [], game: null, log: [],
                v: 1, touched: now(), conns: [], timer: null, timerFor: null,
                turnEndsAt: null, driving: false
              };
              EXTRA_KEYS.forEach(function (k) { t[k] = EXTRA[k](); });
              resizeSeats(t);
              save();
            }
            // reap our own lingering connection (reconnect supersedes)
            t.conns.slice().forEach(function (c) {
              if (token && c.token === token) { c.closed = true; t.conns.splice(t.conns.indexOf(c), 1); }
            });
            // unique display names among live connections AND host-added bot
            // seats (a returning token's own seat doesn't block its reclaim)
            var clash = t.conns.some(function (c) { return !c.closed && c.name.toLowerCase() === name.toLowerCase() && c.token !== token; }) ||
                        t.seats.some(function (s) { return s && s.token !== token && s.name.toLowerCase() === name.toLowerCase(); });
            if (clash) return reject({ code: "name-taken" });
            if (t.conns.filter(function (c) { return !c.closed; }).length >= MAX_CONNS) return reject({ code: "full" });

            var conn = {
              token: token, name: name, h: uid(), handler: null, closed: false,
              get seat() { return seatOfToken(t, token); },
              onMessage: function (cb) { conn.handler = cb; },
              onStatus: function () {},                        // the mock never drops
              send: function (msg) {
                setTimeout(function () { if (!conn.closed) handle(t, conn, msg); }, LATENCY);
              },
              close: function () {
                conn.closed = true;
                var i = t.conns.indexOf(conn);
                if (i >= 0) t.conns.splice(i, 1);
                broadcast(t, []);                              // presence update
              }
            };
            t.conns.push(conn);
            t.touched = now();
            if (spec.onJoined) spec.onJoined(t, token);
            sendSnapshot(t, conn);
            broadcast(t, []);                                  // let others see the join
            postApply(t);                                      // resume the drive on reconnect
            resolve(conn);
          }, LATENCY);
        });
      },

      /* dev knobs (console): <Game>Transport.wipe(), .phantomStep */
      wipe: function () {
        Object.keys(TABLES).forEach(function (c) { disarmTimer(TABLES[c]); });
        TABLES = {};
        try { localStorage.removeItem(STORE_KEY); } catch (e) {}
      },
      tables: function () { return TABLES; }
    };
    return API;
  }

  window.DeetsTableMock = { create: create };
})();
