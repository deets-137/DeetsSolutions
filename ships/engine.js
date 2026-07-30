/* DeetsShips — rules engine (docs/ships.md).

   PURE, environment-agnostic module: state + action → new state + events. No
   DOM, no I/O, no Date.now — the caller passes time and randomness in via
   `ctx = { rand, now }` (rand() → [0,1), like Math.random). applyAction never
   mutates its input; it clones, mutates the clone, and returns it.

     createGame(opts, ctx)            → game   (phase "draft" — turn 0)
     applyAction(game, action, ctx)   → { game, events } | { error: {code} }

   Moving-ship Battleship on one shared 20×20 fogged ocean, two teams of
   1–4 seats. The spine is SIMULTANEOUS COMMIT (docs/ships.md, "The
   resolution model"): within a phase every seat stages plans for its own
   ships (`stage` marks the seat ready, `unstage` retracts), the captain
   `commit`s the team, and when both teams are in the phase resolves at
   once. Rounds run MOVE then ACTION; the draft is turn 0 and nobody fires
   on the round they place.

   The engine also owns the TEAM VIEW builders (teamView / spectatorView),
   because the worker and the mock must scrub hidden information
   identically: ship positions, weapon sections, staged plans, sonar
   results and the calendar all ride a team's `you` and nothing else.

   Illegal actions return a typed error and change nothing. Every rule is
   enforced here (the client's lit tiles are cosmetic). The worker repo
   (../DeetsShips) carries a VERBATIM vendored copy — this file and its
   copy are contract, exactly like the cities and mahjong engines.

   Browser: window.ShipsEngine. Node (self-checks): module.exports, and
   `node ships/engine.js` runs selfTest(). */
