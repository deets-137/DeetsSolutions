/* DeetsCities - the MOCK table (docs/games.md, "The pieces").

   The in-page fake worker, selected with ?mock (the page defaults to prod).
   Everything that isn't DeetsCities in particular - persistence, seats, host
   fallback, the lobby verbs, delivery, the deadline, the drive loop, peek /
   connect - lives in the shared core, games/table-mock.js, which mirrors the
   worker base's subclass contract (games/table-do.js) hook for hook.

   This file is the game half: the view, the settings, the rules bridge, the
   bot, and side betting. HIDDEN-INFO INVARIANTS are enforced here exactly as
   the worker enforces them: a hand's contents ride only its owner's `you`,
   everyone else sees counts; dev-card identities ride only the owner's `you`;
   a steal broadcasts THAT it happened, the resource only to thief + victim;
   VP dev cards reveal at `over`. */
(function () {
  "use strict";

  var Engine = window.CitiesEngine;
  var Colors = window.DeetsColors;
  var RES = Engine.RES;

  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function handSize(h) { var n = 0; for (var i = 0; i < RES.length; i++) n += h[RES[i]]; return n; }
  function publicOffer(o) {
    return { id: o.id, from: o.from, toCurrent: o.toCurrent, give: o.give, get: o.get, responses: o.responses };
  }
  function seatOf(t, token) {
    for (var i = 0; i < t.seats.length; i++) if (t.seats[i] && t.seats[i].token === token) return i;
    return null;
  }
  function grantChips(t, token) {
    if (!t.settings.betting) return;
    if (t.chips[token] == null && seatOf(t, token) == null) t.chips[token] = 100;
  }
  // which seat the game is waiting on (drives both the clock and the bot)
  function activeActor(t) {
    var g = t.game; if (!g) return null;
    if (g.phase === "setup") return g.setup.seq[g.setup.i];
    if (g.phase !== "main") return null;
    var p = g.turn.pending;
    if (p && p.kind === "discard") { var k = Object.keys(p.owed)[0]; return k == null ? null : +k; }
    return g.turn.seat;
  }

  window.CitiesTransport = window.DeetsTableMock.create({
    ns: "cities",
    Engine: Engine,
    Colors: Colors,
    extraState: { chips: function () { return {}; }, book: function () { return []; } },
    gameVerbs: { roll: 1, place: 1, buyDev: 1, playDev: 1, discard: 1, moveRobber: 1,
                 steal: 1, bankTrade: 1, offer: 1, respond: 1, close: 1, cancel: 1, endTurn: 1 },

    defaultSettings: function () { return { capacity: 3, timerSec: 0, betting: false, resView: true }; },
    minSeats: function () { return 3; },

    /* the view's game half (the core built code/phase/settings/seats/you) */
    buildView: function (view, t, conn, seat) {
      var token = conn.token, g = t.game;
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
      if (g.phase === "over") {
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
    },

    maskEvent: function (e, seat) {
      if (e.t === "stealHidden" && seat !== e.from && seat !== e.to) {
        return { t: "stealHidden", from: e.from, to: e.to };
      }
      return e;
    },

    /* lobby */
    applySettings: function (t, msg, H) {
      if (msg.capacity != null) {
        var cap = Math.max(3, Math.min(6, msg.capacity | 0));
        var occupiedBeyond = t.seats.some(function (s, si) { return s && si >= cap; });
        if (cap < H.seatedCount(t) || occupiedBeyond) return "full";
        t.settings.capacity = cap;
      }
      if (msg.timerSec != null) {
        var allowed = [0, 45, 60, 90, 120];
        if (allowed.indexOf(msg.timerSec) >= 0) t.settings.timerSec = msg.timerSec;
      }
      if (msg.betting != null) t.settings.betting = !!msg.betting;
      if (msg.resView != null) t.settings.resView = !!msg.resView;
      return null;
    },
    createGame: function (t, seated, ctx) {
      return Engine.createGame({
        seats: seated.map(function (s) { return { name: s.name, color: s.color }; }),
        settings: { timerSec: t.settings.timerSec, betting: t.settings.betting }
      }, ctx);
    },
    onStart: function (t) {
      t.conns.forEach(function (c) { grantChips(t, c.token); });   // spectators get chips
      return [{ t: "start", frame: t.game.frame }];
    },
    onJoined: grantChips,
    onGameOver: function (t) {
      (t.book || []).forEach(function (b) {
        if (b.settled) return;
        b.settled = true;
        if (b.type === "winner" && b.params && b.params.seat === t.game.winner) {
          t.chips[b.token] = (t.chips[b.token] || 0) + b.stake * 2;
        }
      });
    },
    // a spectator stakes chips on an outcome - off-engine, so it rides here
    extraCommand: function (t, conn, msg, H) {
      if (msg.type !== "bet") return false;
      var token = conn.token;
      if (H.seatOfToken(t, token) != null) { H.errTo(conn, "perm"); return true; }
      if (!t.settings.betting || !t.game || t.game.phase === "over") { H.errTo(conn, "phase"); return true; }
      grantChips(t, token);
      var stake = Math.max(0, Math.min(t.chips[token] || 0, msg.stake | 0));
      if (stake <= 0) { H.errTo(conn, "cost"); return true; }
      t.chips[token] -= stake;
      t.book.push({ betId: H.uid(), token: token, type: msg.betType || "winner", params: msg.params || {}, stake: stake });
      H.broadcast(t, []);
      return true;
    },

    /* the table deadline: only a HUMAN's clock runs */
    deadlineFor: function (t) {
      var g = t.game;
      if (!g || g.phase !== "main" || !t.settings.timerSec) return null;
      var actor = activeActor(t);
      if (actor == null || t.seats[actor].phantom) return null;
      return t.settings.timerSec * 1000;
    },
    dlSig: function (t) {
      var g = t.game;
      if (!g || g.phase !== "main") return null;
      var actor = activeActor(t);
      if (actor == null) return null;
      var p = g.turn.pending;
      return actor + ":" + (p ? p.kind : (g.turn.rolled ? "act" : "roll")) + ":" + g.stats.turns;
    },

    /* bot drive (the engine validates every attempt) */
    needsPhantom: function (t) {
      var g = t.game; if (!g) return false;
      if (g.phase === "setup") return t.seats[g.setup.seq[g.setup.i]].phantom;
      if (g.phase !== "main") return false;
      var p = g.turn.pending;
      if (p && p.kind === "discard") return Object.keys(p.owed).some(function (k) { return t.seats[+k].phantom; });
      return t.seats[g.turn.seat].phantom || owesResponse(t);
    },
    phantomOne: function (t, H) { return phantomOne(t, H); }
  });

  // is a bot sitting on an open trade offer it hasn't answered? (runs even
  // when it's a human's turn - the human offers, the bots must respond)
  function owesResponse(t) {
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
  // one bot answers one offer; accepts a fair-or-better deal it can afford
  function respondOnce(t, H) {
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
        return H.tryAct(t, { type: "respond", seat: s, offerId: o.id, action: action });
      }
    }
    return false;
  }

  function phantomOne(t, H) {
    var g = t.game, geo = Engine.geoOf(g.board);
    // phantom discards (any owing phantom), regardless of whose turn
    if (g.phase === "main" && g.turn.pending && g.turn.pending.kind === "discard") {
      var owed = g.turn.pending.owed;
      var pk = Object.keys(owed).filter(function (k) { return t.seats[+k].phantom; })[0];
      if (pk != null) {
        var seat = +pk, need = owed[seat], hand = g.players[seat].hand, cards = {}, left = need;
        for (var i = 0; i < RES.length && left > 0; i++) { var take = Math.min(hand[RES[i]], left); if (take > 0) { cards[RES[i]] = take; left -= take; } }
        return H.tryAct(t, { type: "discard", seat: seat, cards: cards });
      }
    }
    if (g.phase === "setup") {
      var cur = g.setup.seq[g.setup.i];
      if (!t.seats[cur].phantom) return false;
      if (g.setup.need === "settlement") {
        var verts = Object.keys(geo.vertexHexes);
        // prefer high-pip vertices for a slightly smarter bot
        verts.sort(function (a, b) { return pipValue(g, geo, b) - pipValue(g, geo, a); });
        for (var v = 0; v < verts.length; v++) if (H.tryAct(t, { type: "place", kind: "settlement", seat: cur, loc: verts[v] })) return true;
        return false;
      }
      var edges = geo.vertexEdges[g.setup.lastVid] || [];
      for (var e = 0; e < edges.length; e++) if (H.tryAct(t, { type: "place", kind: "road", seat: cur, loc: edges[e] })) return true;
      return false;
    }
    if (g.phase !== "main") return false;
    // answer any open trade offers first — bots respond even on a human's turn
    if (respondOnce(t, H)) return true;
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
      return H.tryAct(t, { type: "moveRobber", seat: seat, hex: best.q + "," + best.r });
    }
    if (p && p.kind === "steal") return H.tryAct(t, { type: "steal", seat: seat, target: p.targets[Math.floor(Math.random() * p.targets.length)] });
    if (p && p.kind === "roads") {
      var re = Object.keys(geo.edgeVertices).filter(function (x) { return g.roads[x] == null; });
      for (var r = 0; r < re.length; r++) if (H.tryAct(t, { type: "place", kind: "road", seat: seat, loc: re[r] })) return true;
      return H.tryAct(t, { type: "endTurn" });     // no legal road — bail the turn
    }
    if (!g.turn.rolled) {
      // occasionally play a knight before rolling if holding one
      if (Math.random() < 0.3 && g.players[seat].dev.some(function (d) { return d.card === "knight" && d.turnBought !== g.stats.turns; })) {
        if (H.tryAct(t, { type: "playDev", card: "knight" })) return true;
      }
      return H.tryAct(t, { type: "roll" });
    }
    // rolled, no pending: try to build/buy one thing, else end turn
    t._acts = (t._acts || 0) + 1;
    if (t._acts < 14) {
      // city
      var sv = Object.keys(g.buildings).filter(function (x) { return g.buildings[x].seat === seat && g.buildings[x].kind === "settlement"; });
      for (var c = 0; c < sv.length; c++) if (H.tryAct(t, { type: "place", kind: "city", seat: seat, loc: sv[c] })) return true;
      // settlement
      var cand = Object.keys(geo.vertexHexes);
      cand.sort(function (a, b) { return pipValue(g, geo, b) - pipValue(g, geo, a); });
      for (var s2 = 0; s2 < cand.length; s2++) if (H.tryAct(t, { type: "place", kind: "settlement", seat: seat, loc: cand[s2] })) return true;
      // road (toward expansion) — only sometimes, to conserve
      if (Math.random() < 0.6) {
        var re2 = Object.keys(geo.edgeVertices).filter(function (x) { return g.roads[x] == null; });
        for (var r2 = 0; r2 < re2.length; r2++) if (H.tryAct(t, { type: "place", kind: "road", seat: seat, loc: re2[r2] })) return true;
      }
      // dev
      if (Math.random() < 0.5 && H.tryAct(t, { type: "buyDev" })) return true;
    }
    t._acts = 0;
    return H.tryAct(t, { type: "endTurn" });
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
})();
