/* DeetsTanks — the MOCK table (docs/tanks.md, docs/realtime.md).

   The in-page fake worker. The page defaults to it (`mockDefault`)
   until ../DeetsTanks ships; everything that isn't DeetsTanks in
   particular lives in the shared core, games/table-mock.js.

   This file is the game half AND the real-time half — it is the spec
   the RealtimeTable DO subclass will be ported from hook-for-hook, so
   the shapes below are contract:

   - The SIM LOOP: 60 Hz engine steps inside the table, run only while
     the game is `playing` and at least one connection is live (an idle
     table costs nothing — the free-plan rule, docs/realtime.md).
   - TWO CHANNELS. State-changing events (die / cleared / failed /
     level / gameOver) go through the core's versioned broadcast — the
     shell repaints its HUD off them. Sim traffic rides `tick` messages
     (20 Hz: tank poses, mines, flavor events), delivered OUTSIDE the
     versioned path so a dropped one costs nothing and the shell never
     repaints for one (table.js `onRaw`).
   - Shells are EVENTS, not streams: `fire` is broadcast once on the
     tick channel and every client flies the shell locally.
   - INPUT is an unversioned verb: latest-wins per seat, fire/mine
     flags consumed by the next step. No broadcast, no refusal chatter.
   - Latency injection (docs/realtime.md — non-optional): setLag(ms,
     jitter) delays the tick channel; the core's own 110 ms fake RTT
     already sits under the input path.

   Tanks has NO hidden information — every view is the same view. */
