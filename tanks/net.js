/* DeetsTanks — client netcode (docs/realtime.md, docs/tanks.md).

   The three jobs, per the authority model:
   - YOUR tank is PREDICTED: integrated locally from your own input at
     the sim rate, so movement is zero-latency; the server's tick is
     the truth and the prediction is blended toward it (snapped when
     hopelessly far). Simplification, recorded: correction is a smooth
     blend against the latest snapshot, not a seq-replay — at these
     speeds the error is centimeters and the blend is invisible, and
     the snapshot always wins within a few ticks.
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
  var BLEND = 0.12;                        // per sim step, toward the server

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
          var b = { id: ev.id, owner: ev.owner, x: ev.x, y: ev.y,
                    vx: ev.vx, vy: ev.vy, bounces: 0, born: ev.tick };
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
      // own-tank HUD counts + the server's word on my pose
      msg.tanks.forEach(function (tk) {
        if (tk.seat !== mySeat || mySeat == null) return;
        hud.sh = tk.sh; hud.mn = tk.mn;
        if (!me) me = { x: tk.x, y: tk.y, hull: tk.h, alive: !!tk.al };
        me.alive = !!tk.al;
        var dx = tk.x - me.x, dy = tk.y - me.y;
        if (dx * dx + dy * dy > SNAP_DIST * SNAP_DIST) { me.x = tk.x; me.y = tk.y; }
        me.srv = { x: tk.x, y: tk.y };
      });
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
        // predict my own hull
        if (me && me.alive && input) {
          var ghost = others.map(function (tk, i) {
            return { x: tk.x, y: tk.y, alive: tk.al && tk.seat !== mySeat, id: "g" + i };
          });
          var self = { x: me.x, y: me.y, hull: me.hull, alive: true, id: "me" };
          E.moveTank(level, blocks, ghost.concat([self]), self, input.d | 0);
          me.x = self.x; me.y = self.y; me.hull = self.hull;
          if (me.srv) {   // ease toward the authoritative pose
            me.x += (me.srv.x - me.x) * BLEND;
            me.y += (me.srv.y - me.y) * BLEND;
          }
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
        aim = [{ x: me.x, y: me.y }];
        var tb2 = { x: me.x + Math.cos(myAim) * 0.46, y: me.y + Math.sin(myAim) * 0.46,
                    vx: Math.cos(myAim) * E.BULLET_SPEED, vy: Math.sin(myAim) * E.BULLET_SPEED,
                    bounces: 0 };
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
      myPos: function () { return me; },
      setAim: function (a) { myAim = a; }
    };
  }

  window.TanksNet = { create: create };
})();
