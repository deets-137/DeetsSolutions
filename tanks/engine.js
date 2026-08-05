/* DeetsTanks — the sim (docs/tanks.md, docs/realtime.md).

   Pure, DOM-free, deterministic, dual-export. The REAL-TIME engine
   contract: the turn-based one with `resolve(action)` swapped for
   `step(inputs)` (docs/realtime.md, "The engine contract"). Vendored
   VERBATIM into ../DeetsTanks/src/ when the worker lands (phase 4), so
   the mock and the worker run byte-identical rules.

   Determinism, two hard rules: no Math.random() — the PRNG is state,
   seeded at init; no Date.now() — the tick number is the only clock.
   The bar is "deterministic enough for 200 ms", not bit-exact: floats
   are fine because reconciliation replays against snapshots, and the
   next snapshot overwrites any drift (docs/realtime.md).

   Every object in `game` is plain JSON — no typed arrays — because the
   mock persists tables through localStorage and snapshot() is a deep
   clone by design.

   Wii Play is the foundation wherever a number or rule was needed
   (his call, 2026-08-05): shells bounce once and die on the second wall
   hit, at most 5 live shells per tank, 2 mines per tank, dying costs a
   heart and restarts the level, all hearts gone -> campaign over.
   The player fire cap is his own: 2 shells/second.

   node tanks/engine.js runs the self-checks. */
