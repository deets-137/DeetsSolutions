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

  /* ═══ THE TUNE REGISTRY (docs/tanks.md, "Tuning") ═══════════════
     Every physics number a level may override, in HUMAN units — the
     level file is hand-written, so it speaks tiles/second and seconds,
     not tiles/tick and ticks. This table is the single source of
     truth: the parser validates against it, the engine reads the
     resolved values, and designer.html BUILDS ITS PANEL FROM IT, so a
     knob added here appears in the UI with no page edit.

       [default, min, max, unit, scope]
     scope: "a" = any actor (player or enemy), "e" = enemy-only (AI),
            "g" = global to the level.

     The clamps are not decoration. `stepBullet` advances a shell one
     position per tick and tests the tile it lands in, so a shell over
     ~0.5 tiles/tick can pass straight THROUGH a one-tile wall. The
     bulletSpeed ceiling is that tunnelling threshold with headroom;
     raising it needs sub-stepping in stepBullet first. Same story, at
     a wider margin, for speed. */
  var TUNE_SPEC = {
    speed:       [3.2,  0,    12,   "tiles/s",  "a"],
    bulletSpeed: [5.0,  1,    22,   "tiles/s",  "a"],
    bounces:     [1,    0,    5,    "",         "a"],
    fireRate:    [2.0,  0.1,  10,   "shells/s", "a"],
    maxShells:   [5,    1,    12,   "",         "a"],
    mines:       [2,    0,    8,    "",         "a"],
    turnRate:    [0.55, 0.05, 12,   "rad/s",    "e"],
    bounceDepth: [0,    0,    3,    "",         "e"],
    aimErr:      [0.05, 0,    0.6,  "rad",      "e"],
    reaction:    [0,    0,    3,    "s",        "e"],
    evade:       [0,    0,    1,    "",         "e"],
    tankR:       [0.34, 0.15, 0.48, "tiles",    "g"],
    mineArm:     [2.0,  0.1,  10,   "s",        "g"],
    mineFuse:    [10,   1,    60,   "s",        "g"],
    mineTrig:    [0.62, 0.2,  3,    "tiles",    "g"],
    mineBlast:   [1.15, 0.3,  4,    "tiles",    "g"]
  };
  /* keys whose unit is seconds-per-thing or per-second and therefore
     convert on resolve; everything else is already in engine units */
  var PER_SEC = { speed: 1, bulletSpeed: 1, turnRate: 1 };
  var SECONDS = { reaction: 1, mineArm: 1, mineFuse: 1 };

  /* ── enemy types (docs/tanks.md, "Enemy AI") ────────────────────
     Difficulty rides the TYPE, and the level chooses what it spawns —
     not BOT_TIER_LIST, which assumes a bot holds a seat.

     Each entry is a sparse OVERRIDE over TUNE_SPEC's defaults, so a
     type only names what makes it that type. `name` and `art` are for
     the designer's palette; the digit is what the level grid writes.

     All seven are BUILT (2026-08-05). What separates them is only
     these numbers — the brain is one routine and every behaviour is a
     tune key, so a level can turn any of them up or down and a new
     type is an entry here rather than new code.

     Read the table as a difficulty ramp. `bounceDepth` is the dial
     that matters (cover stops working); `reaction` is the one that
     decides whether you get time to react to THEM. */
  var ENEMY_TYPES = {
    // bolted down, slow turret, fires rarely — the tutorial
    1: { name: "Sentry",  art: "#a3562c",
         speed: 0, turnRate: 0.55, fireRate: 0.25, maxShells: 1,
         reaction: 0.6, aimErr: 0.05 },
    // mills about, banks one wall: ricochets exist and they hit you
    2: { name: "Rover",   art: "#8d8d84",
         speed: 1.4, turnRate: 0.9, fireRate: 0.5, maxShells: 1,
         bounceDepth: 1, reaction: 0.45, aimErr: 0.05 },
    // stationary, flat fast rocket, no bank — punishes open lanes
    3: { name: "Lancer",  art: "#2f8b86",
         speed: 0, turnRate: 1.3, fireRate: 1.2, maxShells: 2,
         bulletSpeed: 9, bounces: 0, reaction: 0.3, aimErr: 0.04 },
    // fast, mines behind it, one bank — area denial
    4: { name: "Sapper",  art: "#c8a326",
         speed: 2.6, turnRate: 1.1, fireRate: 0.4, maxShells: 1,
         bounceDepth: 1, mines: 4, reaction: 0.4, aimErr: 0.06 },
    // dodges shells and shoots fast — you have to lead it
    5: { name: "Duelist", art: "#c0392b",
         speed: 2.9, turnRate: 1.8, fireRate: 1.1, maxShells: 2,
         bounceDepth: 1, evade: 1, reaction: 0.18, aimErr: 0.03 },
    // stationary, TWO banks, slow readable shell — cover stops working
    6: { name: "Banker",  art: "#4f8a34",
         speed: 0, turnRate: 1.4, fireRate: 0.7, maxShells: 2,
         bounceDepth: 2, bulletSpeed: 4, bounces: 2,
         reaction: 0.35, aimErr: 0.02 },
    // all of it at once — the finale
    7: { name: "Marshal", art: "#3a3340",
         speed: 3.4, turnRate: 2.2, fireRate: 1.4, maxShells: 3,
         bounceDepth: 2, bulletSpeed: 4.5, bounces: 2, mines: 3,
         evade: 1, reaction: 0.12, aimErr: 0.02 }
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
     Header lines: `name`, `tier`, `theme` (art only — see docs).
       =  block, destructible
       P  player spawn (reading order = seat order)
       1..9  enemy spawn, digit = tank type */
  /* ── tuning ──────────────────────────────────────────────────────
     A level may override physics in a `tune` block. Raw overrides are
     scoped strings ("bulletSpeed", "player.mines", "enemy6.bounceDepth");
     resolveTune materialises them into the flat per-actor objects the
     hot paths read, so nothing in step() ever does a string lookup.

     This lives in the LEVEL, not in table settings and not in the
     designer, because the worker vendors this file and receives only
     the level — physics that are not in the level text cannot survive
     the trip to the server (docs/tanks.md, "Tuning"). */
  function tuneKey(raw) {
    var m = String(raw).match(/^(?:(player|enemy[1-9])\.)?([A-Za-z]+)$/);
    if (!m) return null;
    var spec = TUNE_SPEC[m[2]];
    if (!spec) return null;
    var scope = m[1] || "";
    if (spec[4] === "g" && scope) return null;           // global keys take no scope
    if (spec[4] === "e" && scope === "player") return null;  // AI keys are enemy-only
    return { scope: scope, key: m[2], spec: spec };
  }
  function clampTune(key, v) {
    var s = TUNE_SPEC[key];
    v = +v;
    if (!isFinite(v)) return s[0];
    return Math.max(s[1], Math.min(s[2], v));
  }
  // human units -> engine units (per tick, ticks)
  function toEngine(key, v) {
    if (PER_SEC[key]) return v / TICK_HZ;
    if (SECONDS[key]) return Math.max(1, Math.round(v * TICK_HZ));
    if (key === "fireRate") return Math.max(1, Math.round(TICK_HZ / v));  // -> cooldown ticks
    return v;
  }
  function resolveOne(raw, extra) {
    var out = {};
    Object.keys(TUNE_SPEC).forEach(function (k) {
      var v = raw[""] && raw[""][k] != null ? raw[""][k] : TUNE_SPEC[k][0];
      if (extra && extra[k] != null) v = extra[k];
      if (raw.scoped && raw.scoped[k] != null) v = raw.scoped[k];
      out[k] = toEngine(k, clampTune(k, v));
    });
    out.cooldown = out.fireRate;        // readable alias: fireRate resolved to ticks
    return out;
  }
  function resolveTune(over) {
    var g = { "": over[""] || {} };
    var tune = { raw: over, global: resolveOne(g, null), player: null, enemy: {} };
    tune.player = resolveOne({ "": g[""], scoped: over.player || {} }, null);
    for (var d = 1; d <= 9; d++) {
      var ty = ENEMY_TYPES[d];
      if (!ty) continue;
      tune.enemy[d] = resolveOne({ "": g[""], scoped: over["enemy" + d] || {} }, ty);
      tune.enemy[d].name = ty.name; tune.enemy[d].art = ty.art; tune.enemy[d].stub = !!ty.stub;
    }
    return tune;
  }
  /* which tune object governs this tank */
  function tuneFor(level, tank) {
    if (tank.seat != null) return level.tune.player;
    return level.tune.enemy[tank.type] || level.tune.global;
  }

  function parseLevel(src) {
    var name = "", tier = 0, theme = "cork", rows = [], inGrid = false, inTune = false;
    var over = {}, tuneBad = [];
    String(src).split(/\r?\n/).forEach(function (raw) {
      var line = raw.replace(/\s+$/, "");
      if (inGrid) { if (line.length) rows.push(line); return; }
      var t = line.trim();
      if (!t) return;
      if (t === "grid") { inGrid = true; inTune = false; return; }
      if (t === "tune") { inTune = true; return; }
      if (inTune) {
        var tm = t.match(/^(\S+)\s+(\S+)$/);
        if (!tm) { tuneBad.push(t); return; }
        var k = tuneKey(tm[1]);
        if (!k) { tuneBad.push(tm[1]); return; }
        (over[k.scope] = over[k.scope] || {})[k.key] = +tm[2];
        return;
      }
      var m = t.match(/^(name|tier|theme)\s+(.*)$/);
      if (m) {
        if (m[1] === "name") name = m[2];
        else if (m[1] === "theme") theme = m[2].trim().toLowerCase();
        else tier = m[2] | 0;
      }
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
        else if (ch !== "." && ch !== "#" && ch !== "=" && ch !== "o")
          throw new Error("unknown cell '" + ch + "' at " + x + "," + y);
        out += ch;
      }
      cells.push(out);
    }
    /* `theme` is CARRIED, never interpreted. All rendering is
       client-side (docs/realtime.md) — the server does not know what a
       pixel is — so the engine's only job is to keep the name attached
       to the level it belongs to. An unknown theme is not an error: it
       falls back to cork at draw time, because a cosmetic name must
       never be able to fail a level that plays perfectly well. */
    return { name: name, tier: tier, theme: theme, w: w, h: h, cells: cells,
             spawns: spawns, enemies: enemies,
             tune: resolveTune(over), tuneBad: tuneBad };
  }

  function validateLevel(level) {
    var p = [];
    if (!level.spawns.length) p.push("no player spawn");
    if (!level.enemies.length) p.push("no enemies");
    level.enemies.forEach(function (e) {
      if (!ENEMY_TYPES[e.type]) p.push("unknown enemy type " + e.type);
    });
    (level.tuneBad || []).forEach(function (k) { p.push("unknown tune key '" + k + "'"); });
    // a spawn inside terrain is unrecoverable — the tank never moves
    level.spawns.concat(level.enemies).forEach(function (s, i) {
      if (solid(level, null, s.x | 0, s.y | 0)) p.push("spawn " + i + " inside terrain");
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
          // holes stop a tank as surely as a wall, so they gate reachability
          if (level.cells[ny][nx] === "#" || level.cells[ny][nx] === "o") return;
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
  /* TWO solidity tests, and the split is the whole point of the hole.
     A hole stops a tank but a shell flies straight over it, so "can I
     drive there" and "can I shoot there" stop being the same question
     — which is where level design past maze-building starts.
     `blocks` may be null when only the static map matters (validation,
     the designer): an unopened destructible block is solid. */
  function solid(level, blocks, tx, ty) {          // vs TANKS
    var ch = cellAt(level, tx, ty);
    if (ch === "#" || ch === "o") return true;
    if (ch === "=") return !blocks || blocks[ty * level.w + tx] === 1;
    return false;
  }
  function solidShell(level, blocks, tx, ty) {     // vs SHELLS — holes are open sky
    var ch = cellAt(level, tx, ty);
    if (ch === "#") return true;
    if (ch === "=") return !blocks || blocks[ty * level.w + tx] === 1;
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
  // straight line of sight, sampled — deterministic and plenty for AI.
  // SHELL solidity: an enemy can shoot you across a hole it cannot cross.
  function los(level, blocks, x0, y0, x1, y1) {
    var dx = x1 - x0, dy = y1 - y0;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var steps = Math.max(1, Math.ceil(dist / 0.1));
    for (var i = 1; i < steps; i++) {
      var t = i / steps;
      if (solidShell(level, blocks, Math.floor(x0 + dx * t), Math.floor(y0 + dy * t))) return false;
    }
    return true;
  }

  /* ── movement (shared with the client's prediction — net.js calls
     this exact function on the vendored copy it loads) ───────────── */
  function moveTank(level, blocks, tanks, tank, drive) {
    if (!drive) return;
    tank.hull = drive;
    var tn = level.tune ? tuneFor(level, tank) : null;
    var sp = tn ? tn.speed : TANK_SPEED;
    var r = level.tune ? level.tune.global.tankR : TANK_R;
    if (!sp) return;                          // a bolted-down type still turns its turret
    var v = DIRS[drive];
    var nx = tank.x + v[0] * sp;
    var ny = tank.y + v[1] * sp;
    // axis-wise slide: try x, then y, each blocked by grid and by tanks
    if (boxFree(level, blocks, nx, tank.y, r) && !bumps(tanks, tank, nx, tank.y, r)) tank.x = nx;
    if (boxFree(level, blocks, tank.x, ny, r) && !bumps(tanks, tank, tank.x, ny, r)) tank.y = ny;
  }
  function bumps(tanks, self, x, y, r) {
    r = r || TANK_R;
    for (var i = 0; i < tanks.length; i++) {
      var o = tanks[i];
      if (o === self || !o.alive) continue;
      var dx = o.x - x, dy = o.y - y;
      if (dx * dx + dy * dy < (r * 2) * (r * 2) * 0.81) return true;
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
    if (!solidShell(level, blocks, tx, ty)) return null;
    if (cellAt(level, tx, ty) === "=" && blocks[ty * level.w + tx] === 1) return { block: [tx, ty] };
    // reflect: which axis did we cross into the tile on?
    var px = b.x - b.vx, py = b.y - b.vy;
    var hitX = solidShell(level, blocks, tx, Math.floor(py));
    var hitY = solidShell(level, blocks, Math.floor(px), ty);
    // the shell carries its OWN bounce budget (mb), stamped at fire time
    // from the shooter's tune — a Banker's shell must survive the two
    // ricochets its aimSolve planned through
    var maxB = b.mb != null ? b.mb : (level.tune ? level.tune.global.bounces : MAX_BOUNCE);
    if (b.bounces >= maxB) return "gone";
    b.bounces++;
    if (hitX || (!hitX && !hitY)) { b.vx = -b.vx; b.x = px + b.vx; }
    if (hitY || (!hitX && !hitY)) { b.vy = -b.vy; b.y = py + b.vy; }
    return null;
  }

  /* ═══ aimSolve — the shot that reaches `target` ═════════════════
     Returns an ANGLE within `bounces` ricochets, or null.

     The direct line is a cheap analytic test. The bank shot is not:
     the arena is an arbitrary grid, not a billiard rectangle, so the
     mirror trick does not apply. Instead the search SAMPLES headings
     and flies each one with the real `stepBullet`.

     That is the important property, not an implementation detail: the
     plan and the shell are the same physics BY CONSTRUCTION. A planner
     with its own approximate ricochet model drifts from the shell it
     is aiming, and every drift is a bank shot that misses for a reason
     nothing in the code models. Here, if the search says it hits, the
     shell hits — the only gap left is `aimErr`, which is deliberate.

     Cost is the reason it is throttled at the call site: a full sweep
     is AIM_SAMPLES traces, and most die within a few tiles. See
     "the solve budget" in the brain below. */
  var AIM_SAMPLES = 48;          // coarse headings per sweep
  var AIM_REFINE = 14;           // ternary-search passes inside a corridor
  var AIM_CORRIDORS = 3;         // how many coarse candidates get refined
  var AIM_FLIGHT = 150;          // ticks a candidate is followed (2.5 s)
  var AIM_HIT = 0.42;            // tiles — "this shell arrives at the target"

  /* How close this heading's shell ever gets to `target`. Infinity if
     it would strike a fellow enemy on the way: they cancel each
     other's shells, and a firing squad shooting itself in the back
     reads as broken rather than as difficulty. */
  function approach(state, from, angle, target) {
    var level = state.level, blocks = state.blocks;
    var tn = tuneFor(level, from);
    var b = {
      x: from.x + Math.cos(angle) * MUZZLE,
      y: from.y + Math.sin(angle) * MUZZLE,
      vx: Math.cos(angle) * tn.bulletSpeed,
      vy: Math.sin(angle) * tn.bulletSpeed,
      bounces: 0, mb: tn.bounces
    };
    var best = Infinity;
    for (var i = 0; i < AIM_FLIGHT; i++) {
      if (stepBullet(level, blocks, b)) break;              // died
      for (var t = 0; t < state.tanks.length; t++) {
        var o = state.tanks[t];
        if (!o.alive || o === from || o.seat != null) continue;
        var ox = b.x - o.x, oy = b.y - o.y;
        if (ox * ox + oy * oy <= AIM_HIT * AIM_HIT) return Infinity;
      }
      var dx = b.x - target.x, dy = b.y - target.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d < best) best = d;
      if (d <= AIM_HIT) break;
    }
    return best;
  }
  function traceShot(state, from, angle, target) {
    return approach(state, from, angle, target) <= AIM_HIT;
  }
  /* Ternary search inside one bounce corridor, where closest-approach
     is unimodal. Deterministic: fixed iteration count, no early exit
     on a floating comparison that could differ between machines. */
  function refineAim(state, from, target, a, w) {
    var lo = a - w, hi = a + w;
    for (var i = 0; i < AIM_REFINE; i++) {
      var m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
      if (approach(state, from, m1, target) <= approach(state, from, m2, target)) hi = m2;
      else lo = m1;
    }
    var mid = (lo + hi) / 2;
    return { a: mid, d: approach(state, from, mid, target) };
  }

  function aimSolve(state, from, target, bounces) {
    var direct = Math.atan2(target.y - from.y, target.x - from.x);
    if (los(state.level, state.blocks, from.x, from.y, target.x, target.y)) return direct;
    if (!bounces) return null;

    /* COARSE SWEEP then LOCAL REFINE, and the two-phase shape is not
       optional: a bare sweep fine enough to land inside AIM_HIT at
       range would need well over a thousand traces (48 headings is
       7.5°, which is more than a tile of miss ten tiles out). So the
       sweep only has to find the right CORRIDOR — scored by CLOSEST
       APPROACH rather than hit/miss — and a search walks it in.

       Two things this got wrong first time round, both worth keeping
       written down:

       - Refining by stepping ±w and halving is a hill-climb, and the
         landscape is NOT smooth: it is piecewise, one continuous
         corridor per sequence of walls the shell bounces off, with
         cliffs between them. Ternary search INSIDE one corridor is
         well behaved; hill-climbing across them stalls on a cliff.
       - Refining only the single best coarse sample assumes the
         coarse winner is in the winning corridor. It often is not —
         a blocked direct path can score a deceptively small closest
         approach. So the best few are each refined, and the first
         that actually connects wins.

       The sweep runs OUTWARD from the direct heading, so among equally
       good banks the one closest to facing the player is preferred:
       the most readable shot, and a deterministic tie-break. */
    var stepA = 2 * Math.PI / AIM_SAMPLES;
    var cand = [];
    for (var i = 1; i <= AIM_SAMPLES; i++) {
      var k = (i % 2 ? 1 : -1) * Math.ceil(i / 2);
      var a = direct + k * stepA;
      cand.push({ a: a, d: approach(state, from, a, target), i: i });
    }
    // the most promising corridors, then back into outward order so the
    // tie-break survives the ranking
    var top = cand.slice().sort(function (p, q) { return p.d - q.d || p.i - q.i; })
                  .slice(0, AIM_CORRIDORS)
                  .sort(function (p, q) { return p.i - q.i; });
    for (var c = 0; c < top.length; c++) {
      if (top[c].d === Infinity) continue;                  // friendly in the way
      var got = refineAim(state, from, target, top[c].a, stepA);
      if (got.d <= AIM_HIT) return got.a;
    }
    return null;
  }

  /* ═══ THE ENEMY BRAIN ═══════════════════════════════════════════
     Lives here and nowhere else (docs/games.md): never in a mock,
     never in a worker's index.js, so the two cannot drift. Everything
     below is deterministic — `prngNext(g)` is the only randomness and
     the tick is the only clock — because the client re-runs this exact
     code to predict, and a brain that consulted Math.random() would
     desync every enemy on screen.

     Four behaviours, gated by the type's tune so a level can dial any
     of them (docs/tanks.md, "Tuning"):

       aim + fire   everyone            bounceDepth picks direct or bank
       drive        speed > 0           range-keeping, not pathfinding
       evade        evade = 1           sidestep a shell already in flight
       mines        mines > 0           dropped behind while moving

     THE SOLVE BUDGET. A bank search is AIM_SAMPLES traces, so it is
     not run per tick. It runs only when the tank could actually shoot
     (cooldown clear, a shell spare) and at most every SOLVE_EVERY
     ticks, staggered by the tank's own index so a room full of Bankers
     never all solve on the same tick. Between solves the turret turns
     toward the angle it last found, which is also what makes a bank
     shot READABLE: the barrel visibly swings off-player before it
     fires. Worth profiling once with a room full of type 7s. */
  var SOLVE_EVERY = 12;          // ticks between bank searches, per tank
  var LOSE_AIM = 90;             // ticks a stale solution stays worth turning to
  var RANGE_NEAR = 3.6;          // closer than this, back off
  var RANGE_FAR = 8.0;           // farther than this, close in
  var LEG_MIN = 24, LEG_VAR = 48; // ticks a heading is committed to
  var EVADE_LOOK = 5.0;          // tiles ahead of a shell we care about
  var EVADE_WIDE = 0.85;         // tiles off its line that counts as incoming
  var EVADE_HOLD = 22;           // ticks a dodge overrides normal driving
  var MINE_CHANCE = 0.012;       // per moving tick, when the type lays them

  function nearestPlayer(g, tk) {
    var best = null, bd = Infinity;
    for (var i = 0; i < g.tanks.length; i++) {
      var p = g.tanks[i];
      if (p.seat == null || !p.alive) continue;
      var dx = p.x - tk.x, dy = p.y - tk.y, d2 = dx * dx + dy * dy;
      if (d2 < bd) { bd = d2; best = p; }
    }
    return best;
  }
  // nearest of the 8 hull facings to a vector
  function dirOf(x, y) {
    var best = 1, bs = -Infinity, len = Math.sqrt(x * x + y * y) || 1;
    for (var d = 1; d <= 8; d++) {
      var s = (DIRS[d][0] * x + DIRS[d][1] * y) / len;
      if (s > bs) { bs = s; best = d; }
    }
    return best;
  }
  // could this tank take one step that way?
  function canStep(g, tk, d) {
    var tn = tuneFor(g.level, tk), r = g.level.tune.global.tankR;
    var nx = tk.x + DIRS[d][0] * tn.speed, ny = tk.y + DIRS[d][1] * tn.speed;
    return boxFree(g.level, g.blocks, nx, ny, r) && !bumps(g.tanks, tk, nx, ny, r);
  }

  /* A shell already in flight that will pass close. Returns a heading
     STEPPING OFF ITS LINE — perpendicular, toward the side we are
     already on, so the dodge is the short way out rather than a dive
     across the shell's path. */
  function dodge(g, tk) {
    for (var i = 0; i < g.bullets.length; i++) {
      var b = g.bullets[i];
      if (b.owner === tk.id) continue;
      var sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
      if (!sp) continue;
      var ux = b.vx / sp, uy = b.vy / sp;
      var rx = tk.x - b.x, ry = tk.y - b.y;
      var along = rx * ux + ry * uy;              // distance ahead of the shell
      if (along <= 0 || along > EVADE_LOOK) continue;
      var side = rx * uy - ry * ux;               // signed miss distance
      if (Math.abs(side) > EVADE_WIDE) continue;
      var s = side >= 0 ? 1 : -1;
      return dirOf(-uy * s, ux * s);
    }
    return 0;
  }

  /* Range-keeping, not pathfinding. Score the 8 facings by whether
     they take us toward the band we want to fight from, add a little
     seeded jitter so two of the same type do not move in lockstep, and
     favour the current heading so the hull does not twitch. Deliberate
     non-goal: no A*, no flow field. A tank that solves the maze reads
     as a hunter, and Wii Play's do not hunt — they mill about and
     shoot, and that is the feel being copied. */
  function chooseHeading(g, tk, target) {
    var dx = 0, dy = 0, dist = 0;
    if (target) {
      dx = target.x - tk.x; dy = target.y - tk.y;
      dist = Math.sqrt(dx * dx + dy * dy) || 1;
    }
    var want = 0;
    if (target) want = dist > RANGE_FAR ? 1 : (dist < RANGE_NEAR ? -1 : 0);
    var best = 0, bs = -Infinity;
    for (var d = 1; d <= 8; d++) {
      if (!canStep(g, tk, d)) continue;
      var toward = dist ? (DIRS[d][0] * dx + DIRS[d][1] * dy) / dist : 0;
      var s;
      if (want > 0) s = toward;
      else if (want < 0) s = -toward;
      else s = 1 - Math.abs(toward);              // hold the band: strafe
      s += prngNext(g) * 0.35;
      if (d === tk.dr) s += 0.15;
      if (s > bs) { bs = s; best = d; }
    }
    return best;
  }

  function driveEnemy(g, tk, ty, target, events) {
    if (!ty.speed) return;
    if (ty.evade && tk.evadeT <= 0) {
      var e = dodge(g, tk);
      if (e) { tk.dr = e; tk.drT = EVADE_HOLD; tk.evadeT = EVADE_HOLD; }
    }
    if (tk.evadeT > 0) tk.evadeT--;
    if (tk.drT > 0) tk.drT--;
    if (!tk.dr || tk.drT <= 0) {
      tk.dr = chooseHeading(g, tk, target);
      tk.drT = LEG_MIN + Math.floor(prngNext(g) * LEG_VAR);
    }
    var px = tk.x, py = tk.y;
    moveTank(g.level, g.blocks, g.tanks, tk, tk.dr);
    // wedged against something: repick next tick rather than grind
    if (tk.x === px && tk.y === py) { tk.drT = 0; return; }
    if (ty.mines && tk.mines > 0 && tk.mineCd === 0 && prngNext(g) < MINE_CHANCE) {
      tk.mines--; tk.mineCd = MINE_CD;
      var m = { id: "m" + g.tick + "-" + tk.id, owner: tk.id, x: px, y: py, born: g.tick };
      g.mines.push(m);
      events.push({ t: "mine", id: m.id, x: m.x, y: m.y, born: m.born, seat: null });
    }
  }

  function thinkEnemy(g, tk, events) {
    var ty = g.level.tune.enemy[tk.type] || g.level.tune.global;
    if (tk.cooldown > 0) tk.cooldown--;
    if (tk.mineCd > 0) tk.mineCd--;
    var target = nearestPlayer(g, tk);
    driveEnemy(g, tk, ty, target, events);
    if (!target) { tk.seenAt = 0; return; }

    /* the solve, throttled and staggered (see "the solve budget").
       `seenAt` is the TICK acquisition began, not a count of solves —
       reaction is a duration, and counting solves would have silently
       multiplied every reaction time by SOLVE_EVERY. */
    var armed = tk.cooldown === 0 && liveShells(g, tk.id) < ty.maxShells;
    var due = (g.tick + tk.stagger) % SOLVE_EVERY === 0;
    if (armed && due) {
      var a = aimSolve(g, tk, target, ty.bounceDepth);
      if (a == null) { tk.goal = null; tk.seenAt = 0; }
      else {
        if (!tk.seenAt) tk.seenAt = g.tick;      // first sight this pass
        tk.goal = a; tk.goalAt = g.tick;
      }
    } else if (tk.goal != null && g.tick - tk.goalAt > LOSE_AIM) {
      tk.goal = null; tk.seenAt = 0;
    }

    /* Turn toward the SOLVED angle, not the player. Aiming at the
       player and merely gating on the solve was the original bug: a
       bank-shot type would line up on a target behind a wall and fire
       straight into it. */
    var want = tk.goal != null ? tk.goal
             : Math.atan2(target.y - tk.y, target.x - tk.x);
    var diff = want - tk.turret;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    tk.turret += Math.max(-ty.turnRate, Math.min(ty.turnRate, diff));

    if (tk.goal == null || !armed) return;
    if (Math.abs(diff) >= AIM_ALIGN) return;         // still swinging
    if (g.tick - tk.seenAt < ty.reaction) return;    // reaction time
    var err = (prngNext(g) - 0.5) * 2 * ty.aimErr;
    fireShell(g, tk, tk.turret + err, events);
    tk.cooldown = ty.cooldown + Math.floor(prngNext(g) * 30);
    tk.goal = null; tk.seenAt = 0;   // re-acquire before the next shot
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
        alive: g.lives[s] > 0, cooldown: 0, mineCd: 0, mines: level.tune.player.mines
      });
    }
    level.enemies.forEach(function (e, i) {
      var ty = level.tune.enemy[e.type] || level.tune.global;
      g.tanks.push({
        id: "e" + i, seat: null, type: e.type,
        x: e.x, y: e.y, hull: 5, turret: dirAngle(5),
        alive: true, cooldown: ty.cooldown, mineCd: 0, mines: ty.mines,
        // brain state. `stagger` spreads the bank searches across ticks
        // so a room full of Bankers never all solve on the same one.
        dr: 0, drT: 0, evadeT: 0, seenAt: 0, goal: null, goalAt: 0,
        stagger: i % SOLVE_EVERY
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
    var blast = g.level.tune.global.mineBlast;
    g.tanks.forEach(function (tk) {
      if (!tk.alive) return;
      var dx = tk.x - m.x, dy = tk.y - m.y;
      if (dx * dx + dy * dy <= blast * blast) killTank(g, tk, m.owner, events);
    });
    for (var y = 0; y < g.level.h; y++) {
      for (var x = 0; x < g.level.w; x++) {
        if (g.level.cells[y][x] !== "=" || g.blocks[y * g.level.w + x] !== 1) continue;
        var ddx = x + 0.5 - m.x, ddy = y + 0.5 - m.y;
        if (ddx * ddx + ddy * ddy <= blast * blast) {
          g.blocks[y * g.level.w + x] = 0;
          events.push({ t: "block", x: x, y: y });
        }
      }
    }
  }

  function fireShell(g, tank, angle, events) {
    var tn = tuneFor(g.level, tank);
    var b = {
      id: "b" + g.tick + "-" + tank.id,
      owner: tank.id, ownerSeat: tank.seat,
      x: tank.x + Math.cos(angle) * MUZZLE,
      y: tank.y + Math.sin(angle) * MUZZLE,
      vx: Math.cos(angle) * tn.bulletSpeed,
      vy: Math.sin(angle) * tn.bulletSpeed,
      bounces: 0, mb: tn.bounces, born: g.tick
    };
    g.bullets.push(b);
    tank.cooldown = tn.cooldown;
    // the ONE broadcast a shell ever gets — clients fly it from here, so
    // `mb` has to ride it or a client's copy dies a bounce early
    events.push({ t: "fire", id: b.id, owner: b.owner, seat: tank.seat,
                  x: b.x, y: b.y, vx: b.vx, vy: b.vy, mb: b.mb, tick: g.tick });
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
      var ptn = g.level.tune.player;
      if (inp.a != null) tk.turret = inp.a;
      moveTank(g.level, g.blocks, g.tanks, tk, inp.d | 0);
      if (inp.f && tk.cooldown === 0 && liveShells(g, tk.id) < ptn.maxShells) {
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
      thinkEnemy(g, tk, events);
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
    var gt = g.level.tune.global;
    for (var mi = g.mines.length - 1; mi >= 0; mi--) {
      var m = g.mines[mi], go = false;
      var age = g.tick - m.born;
      if (age >= gt.mineFuse) go = true;
      if (!go && age >= gt.mineArm) {
        for (var ki = 0; ki < g.tanks.length; ki++) {
          var kt = g.tanks[ki];
          if (!kt.alive || kt.id === m.owner) continue;
          var mx = kt.x - m.x, my = kt.y - m.y;
          if (mx * mx + my * my <= gt.mineTrig * gt.mineTrig) { go = true; break; }
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
    /* the tuning surface. designer.html builds its whole panel from
       TUNE_SPEC — adding a knob there adds it to the UI, the parser
       and the validator at once, with no second edit anywhere. */
    TUNE_SPEC: TUNE_SPEC, tuneKey: tuneKey, clampTune: clampTune,
    resolveTune: resolveTune, tuneFor: tuneFor,
    parseLevel: parseLevel, validateLevel: validateLevel,
    cellAt: cellAt, solid: solid, solidShell: solidShell, los: los,
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

    /* ── holes: tanks stop, shells fly over ─────────────────────── */
    var HOLE = ["grid",
      "##########",
      "#P.......#",
      "#..oooo..#",
      "#........#",
      "#P......1#",
      "##########"].join("\n");
    var hl = parseLevel(HOLE);
    var hb = [];
    for (var hy = 0; hy < hl.h; hy++) for (var hx = 0; hx < hl.w; hx++) hb.push(0);
    ok(solid(hl, hb, 3, 2) === true, "hole is solid to tanks");
    ok(solidShell(hl, hb, 3, 2) === false, "hole is open to shells");
    ok(los(hl, hb, 1.5, 2.5, 8.5, 2.5) === true, "line of sight crosses a hole");
    var hTank = { x: 2.5, y: 2.5, hull: 1, alive: true, id: "t", seat: 0 };
    moveTank(hl, hb, [hTank], hTank, 3);            // drive east, into the hole
    ok(hTank.x < 2.7, "tank cannot drive into a hole");
    var hShell = { x: 2.5, y: 2.5, vx: 0.08, vy: 0, bounces: 0, mb: 1 };
    ok(stepBullet(hl, hb, hShell) === null && hShell.x > 2.5, "shell crosses a hole");
    // a hole walling a spawn off must fail reachability
    var walled = parseLevel(["grid",
      "##########", "#P..o...1#", "#...o....#", "#P..o....#", "##########"].join("\n"));
    ok(validateLevel(walled).some(function (x) { return x.indexOf("unreachable") >= 0; }),
       "hole blocks reachability");

    /* ── the tune block ─────────────────────────────────────────── */
    var TUNED = ["tune",
      "  bulletSpeed 9",
      "  player.mines 6",
      "  enemy1.bounceDepth 2",
      "grid",
      "##########", "#P.......#", "#P......1#", "##########"].join("\n");
    var tl = parseLevel(TUNED);
    ok(Math.abs(tl.tune.global.bulletSpeed - 9 / TICK_HZ) < 1e-9, "global tune reaches the engine");
    ok(tl.tune.player.mines === 6, "player-scoped tune overrides");
    ok(tl.tune.enemy[1].bounceDepth === 2, "enemy-scoped tune overrides");
    ok(Math.abs(tl.tune.enemy[1].bulletSpeed - 9 / TICK_HZ) < 1e-9, "enemy inherits the global tune");
    ok(tl.tune.player.speed === TUNE_SPEC.speed[0] / TICK_HZ, "untouched keys keep the default");
    ok(tl.tune.enemy[1].speed === 0, "an enemy TYPE still beats the default");
    ok(validateLevel(tl).length === 0, "a tuned level validates clean");
    // clamps, and the tunnelling ceiling in particular
    var CL = parseLevel("tune\n  bulletSpeed 9999\n  speed -5\ngrid\n####\n#P1#\n####");
    ok(CL.tune.global.bulletSpeed === TUNE_SPEC.bulletSpeed[2] / TICK_HZ, "bulletSpeed clamps at the ceiling");
    ok(CL.tune.global.bulletSpeed < 0.5, "the ceiling is below the tunnelling threshold");
    ok(CL.tune.global.speed === 0, "speed clamps at the floor");
    // a bad key is reported, never silently swallowed
    var BAD = parseLevel("tune\n  nonsense 3\n  player.turnRate 2\ngrid\n####\n#P1#\n####");
    ok(BAD.tuneBad.length === 2, "unknown and mis-scoped tune keys are collected");
    ok(validateLevel(BAD).some(function (x) { return x.indexOf("unknown tune key") >= 0; }),
       "bad tune keys fail validation");
    ok(tuneKey("enemy3.evade") && !tuneKey("enemy3.tankR"), "global keys refuse a scope");

    // fireRate resolves to a cooldown, and the shell carries its budget
    var FR = parseLevel("tune\n  player.fireRate 4\n  player.bounces 3\ngrid\n####\n#P1#\n####");
    ok(FR.tune.player.cooldown === 15, "fireRate 4/s -> 15 tick cooldown");
    ok(FR.tune.player.bounces === 3, "player bounce budget");

    /* ── per-level art theme: carried, never interpreted ───────── */
    var PLAIN = ["grid", "####", "#P1#", "####"].join("\n");
    var TH = parseLevel(["name  Snowfield", "theme  Snow ", PLAIN].join("\n"));
    ok(TH.theme === "snow", "theme is parsed and normalised");
    ok(parseLevel(PLAIN).theme === "cork", "theme defaults to cork");
    ok(validateLevel(parseLevel("theme nonesuch\n" + PLAIN)).length === 0,
       "an unknown theme never fails validation — art is cosmetic");

    /* ══ THE ENEMY BRAIN ══════════════════════════════════════════ */
    function arena(rows, tune) {
      return (tune ? "tune\n" + tune + "\n" : "") + "grid\n" + rows.join("\n");
    }
    function run(src, ticks, inputs) {
      var gg = createGame({ levels: [src], seats: 1,
        settings: { lives: 3, aimLine: true, friendlyFire: false }, seed: 7 }, CTX);
      delete gg._boot;
      var evs = [];
      for (var t = 0; t < ticks; t++) evs = evs.concat(step(gg, inputs || {}));
      return { g: gg, ev: evs };
    }
    function foes(gg) { return gg.tanks.filter(function (t) { return t.seat == null; }); }

    // every type in the registry has behaviour now — nothing is a stub
    ok(Object.keys(ENEMY_TYPES).length === 7, "seven enemy types");
    ok(!Object.keys(ENEMY_TYPES).some(function (d) { return ENEMY_TYPES[d].stub; }),
       "no type is still a stub");
    ok(Object.keys(ENEMY_TYPES).every(function (d) { return ENEMY_TYPES[d].name && ENEMY_TYPES[d].art; }),
       "every type carries a name and livery for the designer");

    // AIMING: a Sentry with line of sight shoots the player
    var OPEN = ["############", "#P.........#", "#..........#",
                "#.........1#", "############"];
    var r1 = run(arena(OPEN), 400);
    ok(r1.ev.some(function (e) { return e.t === "fire" && e.seat == null; }),
       "an enemy with line of sight fires");

    // ...and does NOT, when it has no shot and cannot bank (bounceDepth 0)
    var WALLED = ["############", "#P...#.....#", "#....#.....#",
                  "#....#....1#", "############"];
    var r2 = run(arena(WALLED, "  enemy1.reaction 0.1"), 400);
    ok(!r2.ev.some(function (e) { return e.t === "fire"; }),
       "a direct-only enemy behind a wall holds fire");

    /* BANK SHOTS. This geometry is not hand-waved: a 0.1° sweep over
       every blocked shooter/target pair in this room proves 2314 of
       them admit a one-bounce hit, and this is one. (A full-height
       divider admits NONE, which is how the first draft of this check
       managed to fail for a reason that had nothing to do with the
       planner — worth remembering before trusting a hand-drawn test
       arena again.) */
    var BANK = ["################", "#2.............#", "#..............#",
                "#..............#", "#.....####P....#", "#..............#",
                "#..............#", "#..............#", "################"];
    var r3 = run(arena(BANK, "  enemy2.speed 0\n  enemy2.reaction 0.1"), 500);
    ok(r3.ev.some(function (e) { return e.t === "fire"; }),
       "a bank-shot enemy DOES fire at a target behind a wall");
    // and it aims off-player to do it — the bug this replaced fired straight in
    var bshot = r3.ev.filter(function (e) { return e.t === "fire"; })[0];
    var f3 = foes(r3.g)[0];
    var directA = Math.atan2(r3.g.tanks[0].y - f3.y, r3.g.tanks[0].x - f3.x);
    var shotA = Math.atan2(bshot.vy, bshot.vx);
    var off = Math.abs(((shotA - directA + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    ok(off > 0.15, "the bank shot is aimed away from the direct line");

    // aimSolve is honest: what it plans, the real stepBullet delivers
    var solveLv = parseLevel(arena(BANK));
    var sBlocks = [];
    for (var sy = 0; sy < solveLv.h; sy++)
      for (var sx = 0; sx < solveLv.w; sx++)
        sBlocks.push(solveLv.cells[sy][sx] === "=" ? 1 : 0);
    var shooter = { x: 1.5, y: 1.5, seat: null, type: 2, alive: true, id: "s" };
    var mark = { x: 10.5, y: 4.5 };
    var sState = { level: solveLv, blocks: sBlocks, tanks: [shooter] };
    var solved = aimSolve(sState, shooter, mark, 2);
    ok(solved != null, "aimSolve finds a bank around a wall");
    ok(traceShot(sState, shooter, solved, mark),
       "the angle aimSolve returns actually reaches the target");
    ok(aimSolve(sState, shooter, mark, 0) == null, "bounceDepth 0 refuses the same shot");

    // DRIVING: a mobile type leaves its spawn, a bolted-down one never does
    var ROOM = ["##############", "#P...........#", "#............#",
                "#............#", "#...........4#", "##############"];
    var r4 = run(arena(ROOM), 240);
    var m4 = foes(r4.g)[0];
    ok(Math.abs(m4.x - 12.5) + Math.abs(m4.y - 4.5) > 1, "a mobile enemy drives");
    ok(m4.x > 0 && m4.x < 14 && m4.y > 0 && m4.y < 6, "and stays inside the arena");
    var r5 = run(arena(ROOM.map(function (r) { return r.replace("4", "1"); })), 240);
    var m5 = foes(r5.g)[0];
    ok(m5.x === 12.5 && m5.y === 4.5, "a speed-0 enemy never moves");

    // it must not drive into a hole either
    var PIT = ["##############", "#P...........#", "#.....oooooo.#",
               "#.....oooooo.#", "#..........4.#", "##############"];
    var r6 = run(arena(PIT), 600);
    var m6 = foes(r6.g)[0];
    ok(!solid(r6.g.level, r6.g.blocks, m6.x | 0, m6.y | 0), "a driving enemy never ends up in a hole");

    // MINES: a type that lays them does, one that doesn't never does
    var r7 = run(arena(ROOM), 900);
    ok(r7.ev.some(function (e) { return e.t === "mine" && e.seat == null; }),
       "a mine-laying type drops mines");
    ok(!r5.ev.some(function (e) { return e.t === "mine"; }),
       "a type with mines 0 never drops one");
    var laid = r7.ev.filter(function (e) { return e.t === "mine"; }).length;
    ok(laid <= ENEMY_TYPES[4].mines, "it never lays more than its allowance");

    // EVASION: a Duelist steps off the line of an incoming shell
    var DUEL = ["##############", "#P..........5#", "#............#", "##############"];
    var dg = createGame({ levels: [arena(DUEL, "  enemy5.fireRate 0.1")], seats: 1,
      settings: { lives: 3, aimLine: true, friendlyFire: false }, seed: 3 }, CTX);
    delete dg._boot;
    var duelist = foes(dg)[0];
    var y0 = duelist.y;
    // a shell straight down the row it is sitting in
    dg.bullets.push({ id: "inc", owner: "p0", ownerSeat: 0,
                      x: 3, y: y0, vx: 0.12, vy: 0, bounces: 0, mb: 1, born: 0 });
    for (var dt = 0; dt < 40; dt++) step(dg, {});
    ok(Math.abs(duelist.y - y0) > 0.2, "an evading type leaves the shell's line");

    // DETERMINISM: same seed, same everything — the client re-runs this
    var a1 = run(arena(ROOM), 300).g, a2 = run(arena(ROOM), 300).g;
    ok(JSON.stringify(snapshot(a1)) === JSON.stringify(snapshot(a2)),
       "the whole brain is deterministic under a fixed seed");
    ok(!/Math\.random|Date\.now/.test(String(thinkEnemy) + String(driveEnemy) +
                                      String(chooseHeading) + String(dodge) + String(aimSolve)),
       "no brain function reaches for a wall clock or Math.random");

    // TUNING still governs the brain: a level can defang a type
    var soft = run(arena(OPEN, "  enemy1.reaction 3\n  enemy1.aimErr 0"), 150);
    ok(!soft.ev.some(function (e) { return e.t === "fire"; }),
       "a level can slow a type's reaction until it holds fire");

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