(function () {
  "use strict";

  /* ── the board ─────────────────────────────────────────────────── */
  var BOARD = 20;                      // 20×20, one shared ocean
  var BAND = 5;                        // home bands: cols 0–4 and 15–19
  var REVEAL_RANGE = 8;                // the single reveal threshold
  var SWEEP = 2;                       // sonar: 5×5 → ±2 around the mount

  /* ── the fleet ─────────────────────────────────────────────────── */
  var CLASSES = {
    carrier:    { len: 5, move: 5, agile: false, attack: "plane" },
    battleship: { len: 4, move: 5, agile: false, attack: "line", range: 15 },
    destroyer:  { len: 3, move: 5, agile: false, attack: "missile", range: 10 },
    submarine:  { len: 3, move: 7, agile: true,  attack: "missile", range: 10, special: "sonar" },
    cruiser:    { len: 2, move: 7, agile: true,  attack: "line", range: 5, special: "move" },
  };
  var CLASS_LIST = ["carrier", "battleship", "destroyer", "submarine", "cruiser"];
  // ships per TEAM by seats-per-team (docs/ships.md, "Table shape")
  var FLEET_BY_SIZE = { 1: 3, 2: 4, 3: 3, 4: 4 };

  /* ── small helpers ─────────────────────────────────────────────── */
  var DIRS = [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }];
  var DIR8 = ["n", "ne", "e", "se", "s", "sw", "w", "nw"];
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function key(x, y) { return x + "," + y; }
  function inBounds(x, y) { return x >= 0 && x < BOARD && y >= 0 && y < BOARD; }
  function cheb(ax, ay, bx, by) { return Math.max(Math.abs(ax - bx), Math.abs(ay - by)); }
  function randInt(ctx, n) { return Math.floor(ctx.rand() * n); }
  function perp(dir) { return [(dir + 1) % 4, (dir + 3) % 4]; }
  function err(code) { return { error: { code: code } }; }

  // hull tiles of a placement {x, y, dir, len}: index 0 at (x, y), running
  // along dir. Damage and the weapon section are bound to these indices.
  function tilesOf(p, len) {
    var n = len != null ? len : (p.len != null ? p.len : CLASSES[p.cls].len);
    var d = DIRS[p.dir], out = [];
    for (var i = 0; i < n; i++) out.push({ x: p.x + d.x * i, y: p.y + d.y * i });
    return out;
  }
  function placementOk(p, len) {
    return tilesOf(p, len).every(function (t) { return inBounds(t.x, t.y); });
  }
  function overlaps(tilesA, tilesB) {
    var set = {};
    tilesA.forEach(function (t) { set[key(t.x, t.y)] = 1; });
    return tilesB.some(function (t) { return set[key(t.x, t.y)]; });
  }
  // bearing anchor → target, rounded to 8 compass points (y+ is SOUTH)
  function dir8(ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    if (!dx && !dy) return "n";
    var ang = Math.atan2(dx, -dy);               // 0 = N, clockwise
    var oct = Math.round(ang / (Math.PI / 4));
    return DIR8[((oct % 8) + 8) % 8];
  }

  /* ── ship accessors ────────────────────────────────────────────── */
  function hits(ship) {
    var n = 0;
    for (var i = 0; i < ship.dmg.length; i++) if (ship.dmg[i]) n++;
    return n;
  }
  function moveBudget(ship) {
    return Math.max(0, CLASSES[ship.cls].move - 2 * hits(ship));
  }
  function mountTile(ship) { return tilesOf(ship)[ship.weapon]; }
  function disarmed(ship) { return !!ship.dmg[ship.weapon]; }
  function isSub(ship) { return ship.cls === "submarine"; }
  // live pivot indices: either end, plus the center on an odd hull —
  // a destroyed tile can no longer serve (docs/ships.md, "Damage")
  function livePivots(ship) {
    var len = CLASSES[ship.cls].len, out = [];
    [0, len - 1].forEach(function (i) { if (!ship.dmg[i]) out.push(i); });
    if (len % 2 === 1) {
      var c = (len - 1) / 2;
      if (!ship.dmg[c] && out.indexOf(c) < 0) out.push(c);
    }
    return out;
  }
  // turn the placement 90° about pivot index p: tile i moves from
  // pivot + dir·(i−p) to pivot + newDir·(i−p); indices (weapon, damage)
  // ride along untouched
  function turned(p, pivotIdx, newDir, len) {
    var piv = tilesOf(p, len)[pivotIdx], d = DIRS[newDir];
    return { x: piv.x - d.x * pivotIdx, y: piv.y - d.y * pivotIdx, dir: newDir };
  }

  /* ── movement legality (client highlighting = this, verbatim) ────
     Endpoints only — DESTINATION-ONLY collisions are the settled rule,
     so intermediate tiles are never checked. `avoid` is the list of
     same-layer footprints the mover's own team knows about (teammates'
     staged endpoints where staged, else their current hulls); enemy
     hulls are the server's business at resolve.
       big three: translate up to budget along the axis (either way),
                  OR turn about a live pivot (turning is free of budget —
                  an immobilised carrier can still turn);
       agile:     one optional turn anywhere in the sequence, costing 1;
                  slides split around it, total ≤ budget. */
  function legalEndpoints(ship, avoid) {
    var cls = CLASSES[ship.cls], len = cls.len, M = moveBudget(ship);
    var seen = {}, out = [];
    function consider(p) {
      var k = p.x + "," + p.y + "," + p.dir;
      if (seen[k]) return;
      seen[k] = 1;
      if (!placementOk(p, len)) return;
      var tl = tilesOf(p, len);
      for (var i = 0; i < avoid.length; i++) if (overlaps(tl, avoid[i])) return;
      out.push({ x: p.x, y: p.y, dir: p.dir });
    }
    function slides(p, budget, fn) {
      fn(p, budget);
      var d = DIRS[p.dir];
      for (var s = -1; s <= 1; s += 2) {
        for (var k = 1; k <= budget; k++) {
          fn({ x: p.x + d.x * k * s, y: p.y + d.y * k * s, dir: p.dir }, budget - k);
        }
      }
    }
    consider({ x: ship.x, y: ship.y, dir: ship.dir });   // holding still is legal
    if (!cls.agile) {
      slides({ x: ship.x, y: ship.y, dir: ship.dir }, M, function (p) { consider(p); });
      livePivots(ship).forEach(function (piv) {
        perp(ship.dir).forEach(function (nd) {
          consider(turned({ x: ship.x, y: ship.y, dir: ship.dir }, piv, nd, len));
        });
      });
      return out;
    }
    slides({ x: ship.x, y: ship.y, dir: ship.dir }, M, function (p, left) {
      consider(p);
      if (left < 1) return;                              // the turn costs 1
      livePivots(ship).forEach(function (piv) {
        perp(p.dir).forEach(function (nd) {
          var tp = turned(p, piv, nd, len);
          slides(tp, left - 1, function (q) { consider(q); });
        });
      });
    });
    return out;
  }
  function endpointLegal(ship, avoid, to) {
    return legalEndpoints(ship, avoid).some(function (p) {
      return p.x === to.x && p.y === to.y && p.dir === to.dir;
    });
  }

  /* ── fire geometry (docs/ships.md, "Where the gun sits") ────────
     The hull blocks its own fire: an end mount fires away along the axis
     plus both perpendiculars; an interior mount only perpendicular. */
  function fireDirs(ship) {
    var len = CLASSES[ship.cls].len, k = ship.weapon;
    var dirs = perp(ship.dir).slice();
    if (k === 0) dirs.push((ship.dir + 2) % 4);
    if (k === len - 1) dirs.push(ship.dir);
    return dirs;
  }
  function laneTiles(from, dir, range) {
    var d = DIRS[dir], out = [];
    for (var i = 1; i <= range; i++) {
      var x = from.x + d.x * i, y = from.y + d.y * i;
      if (!inBounds(x, y)) break;
      out.push({ x: x, y: y });
    }
    return out;
  }
  // the carrier's strike zone: 4 along the line of flight × 3 across it,
  // starting `dist` tiles out from the mount; off-board tiles drop out
  function planeZone(from, dir, dist) {
    var d = DIRS[dir], p = DIRS[perp(dir)[0]], out = [];
    for (var a = 0; a < 4; a++) {
      for (var b = -1; b <= 1; b++) {
        var x = from.x + d.x * (dist + a) + p.x * b;
        var y = from.y + d.y * (dist + a) + p.y * b;
        if (inBounds(x, y)) out.push({ x: x, y: y });
      }
    }
    return out;
  }
  function sweepTiles(from) {
    var out = [];
    for (var dx = -SWEEP; dx <= SWEEP; dx++) {
      for (var dy = -SWEEP; dy <= SWEEP; dy++) {
        var x = from.x + dx, y = from.y + dy;
        if (inBounds(x, y)) out.push({ x: x, y: y });
      }
    }
    return out;
  }
  function inHomeBand(team, tiles) {
    return tiles.every(function (t) {
      return team === 0 ? t.x < BAND : t.x >= BOARD - BAND;
    });
  }

  /* ── game creation ─────────────────────────────────────────────── */
  function createGame(opts, ctx) {
    var seats = (opts.seated || opts.seats).map(function (s) { return { team: s.team }; });
    var size = seats.length / 2;
    var st = opts.settings || {};
    var fleet = FLEET_BY_SIZE[size] || 3;
    return {
      phase: "draft",
      round: 0,
      size: size,
      fleetSize: fleet,
      perSeat: fleet / size,
      seats: seats,
      ships: {},
      nextShip: 0,
      staged: {},                       // seat -> { ready, plans }
      committed: [false, false],
      intel: [[], []],                  // live-board marks per team (one turn)
      history: [[], []],                // the calendar, per team
      wrecks: [],                       // public: sunk ships stay visible
      winner: null,                     // team index, or null (tie) once over
      seatStats: seats.map(function () { return { shots: 0, hits: 0, sunk: 0 }; }),
      stats: { turns: 0 },
      settings: {
        fleetPublic: st.fleetPublic !== false,
        lockCommit: !!st.lockCommit,
        timerDraft: st.timerDraft || 0,       // draft defaults untimed
        timerMove: st.timerMove || 0,
        timerAction: st.timerAction || 0,
      },
    };
  }
  function seatTeam(g, seat) { return g.seats[seat] ? g.seats[seat].team : null; }
  function teamSeats(g, team) {
    var out = [];
    g.seats.forEach(function (s, i) { if (s.team === team) out.push(i); });
    return out;
  }
  function teamShips(g, team, incSunk) {
    var out = [];
    Object.keys(g.ships).sort().forEach(function (id) {
      var s = g.ships[id];
      if (s.team === team && (incSunk || !s.sunk)) out.push(s);
    });
    return out;
  }
  function aliveCounts(g) {
    return [teamShips(g, 0).length, teamShips(g, 1).length];
  }

  /* ── occupancy ─────────────────────────────────────────────────── */
  // layer of a ship for collision/targeting: subs live on "sub" unless
  // surfaced (a per-action-phase flag the resolver sets), everything else
  // on "surface"
  function layerOf(ship, surfaced) {
    if (!isSub(ship)) return "surface";
    return (surfaced && surfaced[ship.id]) ? "surface" : "sub";
  }
  function footprints(g, filter) {
    var out = [];
    Object.keys(g.ships).sort().forEach(function (id) {
      var s = g.ships[id];
      if (s.sunk) return;
      if (filter && !filter(s)) return;
      out.push({ ship: s, tiles: tilesOf(s) });
    });
    return out;
  }
  // teammates' reference footprints for stage-time validation: a staged
  // endpoint where one exists, else the current hull — same layer only
  function avoidFor(g, ship) {
    var out = [];
    Object.keys(g.ships).sort().forEach(function (id) {
      var s = g.ships[id];
      if (s.sunk || s.id === ship.id || s.team !== ship.team) return;
      if (isSub(s) !== isSub(ship)) return;   // depth layers don't collide
      var st = g.staged[s.seat];
      var mv = st && st.plans && st.plans.moves && st.plans.moves[s.id];
      out.push(tilesOf({ x: mv ? mv.x : s.x, y: mv ? mv.y : s.y, dir: mv ? mv.dir : s.dir }, CLASSES[s.cls].len));
    });
    return out;
  }

  /* ── the draft (turn 0) ────────────────────────────────────────── */
  function teamClassesStaged(g, team, exceptSeat) {
    var used = {};
    teamSeats(g, team).forEach(function (seat) {
      if (seat === exceptSeat) return;
      var st = g.staged[seat];
      ((st && st.plans && st.plans.ships) || []).forEach(function (s) { used[s.cls] = 1; });
    });
    return used;
  }
  function validateDraft(g, seat, plans) {
    var team = seatTeam(g, seat);
    var list = plans && plans.ships;
    if (!Array.isArray(list) || list.length !== g.perSeat) return "plan";
    var used = teamClassesStaged(g, team, seat);
    var placed = [];
    for (var i = 0; i < list.length; i++) {
      var p = list[i];
      var cls = CLASSES[p.cls];
      if (!cls) return "plan";
      if (used[p.cls]) return "dupe";           // no duplicates within a team
      used[p.cls] = 1;
      if (p.dir == null || !DIRS[p.dir]) return "plan";
      if (typeof p.weapon !== "number" || p.weapon < 0 || p.weapon >= cls.len) return "plan";
      var tl = tilesOf(p, cls.len);
      if (!placementOk(p, cls.len)) return "plan";
      if (!inHomeBand(team, tl)) return "band"; // placement stays in the home band
      for (var j = 0; j < placed.length; j++) {
        if (placed[j].sub === (p.cls === "submarine") && overlaps(placed[j].tiles, tl)) return "plan";
      }
      placed.push({ tiles: tl, sub: p.cls === "submarine" });
    }
    // and against teammates' already-staged hulls (same layer)
    var bad = null;
    teamSeats(g, team).forEach(function (other) {
      if (other === seat || bad) return;
      var st = g.staged[other];
      ((st && st.plans && st.plans.ships) || []).forEach(function (o) {
        var osub = o.cls === "submarine";
        var otl = tilesOf(o, CLASSES[o.cls].len);
        list.forEach(function (p) {
          if ((p.cls === "submarine") === osub && overlaps(otl, tilesOf(p, CLASSES[p.cls].len))) bad = "plan";
        });
      });
    });
    return bad;
  }
  // timer expiry (or a bot) fills a seat that staged nothing: random
  // remaining classes, random legal placements in the home band
  function autoPickDraft(g, seat, ctx) {
    var team = seatTeam(g, seat);
    var used = teamClassesStaged(g, team, null);
    var pool = CLASS_LIST.filter(function (c) { return !used[c]; });
    var picks = [];
    var placedS = [], placedSub = [];
    // teammates' staged hulls count as occupied from the start
    teamSeats(g, team).forEach(function (other) {
      var st = g.staged[other];
      ((st && st.plans && st.plans.ships) || []).forEach(function (o) {
        (o.cls === "submarine" ? placedSub : placedS).push(tilesOf(o, CLASSES[o.cls].len));
      });
    });
    for (var n = 0; n < g.perSeat; n++) {
      var cls = pool.splice(randInt(ctx, pool.length), 1)[0];
      var len = CLASSES[cls].len, sub = cls === "submarine";
      var into = sub ? placedSub : placedS;
      for (var tries = 0; tries < 400; tries++) {
        var dir = randInt(ctx, 4);
        var x = randInt(ctx, BOARD), y = randInt(ctx, BOARD);
        var p = { x: x, y: y, dir: dir };
        var tl = tilesOf(p, len);
        if (!placementOk(p, len) || !inHomeBand(team, tl)) continue;
        var clash = into.some(function (o) { return overlaps(o, tl); });
        if (clash) continue;
        into.push(tl);
        picks.push({ cls: cls, x: x, y: y, dir: dir, weapon: randInt(ctx, len) });
        break;
      }
    }
    return { ships: picks };
  }
  function buildFleets(g, ctx) {
    g.seats.forEach(function (s, seat) {
      var st = g.staged[seat];
      var plans = (st && st.plans && st.plans.ships) ? st.plans : autoPickDraft(g, seat, ctx);
      if (!st || !st.plans || !st.plans.ships) g.staged[seat] = { ready: true, plans: plans };
      plans.ships.forEach(function (p) {
        var id = "s" + g.nextShip++;
        g.ships[id] = {
          id: id, seat: seat, team: s.team, cls: p.cls,
          x: p.x, y: p.y, dir: p.dir, weapon: p.weapon,
          mods: [],                              // the catalogue ships empty (v1)
          dmg: tilesOf(p, CLASSES[p.cls].len).map(function () { return false; }),
          sunk: false,
        };
      });
    });
  }

  /* ── stage validation, move + action phases ────────────────────── */
  function validateMove(g, seat, plans) {
    var moves = plans && plans.moves;
    if (!moves || typeof moves !== "object") return "plan";
    var ids = Object.keys(moves);
    for (var i = 0; i < ids.length; i++) {
      var ship = g.ships[ids[i]];
      if (!ship || ship.sunk || ship.seat !== seat) return "turn";
      var to = moves[ids[i]];
      if (!to || to.x == null || to.y == null || to.dir == null) return "plan";
      if (!endpointLegal(ship, avoidFor(g, ship), to)) return "move";
    }
    return null;
  }
  function validateActs(g, seat, plans) {
    var acts = plans && plans.acts;
    if (!acts || typeof acts !== "object") return "plan";
    var ids = Object.keys(acts);
    for (var i = 0; i < ids.length; i++) {
      var ship = g.ships[ids[i]];
      if (!ship || ship.sunk || ship.seat !== seat) return "turn";
      var a = acts[ids[i]], cls = CLASSES[ship.cls];
      if (!a || !a.type) return "plan";
      if (a.type === "pass") continue;
      if (a.type === "move") {                       // the cruiser's second move
        if (cls.special !== "move") return "plan";   // (survives disarming)
        if (!a.to || !endpointLegal(ship, avoidFor(g, ship), a.to)) return "move";
        continue;
      }
      if (disarmed(ship)) return "disarmed";         // everything below fires from the mount
      if (a.type === "sonar") {
        if (cls.special !== "sonar") return "plan";
        continue;
      }
      if (a.type === "fire" || a.type === "surface") {
        if (a.type === "surface" && !isSub(ship)) return "plan";
        if (a.dir == null || !DIRS[a.dir]) return "plan";
        if (fireDirs(ship).indexOf(a.dir) < 0) return "aim";   // the hull blocks its own fire
        if (cls.attack === "plane") {
          if (typeof a.dist !== "number" || a.dist < 1 || !planeZone(mountTile(ship), a.dir, a.dist).length) return "aim";
        }
        continue;
      }
      return "plan";
    }
    return null;
  }

  /* ── intel helpers ─────────────────────────────────────────────── */
  function mark(g, team, m) { g.intel[team].push(m); }
  // firing reveals YOU, hit or miss: exact tile within 8 of the target
  // team's nearest hull, a bearing beyond (docs/ships.md, "Firing")
  function revealShot(g, shooter, from) {
    var enemy = 1 - shooter.team;
    var best = null, bestD = Infinity;
    footprints(g, function (s) { return s.team === enemy; }).forEach(function (f) {
      f.tiles.forEach(function (t) {
        var d = cheb(t.x, t.y, from.x, from.y);
        if (d < bestD) { bestD = d; best = t; }
      });
    });
    if (!best) return;
    if (bestD <= REVEAL_RANGE) mark(g, enemy, { k: "reveal", x: from.x, y: from.y });
    else mark(g, enemy, { k: "bearing", x: best.x, y: best.y, dir: dir8(best.x, best.y, from.x, from.y) });
  }

  /* ── phase resolution ──────────────────────────────────────────── */
  function newsFor(g, events) {
    // one private envelope per team per resolution, so the enemy can't
    // even count what happened to the other side (docs/ships.md). The
    // envelope carries the team's SEAT LIST because maskEventFor only
    // ever sees the viewer's seat — the masker has no game to look at.
    var buckets = [[], []];
    return {
      push: function (team, item) { buckets[team].push(item); },
      flush: function () {
        buckets.forEach(function (items, team) {
          if (items.length) events.push({ t: "news", team: team, seats: teamSeats(g, team), items: items });
        });
      },
    };
  }
  function clearStage(g) {
    g.staged = {};
    g.committed = [false, false];
  }
  function pushHistory(g) {
    [0, 1].forEach(function (team) {
      g.history[team].push({
        round: g.round,
        ships: teamShips(g, team, true).map(function (s) { return clone(s); }),
        marks: clone(g.intel[team]),
      });
    });
  }

  function resolveDraft(g, ctx, events) {
    buildFleets(g, ctx);
    g.intel = [[], []];
    pushHistory(g);                                  // turn 0: the fleets as placed
    clearStage(g);
    g.phase = "move";
    g.round = 1;
    g.stats.turns = 1;
    events.push({ t: "phase", phase: "move", round: 1 });
  }

  function resolveMove(g, ctx, events) {
    var news = newsFor(g, events);
    // proposed endpoints (a ship with no plan holds still)
    var prop = {};
    Object.keys(g.ships).forEach(function (id) {
      var s = g.ships[id];
      if (s.sunk) return;
      prop[id] = { x: s.x, y: s.y, dir: s.dir, moved: false };
    });
    g.seats.forEach(function (_, seat) {
      var st = g.staged[seat];
      var moves = st && st.plans && st.plans.moves;
      if (!moves) return;
      Object.keys(moves).forEach(function (id) {
        if (prop[id]) prop[id] = { x: moves[id].x, y: moves[id].y, dir: moves[id].dir, moved: true };
      });
    });
    // destination-only, per layer, only the colliding ships are rejected:
    // revert every mover whose endpoint overlaps anyone, and repeat — a
    // revert can create a new overlap (someone moved into the vacated
    // water), so run to a fixpoint. Originals never overlapped, so this
    // terminates.
    var held = {};
    var changed = true;
    while (changed) {
      changed = false;
      var ids = Object.keys(prop).sort();
      for (var i = 0; i < ids.length; i++) {
        for (var j = i + 1; j < ids.length; j++) {
          var A = g.ships[ids[i]], B = g.ships[ids[j]];
          if (isSub(A) !== isSub(B)) continue;     // depth layers don't collide
          var pa = prop[ids[i]], pb = prop[ids[j]];
          if (!overlaps(tilesOf(pa, CLASSES[A.cls].len), tilesOf(pb, CLASSES[B.cls].len))) continue;
          [ids[i], ids[j]].forEach(function (id) {
            var s = g.ships[id];
            if (prop[id].moved) {
              prop[id] = { x: s.x, y: s.y, dir: s.dir, moved: false };
              if (!held[id]) { held[id] = 1; news.push(s.team, { k: "held", ship: id }); }
              changed = true;
            }
          });
        }
      }
    }
    Object.keys(prop).forEach(function (id) {
      var s = g.ships[id];
      s.x = prop[id].x; s.y = prop[id].y; s.dir = prop[id].dir;
    });
    news.flush();
    clearStage(g);
    g.phase = "action";
    events.push({ t: "phase", phase: "action", round: g.round });
  }

  function resolveAction(g, ctx, events) {
    var news = newsFor(g, events);
    g.intel = [[], []];                              // marks live one turn

    // collect every staged act (a ship without one passes)
    var acts = [];
    g.seats.forEach(function (_, seat) {
      var st = g.staged[seat];
      var a = st && st.plans && st.plans.acts;
      if (!a) return;
      Object.keys(a).forEach(function (id) {
        var s = g.ships[id];
        if (s && !s.sunk && s.seat === seat) acts.push({ ship: s, act: a[id] });
      });
    });

    // 1. surfacing — fails outright if ANYTHING sits above any hull tile
    var surfaced = {};
    acts.forEach(function (e) {
      if (e.act.type !== "surface") return;
      var above = footprints(g, function (s) { return !isSub(s) && s.id !== e.ship.id; });
      var mine = tilesOf(e.ship);
      var corked = above.some(function (f) { return overlaps(f.tiles, mine); });
      if (corked) { news.push(e.ship.team, { k: "corked", ship: e.ship.id }); e.act = { type: "pass" }; }
      else surfaced[e.ship.id] = true;
    });

    // 2. target indexes on the PRE-DAMAGE state — both sides fire at once
    function tileIndex(filter) {
      var idx = {};
      footprints(g, filter).forEach(function (f) {
        f.tiles.forEach(function (t, i) { idx[key(t.x, t.y)] = { ship: f.ship, i: i }; });
      });
      return idx;
    }
    var surfaceIdx = tileIndex(function (s) { return layerOf(s, surfaced) === "surface"; });
    var subIdx = tileIndex(function (s) { return isSub(s); });   // underwater missiles reach surfaced subs too

    // 3. compute every shot against that same state
    var damage = [];                                 // {ship, i, shooter}
    function endTile(ship, i) { return i === 0 || i === CLASSES[ship.cls].len - 1; }
    function missile(shooter, from, dir, range, idx) {
      var d = DIRS[dir], side = perp(dir).map(function (pd) { return DIRS[pd]; });
      for (var dist = 1; dist <= range; dist++) {
        var lx = from.x + d.x * dist, ly = from.y + d.y * dist;
        var cand = [];
        [{ x: lx, y: ly, on: true },
         { x: lx + side[0].x, y: ly + side[0].y, on: false },
         { x: lx + side[1].x, y: ly + side[1].y, on: false }].forEach(function (c) {
          var hit = idx[key(c.x, c.y)];
          if (hit && hit.ship.team !== shooter.team) {
            cand.push({ ship: hit.ship, i: hit.i, on: c.on, live: !hit.ship.dmg[hit.i], end: endTile(hit.ship, hit.i) });
          }
        });
        if (!cand.length) continue;
        // ranking: live > destroyed, end > interior, on-line > deviated,
        // remaining ties a server-rolled 50/50 (docs/ships.md)
        cand.sort(function (a, b) {
          if (a.live !== b.live) return a.live ? -1 : 1;
          if (a.end !== b.end) return a.end ? -1 : 1;
          if (a.on !== b.on) return a.on ? -1 : 1;
          return 0;
        });
        var best = cand.filter(function (c) {
          return c.live === cand[0].live && c.end === cand[0].end && c.on === cand[0].on;
        });
        return best[randInt(ctx, best.length)];
      }
      return null;
    }
    function lineShot(shooter, from, dir, range, idx) {
      var lane = laneTiles(from, dir, range);
      for (var i = 0; i < lane.length; i++) {
        var hit = idx[key(lane[i].x, lane[i].y)];
        if (hit && hit.ship.team !== shooter.team) return hit;   // friendly tiles are transparent
      }
      return null;
    }
    acts.forEach(function (e) {
      var ship = e.ship, act = e.act, cls = CLASSES[ship.cls];
      if (act.type !== "fire" && act.type !== "surface") return;
      var from = mountTile(ship);
      var underwater = isSub(ship) && act.type === "fire";       // submerged missile: subs only
      var idx = underwater ? subIdx : surfaceIdx;
      g.seatStats[ship.seat].shots++;
      revealShot(g, ship, from);                                 // hit or miss, you're seen
      if (cls.attack === "plane") {
        var zone = planeZone(from, act.dir, act.dist);
        var hitAny = false;
        zone.forEach(function (t) {
          var h = surfaceIdx[key(t.x, t.y)];
          if (h && h.ship.team !== ship.team) { damage.push({ ship: h.ship, i: h.i, shooter: ship }); hitAny = true; }
        });
        // the plane is what's seen, at the target end — a softer reveal
        mark(g, 1 - ship.team, { k: "plane", zone: zone, dir: act.dir });
        mark(g, ship.team, { k: "zone", zone: zone });
        if (!hitAny) g.seatStats[ship.seat].shots += 0;          // miss: zone mark already says it
        return;
      }
      var res = (cls.attack === "missile" || underwater)
        ? missile(ship, from, act.dir, cls.range, idx)
        : lineShot(ship, from, act.dir, cls.range, idx);
      if (res) {
        damage.push({ ship: res.ship, i: res.i, shooter: ship });
      } else {
        // a miss is a CLEARED LANE — the third mark in the intel language
        mark(g, ship.team, { k: "lane", tiles: laneTiles(from, act.dir, cls.range), sub: underwater });
      }
    });

    // 4. sonar — sweeps submerged, captures both layers, and subs see pings
    acts.forEach(function (e) {
      if (e.act.type !== "sonar") return;
      var sub = e.ship, area = sweepTiles(mountTile(sub));
      var areaSet = {};
      area.forEach(function (t) { areaSet[key(t.x, t.y)] = 1; });
      footprints(g, function (s) { return s.team !== sub.team; }).forEach(function (f) {
        var inside = f.tiles.some(function (t) { return areaSet[key(t.x, t.y)]; });
        if (!inside) return;
        // the phantom is the FULL ship — length, and therefore class
        mark(g, sub.team, { k: "phantom", tiles: tilesOf(f.ship), sub: isSub(f.ship) });
        if (isSub(f.ship)) {
          // mutual: the swept sub learns, and the sweeper is marked for it
          mark(g, f.ship.team, { k: "phantom", tiles: tilesOf(sub), sub: true, ping: true });
          news.push(f.ship.team, { k: "swept", ship: f.ship.id });
        }
      });
      mark(g, sub.team, { k: "sweep", tiles: area });
    });

    // 5. apply damage simultaneously; hits are tile-specific
    var hurt = {};
    damage.forEach(function (d) {
      var v = d.ship, tl = tilesOf(v)[d.i];
      g.seatStats[d.shooter.seat].hits++;
      if (!v.dmg[d.i]) { v.dmg[d.i] = true; hurt[v.id] = 1; }
      // shooter's team: the exact tile plus the 3×3 orientation reveal
      var around = [];
      tilesOf(v).forEach(function (t) {
        if (cheb(t.x, t.y, tl.x, tl.y) <= 1) around.push({ x: t.x, y: t.y });
      });
      mark(g, d.shooter.team, { k: "hit", x: tl.x, y: tl.y });
      mark(g, d.shooter.team, { k: "phantom", tiles: around });
      news.push(v.team, { k: "struck", ship: v.id, i: d.i });
      if (d.i === v.weapon) news.push(v.team, { k: "disarmed", ship: v.id });
    });
    // sinkings are public — the wreck stops blocking and stays visible
    Object.keys(hurt).sort().forEach(function (id) {
      var v = g.ships[id];
      if (v.sunk || !v.dmg.every(function (x) { return x; })) return;
      v.sunk = true;
      var wreck = { team: v.team, cls: v.cls, tiles: tilesOf(v) };
      g.wrecks.push(wreck);
      damage.some(function (d) {
        if (d.ship.id === id) { g.seatStats[d.shooter.seat].sunk++; return true; }
        return false;
      });
      events.push({ t: "sunk", team: v.team, cls: v.cls });
    });

    // 6. the cruiser's second move — after fire (you can be hit where you
    //    stood), destination-only against the post-damage board
    var movers = acts.filter(function (e) { return e.act.type === "move" && !e.ship.sunk; });
    if (movers.length) {
      var prop = {};
      footprints(g).forEach(function (f) { prop[f.ship.id] = { x: f.ship.x, y: f.ship.y, dir: f.ship.dir, moved: false }; });
      movers.forEach(function (e) {
        prop[e.ship.id] = { x: e.act.to.x, y: e.act.to.y, dir: e.act.to.dir, moved: true };
      });
      var changed = true;
      while (changed) {
        changed = false;
        var ids = Object.keys(prop).sort();
        for (var i = 0; i < ids.length; i++) {
          for (var j = i + 1; j < ids.length; j++) {
            var A = g.ships[ids[i]], B = g.ships[ids[j]];
            if (isSub(A) !== isSub(B)) continue;
            if (!overlaps(tilesOf(prop[ids[i]], CLASSES[A.cls].len), tilesOf(prop[ids[j]], CLASSES[B.cls].len))) continue;
            [ids[i], ids[j]].forEach(function (id) {
              if (prop[id].moved) {
                var s = g.ships[id];
                prop[id] = { x: s.x, y: s.y, dir: s.dir, moved: false };
                news.push(s.team, { k: "held", ship: id });
                changed = true;
              }
            });
          }
        }
      }
      movers.forEach(function (e) {
        var p = prop[e.ship.id];
        e.ship.x = p.x; e.ship.y = p.y; e.ship.dir = p.dir;
      });
    }

    news.flush();
    pushHistory(g);                                  // the calendar entry for this round
    clearStage(g);

    // 7. victory — one replaceable function (docs/ships.md, "Damage and defeat")
    var win = checkVictory(g);
    if (win !== undefined) {
      g.phase = "over";
      g.winner = win;
      events.push({ t: "over", winner: win });
      return;
    }
    g.round++;
    g.stats.turns = g.round;
    g.phase = "move";
    events.push({ t: "phase", phase: "move", round: g.round });
  }

  // → team index that won, null for a mutual-destruction tie, undefined
  //   while the game goes on. Deliberately the ONLY place that decides.
  function checkVictory(g) {
    var alive = aliveCounts(g);
    if (alive[0] && alive[1]) return undefined;
    if (!alive[0] && !alive[1]) return null;
    return alive[0] ? 0 : 1;
  }

  function resolveIfBothIn(g, ctx, events) {
    if (!g.committed[0] || !g.committed[1]) return;
    if (g.phase === "draft") resolveDraft(g, ctx, events);
    else if (g.phase === "move") resolveMove(g, ctx, events);
    else if (g.phase === "action") resolveAction(g, ctx, events);
  }

  /* ── actions ───────────────────────────────────────────────────── */
  function applyAction(game, action, ctx) {
    if (!game || game.phase === "over") return err("phase");
    var g = clone(game);
    var events = [];
    var type = action.type, seat = action.seat;

    if (type === "timerExpire") {
      // expiry commits the staged set for every team still out — exactly
      // what a manual commit would have taken (draft auto-picks instead,
      // inside buildFleets, for any seat that staged nothing)
      [0, 1].forEach(function (team) {
        if (!g.committed[team]) {
          g.committed[team] = true;
          events.push({ t: "committed", team: team, auto: true });
        }
      });
      resolveIfBothIn(g, ctx, events);
      return { game: g, events: events };
    }

    var team = seatTeam(g, seat);
    if (team == null) return err("perm");

    if (type === "stage") {
      if (g.committed[team]) return err("phase");    // committed sides re-open via uncommit
      var bad = g.phase === "draft" ? validateDraft(g, seat, action.plans)
              : g.phase === "move" ? validateMove(g, seat, action.plans)
              : validateActs(g, seat, action.plans);
      if (bad) return err(bad);
      g.staged[seat] = { ready: true, plans: clone(action.plans) };
      events.push({ t: "ready", seat: seat, on: true });
      return { game: g, events: events };
    }
    if (type === "unstage") {
      if (g.committed[team]) return err("phase");
      delete g.staged[seat];
      events.push({ t: "ready", seat: seat, on: false });
      return { game: g, events: events };
    }
    if (type === "commit") {
      // captaincy is the CALLER's to enforce (the DO/mock check the seat
      // against captainSeat before dispatching) — the engine checks team
      if (g.committed[team]) return err("phase");
      g.committed[team] = true;
      events.push({ t: "committed", team: team });
      resolveIfBothIn(g, ctx, events);
      return { game: g, events: events };
    }
    if (type === "uncommit") {
      if (!g.committed[team]) return err("phase");
      if (g.settings.lockCommit) return err("locked");
      // once both sides are in, resolution already happened — there is
      // nothing left to retract, and committed[] was cleared with it
      g.committed[team] = false;
      events.push({ t: "uncommitted", team: team });
      return { game: g, events: events };
    }
    return err("phase");
  }

  /* ── views (hidden info: docs/ships.md, "Hidden information") ────
     The worker and the mock BOTH build views through these, so the two
     scrub identically. Everything positional about a living ship rides
     only its own team's `you`; the enemy sees intel marks, readiness,
     the alive tally, and public wrecks. */
  function publicView(g) {
    var ready = g.seats.map(function (_, seat) { return !!(g.staged[seat] && g.staged[seat].ready); });
    var v = {
      round: g.round,
      committed: g.committed.slice(),
      ready: ready,
      alive: aliveCounts(g),
      fleetSize: g.fleetSize,
      wrecks: clone(g.wrecks),
      winner: g.winner,
    };
    if (g.settings.fleetPublic && g.round > 0) {
      v.fleets = [0, 1].map(function (team) {
        return teamShips(g, team, true).map(function (s) { return s.cls; }).sort();
      });
    }
    return v;
  }
  function teamYou(g, team, seat) {
    return {
      team: team,
      ships: teamShips(g, team, true).map(function (s) { return clone(s); }),
      marks: clone(g.intel[team]),
      history: clone(g.history[team]),
      plans: (seat != null && g.staged[seat]) ? clone(g.staged[seat].plans) : null,
    };
  }
  function spectatorYou(g) {
    return {
      spectator: true,
      ships: [0, 1].map(function (team) {
        return teamShips(g, team, true).map(function (s) { return clone(s); });
      }),
      marks: [clone(g.intel[0]), clone(g.intel[1])],
      history: [clone(g.history[0]), clone(g.history[1])],
    };
  }
  // events: private payloads ride the one "news" envelope per team. The
  // decision runs on the viewer's SEAT (all the delivery layer knows);
  // a null seat is a spectator, who sees both fleets and both news.
  function maskEventFor(e, seat) {
    if (e && e.t === "news" && seat != null && (e.seats || []).indexOf(seat) < 0) {
      return { t: "news", team: e.team, seats: e.seats, items: [] };
    }
    return e;
  }

  /* ── the ships Colors wrapper (docs/ships.md, "Board art") ──────
     Red is the intel language's, so team colors may not wear it: the
     presets drop the red slot, and norm() refuses any custom hex inside
     the red hue band. A FACTORY over the shared DeetsColors so the
     browser and the worker wrap the same base without this module
     importing anything (engine.js stays dependency-free). */
  function makeColors(base) {
    var PRESETS = ["#3b7dd8", "#2fae66", "#e08a2e", "#9457c9", "#22b0b0", "#c74da6"];
    function inRedBand(hex) {
      var r = parseInt(hex.slice(1, 3), 16) / 255;
      var gc = parseInt(hex.slice(3, 5), 16) / 255;
      var b = parseInt(hex.slice(5, 7), 16) / 255;
      var max = Math.max(r, gc, b), min = Math.min(r, gc, b), d = max - min;
      var l = (max + min) / 2;
      if (!d || l < 0.2 || l > 0.85) return false;        // greys and extremes are fine
      var s = d / (1 - Math.abs(2 * l - 1));
      if (s < 0.3) return false;
      var h;
      if (max === r) h = 60 * (((gc - b) / d) % 6);
      else if (max === gc) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - gc) / d + 4);
      h = (h + 360) % 360;
      return h <= 18 || h >= 342;
    }
    return {
      PRESETS: PRESETS,
      LEGACY: { red: PRESETS[0], blue: PRESETS[0], green: PRESETS[1], orange: PRESETS[2], purple: PRESETS[3], teal: PRESETS[4] },
      MIN_DIST: base.MIN_DIST,
      norm: function (v) {
        var hex = base.norm(v);
        return hex && inRedBand(hex) ? null : hex;
      },
      dist: base.dist,
      clash: base.clash,
      freePreset: function (taken) {
        for (var i = 0; i < PRESETS.length; i++) if (base.clash(PRESETS[i], taken) < 0) return PRESETS[i];
        return PRESETS[0];
      },
      inRedBand: inRedBand,
    };
  }

  /* ── standings (the results POST reads this) ───────────────────── */
  function standings(g) {
    var alive = aliveCounts(g);
    return g.seats.map(function (s, seat) {
      var rank = 1, tied = false;
      if (g.phase === "over") {
        if (g.winner == null) { rank = 1; tied = true; }
        else rank = s.team === g.winner ? 1 : 2;
      }
      return { seat: seat, rank: rank, tied: tied, score: alive[s.team] };
    });
  }

  /* ── the anchor bot (v1: legal, minimal, never stalls a table) ───
     Auto-picks a draft, holds every ship in the move phase, passes every
     action, readies, and commits when it captains. Parameterized bots
     are a separate workstream (docs/ships.md). */
  function botAct(g, seat) {
    if (!g || g.phase === "over" || !g.seats) return null;
    var team = seatTeam(g, seat);
    if (team == null) return null;
    if (g.committed[team]) return null;
    if (!g.staged[seat] || !g.staged[seat].ready) {
      if (g.phase === "draft") return { type: "stage", seat: seat, auto: true };  // caller auto-picks
      if (g.phase === "move") return { type: "stage", seat: seat, plans: { moves: {} } };
      return { type: "stage", seat: seat, plans: { acts: {} } };
    }
    return null;
  }

  /* ── exports ───────────────────────────────────────────────────── */
  var API = {
    BOARD: BOARD, BAND: BAND, REVEAL_RANGE: REVEAL_RANGE,
    CLASSES: CLASSES, CLASS_LIST: CLASS_LIST, FLEET_BY_SIZE: FLEET_BY_SIZE,
    DIRS: DIRS, DIR8: DIR8,
    createGame: createGame, applyAction: applyAction, standings: standings,
    tilesOf: tilesOf, inBounds: inBounds, cheb: cheb, dir8: dir8,
    legalEndpoints: legalEndpoints, endpointLegal: endpointLegal,
    fireDirs: fireDirs, laneTiles: laneTiles, planeZone: planeZone,
    sweepTiles: sweepTiles, inHomeBand: inHomeBand,
    moveBudget: moveBudget, mountTile: mountTile, disarmed: disarmed,
    livePivots: livePivots, turned: turned, hits: hits,
    avoidFor: avoidFor, autoPickDraft: autoPickDraft, validateDraft: validateDraft,
    publicView: publicView, teamYou: teamYou, spectatorYou: spectatorYou,
    maskEventFor: maskEventFor, seatTeam: seatTeam, teamSeats: teamSeats,
    botAct: botAct, checkVictory: checkVictory, makeColors: makeColors,
    selfTest: selfTest,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.ShipsEngine = API;

  /* ══ self-checks — `node ships/engine.js` ═══════════════════════ */
  function selfTest() {
    var pass = 0, fail = 0, msgs = [];
    function ok(cond, label) {
      if (cond) pass++;
      else { fail++; msgs.push("FAIL " + label); }
    }
    function eq(a, b, label) { ok(a === b, label + " (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")"); }
    var seed = 42;
    var ctx = { rand: function () { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; }, now: 0 };

    function game1v1() {
      return createGame({ seated: [{ team: 0 }, { team: 1 }], settings: {} }, ctx);
    }
    // a hand-built mid-game state: one ship per side, phase "move"
    function duel(shipA, shipB, phase) {
      var g = game1v1();
      g.phase = phase || "move";
      g.round = 1;
      shipA = Object.assign({ id: "s0", seat: 0, team: 0, mods: [], sunk: false }, shipA);
      shipB = Object.assign({ id: "s1", seat: 1, team: 1, mods: [], sunk: false }, shipB);
      [shipA, shipB].forEach(function (s) {
        if (!s.dmg) s.dmg = tilesOf(s, CLASSES[s.cls].len).map(function () { return false; });
      });
      g.ships = { s0: shipA, s1: shipB };
      g.nextShip = 2;
      return g;
    }
    function stageCommit(g, actions) {
      actions.forEach(function (a) {
        var r = applyAction(g, a, ctx);
        ok(!r.error, "action " + a.type + " ok" + (r.error ? " [" + r.error.code + "]" : ""));
        g = r.game;
      });
      return g;
    }

    /* geometry */
    (function () {
      var t = tilesOf({ x: 3, y: 3, dir: 0 }, 4);
      eq(t.length, 4, "hull length");
      eq(t[3].x, 6, "hull runs along dir");
      var tn = turned({ x: 3, y: 3, dir: 0 }, 0, 1, 4);
      eq(tn.x + "," + tn.y + "," + tn.dir, "3,3,1", "turn about the bow keeps the bow");
      var tn2 = turned({ x: 3, y: 3, dir: 0 }, 3, 1, 4);
      eq(tn2.x + "," + tn2.y, "6,0", "turn about the stern swings the origin");
      eq(dir8(5, 5, 5, 0), "n", "dir8 north");
      eq(dir8(5, 5, 9, 9), "se", "dir8 southeast");
      eq(dir8(5, 5, 15, 6), "e", "dir8 shallow angles snap to the cardinal");
    })();

    /* movement legality */
    (function () {
      var bb = { id: "s0", cls: "battleship", x: 8, y: 8, dir: 0, weapon: 0, dmg: [false, false, false, false] };
      var eps = legalEndpoints(bb, []);
      ok(eps.some(function (p) { return p.x === 13 && p.y === 8 && p.dir === 0; }), "big three slide 5");
      ok(!eps.some(function (p) { return p.x === 14 && p.y === 8; }), "…but not 6");
      ok(eps.some(function (p) { return p.x === 3 && p.y === 8 && p.dir === 0; }), "reverse is legal");
      ok(eps.some(function (p) { return p.dir === 1 && p.x === 8 && p.y === 8; }), "turn about the bow");
      // big three: turn OR move — exactly 6 turned endpoints (3 pivots × 2
      // rotations), never a turned-and-slid one
      eq(eps.filter(function (p) { return p.dir !== 0; }).length, 4, "battleship: 2 pivots × 2 rotations, no turn+slide");
      // agile: turn costs 1 out of the budget
      var sub = { id: "s1", cls: "submarine", x: 8, y: 8, dir: 0, weapon: 0, dmg: [false, false, false] };
      var seps = legalEndpoints(sub, []);
      ok(seps.some(function (p) { return p.dir === 1 && p.x === 8 && p.y === 14; }), "sub turns then runs 6");
      ok(!seps.some(function (p) { return p.dir === 1 && p.x === 8 && p.y === 15; }), "…not 7 — the turn cost 1");
      // damage: −2 per hit, clamp at 0, and the big three keep turning
      var hurt = { id: "s2", cls: "carrier", x: 8, y: 8, dir: 0, weapon: 2, dmg: [true, true, true, false, false] };
      eq(moveBudget(hurt), 0, "three hits immobilise a carrier");
      var heps = legalEndpoints(hurt, []);
      eq(heps.filter(function (p) { return p.dir === 0; }).length, 1, "immobile: no translations (holding is the only same-heading endpoint)");
      ok(heps.some(function (p) { return p.dir !== 0; }), "…but it can still turn (a live pivot remains)");
      eq(livePivots(hurt).length, 1, "two destroyed pivots are gone");
      var dead = { id: "s3", cls: "destroyer", x: 8, y: 8, dir: 0, weapon: 1, dmg: [true, true, true] };
      eq(livePivots(dead).length, 0, "no live pivots at all");
      eq(legalEndpoints(dead, []).filter(function (p) { return p.dir !== 0; }).length, 0, "…so it cannot turn");
      // avoid: teammates' hulls refuse the endpoint
      var mate = tilesOf({ x: 12, y: 8, dir: 1 }, 3);
      ok(!legalEndpoints(bb, [mate]).some(function (p) { return p.x === 12 && p.y === 8 && p.dir === 0; }), "teammate blocks the destination");
    })();

    /* the gun and the hull */
    (function () {
      var bb = { cls: "battleship", x: 5, y: 5, dir: 0, weapon: 0, dmg: [false, false, false, false] };
      var d0 = fireDirs(bb);
      ok(d0.indexOf(2) >= 0 && d0.indexOf(0) < 0, "bow mount fires away, not into the hull");
      ok(d0.indexOf(1) >= 0 && d0.indexOf(3) >= 0, "…plus both perpendiculars");
      bb.weapon = 1;
      var d1 = fireDirs(bb);
      eq(d1.length, 2, "interior mount is perpendicular-locked");
      bb.weapon = 3;
      ok(fireDirs(bb).indexOf(0) >= 0, "stern mount fires along +dir");
      var cz = planeZone({ x: 5, y: 5 }, 0, 3);
      eq(cz.length, 12, "plane zone is 4×3");
      ok(cz.some(function (t) { return t.x === 8 && t.y === 4; }), "zone spans the across axis");
    })();

    /* draft */
    (function () {
      var g = game1v1();
      var plan = { ships: [
        { cls: "carrier", x: 0, y: 0, dir: 1, weapon: 2 },
        { cls: "submarine", x: 2, y: 0, dir: 1, weapon: 1 },
        { cls: "cruiser", x: 4, y: 0, dir: 1, weapon: 0 },
      ] };
      eq(validateDraft(g, 0, plan), null, "a legal draft validates");
      var out = validateDraft(g, 0, { ships: [plan.ships[0], plan.ships[0], plan.ships[2]] });
      eq(out, "dupe", "no duplicate classes within a team");
      var far = { ships: [Object.assign({}, plan.ships[0], { x: 6 }), plan.ships[1], plan.ships[2]] };
      eq(validateDraft(g, 0, far), "band", "placement stays in the home band");
      // sub may share tiles with a surface hull in the draft (depth layer)
      var lay = { ships: [
        { cls: "carrier", x: 0, y: 0, dir: 1, weapon: 2 },
        { cls: "submarine", x: 0, y: 0, dir: 1, weapon: 1 },
        { cls: "cruiser", x: 4, y: 0, dir: 1, weapon: 0 },
      ] };
      eq(validateDraft(g, 0, lay), null, "a sub shares water with a surface hull");
      g = stageCommit(g, [
        { type: "stage", seat: 0, plans: plan },
        { type: "commit", seat: 0 },
        { type: "stage", seat: 1, plans: { ships: [
          { cls: "battleship", x: 19, y: 0, dir: 1, weapon: 0 },
          { cls: "destroyer", x: 17, y: 4, dir: 1, weapon: 1 },
          { cls: "cruiser", x: 15, y: 10, dir: 1, weapon: 0 },
        ] } },
        { type: "commit", seat: 1 },
      ]);
      eq(g.phase, "move", "draft resolves into round 1's move");
      eq(g.round, 1, "the draft was turn 0");
      eq(Object.keys(g.ships).length, 6, "both fleets exist");
      eq(g.history[0].length, 1, "turn 0 is in the calendar");
      eq(g.history[0][0].ships.length, 3, "…with the fleet as placed");
      var pub = publicView(g);
      eq(pub.alive.join(","), "3,3", "public alive tally");
      ok(pub.fleets && pub.fleets[1].indexOf("battleship") >= 0, "fleet lists are public by setting");
      var you = teamYou(g, 0, 0);
      eq(you.ships.length, 3, "you carries the whole team");
      var spec = spectatorYou(g);
      eq(spec.ships[0].length + spec.ships[1].length, 6, "spectators see both fleets");
    })();

    /* draft auto-pick */
    (function () {
      var g = game1v1();
      var r = applyAction(g, { type: "timerExpire" }, ctx);
      ok(!r.error, "expiry on an empty draft resolves");
      g = r.game;
      eq(g.phase, "move", "auto-pick dealt both fleets");
      eq(Object.keys(g.ships).length, 6, "…all six ships");
      var t0 = teamShips(g, 0);
      ok(t0.every(function (s) { return inHomeBand(0, tilesOf(s)); }), "auto-picks stay in the band");
      var cls0 = t0.map(function (s) { return s.cls; }).sort();
      eq(cls0.length, new Set ? 3 : 3, "three ships");
      ok(cls0[0] !== cls0[1] && cls0[1] !== cls0[2], "no dupes in an auto-picked fleet");
    })();

    /* move resolution: destination-only collisions */
    (function () {
      // two destroyers commit into the same water: both hold
      var g = duel(
        { cls: "destroyer", x: 5, y: 8, dir: 0, weapon: 0 },
        { cls: "destroyer", x: 13, y: 8, dir: 2, weapon: 0 });
      g = stageCommit(g, [
        { type: "stage", seat: 0, plans: { moves: { s0: { x: 9, y: 8, dir: 0 } } } },
        { type: "commit", seat: 0 },
        { type: "stage", seat: 1, plans: { moves: { s1: { x: 11, y: 8, dir: 2 } } } },
        { type: "commit", seat: 1 },
      ]);
      eq(g.phase, "action", "move resolved");
      eq(g.ships.s0.x, 5, "collider A held");
      eq(g.ships.s1.x, 13, "collider B held");
    })();
    (function () {
      // enemy ships SWAP ends of a line: destination-only lets both stand
      var g = duel(
        { cls: "cruiser", x: 5, y: 8, dir: 0, weapon: 0 },
        { cls: "cruiser", x: 12, y: 8, dir: 2, weapon: 0 });
      g = stageCommit(g, [
        { type: "stage", seat: 0, plans: { moves: { s0: { x: 11, y: 8, dir: 0 } } } },
        { type: "commit", seat: 0 },
        { type: "stage", seat: 1, plans: { moves: { s1: { x: 6, y: 8, dir: 2 } } } },
        { type: "commit", seat: 1 },
      ]);
      eq(g.ships.s0.x, 11, "swap: A passed through");
      eq(g.ships.s1.x, 6, "swap: B passed through");
    })();
    (function () {
      // a mover into a stationary hidden hull holds; the stationary stands
      var g = duel(
        { cls: "destroyer", x: 5, y: 8, dir: 0, weapon: 0 },
        { cls: "battleship", x: 9, y: 7, dir: 1, weapon: 0 });
      g = stageCommit(g, [
        { type: "stage", seat: 0, plans: { moves: { s0: { x: 8, y: 8, dir: 0 } } } },
        { type: "commit", seat: 0 },
        { type: "commit", seat: 1 },
      ]);
      eq(g.ships.s0.x, 5, "hidden collision: the mover holds");
      eq(g.ships.s1.x, 9, "…the hull it found stands");
      // a submerged sub triggers no rejection at all
      var g2 = duel(
        { cls: "destroyer", x: 5, y: 8, dir: 0, weapon: 0 },
        { cls: "submarine", x: 9, y: 7, dir: 1, weapon: 0 });
      g2 = stageCommit(g2, [
        { type: "stage", seat: 0, plans: { moves: { s0: { x: 8, y: 8, dir: 0 } } } },
        { type: "commit", seat: 0 },
        { type: "commit", seat: 1 },
      ]);
      eq(g2.ships.s0.x, 8, "a submerged sub never pushes back");
    })();

    /* action: line shots, first thing hit, reveals */
    (function () {
      var g = duel(
        { cls: "battleship", x: 2, y: 8, dir: 1, weapon: 0 },     // mount at (2,8), fires E
        { cls: "destroyer", x: 12, y: 7, dir: 1, weapon: 2 },     // hull (12,7..9)
        "action");
      g = stageCommit(g, [
        { type: "stage", seat: 0, plans: { acts: { s0: { type: "fire", dir: 0 } } } },
        { type: "commit", seat: 0 },
        { type: "stage", seat: 1, plans: { acts: { s1: { type: "pass" } } } },
        { type: "commit", seat: 1 },
      ]);
      eq(g.phase, "move", "action resolved into the next move");
      eq(g.round, 2, "round advanced");
      var hist = g.history[0][0];   // (no draft entry in a hand-built duel)
      ok(g.ships.s1.dmg[1], "first thing hit: the tile at (12,8)");
      ok(!g.ships.s1.dmg[0] && !g.ships.s1.dmg[2], "…one hit, not a swath");
      var m0 = hist.marks;
      ok(m0.some(function (m) { return m.k === "hit" && m.x === 12 && m.y === 8; }), "shooter sees the ✕");
      ok(m0.some(function (m) { return m.k === "phantom"; }), "…and the 3×3 orientation reveal");
      var m1 = g.history[1][0].marks;
      // target's nearest hull tile (12,8) to the mount (2,8): 10 > 8 → bearing
      ok(m1.some(function (m) { return m.k === "bearing" && m.dir === "w"; }), "beyond 8: a bearing into the fog");
      ok(!m1.some(function (m) { return m.k === "reveal"; }), "…and no exact tile");
    })();
    (function () {
      // within 8: the exact firing tile is revealed; a miss clears a lane
      var g = duel(
        { cls: "cruiser", x: 6, y: 8, dir: 1, weapon: 0 },        // mount (6,8)
        { cls: "destroyer", x: 10, y: 12, dir: 0, weapon: 2 },
        "action");
      g = stageCommit(g, [
        { type: "stage", seat: 0, plans: { acts: { s0: { type: "fire", dir: 0 } } } },  // fires E into open water
        { type: "commit", seat: 0 },
        { type: "stage", seat: 1, plans: { acts: { s1: { type: "pass" } } } },
        { type: "commit", seat: 1 },
      ]);
      var m0 = g.history[0][0].marks;
      ok(m0.some(function (m) { return m.k === "lane" && m.tiles.length === 5; }), "a miss is a cleared lane, range-long");
      var m1 = g.history[1][0].marks;
      ok(m1.some(function (m) { return m.k === "reveal" && m.x === 6 && m.y === 8; }), "within 8: the exact tile, even on a miss");
    })();

    /* both sides fire at once — mutual destruction is real */
    (function () {
      var g = duel(
        { cls: "cruiser", x: 5, y: 8, dir: 0, weapon: 1, dmg: [true, false] },   // one live tile each
        { cls: "cruiser", x: 8, y: 8, dir: 0, weapon: 0, dmg: [false, true] });
      g.phase = "action";
      // A's mount (6,8) fires E and hits B's bow (8,8); B's mount (8,8) fires W and hits A's (6,8)
      g = stageCommit(g, [
        { type: "stage", seat: 0, plans: { acts: { s0: { type: "fire", dir: 0 } } } },
        { type: "commit", seat: 0 },
        { type: "stage", seat: 1, plans: { acts: { s1: { type: "fire", dir: 2 } } } },
        { type: "commit", seat: 1 },
      ]);
      eq(g.phase, "over", "mutual destruction ends the game");
      eq(g.winner, null, "…with no winner");
      var st = standings(g);
      ok(st[0].rank === 1 && st[1].rank === 1 && st[0].tied, "both teams tie at 1");
    })();

    /* the missile ranking */
    (function () {
      // candidates in one cross-section: a destroyed interior on-line tile
      // vs a live end tile one row off — live+end wins, deviated or not
      var g = duel(
        { cls: "destroyer", x: 2, y: 8, dir: 1, weapon: 0 },      // mount (2,8) fires E
        { cls: "battleship", x: 7, y: 8, dir: 1, weapon: 3, dmg: [true, false, false, false] });
      // battleship hull: (7,8) destroyed, (7,9), (7,10), (7,11)
      g.phase = "action";
      g = stageCommit(g, [
        { type: "stage", seat: 0, plans: { acts: { s0: { type: "fire", dir: 0 } } } },
        { type: "commit", seat: 0 },
        { type: "stage", seat: 1, plans: { acts: { s1: { type: "pass" } } } },
        { type: "commit", seat: 1 },
      ]);
      ok(g.ships.s1.dmg[1], "missile deviated off the wreck tile to the live one");
      var live = g.ships.s1.dmg.filter(function (d) { return d; }).length;
      eq(live, 2, "exactly one new hit");
    })();
    (function () {
      // end beats interior: hull broadside to the lane, end tile one column deviated
      var g = duel(
        { cls: "destroyer", x: 2, y: 8, dir: 1, weapon: 0 },
        { cls: "destroyer", x: 8, y: 7, dir: 1, weapon: 1 });     // hull (8,7),(8,8),(8,9)
      g.phase = "action";
      g = stageCommit(g, [
        { type: "stage", seat: 0, plans: { acts: { s0: { type: "fire", dir: 0 } } } },
        { type: "commit", seat: 0 },
        { type: "stage", seat: 1, plans: { acts: { s1: { type: "pass" } } } },
        { type: "commit", seat: 1 },
      ]);
      ok(g.ships.s1.dmg[0] || g.ships.s1.dmg[2], "the missile favors an end tile");
      ok(!g.ships.s1.dmg[1], "…over the on-line interior");
    })();

    /* the depth layer */
    (function () {
      // surface weapons cannot reach a submerged sub
      var g = duel(
        { cls: "battleship", x: 2, y: 8, dir: 1, weapon: 0 },
        { cls: "submarine", x: 8, y: 8, dir: 1, weapon: 0 },
        "action");
      g = stageCommit(g, [
        { type: "stage", seat: 0, plans: { acts: { s0: { type: "fire", dir: 0 } } } },
        { type: "commit", seat: 0 },
        { type: "stage", seat: 1, plans: { acts: { s1: { type: "pass" } } } },
        { type: "commit", seat: 1 },
      ]);
      ok(!g.ships.s1.dmg.some(function (d) { return d; }), "a submerged sub is untouchable from the surface");
      // sub-vs-sub: the underwater missile connects
      var g2 = duel(
        { cls: "submarine", x: 2, y: 8, dir: 1, weapon: 0 },
        { cls: "submarine", x: 8, y: 8, dir: 1, weapon: 0 },
        "action");
      g2 = stageCommit(g2, [
        { type: "stage", seat: 0, plans: { acts: { s0: { type: "fire", dir: 0 } } } },
        { type: "commit", seat: 0 },
        { type: "stage", seat: 1, plans: { acts: { s1: { type: "pass" } } } },
        { type: "commit", seat: 1 },
      ]);
      ok(g2.ships.s1.dmg.some(function (d) { return d; }), "the underwater missile hits another sub");
      // corked: a hull parked above refuses the surfacing outright
      var g3 = duel(
        { cls: "submarine", x: 8, y: 8, dir: 1, weapon: 0 },
        { cls: "battleship", x: 8, y: 8, dir: 1, weapon: 0 },
        "action");
      g3 = stageCommit(g3, [
        { type: "stage", seat: 0, plans: { acts: { s0: { type: "surface", dir: 0 } } } },
        { type: "commit", seat: 0 },
        { type: "stage", seat: 1, plans: { acts: { s1: { type: "pass" } } } },
        { type: "commit", seat: 1 },
      ]);
      ok(!g3.ships.s1.dmg.some(function (d) { return d; }), "corked: the surface attack failed outright");
      // surfaced: the sub is hittable by surface fire that same phase
      var g4 = duel(
        { cls: "submarine", x: 8, y: 6, dir: 1, weapon: 0 },       // mount (8,6)
        { cls: "battleship", x: 12, y: 6, dir: 1, weapon: 0 });    // mount (12,6) fires W
      g4.phase = "action";
      g4 = stageCommit(g4, [
        { type: "stage", seat: 0, plans: { acts: { s0: { type: "surface", dir: 0 } } } },
        { type: "commit", seat: 0 },
        { type: "stage", seat: 1, plans: { acts: { s1: { type: "fire", dir: 2 } } } },
        { type: "commit", seat: 1 },
      ]);
      ok(g4.ships.s0.dmg.some(function (d) { return d; }), "a surfaced sub is shootable that whole phase");
      ok(g4.ships.s1.dmg.some(function (d) { return d; }), "…and its own surface shot still landed");
    })();

    /* sonar — both layers, and subs see pings */
    (function () {
      var g = duel(
        { cls: "submarine", x: 8, y: 8, dir: 0, weapon: 1 },      // mount (9,8)
        { cls: "submarine", x: 11, y: 8, dir: 1, weapon: 0 },
        "action");
      g = stageCommit(g, [
        { type: "stage", seat: 0, plans: { acts: { s0: { type: "sonar" } } } },
        { type: "commit", seat: 0 },
        { type: "stage", seat: 1, plans: { acts: { s1: { type: "pass" } } } },
        { type: "commit", seat: 1 },
      ]);
      var m0 = g.history[0][0].marks;
      var ph = m0.filter(function (m) { return m.k === "phantom"; });
      eq(ph.length, 1, "the sweep phantoms the enemy sub");
      eq(ph[0].tiles.length, 3, "…full hull, so length and class are legible");
      var m1 = g.history[1][0].marks;
      ok(m1.some(function (m) { return m.k === "phantom" && m.ping; }), "the swept sub sees the ping back");
    })();

    /* disarm: the mount dies, the ship fights on */
    (function () {
      var g = duel(
        { cls: "battleship", x: 2, y: 8, dir: 1, weapon: 0 },     // fires E from (2,8)
        { cls: "destroyer", x: 8, y: 6, dir: 1, weapon: 2 });     // hull (8,6..8); mount (8,8)
      g.phase = "action";
      g = stageCommit(g, [
        { type: "stage", seat: 0, plans: { acts: { s0: { type: "fire", dir: 0 } } } },
        { type: "commit", seat: 0 },
        { type: "stage", seat: 1, plans: { acts: { s1: { type: "pass" } } } },
        { type: "commit", seat: 1 },
      ]);
      ok(g.ships.s1.dmg[2], "the mount tile took the hit");
      ok(disarmed(g.ships.s1), "…and the ship is disarmed");
      g.phase = "action";                            // the resolution advanced to move; step back in
      var r = applyAction(g, { type: "stage", seat: 1, plans: { acts: { s1: { type: "fire", dir: 0 } } } }, ctx);
      ok(r.error && r.error.code === "disarmed", "a disarmed ship cannot fire");
      // but a disarmed cruiser keeps its second move (the settled call)
      var g2 = duel(
        { cls: "cruiser", x: 5, y: 5, dir: 0, weapon: 0, dmg: [true, false] },
        { cls: "battleship", x: 15, y: 15, dir: 0, weapon: 0 },
        "action");
      var r2 = applyAction(g2, { type: "stage", seat: 0, plans: { acts: { s0: { type: "move", to: { x: 9, y: 5, dir: 0 } } } } }, ctx);
      ok(!r2.error, "a disarmed cruiser still takes its second move");
    })();

    /* sinking, victory, standings */
    (function () {
      var g = duel(
        { cls: "battleship", x: 2, y: 8, dir: 1, weapon: 0 },
        { cls: "cruiser", x: 8, y: 8, dir: 1, weapon: 0, dmg: [false, true] });
      g.phase = "action";
      g = stageCommit(g, [
        { type: "stage", seat: 0, plans: { acts: { s0: { type: "fire", dir: 0 } } } },
        { type: "commit", seat: 0 },
        { type: "stage", seat: 1, plans: { acts: { s1: { type: "pass" } } } },
        { type: "commit", seat: 1 },
      ]);
      eq(g.phase, "over", "sinking the last hull ends it");
      eq(g.winner, 0, "the survivor wins");
      ok(g.ships.s1.sunk, "the ship is sunk");
      eq(g.wrecks.length, 1, "the wreck is public");
      var st = standings(g);
      eq(st[0].rank, 1, "winner ranks 1");
      eq(st[1].rank, 2, "loser ranks 2");
      eq(g.seatStats[0].sunk, 1, "the kill is credited");
    })();

    /* commit mechanics: uncommit, lock, expiry */
    (function () {
      var g = duel(
        { cls: "destroyer", x: 5, y: 8, dir: 0, weapon: 0 },
        { cls: "destroyer", x: 13, y: 8, dir: 2, weapon: 0 });
      var r = applyAction(g, { type: "commit", seat: 0 }, ctx);
      ok(!r.error, "commit with nothing staged is legal (everything holds)");
      g = r.game;
      ok(g.committed[0] && !g.committed[1], "one side in");
      r = applyAction(g, { type: "uncommit", seat: 0 }, ctx);
      ok(!r.error && !r.game.committed[0], "uncommit retracts while the enemy is out");
      g.settings.lockCommit = true;
      r = applyAction(g, { type: "uncommit", seat: 0 }, ctx);
      ok(r.error && r.error.code === "locked", "the lobby lock makes commits binding");
      g.settings.lockCommit = false;
      // staging after commit is refused; expiry commits the staged set
      r = applyAction(g, { type: "stage", seat: 0, plans: { moves: {} } }, ctx);
      ok(r.error && r.error.code === "phase", "a committed side stages nothing");
      r = applyAction(g, { type: "timerExpire" }, ctx);
      ok(!r.error, "expiry commits everyone");
      eq(r.game.phase, "action", "…and the phase resolved");
      ok(r.game.events === undefined, "engine returns events beside the game");
    })();

    /* the anchor bot */
    (function () {
      var g = game1v1();
      var a = botAct(g, 1);
      ok(a && a.type === "stage" && a.auto, "bot auto-picks its draft");
      g.phase = "move";
      g.round = 1;
      var b = botAct(g, 1);
      ok(b && b.plans && b.plans.moves, "bot holds still in the move phase");
      var c = botAct({ phase: "over" }, 1);
      eq(c, null, "no bot action once it's over");
    })();

    /* masking (seat-keyed: seats 0-1 team 0, seats 2-3 team 1) */
    (function () {
      var e = { t: "news", team: 0, seats: [0, 1], items: [{ k: "held", ship: "s0" }] };
      eq(maskEventFor(e, 2).items.length, 0, "news is scrubbed for the other side");
      eq(maskEventFor(e, 1).items.length, 1, "…and delivered whole to its own");
      eq(maskEventFor(e, null).items.length, 1, "spectators are omniscient");
      var p = { t: "phase", phase: "move", round: 2 };
      eq(maskEventFor(p, 2), p, "public events pass through");
    })();

    /* the ships Colors wrapper: red is reserved */
    (function () {
      var base = { norm: function (v) { return /^#[0-9a-f]{6}$/.test(v) ? v : null; },
                   dist: function () { return 999; }, clash: function () { return -1; }, MIN_DIST: 60 };
      var C = makeColors(base);
      eq(C.PRESETS.length, 6, "six presets, none of them red");
      ok(C.PRESETS.every(function (h) { return !C.inRedBand(h); }), "…verified against the band");
      eq(C.norm("#d94141"), null, "the intel red is refused");
      eq(C.norm("#e03131"), null, "…and the band around it");
      ok(C.norm("#3b7dd8"), "blue passes");
      ok(C.norm("#801515") === null, "dark red is still red");
      ok(C.norm("#333333"), "grey passes (no hue)");
    })();

    var summary = "ships engine selfTest: " + pass + " passed, " + fail + " failed";
    if (typeof console !== "undefined") {
      console.log(summary);
      msgs.forEach(function (m) { console.log("  " + m); });
    }
    return { pass: pass, fail: fail, msgs: msgs };
  }

  /* node CLI: `node ships/engine.js` runs the checks */
  if (typeof module !== "undefined" && module.exports && typeof require !== "undefined" && typeof process !== "undefined" && require.main === module) {
    var r = selfTest();
    process.exit(r.fail ? 1 : 0);
  }
})();
