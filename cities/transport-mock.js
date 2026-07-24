/* DeetsCities — MOCK transport (docs/cities.md, "Build order (mock first)").

   An in-page fake of the table Worker that speaks the wire protocol VERBATIM
   (peek / connect → conn with send/onMessage/onStatus) and runs the REAL
   rules engine (engine.js) locally, so a full hot-seat game is playable
   against phantoms before any worker exists. cities.js must not be able to
   tell this apart from the WebSocket client beyond `CitiesTransport.kind`.

   DEV-ONLY (all replaced by the worker later):
   - host-added phantom seats (the addBot verb) auto-play their turns
     (a lightweight AI that proposes actions and lets the engine validate)
   - tables persist in localStorage, so a running game survives a reload
   - fake command→broadcast latency keeps the async surface honest

   HIDDEN-INFO INVARIANTS are enforced here exactly as the worker must: a
   hand's contents ride only its owner's `you`; everyone else sees counts;
   dev-card identities ride only the owner's `you`; a steal broadcasts THAT
   it happened, the resource only to thief + victim; VP dev cards reveal at
   `over`. Randomness is Math.random here; the worker uses crypto in the DO. */
(function () {
  "use strict";

  var Engine = window.CitiesEngine;
  var Boards = window.CITIES_BOARDS;
  var Colors = window.DeetsColors;
  var RES = Engine.RES;

  var LATENCY = 110;                 // fake round-trip
  var STORE_KEY = "deets-cities-mock-v1";
  var PHANTOM_STEP = 650;            // ms between phantom actions (watchable)
  var LOG_MAX = 200;

  function now() { return Date.now(); }
  function uid() { return Math.random().toString(36).slice(2, 10); }
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function ctx() { return { rand: Math.random, now: now() }; }
  function handSize(h) { var n = 0; for (var i = 0; i < RES.length; i++) n += h[RES[i]]; return n; }

  var TABLES = {};   // code -> table

  /* ── persistence ──────────────────────────────────────────────── */
  function persistable() {
    var out = {};
    Object.keys(TABLES).forEach(function (code) {
      var t = TABLES[code];
      out[code] = {
        code: t.code, createdAt: t.createdAt, creatorToken: t.creatorToken,
        settings: t.settings, seats: t.seats, game: t.game,
        chips: t.chips, book: t.book, log: t.log.slice(-LOG_MAX),
        v: t.v, touched: t.touched
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
      // the 1 h idle+empty expiry, mock edition (the worker's alarm for real)
      if (!running && now() - (s.touched || 0) > 3600000) return;
      TABLES[code] = {
        code: s.code, createdAt: s.createdAt, creatorToken: s.creatorToken,
        settings: s.settings, seats: s.seats || [], game: s.game || null,
        chips: s.chips || {}, book: s.book || [], log: s.log || [],
        v: s.v || 1, touched: s.touched || 0,
        conns: [], timer: null, driving: false
      };
      // legacy saves carried color NAMES ("red"); seats are hex now
      TABLES[code].seats.forEach(function (st) {
        if (st && st.color && Colors.LEGACY[st.color]) st.color = Colors.LEGACY[st.color];
      });
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

  /* fill / trim phantom seats so the lobby holds exactly `capacity` seats
     (dev-only: lets one human start and play a full game solo) */
  // grow/shrink the lobby seat array to capacity with nulls, trimming only
  // trailing empties — the worker's resize, verbatim. The old auto-fill
  // (every open seat became a phantom) is GONE: bots are now host-added
  // via the `addBot` verb, in the mock and the worker alike.
  function resizeSeats(t) {
    if (t.game) return;
    var cap = t.settings.capacity;
    while (t.seats.length < cap) t.seats.push(null);
    while (t.seats.length > cap && !t.seats[t.seats.length - 1]) t.seats.pop();
  }
  // every other seat's color (null holes for empties + the excluded seat)
  function otherColors(t, except) {
    return t.seats.map(function (s) { return s && s !== except ? s.color : null; });
  }

  /* ── views (hidden-info enforced) ─────────────────────────────── */
  function publicOffer(o) {
    return { id: o.id, from: o.from, toCurrent: o.toCurrent, give: o.give, get: o.get, responses: o.responses };
  }
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
        return s ? { seat: i, name: s.name, color: s.color, connected: s.phantom ? true : tokenConnected(t, s.token), phantom: !!s.phantom }
                 : { seat: i, name: null, color: Colors.PRESETS[i], connected: false, empty: true };
      }),
      spectators: t.conns.filter(function (c) { return !c.closed && seatOfToken(t, c.token) == null; }).length,
      you: { seat: seat, host: isHost(t, token) }
    };
    if (t.settings.betting && t.chips[token] != null) view.you.chips = t.chips[token];
    if (!g) return view;

    view.frame = g.frame;
    view.board = g.board;                         // public: hexes, tokens, harbors, robber
    view.buildings = g.buildings;                 // public: piece positions (vid -> {seat,kind})
    view.roads = g.roads;                         // public: road positions (eid -> seat)
    view.bank = g.bank;                           // public counts
    view.devLeft = g.devDeck.length;              // public: TOTAL only (the mix is fixed per frame; per-type would leak draws)
    view.dice = g.stats.dice;                     // public: roll histogram (every roll is seen by all)
    // raw per-seat gained-card totals (no resource identities — those counts
    // are all publicly derivable, even a steal moves a visibly-counted card).
    // Host-toggleable: the "In-Game Resources View" setting omits it entirely.
    if (t.settings.resView !== false) {
      view.gained = g.stats.seats.map(function (s) {
        var tot = 0;
        ["rolls", "steals", "trades", "dev"].forEach(function (src) {
          for (var r in s.gained[src]) tot += s.gained[src][r];
        });
        return tot;
      });
    }
    view.turn = g.turn;                           // public (pending counts are public)
    view.setup = g.setup;
    view.awards = g.awards;
    view.offers = g.offers.map(publicOffer);
    view.vp = Engine.publicVPList(g);
    view.players = g.players.map(function (p, i) {
      return {
        seat: i,
        handCount: handSize(p.hand),
        devCount: p.dev.length,
        knights: p.knights,
        roadLen: (g.roadLens && g.roadLens[i]) || 0,
        vp: Engine.publicVP(g, i),
        supply: p.supply
      };
    });
    if (seat != null) {
      view.you.hand = clone(g.players[seat].hand);
      view.you.dev = g.players[seat].dev.map(function (d) { return { card: d.card, playable: d.turnBought !== g.stats.turns }; });
      var geo = Engine.geoOf(g.board);
      view.you.harbors = Engine.playerHarbors(g, geo, seat);
    }
    if (phase === "over") {
      view.over = {
        winner: g.winner,
        reveal: g.players.map(function (p, i) { return { seat: i, total: Engine.totalVP(g, i), vpCards: p.vpCards }; }),
        stats: g.stats,
        book: t.book,
        chips: t.chips
      };
    }
    if (t.turnEndsAt) view.turnEndsAt = t.turnEndsAt;
    return view;
  }
  function maskEvent(e, seat) {
    if (e.t === "stealHidden" && seat !== e.from && seat !== e.to) {
      return { t: "stealHidden", from: e.from, to: e.to };
    }
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
    if (t.game.phase === "over") { settleBets(t); disarmTimer(t); }
    return res;
  }

  /* ── turn timer (docs/cities.md, "Timers"); default off ───────── */
  function disarmTimer(t) { if (t.timer) { clearTimeout(t.timer); t.timer = null; } t.turnEndsAt = null; }
  function armTimer(t) {
    disarmTimer(t);
    var g = t.game;
    if (!g || g.phase !== "main" || !t.settings.timerSec) return;
    // only arm while a HUMAN must act (phantoms move on their own, fast)
    var actor = activeActor(t);
    if (actor == null || t.seats[actor].phantom) return;
    var ms = t.settings.timerSec * 1000;
    t.turnEndsAt = now() + ms;
    t.timer = setTimeout(function () {
      t.timer = null; t.turnEndsAt = null;
      var r = applyEngine(t, { type: "timerExpire" });
      if (!r.error) { broadcast(t, r.events); postApply(t); }
    }, ms);
  }
  // which seat the game is currently waiting on (for timer + phantom drive)
  function activeActor(t) {
    var g = t.game; if (!g) return null;
    if (g.phase === "setup") return g.setup.seq[g.setup.i];
    if (g.phase !== "main") return null;
    var p = g.turn.pending;
    if (p && p.kind === "discard") { var k = Object.keys(p.owed)[0]; return k == null ? null : +k; }
    return g.turn.seat;
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
  // is there any pending phantom obligation the mock must auto-play?
  function needsPhantom(t) {
    var g = t.game; if (!g) return false;
    if (g.phase === "setup") return t.seats[g.setup.seq[g.setup.i]].phantom;
    if (g.phase !== "main") return false;
    var p = g.turn.pending;
    if (p && p.kind === "discard") return Object.keys(p.owed).some(function (k) { return t.seats[+k].phantom; });
    return t.seats[g.turn.seat].phantom || phantomOwesResponse(t);
  }
  // is a phantom sitting on an open trade offer it hasn't answered? (runs even
  // when it's a human's turn — the human offers, the bots must respond)
  function phantomOwesResponse(t) {
    var g = t.game;
    if (!g || g.phase !== "main" || !g.offers || !g.offers.length) return false;
    return g.offers.some(function (o) {
      return g.players.some(function (_p, s) {
        if (s === o.from || !t.seats[s] || !t.seats[s].phantom) return false;
        if (o.responses && o.responses[s] != null) return false;
        if (o.toCurrent && s !== g.turn.seat) return false;
        return true;
      });
    });
  }
  // one phantom answers one offer; accepts a fair-or-better deal it can afford
  function phantomRespondOnce(t) {
    var g = t.game;
    if (!g.offers || !g.offers.length) return false;
    function bagSum(b) { var n = 0; for (var i = 0; i < RES.length; i++) n += b[RES[i]] || 0; return n; }
    for (var oi = 0; oi < g.offers.length; oi++) {
      var o = g.offers[oi];
      for (var s = 0; s < g.players.length; s++) {
        if (s === o.from || !t.seats[s] || !t.seats[s].phantom) continue;
        if (o.responses && o.responses[s] != null) continue;
        if (o.toCurrent && s !== g.turn.seat) continue;
        var gets = bagSum(o.give), gives = bagSum(o.get);   // responder receives give, pays get
        var canPay = RES.every(function (r) { return (g.players[s].hand[r] || 0) >= (o.get[r] || 0); });
        var action = (canPay && gets > 0 && gets >= gives) ? "accept" : "decline";
        if (action === "accept" && gets === gives && Math.random() < 0.4) action = "decline";
        return tryAct(t, { type: "respond", seat: s, offerId: o.id, action: action });
      }
    }
    return false;
  }
  function tryAct(t, action) {
    var res = Engine.applyAction(t.game, action, ctx());
    if (res.error) return false;
    var applied = applyEngine(t, action);
    t._ev = applied.events || [];   // stash so driveStep can broadcast them —
                                    // clients need phantom events too (log
                                    // lines, trade respond toasts), exactly
                                    // as the worker broadcasts every action's
    return true;                    // events regardless of who acted
  }
  function driveStep(t) {
    var g = t.game; if (!g || g.phase === "over") return;
    var did = phantomOne(t);
    if (did) { broadcast(t, t._ev || []); t._ev = null; t._acts = (t._acts || 0); }
    postApply(t);
  }
  // perform (at most) one phantom action; returns true if something changed
  function phantomOne(t) {
    var g = t.game, geo = Engine.geoOf(g.board);
    // phantom discards (any owing phantom), regardless of whose turn
    if (g.phase === "main" && g.turn.pending && g.turn.pending.kind === "discard") {
      var owed = g.turn.pending.owed;
      var pk = Object.keys(owed).filter(function (k) { return t.seats[+k].phantom; })[0];
      if (pk != null) {
        var seat = +pk, need = owed[seat], hand = g.players[seat].hand, cards = {}, left = need;
        for (var i = 0; i < RES.length && left > 0; i++) { var take = Math.min(hand[RES[i]], left); if (take > 0) { cards[RES[i]] = take; left -= take; } }
        return tryAct(t, { type: "discard", seat: seat, cards: cards });
      }
    }
    if (g.phase === "setup") {
      var cur = g.setup.seq[g.setup.i];
      if (!t.seats[cur].phantom) return false;
      if (g.setup.need === "settlement") {
        var verts = Object.keys(geo.vertexHexes);
        // prefer high-pip vertices for a slightly smarter bot
        verts.sort(function (a, b) { return pipValue(g, geo, b) - pipValue(g, geo, a); });
        for (var v = 0; v < verts.length; v++) if (tryAct(t, { type: "place", kind: "settlement", seat: cur, loc: verts[v] })) return true;
        return false;
      }
      var edges = geo.vertexEdges[g.setup.lastVid] || [];
      for (var e = 0; e < edges.length; e++) if (tryAct(t, { type: "place", kind: "road", seat: cur, loc: edges[e] })) return true;
      return false;
    }
    if (g.phase !== "main") return false;
    // answer any open trade offers first — bots respond even on a human's turn
    if (phantomRespondOnce(t)) return true;
    var seat = g.turn.seat;
    if (!t.seats[seat].phantom) return false;
    var p = g.turn.pending;
    if (p && p.kind === "robber") {
      // move to a hex with a human building if possible (to steal)
      var hexes = g.board.hexes.filter(function (h) { return (h.q + "," + h.r) !== g.board.robber; });
      var best = hexes[Math.floor(Math.random() * hexes.length)];
      for (var hh = 0; hh < hexes.length; hh++) {
        var vv = geo.hexVertices[hexes[hh].q + "," + hexes[hh].r] || [];
        var steal = vv.some(function (x) { var b = g.buildings[x]; return b && b.seat !== seat && !t.seats[b.seat].phantom && handSize(g.players[b.seat].hand) > 0; });
        if (steal) { best = hexes[hh]; break; }
      }
      return tryAct(t, { type: "moveRobber", seat: seat, hex: best.q + "," + best.r });
    }
    if (p && p.kind === "steal") return tryAct(t, { type: "steal", seat: seat, target: p.targets[Math.floor(Math.random() * p.targets.length)] });
    if (p && p.kind === "roads") {
      var re = Object.keys(geo.edgeVertices).filter(function (x) { return g.roads[x] == null; });
      for (var r = 0; r < re.length; r++) if (tryAct(t, { type: "place", kind: "road", seat: seat, loc: re[r] })) return true;
      return tryAct(t, { type: "endTurn" });     // no legal road — bail the turn
    }
    if (!g.turn.rolled) {
      // occasionally play a knight before rolling if holding one
      if (Math.random() < 0.3 && g.players[seat].dev.some(function (d) { return d.card === "knight" && d.turnBought !== g.stats.turns; })) {
        if (tryAct(t, { type: "playDev", card: "knight" })) return true;
      }
      return tryAct(t, { type: "roll" });
    }
    // rolled, no pending: try to build/buy one thing, else end turn
    t._acts = (t._acts || 0) + 1;
    if (t._acts < 14) {
      // city
      var sv = Object.keys(g.buildings).filter(function (x) { return g.buildings[x].seat === seat && g.buildings[x].kind === "settlement"; });
      for (var c = 0; c < sv.length; c++) if (tryAct(t, { type: "place", kind: "city", seat: seat, loc: sv[c] })) return true;
      // settlement
      var cand = Object.keys(geo.vertexHexes);
      cand.sort(function (a, b) { return pipValue(g, geo, b) - pipValue(g, geo, a); });
      for (var s2 = 0; s2 < cand.length; s2++) if (tryAct(t, { type: "place", kind: "settlement", seat: seat, loc: cand[s2] })) return true;
      // road (toward expansion) — only sometimes, to conserve
      if (Math.random() < 0.6) {
        var re2 = Object.keys(geo.edgeVertices).filter(function (x) { return g.roads[x] == null; });
        for (var r2 = 0; r2 < re2.length; r2++) if (tryAct(t, { type: "place", kind: "road", seat: seat, loc: re2[r2] })) return true;
      }
      // dev
      if (Math.random() < 0.5 && tryAct(t, { type: "buyDev" })) return true;
    }
    t._acts = 0;
    return tryAct(t, { type: "endTurn" });
  }
  // rough settlement value = Σ pips of adjacent non-desert hexes
  function pipValue(g, geo, vid) {
    var hexes = geo.vertexHexes[vid] || [], v = 0;
    hexes.forEach(function (hk) {
      var h = g.board.hexes.filter(function (x) { return (x.q + "," + x.r) === hk; })[0];
      if (h && h.token != null) v += 6 - Math.abs(7 - h.token);
    });
    return v;
  }

  /* ── betting (v1.1 designed; transport side wired, UI deferred) ── */
  function grantChips(t, token) {
    if (!t.settings.betting) return;
    if (t.chips[token] == null && seatOfToken(t, token) == null) t.chips[token] = 100;
  }
  function settleBets(t) {
    (t.book || []).forEach(function (b) {
      if (b.settled) return;
      b.settled = true;
      if (b.type === "winner" && b.params && b.params.seat === t.game.winner) {
        t.chips[b.token] = (t.chips[b.token] || 0) + b.stake * 2;   // even money v1.1
      }
    });
  }

  /* ── command handlers (client → table) ────────────────────────── */
  var LOBBY_CMDS = { sit: 1, stand: 1, addBot: 1, shuffle: 1, recolor: 1, setSettings: 1, start: 1 };
  var GAME_CMDS = { roll: 1, place: 1, buyDev: 1, playDev: 1, discard: 1, moveRobber: 1,
                    steal: 1, bankTrade: 1, offer: 1, respond: 1, close: 1, cancel: 1, endTurn: 1 };

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
      // (the worker's takeover rule; kick-ends-game is gone). phantom:true
      // is what the mock's drive keys on; bot:true is the client's tag.
      t.seats[s].bot = true; t.seats[s].phantom = true;
      var kcg = t.conns.filter(function (c) { return c.token === t.seats[s].token; })[0];
      if (kcg) deliver(kcg, { type: "kicked", serverNow: now() });
      broadcast(t, [{ t: "takeover", seat: s }]);
      return postApply(t);                             // the phantom drive picks the seat up
    }
    if (type === "bet") {
      if (seatOfToken(t, token) != null) return errTo(conn, "perm");   // seated tokens can't bet
      if (!t.settings.betting || !t.game || t.game.phase === "over") return errTo(conn, "phase");
      grantChips(t, token);
      var stake = Math.max(0, Math.min(t.chips[token] || 0, msg.stake | 0));
      if (stake <= 0) return errTo(conn, "cost");
      t.chips[token] -= stake;
      t.book.push({ betId: uid(), token: token, type: msg.type === "bet" ? (msg.betType || "winner") : "winner", params: msg.params || {}, stake: stake });
      return broadcast(t, []);
    }

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
      // the lobby; the phantom AI drives it from Start. Removal is kickSeat.
      if (type === "addBot") {
        if (!isHost(t, token)) return errTo(conn, "perm");
        var bi = msg.seat | 0;
        var bname = String(msg.name || "").trim().slice(0, 24);
        if (!bname) return errTo(conn, "perm");
        if (bi < 0 || bi >= t.settings.capacity) return errTo(conn, "full");
        var bs = t.seats[bi];
        if (bs && !bs.phantom) return errTo(conn, "full");   // a human holds it
        var blower = bname.toLowerCase();
        var taken = t.seats.some(function (s, si) { return s && si !== bi && s.name.toLowerCase() === blower; }) ||
                    t.conns.some(function (c) { return !c.closed && c.name.toLowerCase() === blower; });
        if (taken) return errTo(conn, "name-taken");
        if (bs) bs.name = bname;
        else {
          var bocc = t.seats.map(function (s, si) { return s && si !== bi ? s.color : null; });
          t.seats[bi] = { token: "phantom-" + uid(), name: bname, color: Colors.freePreset(bocc), connected: true, phantom: true };
        }
        resizeSeats(t);
        return broadcast(t, []);
      }
      // host shuffles the seated players' order — Fisher-Yates over the
      // occupied entries, reassigned into the same slots (empty seats stay
      // put; colors and names travel with their players)
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
      // colors.js contract — the DO must run this branch byte-identically.
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
        if (msg.capacity != null) {
          var cap = Math.max(3, Math.min(6, msg.capacity | 0));
          var occupiedBeyond = t.seats.some(function (s, si) { return s && si >= cap; });
          if (cap < seatedCount(t) || occupiedBeyond) return errTo(conn, "full");
          t.settings.capacity = cap;
        }
        if (msg.timerSec != null) {
          var allowed = [0, 45, 60, 90, 120];
          if (allowed.indexOf(msg.timerSec) >= 0) t.settings.timerSec = msg.timerSec;
        }
        if (msg.betting != null) t.settings.betting = !!msg.betting;
        if (msg.resView != null) t.settings.resView = !!msg.resView;
        resizeSeats(t);
        return broadcast(t, []);
      }
      if (type === "start") {
        if (!isHost(t, token)) return errTo(conn, "perm");
        resizeSeats(t);
        var seated = t.seats.filter(function (s) { return !!s; });
        if (seated.length < 3) return errTo(conn, "phase");
        t.seats = seated;   // COMPACT: seat index now === engine player index (the worker's rule — open-seat holes are possible now that bots are host-added)
        var game = Engine.createGame({
          seats: seated.map(function (s, i) { return { name: s.name, color: s.color }; }),
          settings: { timerSec: t.settings.timerSec, betting: t.settings.betting }
        }, ctx());
        t.game = game;
        // grant chips to any current spectators
        t.conns.forEach(function (c) { grantChips(t, c.token); });
        broadcast(t, [{ t: "start", frame: game.frame }]);
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

  /* ── public API (the shape transport.js will mirror) ──────────── */
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
            capacity: t.settings.capacity,
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
              settings: { capacity: 3, timerSec: 0, betting: false, resView: true },
              seats: [], game: null, chips: {}, book: [], log: [],
              v: 1, touched: now(), conns: [], timer: null, driving: false
            };
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
          var total = t.conns.filter(function (c) { return !c.closed; }).length;
          if (total >= 30) return reject({ code: "full" });

          var conn = {
            token: token, name: name, h: uid(), handler: null, closed: false,
            get seat() { return seatOfToken(t, token); },
            onMessage: function (cb) { conn.handler = cb; },
            onStatus: function () {},                        // mock never drops
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
          grantChips(t, token);
          sendSnapshot(t, conn);
          broadcast(t, []);                                  // let others see the join
          postApply(t);                                      // resume phantom drive on reconnect
          resolve(conn);
        }, LATENCY);
      });
    },

    /* dev knobs (console): CitiesTransport.wipe(), .phantomStep */
    wipe: function () {
      Object.keys(TABLES).forEach(function (c) { disarmTimer(TABLES[c]); });
      TABLES = {};
      try { localStorage.removeItem(STORE_KEY); } catch (e) {}
    }
  };

  window.CitiesTransport = API;   // transport.js overrides this unless ?mock
})();
