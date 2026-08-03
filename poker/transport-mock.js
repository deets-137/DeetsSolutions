/* DeetsPoker - the MOCK table (docs/games.md, "The pieces").

   The in-page fake worker, selected with ?mock (the page defaults to mock
   until the ../DeetsPoker worker lands - docs/poker.md, "Build phases").
   Everything that isn't DeetsPoker in particular - persistence, seats, host
   fallback, the lobby verbs, delivery, the deadline, the drive loop, peek /
   connect - lives in the shared core, games/table-mock.js, which mirrors the
   worker base's subclass contract (games/table-do.js) hook for hook.

   This file is the game half: the view, the settings, the rules bridge, and
   the two poker-only verbs (sitIn, endGame). HIDDEN INFORMATION is enforced
   here exactly as the worker must: hole cards and the acting seat's options
   ride only each connection's `you`; the deck never leaves the table.
   Reveals become public through handOver, after the showdown says so. */
(function () {
  "use strict";

  var Engine = window.PokerEngine;
  var Colors = window.DeetsColors;

  var HANDOVER_MS = 6000;   // the settlement interstitial always auto-advances

  function chipVals(t) { return t.settings.chips.map(function (c) { return c.v; }); }
  function human(t, s) { return t.seats[s] && !t.seats[s].phantom; }

  /* a clash-free random hex for seats past the six presets (docs/poker.md,
     "Seat colors") - presets first, then random until one clears */
  function randColor(t, exceptSeat) {
    var others = t.seats.map(function (s, i) { return s && i !== exceptSeat ? s.color : null; });
    for (var p = 0; p < Colors.PRESETS.length; p++) {
      if (Colors.clash(Colors.PRESETS[p], others) < 0) return Colors.PRESETS[p];
    }
    for (var k = 0; k < 60; k++) {
      var raw = ("00000" + Math.floor(Math.random() * 0x1000000).toString(16)).slice(-6);
      var hex = "#" + raw;
      if (Colors.clash(hex, others) < 0) return hex;
    }
    return Colors.PRESETS[t.seats.length % Colors.PRESETS.length];
  }

  function deadlineFor(t) {
    var g = t.game;
    if (!g || g.phase === "over") return null;
    if (g.handOver) return HANDOVER_MS;                     // always auto-advances
    if (g.waiting || !g.turn) return null;
    // only a present human's clock runs; bots are the drive's business,
    // and with the timer off a human may take all day (the host can kick)
    if (!t.settings.timerSec || !human(t, g.turn.seat)) return null;
    return t.settings.timerSec * 1000;
  }
  function dlSig(t) {
    var g = t.game;
    if (!g || g.phase === "over") return null;
    if (g.handOver) return "over:" + g.handNo;
    if (!g.turn) return null;
    return "turn:" + g.turn.seat + ":" + g.handNo + ":" + g.street + ":" + (g.bet ? g.bet.current : 0);
  }

  window.PokerTransport = window.DeetsTableMock.create({
    ns: "poker",
    Engine: Engine,
    Colors: Colors,
    gameVerbs: { fold: 1, check: 1, call: 1, raise: 1, buyIn: 1, voteEnd: 1, nextHand: 1 },

    /* No bot EVER takes a poker seat over — the drive is a dev tool, not a
       player. So the three re-join modes mean something poker-specific
       (docs/poker.md, "Stepping away"):
         anyone - the seat goes AWAY with its stack; you can walk back in,
                  and so can any spectator (they inherit the pile);
         rejoin - the seat goes AWAY with its stack; only you come back
                  (same token, or the same account from any device);
         none   - the seat CASHES OUT, and you rejoin as a spectator only.
       "away" is engine `sitOut`, the return is `sitBack`. */
    rejoinModes: ["anyone", "rejoin", "none"],
    awayAction: "sitOut",
    adoptAction: "sitBack",
    defaultSettings: function () {
      return {
        rejoin: "rejoin",
        capacity: 6,
        buyIn: 2000,                       // cents
        bigBlind: 20,                      // cents; the small blind is half
        chips: [                           // the ladder, lowest to highest
          { v: 10, hex: "#f2efe6" },       // white
          { v: 20, hex: "#d94141" },       // red
          { v: 25, hex: "#2fae66" },       // green
          { v: 50, hex: "#3b7dd8" },       // blue
          { v: 100, hex: "#26221f" }       // black
        ],
        timerSec: 0,
        minRaise: "prev"                   // "prev" | "double" | "none"
      };
    },
    minSeats: function () { return 2; },

    /* the view's game half (the core built code/phase/settings/seats/you) */
    buildView: function (view, t, conn, seat) {
      var g = t.game;
      if (!g) return view;
      view.handNo = g.handNo;
      view.dealer = g.dealer;
      view.street = g.street;
      view.board = g.board.slice();
      view.waiting = !!g.waiting;
      if (g.blinds) view.blinds = { sb: g.blinds.sb, bb: g.blinds.bb };
      var pot = 0;
      view.players = g.players.map(function (p, i) {
        if (!p) return null;
        pot += p.betHand;
        return {
          seat: i, stack: p.stack, bought: p.bought,
          inHand: p.inHand, folded: p.folded, allIn: p.allIn,
          out: p.out, left: p.left, waiting: p.waiting,
          away: p.away, owesAnte: p.owesAnte,
          betStreet: p.betStreet,
          stats: p.stats
        };
      });
      view.pot = pot;
      if (g.turn) view.turn = { seat: g.turn.seat };
      if (g.handOver) {
        view.handOver = g.handOver;                          // reveal is public at showdown
        if (t.turnEndsAt) view.handOverAt = t.turnEndsAt;
      }
      var votes = Object.keys(g.endVotes).map(Number);
      view.votes = { n: votes.length, need: Engine.voteNeed(g), seats: votes };
      view.transfers = g.transfers;              // the Winnings ledger — public, like the stacks
      if (seat != null && g.players[seat]) {
        var p = g.players[seat];
        if (p.hole) view.you.hole = p.hole.slice();
        var o = Engine.options(g, seat);
        if (o) view.you.options = o;
        view.you.myVote = !!g.endVotes[seat];
        view.you.canBuyIn = !p.left && p.out;
        // the return pill only exists for the person actually sitting out
        view.you.away = !!p.away;
      }
      if (g.phase === "over") {
        view.over = {
          endedBy: g.endedBy,
          standings: Engine.standings(g),
          hands: g.stats.hands,
          results: g.results
        };
      }
      if (t.turnEndsAt) view.turnEndsAt = t.turnEndsAt;
      return view;
    },

    /* lobby */
    applySettings: function (t, msg) {
      var st = t.settings;
      var vals = chipVals(t);
      if (msg.capacity != null) {
        var cap = msg.capacity | 0;
        if (cap < 2 || cap > 12) return "phase";
        var seated = t.seats.filter(function (s) { return !!s; }).length;
        st.capacity = Math.max(cap, Math.max(2, seated));
      }
      if (msg.chips != null) {
        if (!Array.isArray(msg.chips) || msg.chips.length < 2 || msg.chips.length > 8) return "chips";
        var ladder = [];
        for (var i = 0; i < msg.chips.length; i++) {
          var v = msg.chips[i] && (msg.chips[i].v | 0);
          var hex = msg.chips[i] && Colors.norm(msg.chips[i].hex);
          if (!v || v <= 0 || v > 100000 || !hex) return "chips";
          if (ladder.some(function (c) { return c.v === v; })) return "chips";
          ladder.push({ v: v, hex: hex });
        }
        // ORDER IS THE HOST'S — the lobby ladder is drag-reordered and the
        // wire keeps it verbatim (the engine only ever reads the values)
        var lv = ladder.map(function (c) { return c.v; });
        // the standing blind and buy-in must still split into the new ladder
        if (!Engine.representable(st.bigBlind, lv) || !Engine.representable(st.bigBlind / 2, lv)) return "blind";
        if (!Engine.representable(st.buyIn, lv)) return "buyin";
        st.chips = ladder;
        vals = lv;
      }
      if (msg.buyIn != null) {
        var b = msg.buyIn | 0;
        if (b < 100 || b > 1000000) return "buyin";
        if (!Engine.representable(b, vals)) return "buyin";
        if (b < st.bigBlind) return "buyin";
        st.buyIn = b;
      }
      if (msg.bigBlind != null) {
        var bb = msg.bigBlind | 0;
        // even (the small blind is half), both halves must split into chips
        if (bb < 2 || bb % 2 || bb > st.buyIn) return "blind";
        if (!Engine.representable(bb, vals) || !Engine.representable(bb / 2, vals)) return "blind";
        st.bigBlind = bb;
      }
      if (msg.timerSec != null) {
        var ts = msg.timerSec | 0;
        if (ts !== msg.timerSec || ts < 0 || ts > 600 || (ts > 0 && ts < 5)) return "phase";
        st.timerSec = ts;
      }
      if (msg.minRaise != null) {
        if (["prev", "double", "none"].indexOf(msg.minRaise) < 0) return "phase";
        st.minRaise = msg.minRaise;
      }
      return null;
    },
    createGame: function (t, seated, ctx) {
      return Engine.createGame({
        settings: {
          buyIn: t.settings.buyIn, bigBlind: t.settings.bigBlind,
          chips: chipVals(t), minRaise: t.settings.minRaise,
          timerSec: t.settings.timerSec
        },
        seats: seated.length
      }, ctx);
    },
    onStart: function (t) {
      var ev = t.game._boot || [];
      delete t.game._boot;
      return ev;
    },

    /* the two verbs the shared core doesn't know (docs/poker.md):
       sitIn - at an "anyone" table a spectator takes a NEW seat mid-game,
       buys in, and waits for the next deal (the core's mid-game `sit`
       only adopts an EXISTING seat, so it can't express this);
       endGame - the host closes the game to the cash-out screen. */
    extraCommand: function (t, conn, msg, H) {
      if (msg.type === "sitIn") {
        if (!t.game || t.game.phase === "over") { H.errTo(conn, "phase"); return true; }
        if ((t.settings.rejoin || "rejoin") !== "anyone") { H.errTo(conn, "midjoin"); return true; }
        if (H.seatOfToken(t, conn.token) != null) { H.errTo(conn, "perm"); return true; }
        if (t.seats.length >= t.settings.capacity) { H.errTo(conn, "full"); return true; }
        var lower = String(conn.name || "").toLowerCase();
        var taken = t.seats.some(function (s) { return s && s.name.toLowerCase() === lower; });
        if (taken) { H.errTo(conn, "name-taken"); return true; }
        var idx = t.seats.length;
        if (!H.tryAct(t, { type: "sitIn", seat: idx })) { H.errTo(conn, "phase"); return true; }
        t.seats.push({ token: conn.token, name: conn.name, color: randColor(t, idx),
                       connected: true, phantom: false });
        H.broadcast(t, t._ev || []); t._ev = null;
        H.postApply(t);
        return true;
      }
      /* sitBack - the away seat's own occupant returns. The core's mid-game
         `sit` also lands here (via adoptAction) but only at an "anyone"
         table and only from someone NOT already seated; this is the plain
         "I'm back" for the person who never gave the seat up. */
      if (msg.type === "sitBack") {
        if (!t.game || t.game.phase === "over") { H.errTo(conn, "phase"); return true; }
        var bsi = H.seatOfToken(t, conn.token);
        if (bsi == null || !t.seats[bsi] || !t.seats[bsi].away) { H.errTo(conn, "perm"); return true; }
        if (!H.tryAct(t, { type: "sitBack", seat: bsi })) { H.errTo(conn, "perm"); return true; }
        delete t.seats[bsi].away;
        H.broadcast(t, t._ev || []); t._ev = null;
        H.postApply(t);
        return true;
      }
      if (msg.type === "endGame") {
        if (!t.game || t.game.phase === "over") { H.errTo(conn, "phase"); return true; }
        if (!H.isHost(t, conn.token)) { H.errTo(conn, "perm"); return true; }
        if (!H.tryAct(t, { type: "endGame", seat: H.seatOfToken(t, conn.token) })) {
          H.errTo(conn, "phase"); return true;
        }
        H.broadcast(t, t._ev || []); t._ev = null;
        H.postApply(t);
        return true;
      }
      return false;
    },

    deadlineFor: deadlineFor,
    dlSig: dlSig,
    /* bot drive - the BRAIN LIVES IN engine.js (docs/games.md, "Bots").
       Poker's is deliberately not a player: dev bots exist so a solo
       lobby can watch hands play out (docs/poker.md, "Bots"). */
    needsPhantom: function (t, H) { return Engine.botPending(t.game, H.botFn(t)); },
    phantomOne: function (t, H) {
      var a = Engine.botAct(t.game, H.botFn(t), { tier: H.tierFn(t) }, H.ctx());
      return a ? H.tryAct(t, a) : false;
    }
  });

})();
