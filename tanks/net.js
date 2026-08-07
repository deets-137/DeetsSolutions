/* DeetsTanks — client netcode (docs/realtime.md, docs/tanks.md).

   The three jobs, per the authority model:
   - YOUR tank is PREDICTED: integrated locally from your own input at
     the sim rate, so movement is zero-latency; the server's tick is
     the truth, and it is reconciled by SEQ-REPLAY — the server pose is
     replayed forward through every local input it had not seen yet
     before it is compared to the prediction. Comparing raw poses
     instead (the first cut) showed the whole round trip as error, so
     the correction tugged backward all the while you drove and glided
     you forward after you let go: the hull felt like it was on ice.
   - EVERY OTHER tank is INTERPOLATED ~2 broadcast intervals behind the
     newest tick, so there are always two poses to lerp between.
   - SHELLS are simulated LOCALLY from their one spawn event
     (deterministic projectiles — zero per-tick bandwidth). The server
     stays the sole judge of what they killed; its `boom`/`die` events
     reconcile the local flight.

   The engine here is the same vendored file the server runs — that
   byte-identity is what makes prediction possible at all. */
(function () {
  "use strict";

  var E = window.TanksEngine;
  var TICK_MS = 1000 / E.TICK_HZ;
  var BCAST_MS = TICK_MS * 3;              // the 20 Hz tick channel
  var INTERP_DELAY = BCAST_MS * 2;         // render others this far back
  var SNAP_DIST = 0.6;                     // tiles — beyond this, teleport
  var CORRECT = 0.25;                      // per step, off a DECAYING error
  var HIST_MAX = 240;                      // unacked inputs kept (4 s)

  function create() {
    var level = null, blocks = null;
    var mySeat = null;
    var me = null;                          // predicted own tank {x,y,hull}
    var myAim = 0;
    var ticks = [];                         // [{at, n, tanks, mines}] last few
    var bullets = [];                       // locally-flown shells
    var effects = [];
    var hud = { sh: E.MAX_SHELLS, mn: E.MINES_MAX };
    var acc = 0, lastFrame = 0;
    var levelKey = null;
    var seq = 0;                            // local sim-step counter
    var hist = [];                          // [{q, d}] applied, not yet acked
    var err = { x: 0, y: 0 };               // standing correction, bled off

    function reset(model) {
      var g = model.game, sim = model.sim;
      level = E.parseLevel(window.TANKS_LEVELS[g.levelIdx]);
      blocks = sim.blocks.slice();
      ticks = [{ at: performance.now(), n: sim.tick,
                 tanks: sim.tanks.map(liteTank), mines: sim.mines.map(liteMine(sim.tick)) }];
      bullets = sim.bullets.map(function (b) { return JSON.parse(JSON.stringify(b)); });
      effects = [];
      var mine = null;
      sim.tanks.forEach(function (tk) { if (tk.seat === mySeat) mine = tk; });
      me = mine ? { x: mine.x, y: mine.y, hull: mine.hull, alive: mine.alive } : null;
      acc = 0; lastFrame = 0;
      hist = []; err.x = err.y = 0;
    }
    function liteTank(tk) {
      return { x: tk.x, y: tk.y, h: tk.hull != null ? tk.hull : tk.h,
               tr: tk.turret != null ? tk.turret : tk.tr,
               al: tk.alive != null ? (tk.alive ? 1 : 0) : tk.al,
               seat: tk.seat, type: tk.type,
               sh: tk.sh, mn: tk.mines != null ? tk.mines : tk.mn };
    }
    function liteMine(tick) {
      return function (m) { return { x: m.x, y: m.y, a: tick - m.born >= E.MINE_ARM ? 1 : 0 }; };
    }

    /* the versioned path: join snapshots, level loads, deaths. A new
       level/attempt is a hard reset; otherwise adopt the authoritative
       entity state without disturbing the tick buffer. */
    function sync(model, seat) {
      mySeat = seat;
      if (!model || !model.game || !model.sim) { level = null; return; }
      var key = model.game.levelIdx + ":" + model.game.attempt;
      if (key !== levelKey || !level) { levelKey = key; reset(model); return; }
      // same attempt: refresh authoritative alive flags + blocks
      blocks = model.sim.blocks.slice();
      if (ticks.length) {
        var latest = ticks[ticks.length - 1];
        model.sim.tanks.forEach(function (tk, i) {
          if (latest.tanks[i]) latest.tanks[i].al = tk.alive ? 1 : 0;
        });
      }
      if (me) {
        model.sim.tanks.forEach(function (tk) {
          if (tk.seat === mySeat) me.alive = tk.alive;
        });
      }
    }

    /* the sim channel (shell onRaw → here) */
    function onTick(msg) {
      if (!level) return;
      ticks.push({ at: performance.now(), n: msg.n, tanks: msg.tanks, mines: msg.mines });
      while (ticks.length > 12) ticks.shift();
      (msg.ev || []).forEach(function (ev) {
        if (ev.t === "fire") {
          // one event, whole flight — fast-forward to the server's now
          // mb rides the event: a locally-flown shell must have the same
          // bounce budget the server gave it, or the copies diverge
          var b = { id: ev.id, owner: ev.owner, x: ev.x, y: ev.y,
                    vx: ev.vx, vy: ev.vy, mb: ev.mb, bounces: 0, born: ev.tick };
          var behind = Math.max(0, msg.n - ev.tick);
          for (var i = 0; i < behind; i++) if (E.stepBullet(level, blocks, b)) break;
          bullets.push(b);
        } else if (ev.t === "boom") {
          for (var bi = bullets.length - 1; bi >= 0; bi--) {
            if (bullets[bi].id === ev.id || bullets[bi].id === ev.id2) bullets.splice(bi, 1);
          }
          effects.push({ x: ev.x, y: ev.y, at: performance.now() });
        } else if (ev.t === "mineBoom") {
          effects.push({ x: ev.x, y: ev.y, at: performance.now(), big: true });
        } else if (ev.t === "block") {
          blocks[ev.y * level.w + ev.x] = 0;
        }
      });
      // own-tank HUD counts + reconciliation against the server's word
      msg.tanks.forEach(function (tk) {
        if (tk.seat !== mySeat || mySeat == null) return;
        hud.sh = tk.sh; hud.mn = tk.mn;
        if (!me) {
          me = { x: tk.x, y: tk.y, hull: tk.h, alive: !!tk.al };
          hist = []; err.x = err.y = 0;
        }
        me.alive = !!tk.al;
        reconcile(tk, msg.tanks);
      });
    }

    /* SEQ-REPLAY reconciliation — the reason the hull does not slide.
       The server's pose is `tk.q` inputs old. Comparing it to the live
       prediction would read the whole round trip as error; replaying
       the unacked inputs onto it first compares like with like, so a
       steady drive has ZERO steady-state error and nothing pulls. What
       survives is a genuine disagreement (a wall the server saw and we
       did not, a mid-packet key change), applied as a decaying offset
       so the correction never fights the current input. */
    function reconcile(tk, all) {
      var ack = tk.q == null ? -1 : tk.q | 0;
      if (ack < 0) {
        // The server holds no input for this seat yet (the opening
        // moments of a level, a rematch). Its pose therefore says
        // nothing about where we should be — it is a tank that has not
        // been told to move. Correcting toward it drags the prediction
        // backwards by a whole trip time, which is what made the hull
        // feel like it was ploughing through mud off the line.
        err.x = err.y = 0;
        return;
      }
      while (hist.length && hist[0].q <= ack) hist.shift();
      var srv = { x: tk.x, y: tk.y, hull: tk.h, alive: true, id: "me" };
      var world = [];
      all.forEach(function (o, i) {
        if (o.seat === mySeat) return;
        world.push({ x: o.x, y: o.y, alive: !!o.al, id: "g" + i });
      });
      world.push(srv);
      for (var i = 0; i < hist.length; i++) {
        E.moveTank(level, blocks, world, srv, hist[i].d);
      }

      /* The DEAD ZONE, and it is what makes the hull feel bolted down.
         Even after the replay, the server's pose still trails by a
         constant phase — it ran `T` ticks to reach the input it is
         acking, and `T` minus that seq is the trip time, a standing
         disagreement no replay can close. Correcting it every tick is
         the tug; ignoring it is free, because the moment you stop
         driving, both sims stop and the phase error collapses to the
         REAL divergence on its own. So: tolerate what the trip can
         explain (`hist.length` is exactly the ticks in flight), and
         act only on what it cannot — and only the MOVING inputs in
         flight can explain anything, so a standing tank has no
         tolerance at all and converges hard. */
      var moving = 0;
      for (var m = 0; m < hist.length; m++) if (hist[m].d) moving++;
      var dx = srv.x - me.x, dy = srv.y - me.y;
      var d2 = dx * dx + dy * dy;
      var dead = moving * E.TANK_SPEED + 0.02;
      var snap = Math.max(SNAP_DIST, dead * 2);
      if (d2 > snap * snap) {
        me.x = srv.x; me.y = srv.y; me.hull = srv.hull;
        err.x = err.y = 0;
      } else if (d2 > dead * dead) {
        err.x = dx; err.y = dy;
      } else { err.x = err.y = 0; }
    }

    /* one render frame: fixed-timestep prediction under a rAF caller */
    function frame(now, input) {
      if (!level) return null;
      if (!lastFrame) lastFrame = now;
      acc += Math.min(100, now - lastFrame);
      lastFrame = now;

      var latest = ticks[ticks.length - 1];
      var others = latest ? latest.tanks : [];

      while (acc >= TICK_MS) {
        acc -= TICK_MS;
        // fly the shells at the sim rate
        for (var bi = bullets.length - 1; bi >= 0; bi--) {
          var r = E.stepBullet(level, blocks, bullets[bi]);
          if (r) {
            // walls locally; the block itself waits for the server's word
            if (r === "gone") effects.push({ x: bullets[bi].x, y: bullets[bi].y, at: performance.now() });
            bullets.splice(bi, 1);
          }
        }
        // predict my own hull — instantly, and with nothing pulling on it
        seq++;
        if (me && me.alive && input) {
          var ghost = others.map(function (tk, i) {
            return { x: tk.x, y: tk.y, alive: tk.al && tk.seat !== mySeat, id: "g" + i };
          });
          var self = { x: me.x, y: me.y, hull: me.hull, alive: true, id: "me" };
          E.moveTank(level, blocks, ghost.concat([self]), self, input.d | 0);
          me.x = self.x; me.y = self.y; me.hull = self.hull;
          hist.push({ q: seq, d: input.d | 0 });
          if (hist.length > HIST_MAX) hist.shift();
        }
        // bleed off the standing correction (never a pull toward a
        // stale target — the error shrinks, the target does not move)
        if (me && (err.x || err.y)) {
          me.x += err.x * CORRECT; me.y += err.y * CORRECT;
          err.x -= err.x * CORRECT; err.y -= err.y * CORRECT;
          if (Math.abs(err.x) < 1e-4 && Math.abs(err.y) < 1e-4) err.x = err.y = 0;
        }
      }
      if (input && input.a != null) myAim = input.a;

      /* interpolate everyone else ~2 broadcast intervals back */
      var t = now - INTERP_DELAY;
      var a = null, b = null;
      for (var i = ticks.length - 1; i >= 0; i--) {
        if (ticks[i].at <= t) { a = ticks[i]; b = ticks[i + 1] || ticks[i]; break; }
      }
      if (!a && ticks.length) { a = b = ticks[0]; }
      var f = (a && b && b.at > a.at) ? Math.min(1, (t - a.at) / (b.at - a.at)) : 0;

      var sceneTanks = [];
      (a ? a.tanks : []).forEach(function (tk, i) {
        var tb = (b && b.tanks[i]) || tk;
        if (tk.seat === mySeat && me) {
          sceneTanks.push({ x: me.x, y: me.y, h: me.hull, tr: myAim,
                            al: me.alive ? 1 : 0, seat: mySeat });
          return;
        }
        sceneTanks.push({
          x: tk.x + (tb.x - tk.x) * f,
          y: tk.y + (tb.y - tk.y) * f,
          h: tb.h,
          tr: lerpAngle(tk.tr, tb.tr, f),
          al: tb.al, seat: tk.seat, type: tk.type
        });
      });

      // the aim line: your own shell's exact future, walls and all
      var aim = null;
      if (me && me.alive) {
        // the hint must trace YOUR tuned shell, not the engine default —
        // a level that speeds shells up or grants a second bounce would
        // otherwise draw a line the shell does not follow
        var pt = level.tune.player;
        aim = [{ x: me.x, y: me.y }];
        var tb2 = { x: me.x + Math.cos(myAim) * 0.46, y: me.y + Math.sin(myAim) * 0.46,
                    vx: Math.cos(myAim) * pt.bulletSpeed, vy: Math.sin(myAim) * pt.bulletSpeed,
                    mb: pt.bounces, bounces: 0 };
        for (var s = 0; s < 360; s++) {
          if (E.stepBullet(level, blocks, tb2)) break;
          if (s % 4 === 0) aim.push({ x: tb2.x, y: tb2.y });
        }
        aim.push({ x: tb2.x, y: tb2.y });
      }

      // retire spent effects
      var cutoff = performance.now() - 700;
      effects = effects.filter(function (fx) { return fx.at > cutoff; });

      var latestMines = latest ? latest.mines : [];
      return { tanks: sceneTanks, bullets: bullets, mines: latestMines,
               effects: effects, aim: aim };
    }

    function lerpAngle(a0, a1, f) {
      if (a0 == null) return a1;
      if (a1 == null) return a0;
      var d = a1 - a0;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      return a0 + d * f;
    }

    return {
      sync: sync,
      onTick: onTick,
      frame: frame,
      level: function () { return level; },
      blocks: function () { return blocks; },
      hud: function () { return hud; },
      seq: function () { return seq; },
      myPos: function () { return me; },
      setAim: function (a) { myAim = a; }
    };
  }

  window.TanksNet = { create: create };
})();