(function () {
  "use strict";

  var Engine = window.TanksEngine;
  var Colors = window.DeetsColors;
  var LEVELS = window.TANKS_LEVELS;

  var BROADCAST_EVERY = 3;          // sim ticks per tick message (60/3 = 20 Hz)
  var INTERLEVEL_MS = 3000;         // the interstitial's dwell
  var BIG_EV = { die: 1, cleared: 1, failed: 1, level: 1, gameOver: 1 };

  /* the injectable one-way lag on the sim channel (dev knob) */
  var LAG = { ms: 0, jitter: 0 };

  /* The loop needs the core's broadcast/postApply. The core hands its
     HELPERS to every hook that could want them; needsPhantom runs on
     every postApply — including the one right after Start — so it is a
     guaranteed capture point before the first tick ever fires. */
  var HOLD = { H: null };

  /* one sim loop per live table */
  var LOOPS = {};   // code -> interval id
  function stopLoop(code) {
    if (LOOPS[code]) { clearInterval(LOOPS[code]); delete LOOPS[code]; }
  }
  function ensureLoop(t) {
    var H = HOLD.H;
    if (LOOPS[t.code] || !H) return;
    LOOPS[t.code] = setInterval(function () {
      var g = t.game;
      var live = t.conns.some(function (c) { return !c.closed; });
      // idle fuse, sim edition: nobody connected (or no game) → stop
      if (!g || g.phase === "over" || !live) { stopLoop(t.code); return; }
      if (g.phase !== "playing") return;      // interlevel: the core's timer drives
      var events = Engine.step(g, t._inputs || {});
      // fire/mine are one-shot flags; drive and aim are held state
      Object.keys(t._inputs || {}).forEach(function (s) {
        t._inputs[s].f = 0; t._inputs[s].m = 0;
      });
      var bigs = [], flavor = [];
      events.forEach(function (e) { (BIG_EV[e.t] ? bigs : flavor).push(e); });
      t._tickEv = (t._tickEv || []).concat(flavor);
      if (g.tick % BROADCAST_EVERY === 0) {
        var msg = {
          type: "tick", n: g.tick,
          tanks: g.tanks.map(function (tk) {
            var inp = tk.seat != null && t._inputs ? t._inputs[tk.seat] : null;
            return { x: tk.x, y: tk.y, h: tk.hull, tr: tk.turret,
                     al: tk.alive ? 1 : 0, seat: tk.seat, type: tk.type,
                     sh: tk.seat != null ? shellsReady(g, tk) : 0, mn: tk.mines,
                     // the ACK: the last input seq folded into this pose.
                     // Contract — the client's reconciliation replays
                     // everything after it (docs/tanks.md, "Feel").
                     q: inp && inp.q != null ? inp.q : -1 };
          }),
          mines: g.mines.map(function (m) {
            return { x: m.x, y: m.y, a: g.tick - m.born >= Engine.MINE_ARM ? 1 : 0 };
          }),
          ev: t._tickEv
        };
        t._tickEv = [];
        t.conns.forEach(function (c) {
          if (c.closed || !c.handler) return;
          var delay = LAG.ms + (LAG.jitter ? Math.random() * LAG.jitter : 0);
          setTimeout(function () {
            if (!c.closed && c.handler) c.handler(JSON.parse(JSON.stringify(msg)));
          }, delay);
        });
      }
      if (bigs.length) {
        // arm FIRST: a cleared/failed step needs turnEndsAt on the wire
        // in the same broadcast the overlay paints from
        H.postApply(t);
        H.broadcast(t, bigs);       // versioned: the HUD repaints off this
      }
    }, 1000 / Engine.TICK_HZ);
  }
  function shellsReady(g, tk) {
    var live = 0;
    g.bullets.forEach(function (b) { if (b.owner === tk.id) live++; });
    return Math.max(0, Engine.MAX_SHELLS - live);
  }

  window.TanksTransport = window.DeetsTableMock.create({
    ns: "tanks",
    Engine: Engine,
    Colors: Colors,
    gameVerbs: {},                       // nothing rides the versioned game path
    rejoinModes: ["rejoin"],             // one mode: no row, no choice
    capacity: function () { return 2; }, // rules-fixed, no setting
    minSeats: function () { return 1; },

    defaultSettings: function () {
      return { rejoin: "rejoin", lives: 3, aimLine: true, friendlyFire: false };
    },
    applySettings: function (t, msg) {
      var st = t.settings;
      if (msg.lives != null) {
        var lv = msg.lives | 0;
        if (lv < 1 || lv > 5) return "phase";
        st.lives = lv;
      }
      if (msg.aimLine != null) st.aimLine = !!msg.aimLine;
      if (msg.friendlyFire != null) st.friendlyFire = !!msg.friendlyFire;
      return null;
    },

    /* the view's game half. No hidden info: everyone sees everything.
       `sim` is the ENTITY snapshot a client boots its interpolation and
       prediction from — sent on the low-rate versioned path (join,
       level transitions, deaths), never per tick. */
    buildView: function (view, t) {
      var g = t.game;
      if (!g) return view;
      view.game = {
        phase: g.phase, levelIdx: g.levelIdx, levelName: g.level.name,
        attempt: g.attempt, result: g.result,
        lives: g.lives.slice(), kills: g.kills.slice(),
        enemiesLeft: g.tanks.filter(function (tk) { return tk.seat == null && tk.alive; }).length,
        aimLine: g.settings.aimLine, friendlyFire: g.settings.friendlyFire,
        over: g.over
      };
      view.sim = {
        tick: g.tick, blocks: g.blocks.slice(),
        tanks: JSON.parse(JSON.stringify(g.tanks)),
        bullets: JSON.parse(JSON.stringify(g.bullets)),
        mines: JSON.parse(JSON.stringify(g.mines))
      };
      if (t.turnEndsAt) view.turnEndsAt = t.turnEndsAt;
      return view;
    },

    createGame: function (t, seated, ctx) {
      return Engine.createGame({
        levels: LEVELS,
        seats: seated.length,
        settings: { lives: t.settings.lives, aimLine: t.settings.aimLine,
                    friendlyFire: t.settings.friendlyFire },
        seed: Math.floor(ctx.rand() * 4294967296)
      }, ctx);
    },
    onStart: function (t) {
      t._inputs = {}; t._tickEv = [];
      ensureLoop(t);
      var ev = t.game._boot || [];
      delete t.game._boot;
      return ev;
    },
    onRematch: function (t) { t._inputs = {}; t._tickEv = []; stopLoop(t.code); },
    onJoined: function (t) {
      // a table restored mid-game (localStorage) wakes its sim when
      // someone walks in — the worker's "reconnect re-arms everything"
      if (t.game && t.game.phase !== "over") ensureLoop(t);
    },
    onGameOver: function (t) { stopLoop(t.code); },

    /* input — the real-time verb. Latest-wins; NEVER broadcasts. */
    extraCommand: function (t, conn, msg, H) {
      if (msg.type !== "input") return false;
      if (!t.game || t.game.phase !== "playing") return true;   // quietly dropped
      var seat = H.seatOfToken(t, conn.token);
      if (seat == null) return true;                            // spectators steer nothing
      if (!t._inputs) t._inputs = {};
      var cur = t._inputs[seat] || { d: 0, a: null, f: 0, m: 0, q: -1 };
      cur.d = msg.d | 0;
      if (msg.q != null) cur.q = msg.q | 0;   // acked back on the tick channel
      if (msg.a != null && isFinite(msg.a)) cur.a = +msg.a;
      if (msg.f) cur.f = 1;      // sticky until the next step consumes it
      if (msg.m) cur.m = 1;
      t._inputs[seat] = cur;
      return true;
    },

    /* the interstitial auto-advances on the core's own deadline —
       mahjong's handOver idiom (timerExpire → Engine.advance) */
    deadlineFor: function (t) {
      return t.game && t.game.phase === "interlevel" ? INTERLEVEL_MS : null;
    },
    dlSig: function (t) {
      var g = t.game;
      if (!g || g.phase !== "interlevel") return null;
      return "il:" + g.levelIdx + ":" + g.attempt + ":" + g.result;
    },

    /* enemies are WORLD STATE inside step(), not seated bots
       (docs/tanks.md, "Enemy AI") — the drive loop has nothing to do.
       needsPhantom doubles as the HELPERS capture point (see HOLD): it
       runs on every postApply, including the one right after Start and
       the one every connect fires, so the loop always has them. */
    needsPhantom: function (t, H) { HOLD.H = H; ensureLoop(t); return false; },
    phantomOne: function () { return false; }
  });

  /* dev knobs (console + the toolbar's Lag pill):
       TanksTransport.setLag(150, 40)  — one-way ms + jitter */
  window.TanksTransport.setLag = function (ms, jitter) {
    LAG.ms = Math.max(0, ms | 0); LAG.jitter = Math.max(0, jitter | 0);
  };
  window.TanksTransport.getLag = function () { return { ms: LAG.ms, jitter: LAG.jitter }; };
})();
