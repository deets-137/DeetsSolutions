/* DeetsMahjong - the MOCK table (docs/games.md, "The pieces").

   The in-page fake worker, selected with ?mock (the page defaults to prod).
   Everything that isn't DeetsMahjong in particular - persistence, seats, host
   fallback, the lobby verbs, delivery, the deadline, the drive loop, peek /
   connect - lives in the shared core, games/table-mock.js, which mirrors the
   worker base's subclass contract (games/table-do.js) hook for hook.

   This file is the game half: the view, the settings, the rules bridge, and
   the bot. HIDDEN INFORMATION is enforced here exactly as
   the worker enforces it: hands, the drawn tile and per-seat claim options
   ride only each connection's `you`, and maskEvent scrubs the claim ack. */
(function () {
  "use strict";

  var Engine = window.MahjongEngine;
  var Colors = window.DeetsColors;

  var HANDOVER_MS = 9000;    // the settlement interstitial always auto-advances
  var CLAIM_CAP_MS = 10000;  // a claim window never waits longer than this (timed tables)

  // legal self-kong tiles for the seat holding the draw (the VIEW's copy —
  // `you.kongs` is what lights the client's Kong pill; the bot's own copy
  // lives in the engine)
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
  // a stable signature for the current obligation so the countdown isn't
  // reset by unrelated broadcasts (claim acks, a spectator joining) - the
  // worker's dlSig, verbatim
  function dlSig(t) {
    var g = t.game;
    if (!g || g.phase === "over") return null;
    if (g.handOver) return "over";
    if (g.phase === "seating") return "seating";
    var r = g.round, hid = r ? (r.prevailing + "/" + r.dealerIdx + "/" + r.hand) : "0";
    if (g.claims) return "claim:" + g.claims.from + ":" + g.pond.length;
    if (g.wall === null) return "break:" + hid;
    if (g.turn) return "turn:" + g.turn.seat + ":" + hid;
    return "x";
  }

  /* ── command handlers (client → table) ────────────────────────── */
  var LOBBY_CMDS = { sit: 1, stand: 1, addBot: 1, shuffle: 1, recolor: 1, setSettings: 1, start: 1 };
  var GAME_CMDS = { rollSeat: 1, rollBreak: 1, discard: 1, win: 1, kong: 1, claim: 1, nextHand: 1 };


  window.MahjongTransport = window.DeetsTableMock.create({
    ns: "mahjong",
    Engine: Engine,
    Colors: Colors,
    gameVerbs: { rollSeat: 1, rollBreak: 1, discard: 1, win: 1, kong: 1, claim: 1, nextHand: 1 },

    defaultSettings: function () { return { minFaan: 3, capFaan: 13, winds: 1, timerSec: 0 }; },
    minSeats: function () { return 4; },
    capacity: function () { return 4; },   // mahjong is LOCKED to four seats

    /* the view's game half (the core built code/phase/settings/seats/you) */
    buildView: function (view, t, conn, seat) {
      var g = t.game;
      if (!g) return view;
      var phase = g.phase;

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
        // standings ride the view so the client never sorts a finish itself
        // (docs/stats.md) — competition ranking, ties shared, and honest about
        // a tie that finishGame resolved to the lowest seat. Must stay
        // identical to the worker's viewGame.
        view.over = {
          winner: g.winner,
          standings: Engine.standings(g),
          scores: g.players.map(function (p) { return p.score; }),
          stats: g.players.map(function (p) { return p.stats; }),
          hands: g.stats.hands,
          results: g.results
        };
      }
      if (t.turnEndsAt) view.turnEndsAt = t.turnEndsAt;
      return view;
    },
    maskEvent: function (e, seat) {
      // pass-vs-claim rides only the actor's copy until the window resolves
      if (e.t === "claimAck" && seat !== e.seat) return { t: "claimAck", seat: e.seat };
      return e;
    },

    /* lobby */
    applySettings: function (t, msg) {
      if (msg.minFaan != null) { var mf = msg.minFaan | 0; if (mf >= 0 && mf <= 13) t.settings.minFaan = mf; }
      if (msg.capFaan != null && [8, 10, 13].indexOf(msg.capFaan) >= 0) t.settings.capFaan = msg.capFaan;
      if (msg.winds != null && [0, 1, 4].indexOf(msg.winds) >= 0) t.settings.winds = msg.winds;
      if (msg.timerSec != null && [0, 45, 60, 90, 120].indexOf(msg.timerSec) >= 0) t.settings.timerSec = msg.timerSec;
      return null;
    },
    createGame: function (t, seated, ctx) {
      return Engine.createGame({
        settings: {
          minFaan: t.settings.minFaan, capFaan: t.settings.capFaan,
          winds: t.settings.winds, timerSec: t.settings.timerSec
        }
      }, ctx);
    },
    onStart: function () { return [{ t: "start" }]; },

    // (rematch is a shared table verb — table-mock.js / table-do.js. Mahjong
    // keeps nothing beside the game, so it needs no onRematch.)

    deadlineFor: deadlineFor,
    dlSig: dlSig,
    /* bot drive — the BRAIN LIVES IN engine.js (docs/games.md, "Bots").
       This file used to carry its own ES5 copy of it while the worker
       carried an ES6 one, so every tuning pass had to be written twice.
       Both now call the vendored engine and cannot drift. */
    needsPhantom: function (t) { return Engine.botPending(t.game, botAt(t)); },
    phantomOne: function (t, H) {
      var a = Engine.botAct(t.game, botAt(t), { tier: tierAt(t) }, H.ctx());
      return a ? H.tryAct(t, a) : false;
    }
  });

  // who is a bot, and how hard each one plays — the table's half of the
  // contract; the engine owns what a bot actually does with it
  function botAt(t) {
    return function (seat) { return !!(t.seats[seat] && t.seats[seat].phantom); };
  }
  function tierAt(t) {
    return function (seat) { return (t.seats[seat] && t.seats[seat].tier) || "normal"; };
  }
})();
