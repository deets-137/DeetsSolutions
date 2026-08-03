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
    // cities opts into "None" — the engine speaks `concede` (docs/cities.md)
    rejoinModes: ["anyone", "rejoin", "none"],
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
        // rank/tied come from the engine so the client never sorts a finish
        // itself (docs/stats.md, "Standings") — competition ranking, ties
        // shared. Must stay identical to the worker's viewGame.
        var rank = {};
        Engine.standings(g).forEach(function (r) { rank[r.seat] = r; });
        view.over = {
          winner: g.winner,
          reveal: g.players.map(function (p, i) {
            return { seat: i, total: Engine.totalVP(g, i), vpCards: p.vpCards,
                     rank: rank[i].rank, tied: rank[i].tied };
          }),
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
        // any whole 0–600s: the UI offers presets plus a custom box
        var tsec = msg.timerSec | 0;
        if (tsec >= 0 && tsec <= 600) t.settings.timerSec = tsec;
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

    /* bot drive — the BRAIN LIVES IN engine.js (docs/games.md, "Bots").
       This file used to carry its own ES5 copy of it while the worker
       carried an ES6 one, so every tuning pass had to be written twice.
       Both now call the vendored engine and cannot drift. */
    needsPhantom: function (t, H) {
      return Engine.botPending(t.game, H.botFn(t));
    },
    phantomOne: function (t, H) {
      var g = t.game;
      // the per-turn build budget is the caller's to count — one botAct
      // call is one action, and a turn's budget outlives the call
      if (!g || g.stats.turns !== t._botTurn) { t._botTurn = g ? g.stats.turns : -1; t._botActs = 0; }
      var a = Engine.botAct(g, H.botFn(t), { tier: H.tierFn(t), acts: t._botActs }, H.ctx());
      if (!a) return false;
      t._botActs = a.type === "endTurn" ? 0 : t._botActs + 1;
      return H.tryAct(t, a);
    }
  });


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