(function () {
  "use strict";

  /* ── constants ──────────────────────────────────────────────────
     Units are TILES; speeds are tiles-per-tick at TICK_HZ. */
  var TICK_HZ = 60;
  var TANK_SPEED = 3.2 / TICK_HZ;    // player hull speed
  var BULLET_SPEED = 5.0 / TICK_HZ;  // ~2x the hull — slow enough to dodge
  var TANK_R = 0.34;                 // hull half-size (square vs the grid)
  var BULLET_R = 0.09;
  var FIRE_CD = 30;                  // ticks — the 2 shells/second cap
  var MAX_SHELLS = 5;                // Wii Play's on-screen cap
  var MAX_BOUNCE = 1;                // one ricochet, dead on the next wall
  var MINES_MAX = 2;                 // per tank, per level attempt
  var MINE_CD = 30;                  // ticks between lays
  var MINE_ARM = 120;                // 2 s before it goes live
  var MINE_FUSE = 600;               // 10 s self-detonate
  var MINE_TRIG = 0.62;              // proximity radius, tiles
  var MINE_BLAST = 1.15;             // kill/clear radius, tiles
  var MUZZLE = 0.46;                 // shell spawn offset from hull centre
  var AIM_ALIGN = 0.06;              // rad — "aimed" for the AI trigger

  /* drive 1..8, clockwise from north; 0 = still. The hull SNAPS to the
     facing (his call — no turn rate; docs/tanks.md, "Simplification"). */
  var DIAG = Math.SQRT1_2;
  var DIRS = [null,
    [0, -1], [DIAG, -DIAG], [1, 0], [DIAG, DIAG],
    [0, 1], [-DIAG, DIAG], [-1, 0], [-DIAG, -DIAG]];
  function dirAngle(d) { var v = DIRS[d]; return Math.atan2(v[1], v[0]); }

  /* ── enemy types (docs/tanks.md, "Enemy AI") ────────────────────
     Difficulty rides the TYPE, and the level chooses what it spawns —
     not BOT_TIER_LIST, which assumes a bot holds a seat. Type 1 is the
     tutorial enemy: bolted down, turret slowly tracking, fires rarely.
     The rest of the cast is Aditya's to invent; the table is shaped to
     receive it. */
  var ENEMY_TYPES = {
    1: { speed: 0, turnRate: 0.55 / TICK_HZ, cooldown: 240, maxShells: 1,
         bounceDepth: 0, aimErr: 0.05, mines: 0, evade: false }
  };

  /* ── PRNG — mulberry32; the state is an int IN the game ───────── */
  function prngNext(g) {
    g.prng = (g.prng + 0x6D2B79F5) | 0;
    var t = g.prng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /* ═══ LEVEL FORMAT (docs/tanks.md, "The level format") ══════════
     Plain text: `name` / `tier` header lines, then a `grid` block.
     Legend (fixed vocabulary until his terrain pass):
       .  floor        #  wall, indestructible
       =  block, destructible
       P  player spawn (reading order = seat order)
       1..9  enemy spawn, digit = tank type */
  function parseLevel(src) {
    var name = "", tier = 0, rows = [], inGrid = false;
    String(src).split(/\r?\n/).forEach(function (raw) {
      var line = raw.replace(/\s+$/, "");
      if (inGrid) { if (line.length) rows.push(line); return; }
      var t = line.trim();
      if (!t) return;
      if (t === "grid") { inGrid = true; return; }
      var m = t.match(/^(name|tier)\s+(.*)$/);
      if (m) { if (m[1] === "name") name = m[2]; else tier = m[2] | 0; }
      // anything else pre-grid (a legend block) is tolerated, not parsed
    });
    if (!rows.length) throw new Error("level has no grid");
    var w = rows[0].length, h = rows.length;
    var cells = [], spawns = [], enemies = [];
    for (var y = 0; y < h; y++) {
      if (rows[y].length !== w) throw new Error("grid not rectangular at row " + y);
      var out = "";
      for (var x = 0; x < w; x++) {
        var ch = rows[y][x];
        if (ch === "P") { spawns.push({ x: x + 0.5, y: y + 0.5 }); ch = "."; }
        else if (ch >= "1" && ch <= "9") { enemies.push({ x: x + 0.5, y: y + 0.5, type: +ch }); ch = "."; }
        else if (ch !== "." && ch !== "#" && ch !== "=") throw new Error("unknown cell '" + ch + "' at " + x + "," + y);
        out += ch;
      }
      cells.push(out);
    }
    return { name: name, tier: tier, w: w, h: h, cells: cells, spawns: spawns, enemies: enemies };
  }

  function validateLevel(level) {
    var p = [];
    if (!level.spawns.length) p.push("no player spawn");
    if (!level.enemies.length) p.push("no enemies");
    level.enemies.forEach(function (e) {
      if (!ENEMY_TYPES[e.type]) p.push("unknown enemy type " + e.type);
    });
    for (var x = 0; x < level.w; x++) {
      if (level.cells[0][x] !== "#" || level.cells[level.h - 1][x] !== "#") { p.push("open border"); break; }
    }
    for (var y = 0; y < level.h; y++) {
      if (level.cells[y][0] !== "#" || level.cells[y][level.w - 1] !== "#") { p.push("open border"); break; }
    }
    // every enemy reachable from the first spawn (flood fill over non-wall;
    // destructible blocks count as passable — a shell opens them)
    if (level.spawns.length && level.enemies.length) {
      var seen = {}, q = [[level.spawns[0].x | 0, level.spawns[0].y | 0]];
      seen[(level.spawns[0].x | 0) + "," + (level.spawns[0].y | 0)] = 1;
      while (q.length) {
        var c = q.pop();
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
          var nx = c[0] + d[0], ny = c[1] + d[1], k = nx + "," + ny;
          if (nx < 0 || ny < 0 || nx >= level.w || ny >= level.h || seen[k]) return;
          if (level.cells[ny][nx] === "#") return;
          seen[k] = 1; q.push([nx, ny]);
        });
      }
      level.enemies.forEach(function (e, i) {
        if (!seen[(e.x | 0) + "," + (e.y | 0)]) p.push("enemy " + i + " unreachable");
      });
    }
    return p;
  }

  /* ── grid queries ─────────────────────────────────────────────── */
  function cellAt(level, tx, ty) {
    if (tx < 0 || ty < 0 || tx >= level.w || ty >= level.h) return "#";
    return level.cells[ty][tx];
  }
  function solid(level, blocks, tx, ty) {
    var ch = cellAt(level, tx, ty);
    if (ch === "#") return true;
    if (ch === "=") return blocks[ty * level.w + tx] === 1;
    return false;
  }
  // a square of half-size r fits at (x, y)?
  function boxFree(level, blocks, x, y, r) {
    var x0 = Math.floor(x - r), x1 = Math.floor(x + r);
    var y0 = Math.floor(y - r), y1 = Math.floor(y + r);
    for (var ty = y0; ty <= y1; ty++)
      for (var tx = x0; tx <= x1; tx++)
        if (solid(level, blocks, tx, ty)) return false;
    return true;
  }
  // straight line of sight, sampled — deterministic and plenty for AI
  function los(level, blocks, x0, y0, x1, y1) {
    var dx = x1 - x0, dy = y1 - y0;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var steps = Math.max(1, Math.ceil(dist / 0.1));
    for (var i = 1; i < steps; i++) {
      var t = i / steps;
      if (solid(level, blocks, Math.floor(x0 + dx * t), Math.floor(y0 + dy * t))) return false;
    }
    return true;
  }

  /* ── movement (shared with the client's prediction — net.js calls
     this exact function on the vendored copy it loads) ───────────── */
  function moveTank(level, blocks, tanks, tank, drive) {
    if (!drive) return;
    tank.hull = drive;
    var v = DIRS[drive];
    var nx = tank.x + v[0] * TANK_SPEED;
    var ny = tank.y + v[1] * TANK_SPEED;
    // axis-wise slide: try x, then y, each blocked by grid and by tanks
    if (boxFree(level, blocks, nx, tank.y, TANK_R) && !bumps(tanks, tank, nx, tank.y)) tank.x = nx;
    if (boxFree(level, blocks, tank.x, ny, TANK_R) && !bumps(tanks, tank, tank.x, ny)) tank.y = ny;
  }
  function bumps(tanks, self, x, y) {
    for (var i = 0; i < tanks.length; i++) {
      var o = tanks[i];
      if (o === self || !o.alive) continue;
      var dx = o.x - x, dy = o.y - y;
      if (dx * dx + dy * dy < (TANK_R * 2) * (TANK_R * 2) * 0.81) return true;
    }
    return false;
  }

  /* ── bullets — spawned once, simulated everywhere (docs/realtime.md,
     "Deterministic projectiles"). stepBullet is also the client's
     tracer for the aim line and for local flight. Returns:
       null       still flying
       "gone"     expired (second wall hit)
       {block: [tx, ty]}  died opening a destructible block */
  function stepBullet(level, blocks, b) {
    b.x += b.vx; b.y += b.vy;
    var tx = Math.floor(b.x), ty = Math.floor(b.y);
    if (!solid(level, blocks, tx, ty)) return null;
    if (cellAt(level, tx, ty) === "=" && blocks[ty * level.w + tx] === 1) return { block: [tx, ty] };
    // reflect: which axis did we cross into the tile on?
    var px = b.x - b.vx, py = b.y - b.vy;
    var hitX = solid(level, blocks, tx, Math.floor(py));
    var hitY = solid(level, blocks, Math.floor(px), ty);
    if (b.bounces >= MAX_BOUNCE) return "gone";
    b.bounces++;
    if (hitX || (!hitX && !hitY)) { b.vx = -b.vx; b.x = px + b.vx; }
    if (hitY || (!hitX && !hitY)) { b.vy = -b.vy; b.y = py + b.vy; }
    return null;
  }

  /* aimSolve — the angle that reaches `target` from `from` within
     `bounces` ricochets, or null. Shared by the AI and (later) the aim
     hint. MVP: direct line only; bank-shot planning arrives with the
     first enemy type whose bounceDepth > 0 (docs/tanks.md). */
  function aimSolve(state, from, target, bounces) {
    if (los(state.level, state.blocks, from.x, from.y, target.x, target.y)) {
      return Math.atan2(target.y - from.y, target.x - from.x);
    }
    return null;
  }

  /* ═══ GAME ══════════════════════════════════════════════════════ */
  function liveShells(g, ownerId) {
    var n = 0;
    g.bullets.forEach(function (b) { if (b.owner === ownerId) n++; });
    return n;
  }
  function tankById(g, id) {
    for (var i = 0; i < g.tanks.length; i++) if (g.tanks[i].id === id) return g.tanks[i];
    return null;
  }

  function loadLevel(g, events) {
    var level = parseLevel(g.levels[g.levelIdx]);
    g.level = level;
    g.blocks = [];
    for (var y = 0; y < level.h; y++)
      for (var x = 0; x < level.w; x++)
        g.blocks.push(level.cells[y][x] === "=" ? 1 : 0);
    g.tanks = [];
    g.bullets = [];
    g.mines = [];
    for (var s = 0; s < g.seatCount; s++) {
      var sp = level.spawns[s % level.spawns.length];
      g.tanks.push({
        id: "p" + s, seat: s, type: null,
        x: sp.x, y: sp.y, hull: 1, turret: dirAngle(1),
        alive: g.lives[s] > 0, cooldown: 0, mineCd: 0, mines: MINES_MAX
      });
    }
    level.enemies.forEach(function (e, i) {
      var ty = ENEMY_TYPES[e.type];
      g.tanks.push({
        id: "e" + i, seat: null, type: e.type,
        x: e.x, y: e.y, hull: 5, turret: dirAngle(5),
        alive: true, cooldown: ty.cooldown, mineCd: 0, mines: ty.mines
      });
    });
    events.push({ t: "level", n: g.levelIdx, name: level.name, attempt: g.attempt });
  }

  function createGame(opts, ctx) {
    var g = {
      phase: "playing",            // playing | interlevel | over
      tick: 0,
      prng: (opts.seed != null ? opts.seed : Math.floor(ctx.rand() * 4294967296)) | 0,
      seatCount: opts.seats,
      settings: {
        lives: opts.settings.lives,
        aimLine: !!opts.settings.aimLine,
        friendlyFire: !!opts.settings.friendlyFire
      },
      levels: opts.levels,
      levelIdx: 0, attempt: 1, result: null,
      lives: [], kills: [],
      level: null, blocks: [], tanks: [], bullets: [], mines: [],
      over: null,
      _boot: []
    };
    for (var s = 0; s < opts.seats; s++) { g.lives.push(opts.settings.lives); g.kills.push(0); }
    var ev = [];
    loadLevel(g, ev);
    g._boot = ev;
    return g;
  }

  function killTank(g, tank, byId, events) {
    if (!tank.alive) return;
    tank.alive = false;
    var by = byId ? tankById(g, byId) : null;
    events.push({ t: "die", id: tank.id, seat: tank.seat, type: tank.type,
                  by: byId || null, x: tank.x, y: tank.y });
    if (tank.seat != null) g.lives[tank.seat]--;
    else if (by && by.seat != null) g.kills[by.seat]++;
  }

  function detonateMine(g, m, events) {
    events.push({ t: "mineBoom", x: m.x, y: m.y });
    g.tanks.forEach(function (tk) {
      if (!tk.alive) return;
      var dx = tk.x - m.x, dy = tk.y - m.y;
      if (dx * dx + dy * dy <= MINE_BLAST * MINE_BLAST) killTank(g, tk, m.owner, events);
    });
    for (var y = 0; y < g.level.h; y++) {
      for (var x = 0; x < g.level.w; x++) {
        if (g.level.cells[y][x] !== "=" || g.blocks[y * g.level.w + x] !== 1) continue;
        var ddx = x + 0.5 - m.x, ddy = y + 0.5 - m.y;
        if (ddx * ddx + ddy * ddy <= MINE_BLAST * MINE_BLAST) {
          g.blocks[y * g.level.w + x] = 0;
          events.push({ t: "block", x: x, y: y });
        }
      }
    }
  }

  function fireShell(g, tank, angle, events) {
    var b = {
      id: "b" + g.tick + "-" + tank.id,
      owner: tank.id, ownerSeat: tank.seat,
      x: tank.x + Math.cos(angle) * MUZZLE,
      y: tank.y + Math.sin(angle) * MUZZLE,
      vx: Math.cos(angle) * BULLET_SPEED,
      vy: Math.sin(angle) * BULLET_SPEED,
      bounces: 0, born: g.tick
    };
    g.bullets.push(b);
    tank.cooldown = FIRE_CD;
    // the ONE broadcast a shell ever gets — clients fly it from here
    events.push({ t: "fire", id: b.id, owner: b.owner, seat: tank.seat,
                  x: b.x, y: b.y, vx: b.vx, vy: b.vy, tick: g.tick });
  }

  /* one tick. `inputs` = { [seat]: {d, a, f, m} } — drive 0-8, aim
     angle, fire flag, mine flag. Mutates `g`, returns events. */
  function step(g, inputs) {
    var events = [];
    if (g.phase !== "playing") return events;
    g.tick++;

    // players
    g.tanks.forEach(function (tk) {
      if (tk.seat == null || !tk.alive) return;
      if (tk.cooldown > 0) tk.cooldown--;
      if (tk.mineCd > 0) tk.mineCd--;
      var inp = inputs && inputs[tk.seat];
      if (!inp) return;
      if (inp.a != null) tk.turret = inp.a;
      moveTank(g.level, g.blocks, g.tanks, tk, inp.d | 0);
      if (inp.f && tk.cooldown === 0 && liveShells(g, tk.id) < MAX_SHELLS) {
        fireShell(g, tk, tk.turret, events);
      }
      if (inp.m && tk.mines > 0 && tk.mineCd === 0) {
        tk.mines--; tk.mineCd = MINE_CD;
        var m = { id: "m" + g.tick + "-" + tk.id, owner: tk.id,
                  x: tk.x, y: tk.y, born: g.tick };
        g.mines.push(m);
        events.push({ t: "mine", id: m.id, x: m.x, y: m.y, born: m.born, seat: tk.seat });
      }
    });

    // enemies — the brain lives HERE, per the house rule (docs/games.md)
    g.tanks.forEach(function (tk) {
      if (tk.seat != null || !tk.alive) return;
      var ty = ENEMY_TYPES[tk.type];
      if (tk.cooldown > 0) tk.cooldown--;
      var best = null, bd = Infinity;
      g.tanks.forEach(function (p) {
        if (p.seat == null || !p.alive) return;
        var dx = p.x - tk.x, dy = p.y - tk.y, d2 = dx * dx + dy * dy;
        if (d2 < bd) { bd = d2; best = p; }
      });
      if (!best) return;
      var want = Math.atan2(best.y - tk.y, best.x - tk.x);
      var diff = want - tk.turret;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      var turn = Math.max(-ty.turnRate, Math.min(ty.turnRate, diff));
      tk.turret += turn;
      if (Math.abs(diff) < AIM_ALIGN && tk.cooldown === 0 &&
          liveShells(g, tk.id) < ty.maxShells &&
          aimSolve(g, tk, best, ty.bounceDepth) != null) {
        var err = (prngNext(g) - 0.5) * 2 * ty.aimErr;
        fireShell(g, tk, tk.turret + err, events);
        tk.cooldown = ty.cooldown + Math.floor(prngNext(g) * 60);
      }
    });

    // bullets: advance, reflect, expire, cancel each other, hit tanks
    for (var bi = g.bullets.length - 1; bi >= 0; bi--) {
      var b = g.bullets[bi];
      var r = stepBullet(g.level, g.blocks, b);
      if (r === "gone") {
        events.push({ t: "boom", x: b.x, y: b.y, id: b.id });
        g.bullets.splice(bi, 1);
        continue;
      }
      if (r && r.block) {
        g.blocks[r.block[1] * g.level.w + r.block[0]] = 0;
        events.push({ t: "block", x: r.block[0], y: r.block[1] });
        events.push({ t: "boom", x: b.x, y: b.y, id: b.id });
        g.bullets.splice(bi, 1);
      }
    }
    // shell vs shell — Wii Play's parry
    for (var i = g.bullets.length - 1; i >= 0; i--) {
      for (var j = i - 1; j >= 0; j--) {
        var a = g.bullets[i], c = g.bullets[j];
        var dx = a.x - c.x, dy = a.y - c.y;
        if (dx * dx + dy * dy < (BULLET_R * 2) * (BULLET_R * 2)) {
          events.push({ t: "boom", x: (a.x + c.x) / 2, y: (a.y + c.y) / 2, id: a.id, id2: c.id });
          g.bullets.splice(i, 1); g.bullets.splice(j, 1);
          i--;
          break;
        }
      }
    }
    // shell vs tank. Friendly fire OFF shields players from OTHER
    // players' shells only — your own shell can still find you off a
    // wall, which is Wii Play working as intended.
    for (var k = g.bullets.length - 1; k >= 0; k--) {
      var bl = g.bullets[k], hit = null;
      for (var ti = 0; ti < g.tanks.length; ti++) {
        var tk2 = g.tanks[ti];
        if (!tk2.alive) continue;
        var hx = bl.x - tk2.x, hy = bl.y - tk2.y;
        if (hx * hx + hy * hy > (TANK_R + BULLET_R) * (TANK_R + BULLET_R)) continue;
        if (tk2.id === bl.owner && g.tick - bl.born < 8) continue;   // still leaving the muzzle
        if (!g.settings.friendlyFire && tk2.seat != null &&
            bl.ownerSeat != null && bl.ownerSeat !== tk2.seat && tk2.id !== bl.owner) continue;
        hit = tk2; break;
      }
      if (hit) {
        killTank(g, hit, bl.owner, events);
        events.push({ t: "boom", x: bl.x, y: bl.y, id: bl.id });
        g.bullets.splice(k, 1);
      }
    }

    // mines: arm, trigger, fuse; shells detonate them too
    for (var mi = g.mines.length - 1; mi >= 0; mi--) {
      var m = g.mines[mi], go = false;
      var age = g.tick - m.born;
      if (age >= MINE_FUSE) go = true;
      if (!go && age >= MINE_ARM) {
        for (var ki = 0; ki < g.tanks.length; ki++) {
          var kt = g.tanks[ki];
          if (!kt.alive || kt.id === m.owner) continue;
          var mx = kt.x - m.x, my = kt.y - m.y;
          if (mx * mx + my * my <= MINE_TRIG * MINE_TRIG) { go = true; break; }
        }
      }
      if (!go) {
        for (var bj = g.bullets.length - 1; bj >= 0; bj--) {
          var bb = g.bullets[bj];
          var bx = bb.x - m.x, by = bb.y - m.y;
          if (bx * bx + by * by <= (MINE_R_HIT) * (MINE_R_HIT)) {
            g.bullets.splice(bj, 1); go = true; break;
          }
        }
      }
      if (go) { g.mines.splice(mi, 1); detonateMine(g, m, events); }
    }

    // level outcome
    var playersAlive = 0, enemiesAlive = 0;
    g.tanks.forEach(function (t2) {
      if (!t2.alive) return;
      if (t2.seat != null) playersAlive++; else enemiesAlive++;
    });
    if (!enemiesAlive) {
      g.phase = "interlevel"; g.result = "cleared";
      events.push({ t: "cleared", n: g.levelIdx });
    } else if (!playersAlive) {
      g.phase = "interlevel"; g.result = "failed";
      events.push({ t: "failed", n: g.levelIdx });
      if (!g.lives.some(function (l) { return l > 0; })) {
        g.phase = "over"; g.over = { win: false };
        events.push({ t: "gameOver", win: false });
      }
    }
    return events;
  }

  /* the interlevel step: cleared -> next level (or victory), failed ->
     the same level again. Driven by the table's deadline (mock/DO). */
  function advance(g) {
    var events = [];
    if (g.phase !== "interlevel") return events;
    if (g.result === "cleared") {
      g.levelIdx++;
      g.attempt = 1;
      if (g.levelIdx >= g.levels.length) {
        g.phase = "over"; g.over = { win: true };
        events.push({ t: "gameOver", win: true });
        return events;
      }
    } else {
      g.attempt++;
    }
    g.phase = "playing"; g.result = null;
    loadLevel(g, events);
    return events;
  }

  /* ── the turn-based bridge the shared table core expects ──────── */
  function err(code) { return { error: { code: code } }; }
  function applyAction(g, action) {
    if (!action || !action.type) return err("phase");
    if (action.type === "timerExpire") {
      if (g.phase !== "interlevel") return { game: g, events: [] };
      return { game: g, events: advance(g) };
    }
    return err("phase");
  }

  function snapshot(g) { return JSON.parse(JSON.stringify(g)); }
  function restore(snap) { return JSON.parse(JSON.stringify(snap)); }

  /* no seat-holding bots: enemies are world state, driven by step() */
  function botPending() { return false; }
  function botAct() { return null; }

  var MINE_R_HIT = 0.3;   // a shell within this pops a mine

  var Engine = {
    TICK_HZ: TICK_HZ,
    TANK_SPEED: TANK_SPEED, BULLET_SPEED: BULLET_SPEED,
    TANK_R: TANK_R, BULLET_R: BULLET_R,
    FIRE_CD: FIRE_CD, MAX_SHELLS: MAX_SHELLS, MAX_BOUNCE: MAX_BOUNCE,
    MINES_MAX: MINES_MAX, MINE_ARM: MINE_ARM, MINE_FUSE: MINE_FUSE,
    MINE_TRIG: MINE_TRIG, MINE_BLAST: MINE_BLAST,
    DIRS: DIRS, dirAngle: dirAngle,
    ENEMY_TYPES: ENEMY_TYPES,
    parseLevel: parseLevel, validateLevel: validateLevel,
    cellAt: cellAt, solid: solid, los: los,
    moveTank: moveTank, stepBullet: stepBullet, aimSolve: aimSolve,
    createGame: createGame, step: step, advance: advance,
    applyAction: applyAction,
    snapshot: snapshot, restore: restore,
    botPending: botPending, botAct: botAct,
    BOT_TIER_LIST: []
  };

  if (typeof module !== "undefined" && module.exports) module.exports = Engine;
  if (typeof window !== "undefined") window.TanksEngine = Engine;

  /* ═══ SELF-CHECKS — node tanks/engine.js ════════════════════════ */
  if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
    var n = 0;
    function ok(cond, what) {
      n++;
      if (!cond) { console.error("FAIL " + n + ": " + what); process.exit(1); }
    }
    var SRC0 = [
      "name  [ph] Test Arena", "tier  0", "", "grid",
      "##########",
      "#P.......#",
      "#........#",
      "#....=...#",
      "#........#",
      "#P......1#",
      "##########"
    ].join("\n");
    var lv = parseLevel(SRC0);
    ok(lv.w === 10 && lv.h === 7, "grid dims");
    ok(lv.spawns.length === 2, "two player spawns");
    ok(lv.enemies.length === 1 && lv.enemies[0].type === 1, "one type-1 enemy");
    ok(validateLevel(lv).length === 0, "level validates clean");
    ok(validateLevel(parseLevel("grid\n###\n#.#\n###")).indexOf("no player spawn") >= 0, "spawnless flagged");
    var open = parseLevel("grid\n#P#\n...\n#1#");
    ok(validateLevel(open).some(function (x) { return x === "open border"; }), "open border flagged");
    var threw = false;
    try { parseLevel("grid\n##\n#"); } catch (e) { threw = true; }
    ok(threw, "ragged grid throws");
    threw = false;
    try { parseLevel("grid\n#X#"); } catch (e) { threw = true; }
    ok(threw, "unknown cell throws");

    var CTX = { rand: function () { return 0.5; } };
    function boot(seats) {
      return createGame({ levels: [SRC0, SRC0], seats: seats || 1,
        settings: { lives: 3, aimLine: true, friendlyFire: false }, seed: 42 }, CTX);
    }
    var g = boot();
    ok(g.phase === "playing" && g.levelIdx === 0, "boots playing");
    ok(g.tanks.length === 2, "one player + one enemy");
    ok(g.lives[0] === 3, "three hearts");
    ok(g._boot.length === 1 && g._boot[0].t === "level", "boot event");

    // determinism: same seed, same ticks, same state
    var g2 = boot();
    for (var d = 0; d < 120; d++) { step(g, { 0: { d: 3, a: 0, f: 0, m: 0 } }); step(g2, { 0: { d: 3, a: 0, f: 0, m: 0 } }); }
    ok(JSON.stringify(g) === JSON.stringify(g2), "deterministic across runs");

    // snapshot -> restore -> identical future
    var snap = snapshot(g);
    var g3 = restore(snap);
    step(g, { 0: { d: 5, a: 1, f: 0, m: 0 } });
    step(g3, { 0: { d: 5, a: 1, f: 0, m: 0 } });
    ok(JSON.stringify(g) === JSON.stringify(g3), "snapshot/restore continues identically");

    // movement: east until the wall stops you short of the border tile
    g = boot();
    for (var mv = 0; mv < 600; mv++) step(g, { 0: { d: 3, a: 0, f: 0, m: 0 } });
    ok(g.tanks[0].x < lv.w - 1 - TANK_R + 0.01, "wall stops the hull");
    ok(g.tanks[0].hull === 3, "hull snapped to the drive facing");

    // fire: one shell, capped at 2/s
    g = boot();
    step(g, { 0: { d: 0, a: 0, f: 1, m: 0 } });
    ok(g.bullets.length === 1, "shell spawned");
    var evs = step(g, { 0: { d: 0, a: 0, f: 1, m: 0 } });
    ok(g.bullets.length === 1 && !evs.some(function (e) { return e.t === "fire"; }), "cooldown holds the second shell");
    for (var cd = 0; cd < FIRE_CD; cd++) step(g, { 0: { d: 0, a: 0, f: 0, m: 0 } });
    step(g, { 0: { d: 0, a: 0, f: 1, m: 0 } });
    ok(g.bullets.length <= 2, "second shell only after the cap");

    // ricochet: a shell dies on its second wall
    g = boot();
    g.tanks[0].x = 3.5; g.tanks[0].y = 2;     // clear column (5 holds a block)
    step(g, { 0: { d: 0, a: -Math.PI / 2, f: 1, m: 0 } });   // straight up
    g.tanks[0].x = 7.5; g.tanks[0].y = 2.5;   // step out of the shaft — your own
    // shell coming back off the wall WILL kill you (Wii rule, kept)
    var alive = 0;
    for (var fl = 0; fl < 600 && g.bullets.length; fl++) { step(g, {}); alive = fl; }
    ok(g.bullets.length === 0, "bounced shell expires");
    ok(alive > 30, "it flew a while first");

    // kill the enemy -> cleared -> advance -> level 2 -> win
    g = boot();
    g.tanks[0].x = 2.5; g.tanks[0].y = 5.5;                 // same row as the enemy
    step(g, { 0: { d: 0, a: 0, f: 1, m: 0 } });
    var cleared = false;
    for (var kk = 0; kk < 400 && !cleared; kk++) {
      var ee = step(g, {});
      if (ee.some(function (e) { return e.t === "cleared"; })) cleared = true;
    }
    ok(cleared && g.phase === "interlevel", "enemy down clears the level");
    ok(g.kills[0] === 1, "the kill is credited");
    var adv = advance(g);
    ok(g.phase === "playing" && g.levelIdx === 1, "advance loads the next level");
    ok(adv.some(function (e) { return e.t === "level"; }), "level event on advance");
    g.tanks.forEach(function (t2) { if (t2.seat == null) killTank(g, t2, "p0", []); });
    step(g, {});
    advance(g);
    ok(g.phase === "over" && g.over.win === true, "last level cleared wins the campaign");

    // death costs a heart and fails the attempt; hearts gone ends it
    g = boot();
    var pt = g.tanks[0];
    killTank(g, pt, "e0", []);
    var fe = step(g, {});
    ok(g.lives[0] === 2, "death cost a heart");
    ok(fe.some(function (e) { return e.t === "failed"; }) && g.phase === "interlevel", "attempt failed");
    advance(g);
    ok(g.phase === "playing" && g.attempt === 2 && g.levelIdx === 0, "retry restarts the level");
    killTank(g, g.tanks[0], "e0", []); step(g, {});
    advance(g);
    killTank(g, g.tanks[0], "e0", []);
    var ge = step(g, {});
    ok(g.phase === "over" && g.over.win === false, "no hearts left ends the campaign");
    ok(ge.some(function (e) { return e.t === "gameOver"; }), "gameOver event");

    // mines: lay, cap, arm delay, proximity boom
    g = boot(1);
    step(g, { 0: { d: 0, a: 0, f: 0, m: 1 } });
    ok(g.mines.length === 1 && g.tanks[0].mines === 1, "mine laid, one left");
    for (var mc = 0; mc < MINE_CD; mc++) step(g, {});
    step(g, { 0: { d: 0, a: 0, f: 0, m: 1 } });
    step(g, { 0: { d: 0, a: 0, f: 0, m: 1 } });
    ok(g.mines.length === 2 && g.tanks[0].mines === 0, "two per attempt, no more");
    // own mine ignores its owner; park the enemy on it and wait out the arm
    g = boot(1);
    step(g, { 0: { d: 0, a: 0, f: 0, m: 1 } });
    var en = g.tanks[1];
    en.x = g.tanks[0].x + 0.3; en.y = g.tanks[0].y;
    var boomed = false;
    for (var mt = 0; mt < MINE_ARM + 10 && !boomed; mt++) {
      if (step(g, {}).some(function (e) { return e.t === "mineBoom"; })) boomed = true;
    }
    ok(boomed, "armed mine triggers on proximity");
    ok(!en.alive, "the blast kills");

    // friendly fire off: another player's shell passes through
    g = boot(2);
    g.tanks[0].x = 2.5; g.tanks[0].y = 2.5;
    g.tanks[1].x = 6.5; g.tanks[1].y = 2.5;
    step(g, { 0: { d: 0, a: 0, f: 1, m: 0 } });
    for (var ff = 0; ff < 60; ff++) step(g, {});
    ok(g.tanks[1].alive, "friendly fire off shields the teammate");
    g = boot(2);
    g.settings.friendlyFire = true;
    g.tanks[0].x = 2.5; g.tanks[0].y = 2.5;
    g.tanks[1].x = 6.5; g.tanks[1].y = 2.5;
    step(g, { 0: { d: 0, a: 0, f: 1, m: 0 } });
    var dead = false;
    for (var ff2 = 0; ff2 < 60 && !dead; ff2++) {
      if (step(g, {}).some(function (e) { return e.t === "die" && e.seat === 1; })) dead = true;
    }
    ok(dead, "friendly fire on lets it land");

    // shells parry shells
    g = boot(2);
    g.settings.friendlyFire = true;
    g.tanks[0].x = 2.5; g.tanks[0].y = 2.5;
    g.tanks[1].x = 7.5; g.tanks[1].y = 2.5;
    step(g, { 0: { d: 0, a: 0, f: 1, m: 0 }, 1: { d: 0, a: Math.PI, f: 1, m: 0 } });
    var parried = false;
    for (var pp = 0; pp < 60 && !parried; pp++) {
      if (step(g, {}).some(function (e) { return e.t === "boom" && e.id2; })) parried = true;
    }
    ok(parried && g.tanks[0].alive && g.tanks[1].alive, "head-on shells cancel");

    // the tutorial enemy tracks and eventually fires
    g = boot(1);
    g.tanks[0].x = 2.5; g.tanks[0].y = 5.5;
    var enemyFired = false, t0 = g.tanks[1].turret;
    for (var ai = 0; ai < 1200 && !enemyFired; ai++) {
      if (step(g, { 0: { d: 0, a: 0, f: 0, m: 0 } }).some(function (e) { return e.t === "fire" && e.seat == null; })) enemyFired = true;
    }
    ok(g.tanks[1].turret !== t0, "the turret turned");
    ok(enemyFired, "the tracker fires once aligned");

    // applyAction bridge: timerExpire advances the interlevel
    g = boot(1);
    g.phase = "interlevel"; g.result = "failed";
    var r = applyAction(g, { type: "timerExpire" });
    ok(!r.error && g.phase === "playing" && g.attempt === 2, "timerExpire drives the interstitial");
    ok(applyAction(g, { type: "nope" }).error, "unknown action refused");

    console.log("tanks/engine.js self-checks: " + n + " passed");
  }
})();
