/* DeetsMahjong — MOCK transport (docs/mahjong.md, "Build order (mock first)").

   An in-page fake of the table Worker that speaks the wire protocol VERBATIM
   (peek / connect → conn with send/onMessage/onStatus) and runs the REAL
   rules engine (engine.js) locally, so a full game is playable against
   host-added bots before any worker exists. mahjong.js must not be able to
   tell this apart from the WebSocket client beyond `MahjongTransport.kind`.

   DEV-ONLY (all replaced by the worker later):
   - host-added phantom seats (the addBot verb) auto-play their turns
     (a lightweight AI that proposes actions and lets the engine validate)
   - tables persist in localStorage, so a running game survives a reload
   - fake command→broadcast latency keeps the async surface honest

   HIDDEN-INFO INVARIANTS are enforced here exactly as the worker must:
   a hand's contents (and the freshly drawn tile) ride only the owner's
   `you`; everyone else sees counts. Melds, flowers, discards, and the
   wall COUNT are public; the wall's contents never leave the table. A
   claim window broadcasts who may act, but each seat's OPTIONS ride only
   its own `you`; an ack broadcasts THAT a seat answered, pass-vs-claim
   only to the actor. The winning hand reveals in the handOver summary —
   the moment it becomes public at a real table. */
(function () {
  "use strict";

  var Engine = window.MahjongEngine;
  var Colors = window.MahjongColors;

  var LATENCY = 110;                 // fake round-trip
  var STORE_KEY = "deets-mahjong-mock-v1";
  var PHANTOM_STEP = 700;            // ms between phantom actions (watchable)
  var LOG_MAX = 240;
  var HANDOVER_MS = 9000;            // settlement interstitial auto-advance
  var CLAIM_CAP_MS = 10000;          // claim window never waits longer than this (timed tables)

  function now() { return Date.now(); }
  function uid() { return Math.random().toString(36).slice(2, 10); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function ctx() { return { rand: Math.random, now: now() }; }

  var TABLES = {};   // code -> table

  /* ── persistence ──────────────────────────────────────────────── */
  function persistable() {
    var out = {};
    Object.keys(TABLES).forEach(function (code) {
      var t = TABLES[code];
      out[code] = {
        code: t.code, createdAt: t.createdAt, creatorToken: t.creatorToken,
        settings: t.settings, seats: t.seats, game: t.game,
        log: t.log.slice(-LOG_MAX), v: t.v, touched: t.touched
      };
    });
    return out;
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ tables: persistable() })); } catch (e) {}
  }
  function load() {
    try { return (JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {}).tables || {}; }
    catch (e) { return {}; }
  }
  (function boot() {
    var saved = load();
    Object.keys(saved).forEach(function (code) {
      var s = saved[code];
      var running = s.game && s.game.phase !== "over";
      if (!running && now() - (s.touched || 0) > 3600000) return;   // 1 h idle expiry
      TABLES[code] = {
        code: s.code, createdAt: s.createdAt, creatorToken: s.creatorToken,
        settings: s.settings, seats: s.seats || [], game: s.game || null,
        log: s.log || [], v: s.v || 1, touched: s.touched || 0,
        conns: [], timer: null, driving: false
      };
    });
  })();

  /* ── seats / host / identity ──────────────────────────────────── */
  function seatOfToken(t, token) {
    for (var i = 0; i < t.seats.length; i++) if (t.seats[i] && t.seats[i].token === token) return i;
    return null;
  }
  function tokenConnected(t, token) {
    return t.conns.some(function (c) { return c.token === token && !c.closed; });
  }
  function hostToken(t) {
    if (t.creatorToken && tokenConnected(t, t.creatorToken)) return t.creatorToken;
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
  // mahjong is LOCKED to four seats — the lobby always holds exactly 4
  function resizeSeats(t) {
    if (t.game) return;
    while (t.seats.length < 4) t.seats.push(null);
    while (t.seats.length > 4 && !t.seats[t.seats.length - 1]) t.seats.pop();
  }
  function otherColors(t, except) {
    return t.seats.map(function (s) { return s && s !== except ? s.color : null; });
  }

  /* ── views (hidden-info enforced) ─────────────────────────────── */
  function buildView(t, conn) {
    var token = conn.token, seat = seatOfToken(t, token);
    var g = t.game, phase = g ? g.phase : "lobby";
    var view = {
      code: t.code,
      phase: phase,
      settings: t.settings,
      host: isHost(t, token),
      hostSeat: seatOfToken(t, hostToken(t)),
      seats: t.seats.map(function (s, i) {
        return s ? { seat: i, name: s.name, color: s.color, connected: s.phantom ? true : tokenConnected(t, s.token), phantom: !!s.phantom, bot: !!s.bot }
                 : { seat: i, name: null, color: Colors.PRESETS[i], connected: false, empty: true };
      }),
      spectators: t.conns.filter(function (c) { return !c.closed && seatOfToken(t, c.token) == null; }).length,
      you: { seat: seat, host: isHost(t, token) }
    };
    if (!g) return view;

    view.order = g.order;
    view.round = g.round;
    view.breakRoll = g.breakRoll;
    view.seating = g.seating;                       // rolls are public theater
    view.needBreak = g.phase === "play" && g.wall === null && !g.handOver;
    view.wallLeft = g.wall ? g.wall.length : null;
    view.wallBack = g.wallBack || 0;                // rear draws this hand — places the wall's tail gap
    view.pond = g.pond.slice();                     // chronological discards { seat, tile } — public record
    view.turn = g.turn ? { seat: g.turn.seat, hasDrawn: g.turn.drawn != null, justKonged: !!g.turn.justKonged } : null;
    if (g.claims) {
      view.claims = {
        from: g.claims.from,
        tile: g.claims.robbing ? null : g.claims.tile,   // a robbed kong's tile shows via the meld try, not here
        robbing: !!g.claims.robbing,
        waiting: Object.keys(g.claims.can).filter(function (k) { return !g.claims.responses[k]; }).map(Number),
        acked: Object.keys(g.claims.responses).map(Number)
      };
    }
    view.players = g.players.map(function (p, i) {
      return {
        seat: i,
        handCount: p.hand.length + (g.turn && g.turn.seat === i && g.turn.drawn != null ? 1 : 0),
        melds: p.melds,
        flowers: p.flowers,
        discards: p.discards,
        score: p.score,
        stats: p.stats
      };
    });
    if (seat != null) {
      var p = g.players[seat];
      view.you.hand = p.hand.slice();
      view.you.drawn = g.turn && g.turn.seat === seat ? g.turn.drawn : null;
      // my live options, computed server-side so the client stays dumb
      if (g.claims && g.claims.can[seat] && !g.claims.responses[seat]) {
        view.you.claims = {
          options: g.claims.can[seat].slice(),
          chows: g.claims.robbing ? [] : Engine.chowChoices(p.hand, g.claims.tile)
        };
      }
      if (g.phase === "play" && g.turn && g.turn.seat === seat && !g.claims && !g.handOver && g.wall) {
        var winCtx = {
          seat: seat, selfDraw: true, discarder: null, robbing: false,
          lastWall: g.wall.length === 0, replacement: !!g.turn.justKonged,
          firstTurn: !!g.turn.firstTurn
        };
        view.you.canWin = g.turn.drawn != null && !!Engine.winCheck(g, seat, null, winCtx);
        view.you.kongs = selfKongs(g, seat);
        // structurally winning but under the table minimum: say how close
        // (rides only `you` — the same hidden-info budget as canWin)
        if (g.turn.drawn != null && !view.you.canWin) {
          var nwTiles = p.hand.concat([g.turn.drawn]);
          if (Engine.isWinningTiles(nwTiles, p.melds.length)) {
            var nwSc = Engine.scoreHand(g, seat, nwTiles, winCtx);
            if (nwSc) view.you.nearWin = { faan: nwSc.faan, need: g.settings.minFaan };
          }
        }
      }
      // live hand value (the scoring guide's live marks): the full
      // scoreHand result while my drawn hand is structurally complete,
      // otherwise scoreProgress's mid-hand facts. Rides only `you` —
      // same hidden-info budget as canWin/nearWin. The worker must
      // mirror this field verbatim (wire contract).
      if (g.phase === "play" && g.wall && !g.handOver) {
        var hv = null;
        if (g.turn && g.turn.seat === seat && g.turn.drawn != null && !g.claims) {
          var hvTiles = p.hand.concat([g.turn.drawn]);
          if (Engine.isWinningTiles(hvTiles, p.melds.length)) {
            var hvSc = Engine.scoreHand(g, seat, hvTiles, {
              seat: seat, selfDraw: true, discarder: null, robbing: false,
              lastWall: g.wall.length === 0, replacement: !!g.turn.justKonged,
              firstTurn: !!g.turn.firstTurn
            });
            if (hvSc) hv = { faan: hvSc.faan, parts: hvSc.parts, complete: true };
          }
        }
        if (!hv) {
          var pr = Engine.scoreProgress(g, seat);
          hv = { faan: pr.faan, parts: pr.parts, complete: false };
        }
        view.you.handValue = hv;
      }
    }
    if (g.handOver) {
      view.handOver = g.handOver;
      if (t.turnEndsAt) view.handOverAt = t.turnEndsAt;
    }
    if (phase === "over") {
      view.over = {
        winner: g.winner,
        scores: g.players.map(function (p) { return p.score; }),
        stats: g.players.map(function (p) { return p.stats; }),
        hands: g.stats.hands,
        results: g.results
      };
    }
    if (t.turnEndsAt) view.turnEndsAt = t.turnEndsAt;
    return view;
  }
  // legal self-kong tiles for the seat holding the draw
  function selfKongs(g, seat) {
    var p = g.players[seat];
    var pool = p.hand.slice();
    if (g.turn.drawn != null) pool.push(g.turn.drawn);
    var c = {};
    pool.forEach(function (x) { c[x] = (c[x] || 0) + 1; });
    var out = [];
    Object.keys(c).forEach(function (k) { if (c[k] >= 4) out.push(k); });
    p.melds.forEach(function (m) { if (m.kind === "pung" && c[m.tile]) out.push(m.tile); });
    return out;
  }
  function maskEvent(e, seat) {
    // pass-vs-claim rides only the actor's copy until the window resolves
    if (e.t === "claimAck" && seat !== e.seat) return { t: "claimAck", seat: e.seat };
    return e;
  }

  /* ── delivery ─────────────────────────────────────────────────── */
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

  /* ── engine bridge ────────────────────────────────────────────── */
  function applyEngine(t, action) {
    var res = Engine.applyAction(t.game, action, ctx());
    if (res.error) return res;
    t.game = res.game;
    (res.events || []).forEach(function (e) { t.log.push(e); });
    if (t.log.length > LOG_MAX) t.log.splice(0, t.log.length - LOG_MAX);
    if (t.game.phase === "over") disarmTimer(t);
    return res;
  }

  /* ── table timer (docs/mahjong.md, "Timers") ──────────────────── */
  function disarmTimer(t) { if (t.timer) { clearTimeout(t.timer); t.timer = null; } t.turnEndsAt = null; }
  // one deadline for whatever the table is waiting on; timerExpire resolves it
  function deadlineFor(t) {
    var g = t.game;
    if (!g || g.phase === "over") return null;
    if (g.handOver) return HANDOVER_MS;                       // always auto-advances
    var timed = t.settings.timerSec > 0;
    var ms = t.settings.timerSec * 1000;
    function human(s) { return t.seats[s] && !t.seats[s].phantom; }
    if (g.phase === "seating") {
      var scope = g.seating.reroll || [0, 1, 2, 3];
      var pendingHuman = scope.some(function (s) { return !g.seating.rolls[s] && human(s); });
      return timed && pendingHuman ? ms : null;
    }
    if (g.claims) {
      var waitHuman = Object.keys(g.claims.can).some(function (k) { return !g.claims.responses[k] && human(+k); });
      return timed && waitHuman ? Math.min(ms, CLAIM_CAP_MS) : null;
    }
    if (g.wall === null) return timed && human(Engine.dealerSeat(g)) ? ms : null;
    if (g.turn) return timed && human(g.turn.seat) ? ms : null;
    return null;
  }
  function armTimer(t) {
    disarmTimer(t);
    var ms = deadlineFor(t);
    if (ms == null) return;
    t.turnEndsAt = now() + ms;
    t.timer = setTimeout(function () {
      t.timer = null; t.turnEndsAt = null;
      var r = applyEngine(t, { type: "timerExpire" });
      if (!r.error) { broadcast(t, r.events); postApply(t); }
    }, ms);
  }

  /* ── phantom drive (dev-only AI; engine validates every attempt) ─ */
  function postApply(t) { armTimer(t); scheduleDrive(t); }
  function scheduleDrive(t) {
    if (t.driving) return;
    var g = t.game; if (!g || g.phase === "over") return;
    if (!needsPhantom(t)) return;
    t.driving = true;
    setTimeout(function () { t.driving = false; driveStep(t); }, PHANTOM_STEP);
  }
  function phantom(t, s) { return t.seats[s] && t.seats[s].phantom; }
  function needsPhantom(t) {
    var g = t.game; if (!g || g.phase === "over") return false;
    if (g.handOver) return false;                             // the timer advances it
    if (g.phase === "seating") {
      var scope = g.seating.reroll || [0, 1, 2, 3];
      return scope.some(function (s) { return !g.seating.rolls[s] && phantom(t, s); });
    }
    if (g.claims) {
      return Object.keys(g.claims.can).some(function (k) { return !g.claims.responses[k] && phantom(t, +k); });
    }
    if (g.wall === null) return phantom(t, Engine.dealerSeat(g));
    if (g.turn) return phantom(t, g.turn.seat);
    return false;
  }
  function tryAct(t, action) {
    var res = Engine.applyAction(t.game, action, ctx());
    if (res.error) return false;
    var applied = applyEngine(t, action);
    t._ev = applied.events || [];
    return true;
  }
  function driveStep(t) {
    var g = t.game; if (!g || g.phase === "over") return;
    var did = phantomOne(t);
    if (did) { broadcast(t, t._ev || []); t._ev = null; }
    postApply(t);
  }
  function phantomOne(t) {
    var g = t.game;
    if (g.phase === "seating") {
      var scope = g.seating.reroll || [0, 1, 2, 3];
      var s0 = scope.filter(function (s) { return !g.seating.rolls[s] && phantom(t, s); })[0];
      if (s0 == null) return false;
      return tryAct(t, { type: "rollSeat", seat: s0 });
    }
    if (g.claims) {
      var ks = Object.keys(g.claims.can).filter(function (k) { return !g.claims.responses[k] && phantom(t, +k); });
      if (!ks.length) return false;
      var seat = +ks[0], opts = g.claims.can[seat];
      var act = "pass", tiles = null;
      if (opts.indexOf("win") >= 0) act = "win";
      else if (opts.indexOf("kong") >= 0 && Math.random() < 0.8) act = "kong";
      else if (opts.indexOf("pung") >= 0 && Math.random() < 0.55) act = "pung";
      else if (opts.indexOf("chow") >= 0 && Math.random() < 0.3) {
        act = "chow";
        var cc = Engine.chowChoices(g.players[seat].hand, g.claims.tile);
        tiles = cc[Math.floor(Math.random() * cc.length)];
      }
      return tryAct(t, { type: "claim", seat: seat, action: act, tiles: tiles });
    }
    if (g.wall === null && !g.handOver) {
      var dealer = Engine.dealerSeat(g);
      if (!phantom(t, dealer)) return false;
      return tryAct(t, { type: "rollBreak", seat: dealer });
    }
    if (!g.turn || !phantom(t, g.turn.seat)) return false;
    var me = g.turn.seat, p = g.players[me];
    // 1) win if the drawn tile completes the hand
    if (g.turn.drawn != null && tryAct(t, { type: "win", seat: me })) return true;
    // 2) kong when available (keeps the replacement-draw machinery exercised)
    var kongs = selfKongs(g, me);
    if (kongs.length && Math.random() < 0.7 && tryAct(t, { type: "kong", seat: me, tile: kongs[0] })) return true;
    // 3) discard the least useful tile
    var pool = p.hand.slice();
    if (g.turn.drawn != null) pool.push(g.turn.drawn);
    var counts = {};
    pool.forEach(function (x) { counts[x] = (counts[x] || 0) + 1; });
    function usefulness(tile) {
      var v = (counts[tile] - 1) * 4;
      if (!Engine.isHonor(tile)) {
        var s = Engine.suitOf(tile), n = Engine.numOf(tile);
        [-2, -1, 1, 2].forEach(function (d) {
          var nb = n + d;
          if (nb >= 1 && nb <= 9 && counts[s + nb]) v += Math.abs(d) === 1 ? 2 : 1;
        });
      }
      return v + Math.random() * 0.5;   // jitter breaks ties un-robotically
    }
    var worst = null, worstV = Infinity;
    pool.forEach(function (tile) {
      var v = usefulness(tile);
      if (v < worstV) { worstV = v; worst = tile; }
    });
    return tryAct(t, { type: "discard", seat: me, tile: worst });
  }

  /* ── command handlers (client → table) ────────────────────────── */
  var LOBBY_CMDS = { sit: 1, stand: 1, addBot: 1, shuffle: 1, recolor: 1, setSettings: 1, start: 1 };
  var GAME_CMDS = { rollSeat: 1, rollBreak: 1, discard: 1, win: 1, kong: 1, claim: 1, nextHand: 1 };

  function handle(t, conn, msg) {
    var token = conn.token, type = msg.type;

    if (type === "closeTable") {
      if (!isHost(t, token)) return errTo(conn, "perm");
      t.conns.slice().forEach(function (c) { deliver(c, { type: "closed", serverNow: now() }); });
      disarmTimer(t); delete TABLES[t.code]; save();
      return;
    }
    // host rematch from the game-over reveal: the finished game clears and
    // the table drops back to the lobby (seats, colors, bots, and settings
    // persist; scores lived in the discarded game). Wire contract — the
    // worker mirrors this verb verbatim.
    if (type === "rematch") {
      if (!isHost(t, token)) return errTo(conn, "perm");
      if (!t.game || t.game.phase !== "over") return errTo(conn, "phase");
      t.game = null;
      disarmTimer(t);
      return broadcast(t, []);
    }
    if (type === "kickSeat") {
      if (!isHost(t, token)) return errTo(conn, "perm");
      var s = msg.seat;
      if (s == null || !t.seats[s]) return;
      if (!t.game || t.game.phase === "over") {
        var kickedTok = t.seats[s].token;
        t.seats[s] = null; resizeSeats(t);
        var kc = t.conns.filter(function (c) { return c.token === kickedTok; })[0];
        if (kc) deliver(kc, { type: "kicked", serverNow: now() });
        return broadcast(t, []);
      }
      // running game: the seat converts to a bot (the takeover rule)
      t.seats[s].bot = true; t.seats[s].phantom = true;
      var kcg = t.conns.filter(function (c) { return c.token === t.seats[s].token; })[0];
      if (kcg) deliver(kcg, { type: "kicked", serverNow: now() });
      broadcast(t, [{ t: "takeover", seat: s }]);
      return postApply(t);
    }

    if (LOBBY_CMDS[type]) {
      if (t.game) return errTo(conn, "phase");
      if (type === "sit") {
        if (seatOfToken(t, token) != null) return;
        var idx = -1;
        if (msg.seat != null && !t.seats[msg.seat]) idx = msg.seat;
        else idx = openSeatIndex(t);
        if (idx < 0) return errTo(conn, "full");
        var occupied = t.seats.map(function (x, si) { return x && si !== idx ? x.color : null; });
        t.seats[idx] = { token: token, name: conn.name, color: Colors.freePreset(occupied), connected: true, phantom: false };
        resizeSeats(t);
        return broadcast(t, []);
      }
      if (type === "stand") {
        var mi = seatOfToken(t, token);
        if (mi != null) { t.seats[mi] = null; resizeSeats(t); broadcast(t, []); }
        return;
      }
      if (type === "addBot") {
        if (!isHost(t, token)) return errTo(conn, "perm");
        var bi = msg.seat | 0;
        var bname = String(msg.name || "").trim().slice(0, 24);
        if (!bname) return errTo(conn, "perm");
        if (bi < 0 || bi >= 4) return errTo(conn, "full");
        var bs = t.seats[bi];
        if (bs && !bs.phantom) return errTo(conn, "full");
        var blower = bname.toLowerCase();
        var taken = t.seats.some(function (x, si) { return x && si !== bi && x.name.toLowerCase() === blower; }) ||
                    t.conns.some(function (c) { return !c.closed && c.name.toLowerCase() === blower; });
        if (taken) return errTo(conn, "name-taken");
        if (bs) bs.name = bname;
        else {
          var bocc = t.seats.map(function (x, si) { return x && si !== bi ? x.color : null; });
          t.seats[bi] = { token: "phantom-" + uid(), name: bname, color: Colors.freePreset(bocc), connected: true, phantom: true };
        }
        resizeSeats(t);
        return broadcast(t, []);
      }
      if (type === "shuffle") {
        if (!isHost(t, token)) return errTo(conn, "perm");
        var occ = [];
        t.seats.forEach(function (x, si) { if (x) occ.push(si); });
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
        if (msg.minFaan != null) {
          var mf = msg.minFaan | 0;
          if (mf >= 0 && mf <= 13) t.settings.minFaan = mf;
        }
        if (msg.capFaan != null && [8, 10, 13].indexOf(msg.capFaan) >= 0) t.settings.capFaan = msg.capFaan;
        if (msg.winds != null && [0, 1, 4].indexOf(msg.winds) >= 0) t.settings.winds = msg.winds;
        if (msg.timerSec != null && [0, 45, 60, 90, 120].indexOf(msg.timerSec) >= 0) t.settings.timerSec = msg.timerSec;
        return broadcast(t, []);
      }
      if (type === "start") {
        if (!isHost(t, token)) return errTo(conn, "perm");
        resizeSeats(t);
        var seated = t.seats.filter(function (x) { return !!x; });
        if (seated.length !== 4) return errTo(conn, "phase");
        t.seats = seated;   // COMPACT: seat index === engine player index
        t.game = Engine.createGame({
          settings: {
            minFaan: t.settings.minFaan, capFaan: t.settings.capFaan,
            winds: t.settings.winds, timerSec: t.settings.timerSec
          }
        }, ctx());
        broadcast(t, [{ t: "start" }]);
        return postApply(t);
      }
      return;
    }

    if (GAME_CMDS[type]) {
      if (!t.game || t.game.phase === "over") return errTo(conn, "phase");
      var seat = seatOfToken(t, token);
      if (seat == null) return errTo(conn, "perm");
      var action = clone(msg); action.seat = seat;   // server injects the actor
      var res = applyEngine(t, action);
      if (res.error) return errTo(conn, res.error.code);
      broadcast(t, res.events);
      return postApply(t);
    }
  }

  /* ── public API (the shape transport.js mirrors) ──────────────── */
  var API = {
    kind: "mock",

    peek: function (code) {
      return new Promise(function (resolve) {
        setTimeout(function () {
          var t = TABLES[code];
          if (!t) return resolve({ exists: false });
          resolve({
            exists: true,
            phase: t.game ? t.game.phase : "lobby",
            seated: seatedCount(t),
            capacity: 4,
            spectators: t.conns.filter(function (c) { return !c.closed && seatOfToken(t, c.token) == null; }).length
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
              settings: { minFaan: 3, capFaan: 13, winds: 1, timerSec: 0 },
              seats: [], game: null, log: [],
              v: 1, touched: now(), conns: [], timer: null, driving: false
            };
            resizeSeats(t);
            save();
          }
          t.conns.slice().forEach(function (c) {
            if (token && c.token === token) { c.closed = true; t.conns.splice(t.conns.indexOf(c), 1); }
          });
          var clash = t.conns.some(function (c) { return !c.closed && c.name.toLowerCase() === name.toLowerCase() && c.token !== token; }) ||
                      t.seats.some(function (s) { return s && s.token !== token && s.name.toLowerCase() === name.toLowerCase(); });
          if (clash) return reject({ code: "name-taken" });
          var total = t.conns.filter(function (c) { return !c.closed; }).length;
          if (total >= 30) return reject({ code: "full" });

          var conn = {
            token: token, name: name, h: uid(), handler: null, closed: false,
            onMessage: function (cb) { conn.handler = cb; },
            onStatus: function () {},                        // mock never drops
            send: function (msg) {
              setTimeout(function () { if (!conn.closed) handle(t, conn, msg); }, LATENCY);
            },
            close: function () {
              conn.closed = true;
              var i = t.conns.indexOf(conn);
              if (i >= 0) t.conns.splice(i, 1);
              broadcast(t, []);
            }
          };
          t.conns.push(conn);
          t.touched = now();
          sendSnapshot(t, conn);
          broadcast(t, []);
          postApply(t);
          resolve(conn);
        }, LATENCY);
      });
    },

    /* dev knobs (console): MahjongTransport.wipe() */
    wipe: function () {
      Object.keys(TABLES).forEach(function (c) { disarmTimer(TABLES[c]); });
      TABLES = {};
      try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    }
  };

  window.MahjongTransport = API;   // transport.js overrides this unless ?mock
})();
