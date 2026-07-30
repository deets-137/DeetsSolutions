/* DeetsShips — the MOCK table (docs/games.md, "The pieces").

   The in-page fake worker, selected with ?mock (the page defaults to
   prod). Everything that isn't DeetsShips in particular — persistence,
   seats, host fallback, TEAMS (two columns, captains, one color per
   side), the lobby verbs, delivery, the deadline, the drive loop —
   lives in the shared core, games/table-mock.js, which mirrors the
   worker base's subclass contract (games/table-do.js) hook for hook.

   This file is the game half: the view, the settings, the rules
   bridge, the captain-gated commit, and the anchor bot. HIDDEN
   INFORMATION is enforced exactly as the worker enforces it — through
   the ENGINE's own view builders (teamYou / spectatorYou / publicView /
   maskEventFor), so the two cannot drift: ship positions, weapon
   sections, staged plans and the calendar ride only a team's `you`. */
(function () {
  "use strict";

  var Engine = window.ShipsEngine;
  var Colors = Engine.makeColors(window.DeetsColors);   // red band reserved for intel

  var TIMERS = [0, 60, 90, 120, 180];

  function phaseBudget(t) {
    var g = t.game;
    if (!g || g.phase === "over") return 0;
    if (g.phase === "draft") return g.settings.timerDraft;
    if (g.phase === "move") return g.settings.timerMove;
    if (g.phase === "action") return g.settings.timerAction;
    return 0;
  }
  function anyHumanSeat(t) {
    return t.seats.some(function (s) { return s && !s.phantom && !s.bot; });
  }

  window.ShipsTransport = window.DeetsTableMock.create({
    ns: "ships",
    Engine: Engine,
    Colors: Colors,
    teams: 2,
    gameVerbs: { stage: 1, unstage: 1 },

    defaultSettings: function () {
      return { size: 1, timerDraft: 0, timerMove: 90, timerAction: 60, lockCommit: false, fleetPublic: true };
    },
    minSeats: function () { return 2; },
    capacity: function (t) { return t.settings.size * 2; },

    applySettings: function (t, msg) {
      if (msg.size != null) {
        var n = msg.size | 0;
        if (n < 1 || n > 4) return "phase";
        // never trim an occupied seat out of the table
        for (var i = n * 2; i < t.seats.length; i++) if (t.seats[i]) return "full";
        t.settings.size = n;
      }
      ["timerDraft", "timerMove", "timerAction"].forEach(function (k) {
        if (msg[k] != null && TIMERS.indexOf(msg[k]) >= 0) t.settings[k] = msg[k];
      });
      if (msg.lockCommit != null) t.settings.lockCommit = !!msg.lockCommit;
      if (msg.fleetPublic != null) t.settings.fleetPublic = !!msg.fleetPublic;
      return null;
    },
    createGame: function (t, seated, ctx) {
      return Engine.createGame({ seated: seated, settings: t.settings }, ctx);
    },
    onStart: function () { return [{ t: "start" }]; },

    /* commit / uncommit are captain-gated, which the ENGINE cannot see
       (captaincy is a connectivity fact) — so they run off-engine-verb,
       validated here and applied through the ordinary bridge. */
    extraCommand: function (t, conn, msg, H) {
      if (msg.type !== "commit" && msg.type !== "uncommit") return false;
      if (!t.game || t.game.phase === "over") { H.errTo(conn, "phase"); return true; }
      var seat = H.seatOfToken(t, conn.token);
      if (seat == null) { H.errTo(conn, "perm"); return true; }
      var team = H.teamOf(t, seat);
      if (H.captainSeat(t, team) !== seat) { H.errTo(conn, "perm"); return true; }
      var probe = Engine.applyAction(t.game, { type: msg.type, seat: seat }, H.ctx());
      if (probe.error) { H.errTo(conn, probe.error.code); return true; }
      if (H.tryAct(t, { type: msg.type, seat: seat })) {
        H.broadcast(t, t._ev || []);
        t._ev = null;
        H.postApply(t);
      }
      return true;
    },

    /* the view's game half (the core built code/phase/settings/seats/
       captains/you) — everything below comes from the engine's builders */
    buildView: function (view, t, conn, seat) {
      var g = t.game;
      if (!g) return view;
      Object.assign(view, Engine.publicView(g));
      if (t.turnEndsAt) view.turnEndsAt = t.turnEndsAt;
      if (seat != null) Object.assign(view.you, Engine.teamYou(g, Engine.seatTeam(g, seat), seat));
      else Object.assign(view.you, Engine.spectatorYou(g));
      if (g.phase === "over") {
        view.over = {
          winner: g.winner,
          standings: Engine.standings(g),
          seatStats: g.seatStats,
          turns: g.stats.turns,
        };
      }
      return view;
    },
    maskEvent: function (e, seat) { return Engine.maskEventFor(e, seat); },

    /* the phase clock: one budget per phase, host-set; untimed = no clock */
    deadlineFor: function (t) {
      var secs = phaseBudget(t);
      return secs > 0 && anyHumanSeat(t) ? secs * 1000 : null;
    },
    dlSig: function (t) {
      var g = t.game;
      return g && g.phase !== "over" ? g.phase + ":" + g.round : null;
    },

    /* the anchor bot (docs/ships.md): legal, minimal, never stalls —
       auto-picks its draft, holds, passes, and commits when it captains */
    needsPhantom: function (t) {
      var g = t.game;
      if (!g || g.phase === "over") return false;
      for (var seat = 0; seat < t.seats.length; seat++) {
        if (t.seats[seat] && (t.seats[seat].phantom || t.seats[seat].bot) && Engine.botAct(g, seat)) return true;
      }
      for (var team = 0; team < 2; team++) {
        if (g.committed[team]) continue;
        var cap = capOf(t, team);
        if (cap == null) continue;
        var cs = t.seats[cap];
        if (!(cs && (cs.phantom || cs.bot))) continue;
        if (teamAllReady(t, g, team)) return true;
      }
      return false;
    },
    phantomOne: function (t, H) {
      var g = t.game;
      for (var seat = 0; seat < t.seats.length; seat++) {
        var s = t.seats[seat];
        if (!s || !(s.phantom || s.bot)) continue;
        var a = Engine.botAct(g, seat);
        if (!a) continue;
        if (a.auto) a = { type: "stage", seat: seat, plans: Engine.autoPickDraft(g, seat, H.ctx()) };
        if (H.tryAct(t, a)) return true;
      }
      for (var team = 0; team < 2; team++) {
        if (g.committed[team]) continue;
        var cap = capOf(t, team);
        if (cap == null) continue;
        var cs = t.seats[cap];
        if (!(cs && (cs.phantom || cs.bot))) continue;
        if (teamAllReady(t, g, team) && H.tryAct(t, { type: "commit", seat: cap })) return true;
      }
      return false;
    },
  });

  // the mock core's captainSeat, reachable outside a HELPERS call
  function capOf(t, team) {
    var fb = null;
    for (var i = 0; i < t.seats.length; i++) {
      var s = t.seats[i];
      if (!s || s.conceded) continue;
      var st = s.team != null ? s.team : (i < t.seats.length / 2 ? 0 : 1);
      if (st !== team) continue;
      if (fb == null) fb = i;
      if (!(s.bot || s.phantom) && t.conns.some(function (c) { return c.token === s.token && !c.closed; })) return i;
    }
    return fb;
  }
  function teamAllReady(t, g, team) {
    return Engine.teamSeats(g, team).every(function (seat) {
      return g.staged[seat] && g.staged[seat].ready;
    });
  }
})();
