/* DeetsCities — rules engine (docs/cities.md, "Rules engine (engine.js)").

   PURE, environment-agnostic module: state + action → new state + events. No
   DOM, no I/O, no Date.now — the caller passes time and randomness in via
   `ctx = { rand, now }` (rand() → [0,1), like Math.random). applyAction never
   mutates its input; it clones, mutates the clone, and returns it.

     createGame(opts, ctx)            → game            (deals board, → setup)
     applyAction(game, action, ctx)   → { game, events } | { error: {code} }

   Illegal actions return a typed error and change nothing. Every rule is
   enforced here (the client's disabled pills are cosmetic). The worker repo
   carries a VERBATIM vendored copy — this file and its copy are contract and
   must stay byte-identical, exactly like the wire protocol.

   Browser: window.CitiesEngine. Node (self-checks): module.exports, and
   `node cities/engine.js` runs selfTest(). Board data comes from
   board-data.js (window.CITIES_BOARDS / require). */
(function () {
  "use strict";

  var RES = ["wood", "brick", "wheat", "sheep", "ore"];
  var DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

  /* board-data — window in the browser, require under node */
  var BOARDS = (typeof window !== "undefined" && window.CITIES_BOARDS)
    ? window.CITIES_BOARDS
    : (typeof require !== "undefined" ? require("./board-data.js") : null);

  /* ── small helpers ────────────────────────────────────────────── */
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function hkey(q, r) { return q + "," + r; }
  function emptyHand() { return { wood: 0, brick: 0, wheat: 0, sheep: 0, ore: 0 }; }
  function handSize(h) { var n = 0; for (var i = 0; i < RES.length; i++) n += h[RES[i]]; return n; }
  function randInt(ctx, n) { return Math.floor(ctx.rand() * n); }
  function die(ctx) { return 1 + randInt(ctx, 6); }
  function shuffle(ctx, a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = randInt(ctx, i + 1);
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ── geometry (docs/cities.md, "Coordinates — the canonical grid") ──
     Derives full vertex / edge adjacency from a hex list. Pointy-top axial.
     Vertex id "q,r,N|S"; edge id "q,r,NE|E|SE". */
  function corners(q, r) {
    return [
      q + "," + r + ",N",              // N
      (q + 1) + "," + (r - 1) + ",S",  // UR
      q + "," + (r + 1) + ",N",        // LR
      q + "," + r + ",S",              // S
      (q - 1) + "," + (r + 1) + ",N",  // LL
      q + "," + (r - 1) + ",S"         // UL
    ];
  }
  function ownEdges(q, r) {
    return [
      { id: q + "," + r + ",NE", v: [q + "," + r + ",N", (q + 1) + "," + (r - 1) + ",S"] },
      { id: q + "," + r + ",E",  v: [(q + 1) + "," + (r - 1) + ",S", q + "," + (r + 1) + ",N"] },
      { id: q + "," + r + ",SE", v: [q + "," + (r + 1) + ",N", q + "," + r + ",S"] }
    ];
  }
  function edgePair(q, r, d) {
    if (d === "NE") return [[q, r], [q + 1, r - 1]];
    if (d === "E")  return [[q, r], [q + 1, r]];
    return [[q, r], [q, r + 1]]; // SE
  }
  function deriveGeo(hexes) {
    var hexSet = {};
    hexes.forEach(function (h) { hexSet[hkey(h.q, h.r)] = true; });
    var vertexHexes = {}, hexVertices = {};
    hexes.forEach(function (h) {
      var cs = corners(h.q, h.r);
      hexVertices[hkey(h.q, h.r)] = cs;
      cs.forEach(function (v) { (vertexHexes[v] = vertexHexes[v] || []).push(hkey(h.q, h.r)); });
    });
    // canonical edges touching ≥1 real hex — scan real hexes ∪ neighbours
    var superset = {};
    hexes.forEach(function (h) {
      superset[hkey(h.q, h.r)] = { q: h.q, r: h.r };
      DIRS.forEach(function (d) { superset[hkey(h.q + d[0], h.r + d[1])] = { q: h.q + d[0], r: h.r + d[1] }; });
    });
    var edgeVertices = {}, vertexEdges = {}, vertexNeighbors = {};
    Object.keys(superset).forEach(function (k) {
      var h = superset[k];
      ownEdges(h.q, h.r).forEach(function (e) {
        var p = e.id.split(","), pr = edgePair(+p[0], +p[1], p[2]);
        var real = pr.filter(function (c) { return hexSet[hkey(c[0], c[1])]; });
        if (!real.length || edgeVertices[e.id]) return;
        edgeVertices[e.id] = e.v;
        e.v.forEach(function (v) { (vertexEdges[v] = vertexEdges[v] || []).push(e.id); });
        (vertexNeighbors[e.v[0]] = vertexNeighbors[e.v[0]] || []).push(e.v[1]);
        (vertexNeighbors[e.v[1]] = vertexNeighbors[e.v[1]] || []).push(e.v[0]);
      });
    });
    return {
      hexSet: hexSet, vertexHexes: vertexHexes, hexVertices: hexVertices,
      edgeVertices: edgeVertices, vertexEdges: vertexEdges, vertexNeighbors: vertexNeighbors
    };
  }
  function hexNeighbors(q, r) {
    return DIRS.map(function (d) { return { q: q + d[0], r: r + d[1] }; });
  }
  /* geometry for a game's board (cheap; derived per call) */
  function geoOf(board) {
    var g = deriveGeo(board.hexes);
    g.harborByVertex = {};
    (board.harbors || []).forEach(function (hb) {
      hb.vertices.forEach(function (v) {
        var cur = g.harborByVertex[v];
        // a vertex on two harbor edges keeps the better (2:1 beats 3:1)
        if (!cur || (cur === "any" && hb.type !== "any")) g.harborByVertex[v] = hb.type;
      });
    });
    return g;
  }

  /* ── board dealing (docs/cities.md, "Board generation") ────────── */
  function dealBoard(frame, ctx) {
    var def = BOARDS.BOARDS[frame];
    var geo = deriveGeo(def.hexes);
    var terrain = shuffle(ctx, def.terrain);
    var hexes = def.hexes.map(function (h, i) {
      return { q: h.q, r: h.r, terrain: terrain[i], token: null };
    });
    var nonDesert = hexes.filter(function (h) { return h.terrain !== "desert"; });
    // shuffle tokens onto non-desert hexes until no two 6/8 hexes are adjacent
    var ok = false, tries = 0;
    while (!ok && tries < 1000) {
      tries++;
      var toks = shuffle(ctx, def.tokens);
      nonDesert.forEach(function (h, i) { h.token = toks[i]; });
      ok = true;
      for (var a = 0; a < hexes.length && ok; a++) {
        var ha = hexes[a];
        if (ha.token !== 6 && ha.token !== 8) continue;
        var nb = hexNeighbors(ha.q, ha.r);
        for (var b = 0; b < nb.length; b++) {
          var hb = hexes.filter(function (x) { return x.q === nb[b].q && x.r === nb[b].r; })[0];
          if (hb && (hb.token === 6 || hb.token === 8)) { ok = false; break; }
        }
      }
    }
    // robber starts on a desert (the first)
    var desert = hexes.filter(function (h) { return h.terrain === "desert"; })[0];
    // harbours: shuffle types onto the fixed edge positions
    var types = shuffle(ctx, def.harborTypes);
    var harbors = def.harborEdges.map(function (edge, i) {
      return { edge: edge, type: types[i], vertices: geo.edgeVertices[edge].slice() };
    });
    return { frame: frame, hexes: hexes, robber: hkey(desert.q, desert.r), harbors: harbors };
  }

  /* ── new game (lobby → setup) ─────────────────────────────────── */
  function createGame(opts, ctx) {
    var seats = opts.seats;                 // [{name,color}]
    var n = seats.length;
    var frame = BOARDS.frameFor(n);
    var def = BOARDS.BOARDS[frame];
    var board = dealBoard(frame, ctx);
    var players = [];
    for (var i = 0; i < n; i++) {
      players.push({
        hand: emptyHand(),
        dev: [],                            // unplayed dev cards {card, turnBought}
        vpCards: 0,                         // hidden VP dev cards (subset bookkeeping)
        knights: 0,                         // knights played (largest army)
        supply: { settlement: def.pieces.settlement, city: def.pieces.city, road: def.pieces.road }
      });
    }
    // dev deck (server-side only, shuffled), as a flat draw pile
    var deck = [];
    ["knight", "vp", "road", "plenty", "monopoly"].forEach(function (c) {
      var k = c === "vp" ? def.dev.vp : def.dev[c];
      for (var j = 0; j < k; j++) deck.push(c);
    });
    deck = shuffle(ctx, deck);

    // snake-draft order: seats forward, then reverse
    var order = [];
    for (var s = 0; s < n; s++) order.push(s);
    for (var s2 = n - 1; s2 >= 0; s2--) order.push(s2);

    var bank = {};
    RES.forEach(function (rr) { bank[rr] = def.bank; });

    var game = {
      phase: "setup",
      frame: frame,
      board: board,
      seatCount: n,
      settings: opts.settings || { timerSec: 0, betting: false },
      players: players,
      bank: bank,
      devDeck: deck,
      buildings: {},                        // vid -> {seat, kind}
      roads: {},                            // eid -> seat
      awards: { longestRoad: null, largestArmy: null, roadLen: 0, armySize: 0 },
      roadLens: [],                         // per-seat longest contiguous road (public)
      offers: [],
      offerSeq: 0,
      turn: { seat: order[0], rolled: false, dice: null, devPlayed: false, pending: null },
      setup: { seq: order, i: 0, need: "settlement", lastVid: null },
      winner: null,
      stats: newStats(n, ctx.now),
      startedAt: ctx.now
    };
    return game;
  }

  function newStats(n, now) {
    var seats = [];
    for (var i = 0; i < n; i++) {
      seats.push({
        gained: { rolls: emptyHand(), steals: emptyHand(), trades: emptyHand(), dev: emptyHand() },
        lost: { discards: 0, robbed: 0, spent: 0 },
        rolls: { count: 0, hist: {} },
        pieces: { roads: 0, settlements: 0, cities: 0, devBought: 0, devPlayed: 0, knights: 0 },
        robber: { moved: 0, stolen: 0, victimized: 0 },
        biggestHaul: 0
      });
    }
    return { seats: seats, dice: {}, turns: 0, startedAt: now };
  }

  /* ── resource / cost helpers ──────────────────────────────────── */
  var COST = {
    road: { wood: 1, brick: 1 },
    settlement: { wood: 1, brick: 1, wheat: 1, sheep: 1 },
    city: { ore: 3, wheat: 2 },
    dev: { ore: 1, sheep: 1, wheat: 1 }
  };
  function canAfford(hand, cost) {
    for (var k in cost) if (hand[k] < cost[k]) return false;
    return true;
  }
  function pay(game, seat, cost) {
    var h = game.players[seat].hand, spent = 0;
    for (var k in cost) { h[k] -= cost[k]; game.bank[k] += cost[k]; spent += cost[k]; }
    game.stats.seats[seat].lost.spent += spent;
  }
  function gain(game, seat, res, n, src) {
    game.players[seat].hand[res] += n;
    game.bank[res] -= n;
    if (game.stats.seats[seat].gained[src]) game.stats.seats[seat].gained[src][res] += n;
  }

  /* ── board queries ────────────────────────────────────────────── */
  function occupied(game, vid) { return !!game.buildings[vid]; }
  function playerHarbors(game, geo, seat) {
    var out = {};
    for (var vid in game.buildings) {
      if (game.buildings[vid].seat !== seat) continue;
      var t = geo.harborByVertex[vid];
      if (t) out[t] = true;
    }
    return out;                             // { any:true, wheat:true, ... }
  }
  function tradeRate(harbors, give) {
    if (harbors[give]) return 2;
    if (harbors.any) return 3;
    return 4;
  }
  // vertex touches one of the seat's roads (for the settlement road-touch rule)
  function touchesOwnRoad(game, geo, seat, vid) {
    var edges = geo.vertexEdges[vid] || [];
    for (var i = 0; i < edges.length; i++) if (game.roads[edges[i]] === seat) return true;
    return false;
  }
  // edge connects to one of the seat's roads/buildings at either endpoint
  function roadConnects(game, geo, seat, eid) {
    var vs = geo.edgeVertices[eid];
    for (var i = 0; i < vs.length; i++) {
      var v = vs[i];
      if (game.buildings[v] && game.buildings[v].seat === seat) return true;
      // a road reaches through a vertex only if no opposing building sits on it
      if (game.buildings[v] && game.buildings[v].seat !== seat) continue;
      var edges = geo.vertexEdges[v] || [];
      for (var j = 0; j < edges.length; j++) {
        if (edges[j] !== eid && game.roads[edges[j]] === seat) return true;
      }
    }
    return false;
  }

  /* ── longest road (DFS; opponent buildings break the path) ─────── */
  function longestRoadFor(game, geo, seat) {
    var myEdges = Object.keys(game.roads).filter(function (e) { return game.roads[e] === seat; });
    if (!myEdges.length) return 0;
    var adj = {};                           // vid -> [ {to, eid} ]
    myEdges.forEach(function (eid) {
      var vs = geo.edgeVertices[eid];
      (adj[vs[0]] = adj[vs[0]] || []).push({ to: vs[1], eid: eid });
      (adj[vs[1]] = adj[vs[1]] || []).push({ to: vs[0], eid: eid });
    });
    function blocked(v) { return game.buildings[v] && game.buildings[v].seat !== seat; }
    var best = 0;
    function dfs(v, used, len) {
      if (len > best) best = len;
      if (blocked(v)) return;               // path cannot continue through an opponent
      (adj[v] || []).forEach(function (nx) {
        if (used[nx.eid]) return;
        used[nx.eid] = 1;
        dfs(nx.to, used, len + 1);
        used[nx.eid] = 0;
      });
    }
    Object.keys(adj).forEach(function (v) { dfs(v, {}, 0); });
    return best;
  }
  function recomputeLongestRoad(game, geo, events) {
    var n = game.seatCount, lens = [];
    for (var s = 0; s < n; s++) lens.push(longestRoadFor(game, geo, s));
    game.roadLens = lens;                    // per-seat longest path, for the players-tile pill
    var holder = game.awards.longestRoad;
    var holderLen = holder != null ? lens[holder] : 0;
    // holder loses it only if below 5 or overtaken; ties keep the holder
    var max = Math.max.apply(null, lens);
    if (max < 5) {
      if (holder != null && holderLen < 5) setAward(game, "longestRoad", null, events);
    } else {
      // does the current holder still lead (keep-on-tie)?
      if (holder != null && holderLen === max && holderLen >= 5) { game.awards.roadLen = max; return; }
      var leaders = [];
      for (var s2 = 0; s2 < n; s2++) if (lens[s2] === max) leaders.push(s2);
      if (leaders.length === 1) setAward(game, "longestRoad", leaders[0], events);
      else if (holder != null && holderLen === max) { /* keep */ }
      else setAward(game, "longestRoad", null, events);   // tie among new claimants → unclaimed
    }
    game.awards.roadLen = max;
  }
  function recomputeArmy(game, events) {
    var n = game.seatCount, holder = game.awards.largestArmy;
    var max = 0;
    for (var s = 0; s < n; s++) max = Math.max(max, game.players[s].knights);
    if (max < 3) return;
    var holderCt = holder != null ? game.players[holder].knights : 0;
    if (holder != null && holderCt === max) { game.awards.armySize = max; return; }  // keep-on-tie
    var leaders = [];
    for (var s2 = 0; s2 < n; s2++) if (game.players[s2].knights === max) leaders.push(s2);
    if (leaders.length === 1) { setAward(game, "largestArmy", leaders[0], events); game.awards.armySize = max; }
  }
  function setAward(game, kind, seat, events) {
    if (game.awards[kind] === seat) return;
    game.awards[kind] = seat;
    events.push({ t: "award", kind: kind, seat: seat });
  }

  /* ── victory points ───────────────────────────────────────────── */
  function publicVP(game, seat) {
    var vp = 0;
    for (var v in game.buildings) {
      if (game.buildings[v].seat !== seat) continue;
      vp += game.buildings[v].kind === "city" ? 2 : 1;
    }
    if (game.awards.longestRoad === seat) vp += 2;
    if (game.awards.largestArmy === seat) vp += 2;
    return vp;
  }
  function totalVP(game, seat) { return publicVP(game, seat) + game.players[seat].vpCards; }
  function publicVPList(game) {
    var out = [];
    for (var s = 0; s < game.seatCount; s++) out.push(publicVP(game, s));
    return out;
  }
  function checkWin(game, seat, events) {
    if (game.phase !== "main") return;
    if (totalVP(game, seat) >= BOARDS.BOARDS[game.frame].winVP) {
      game.phase = "over";
      game.winner = seat;
      game.turn.pending = null;
      game.offers = [];
      events.push({ t: "win", seat: seat });
    }
  }

  /* ── error helper ─────────────────────────────────────────────── */
  function err(code) { return { error: { code: code } }; }

  /* ═══ ACTION DISPATCH ══════════════════════════════════════════ */
  function applyAction(game, action, ctx) {
    if (!action || !action.type) return err("bad");
    var handler = ACTIONS[action.type];
    if (!handler) return err("bad");
    var g = clone(game);
    var events = [];
    var res = handler(g, action, ctx, events);
    if (res && res.error) return res;       // rejected — original untouched
    return { game: g, events: events };
  }

  var ACTIONS = {
    /* ── setup: snake-draft settlement + road ─────────────────── */
    place: function (g, a, ctx, events) {
      if (g.phase === "setup") return placeSetup(g, a, ctx, events);
      if (g.phase !== "main") return err("phase");
      return placeMain(g, a, ctx, events);
    },

    roll: function (g, a, ctx, events) {
      if (g.phase !== "main") return err("phase");
      var t = g.turn;
      if (t.rolled) return err("turn");
      if (t.pending) return err("phase");
      var d = [die(ctx), die(ctx)], sum = d[0] + d[1];
      t.rolled = true; t.dice = d;
      events.push({ t: "roll", seat: t.seat, d: d });
      var st = g.stats.seats[t.seat].rolls;
      st.count++; st.hist[sum] = (st.hist[sum] || 0) + 1;
      g.stats.dice[sum] = (g.stats.dice[sum] || 0) + 1;
      if (sum === 7) return startRobber(g, ctx, events, false);
      produce(g, sum, events);
      return null;
    },

    endTurn: function (g, a, ctx, events) {
      if (g.phase !== "main") return err("phase");
      var t = g.turn;
      if (!t.rolled) return err("turn");
      if (t.pending) return err("phase");
      nextTurn(g);
      events.push({ t: "turn", seat: g.turn.seat, n: g.stats.turns });
      return null;
    },

    buyDev: function (g, a, ctx, events) {
      if (g.phase !== "main" || !g.turn.rolled || g.turn.pending) return err("phase");
      var seat = g.turn.seat, p = g.players[seat];
      if (!g.devDeck.length) return err("empty");
      if (!canAfford(p.hand, COST.dev)) return err("cost");
      pay(g, seat, COST.dev);
      var card = g.devDeck.shift();
      if (card === "vp") p.vpCards++;
      p.dev.push({ card: card, turnBought: g.stats.turns });
      g.stats.seats[seat].pieces.devBought++;
      events.push({ t: "devBought", seat: seat });
      if (card === "vp") checkWin(g, seat, events);   // a bought VP can win instantly
      return null;
    },

    playDev: function (g, a, ctx, events) { return playDev(g, a, ctx, events); },

    discard: function (g, a, ctx, events) { return discard(g, a, ctx, events); },

    moveRobber: function (g, a, ctx, events) { return moveRobber(g, a, ctx, events); },

    steal: function (g, a, ctx, events) { return steal(g, a, ctx, events); },

    bankTrade: function (g, a, ctx, events) { return bankTrade(g, a, ctx, events); },

    offer: function (g, a, ctx, events) { return offer(g, a, ctx, events); },
    respond: function (g, a, ctx, events) { return respond(g, a, ctx, events); },
    close: function (g, a, ctx, events) { return closeOffer(g, a, ctx, events); },
    cancel: function (g, a, ctx, events) { return cancelOffer(g, a, ctx, events); },

    /* timer expiry — the DO/mock calls this on alarm (docs/cities.md, Timers) */
    timerExpire: function (g, a, ctx, events) { return timerExpire(g, a, ctx, events); }
  };

  /* ── setup placement ──────────────────────────────────────────── */
  function placeSetup(g, a, ctx, events) {
    var seat = g.setup.seq[g.setup.i];
    if (a.seat != null && a.seat !== seat) return err("turn");
    var geo = geoOf(g.board), loc = a.loc;
    if (g.setup.need === "settlement") {
      if (a.kind !== "settlement") return err("loc");
      if (!geo.vertexHexes[loc]) return err("loc");
      if (occupied(g, loc)) return err("loc");
      // distance rule — no adjacent occupied vertex
      var nbrs = geo.vertexNeighbors[loc] || [];
      for (var i = 0; i < nbrs.length; i++) if (occupied(g, nbrs[i])) return err("loc");
      // the mandatory adjoining road needs a free edge here — refuse a vertex
      // whose edges all carry roads already, or the draft softlocks (seen in
      // 6-player games: clustered first-pass roads can ring a vertex)
      var vEdges = geo.vertexEdges[loc] || [], freeEdge = false;
      for (var k = 0; k < vEdges.length; k++) if (g.roads[vEdges[k]] == null) { freeEdge = true; break; }
      if (!freeEdge) return err("loc");
      if (g.players[seat].supply.settlement <= 0) return err("supply");
      g.buildings[loc] = { seat: seat, kind: "settlement" };
      g.players[seat].supply.settlement--;
      g.stats.seats[seat].pieces.settlements++;
      events.push({ t: "build", seat: seat, kind: "settlement", loc: loc });
      // second settlement (reverse pass) pays one of each adjacent non-desert hex
      if (g.setup.i >= g.seatCount) {
        (geo.vertexHexes[loc] || []).forEach(function (hk) {
          var hex = hexAt(g, hk);
          if (hex && hex.terrain !== "desert") {
            gain(g, seat, hex.terrain, 1, "rolls");
            events.push({ t: "gain", seat: seat, res: hex.terrain, n: 1, src: "roll" });
          }
        });
      }
      g.setup.need = "road";
      g.setup.lastVid = loc;
      return null;
    }
    // road adjoining the settlement just placed
    if (a.kind !== "road") return err("loc");
    if (!geo.edgeVertices[loc]) return err("loc");
    if (g.roads[loc] != null) return err("loc");
    var ends = geo.edgeVertices[loc];
    if (ends[0] !== g.setup.lastVid && ends[1] !== g.setup.lastVid) return err("loc");
    g.roads[loc] = seat;
    g.players[seat].supply.road--;
    g.stats.seats[seat].pieces.roads++;
    events.push({ t: "build", seat: seat, kind: "road", loc: loc });
    recomputeLongestRoad(g, geo, events);   // keep per-seat roadLens live through setup
    // advance the draft
    g.setup.i++;
    g.setup.lastVid = null;
    if (g.setup.i >= g.setup.seq.length) {
      g.phase = "main";
      g.setup = null;
      g.turn = { seat: 0, rolled: false, dice: null, devPlayed: false, pending: null };
      g.stats.turns = 1;
      events.push({ t: "turn", seat: 0, n: 1 });
    } else {
      g.setup.need = "settlement";
      g.turn.seat = g.setup.seq[g.setup.i];
    }
    return null;
  }

  function hexAt(g, hk) {
    for (var i = 0; i < g.board.hexes.length; i++) {
      if (hkey(g.board.hexes[i].q, g.board.hexes[i].r) === hk) return g.board.hexes[i];
    }
    return null;
  }

  /* ── main-phase build ─────────────────────────────────────────── */
  function placeMain(g, a, ctx, events) {
    var t = g.turn, seat = t.seat;
    if (a.seat != null && a.seat !== seat) return err("turn");
    if (!t.rolled) return err("turn");
    // free-road placement from a road-building card
    var freeRoad = t.pending && t.pending.kind === "roads";
    if (t.pending && !freeRoad) return err("phase");
    var geo = geoOf(g.board), loc = a.loc, p = g.players[seat];

    if (a.kind === "road") {
      if (!geo.edgeVertices[loc]) return err("loc");
      if (g.roads[loc] != null) return err("loc");
      if (p.supply.road <= 0) return err("supply");
      if (!roadConnects(g, geo, seat, loc)) return err("loc");
      if (!freeRoad) {
        if (!canAfford(p.hand, COST.road)) return err("cost");
        pay(g, seat, COST.road);
      }
      g.roads[loc] = seat; p.supply.road--;
      g.stats.seats[seat].pieces.roads++;
      events.push({ t: "build", seat: seat, kind: "road", loc: loc });
      if (freeRoad) {
        t.pending.left--;
        if (t.pending.left <= 0 || p.supply.road <= 0) t.pending = null;
      }
      recomputeLongestRoad(g, geo, events);
      checkWin(g, seat, events);
      return null;
    }
    if (a.kind === "settlement") {
      if (t.pending) return err("phase");
      if (!geo.vertexHexes[loc]) return err("loc");
      if (occupied(g, loc)) return err("loc");
      var nbrs = geo.vertexNeighbors[loc] || [];
      for (var i = 0; i < nbrs.length; i++) if (occupied(g, nbrs[i])) return err("loc");
      if (!touchesOwnRoad(g, geo, seat, loc)) return err("loc");
      if (p.supply.settlement <= 0) return err("supply");
      if (!canAfford(p.hand, COST.settlement)) return err("cost");
      pay(g, seat, COST.settlement);
      g.buildings[loc] = { seat: seat, kind: "settlement" };
      p.supply.settlement--;
      g.stats.seats[seat].pieces.settlements++;
      events.push({ t: "build", seat: seat, kind: "settlement", loc: loc });
      recomputeLongestRoad(g, geo, events);   // a new settlement can break a road
      checkWin(g, seat, events);
      return null;
    }
    if (a.kind === "city") {
      if (t.pending) return err("phase");
      var b = g.buildings[loc];
      if (!b || b.seat !== seat || b.kind !== "settlement") return err("loc");
      if (p.supply.city <= 0) return err("supply");
      if (!canAfford(p.hand, COST.city)) return err("cost");
      pay(g, seat, COST.city);
      b.kind = "city";
      p.supply.city--; p.supply.settlement++;   // the settlement returns to supply
      g.stats.seats[seat].pieces.cities++;
      events.push({ t: "build", seat: seat, kind: "city", loc: loc });
      checkWin(g, seat, events);
      return null;
    }
    return err("loc");
  }

  /* ── production ───────────────────────────────────────────────── */
  function produce(g, sum, events) {
    var geo = geoOf(g.board);
    // gather per-resource, per-seat demand from hexes showing `sum`
    var demand = {};   // res -> { seat: amount }
    g.board.hexes.forEach(function (hex) {
      if (hex.token !== sum) return;
      if (g.board.robber === hkey(hex.q, hex.r)) return;   // robber blocks
      var verts = geo.hexVertices[hkey(hex.q, hex.r)] || [];
      verts.forEach(function (v) {
        var b = g.buildings[v];
        if (!b) return;
        var amt = b.kind === "city" ? 2 : 1;
        demand[hex.terrain] = demand[hex.terrain] || {};
        demand[hex.terrain][b.seat] = (demand[hex.terrain][b.seat] || 0) + amt;
      });
    });
    RES.forEach(function (res) {
      var d = demand[res]; if (!d) return;
      var seats = Object.keys(d);
      var total = seats.reduce(function (s, k) { return s + d[k]; }, 0);
      if (total <= g.bank[res]) {
        seats.forEach(function (k) { payProduce(g, +k, res, d[k], events); });
      } else if (seats.length === 1) {
        // a single player collects whatever remains (bank-empty rule)
        var only = +seats[0], give = g.bank[res];
        if (give > 0) payProduce(g, only, res, give, events);
      }
      // else: multiple players owed, bank can't cover → nobody gets it
    });
  }
  function payProduce(g, seat, res, n, events) {
    gain(g, seat, res, n, "rolls");
    events.push({ t: "gain", seat: seat, res: res, n: n, src: "roll" });
    if (n > g.stats.seats[seat].biggestHaul) g.stats.seats[seat].biggestHaul = n;
  }

  /* ── robber flow: discard → move → steal ──────────────────────── */
  function startRobber(g, ctx, events, viaKnight) {
    var owed = {};
    for (var s = 0; s < g.seatCount; s++) {
      var n = handSize(g.players[s].hand);
      if (n > 7) owed[s] = Math.floor(n / 2);
    }
    events.push({ t: "robber7", seat: g.turn.seat });
    if (Object.keys(owed).length) {
      g.turn.pending = { kind: "discard", owed: owed, viaKnight: viaKnight, next: "robber" };
    } else {
      g.turn.pending = { kind: "robber", viaKnight: viaKnight };
    }
    return null;
  }
  function discard(g, a, ctx, events) {
    var p = g.turn.pending;
    if (!p || p.kind !== "discard") return err("phase");
    var seat = a.seat;
    if (seat == null || p.owed[seat] == null) return err("turn");
    var need = p.owed[seat], cards = a.cards || {};
    var tot = 0; RES.forEach(function (r) { tot += (cards[r] || 0); });
    if (tot !== need) return err("cost");
    var hand = g.players[seat].hand;
    for (var i = 0; i < RES.length; i++) {
      var r = RES[i], c = cards[r] || 0;
      if (c < 0 || hand[r] < c) return err("cost");
    }
    var disc = {};
    RES.forEach(function (r) {
      var c = cards[r] || 0;
      hand[r] -= c; g.bank[r] += c;
      if (c) disc[r] = c;
    });
    g.stats.seats[seat].lost.discards += need;
    // composition is public: discards land face-up in the bank
    events.push({ t: "discard", seat: seat, n: need, cards: disc });
    delete p.owed[seat];
    if (!Object.keys(p.owed).length) g.turn.pending = { kind: "robber", viaKnight: p.viaKnight };
    return null;
  }
  function moveRobber(g, a, ctx, events) {
    var p = g.turn.pending;
    if (!p || p.kind !== "robber") return err("phase");
    if (a.seat != null && a.seat !== g.turn.seat) return err("turn");
    var hk = a.hex;
    if (!geoOf(g.board).hexSet[hk]) return err("loc");
    if (hk === g.board.robber) return err("loc");     // must move to a different hex
    g.board.robber = hk;
    g.stats.seats[g.turn.seat].robber.moved++;
    events.push({ t: "robber", seat: g.turn.seat, hex: hk });
    // targets: other players with a building on this hex
    var geo = geoOf(g.board), verts = geo.hexVertices[hk] || [], targets = {};
    verts.forEach(function (v) {
      var b = g.buildings[v];
      if (b && b.seat !== g.turn.seat && handSize(g.players[b.seat].hand) > 0) targets[b.seat] = true;
    });
    var list = Object.keys(targets).map(Number);
    if (list.length) g.turn.pending = { kind: "steal", hex: hk, targets: list };
    else g.turn.pending = null;
    return null;
  }
  function steal(g, a, ctx, events) {
    var p = g.turn.pending;
    if (!p || p.kind !== "steal") return err("phase");
    if (a.seat != null && a.seat !== g.turn.seat) return err("turn");
    var victim = a.target;
    if (p.targets.indexOf(victim) < 0) return err("loc");
    var vhand = g.players[victim].hand, pool = [];
    RES.forEach(function (r) { for (var i = 0; i < vhand[r]; i++) pool.push(r); });
    if (pool.length) {
      var res = pool[randInt(ctx, pool.length)];
      vhand[res]--; g.players[g.turn.seat].hand[res]++;
      g.stats.seats[g.turn.seat].robber.stolen++;
      g.stats.seats[victim].robber.victimized++;
      g.stats.seats[victim].lost.robbed++;
      g.stats.seats[g.turn.seat].gained.steals[res]++;
      // the resource identity rides only the two parties' `you` (transport layer)
      events.push({ t: "stealHidden", from: victim, to: g.turn.seat, res: res });
    }
    g.turn.pending = null;
    return null;
  }

  /* ── dev cards ────────────────────────────────────────────────── */
  function playDev(g, a, ctx, events) {
    if (g.phase !== "main") return err("phase");
    var t = g.turn, seat = t.seat, card = a.card;
    if (a.seat != null && a.seat !== seat) return err("turn");
    if (t.devPlayed) return err("turn");             // one dev per turn
    if (card === "vp") return err("perm");           // VP cards are never played
    if (t.pending && !(card === "knight" && t.pending.kind === "robber")) return err("phase");
    // knights may be played before rolling; other cards need an active turn too
    // find an owned, not-bought-this-turn card of this type
    var p = g.players[seat], idx = -1;
    for (var i = 0; i < p.dev.length; i++) {
      if (p.dev[i].card === card && p.dev[i].turnBought !== g.stats.turns) { idx = i; break; }
    }
    if (idx < 0) return err("cost");
    if (card === "knight") {
      p.dev.splice(idx, 1);
      p.knights++;
      t.devPlayed = true;
      g.stats.seats[seat].pieces.devPlayed++;
      g.stats.seats[seat].pieces.knights++;
      events.push({ t: "devPlayed", seat: seat, card: "knight" });
      recomputeArmy(g, events);
      checkWin(g, seat, events);              // largest army can win
      if (g.phase !== "main") return null;
      // knight acts as a 7's robber move, without the discard
      t.pending = { kind: "robber", viaKnight: true };
      return null;
    }
    // progress cards require the player to have rolled first (an in-turn action)
    if (!t.rolled) return err("turn");
    if (card === "road") {
      p.dev.splice(idx, 1); t.devPlayed = true;
      g.stats.seats[seat].pieces.devPlayed++;
      events.push({ t: "devPlayed", seat: seat, card: "road" });
      var left = Math.min(2, p.supply.road);
      if (left <= 0) return null;             // no pieces — the card fizzles
      t.pending = { kind: "roads", left: left };
      return null;
    }
    if (card === "plenty") {
      var picks = a.args || {};
      var want = [picks.a, picks.b].filter(function (x) { return x; });
      if (want.length !== 2) return err("cost");
      if (RES.indexOf(want[0]) < 0 || RES.indexOf(want[1]) < 0) return err("cost");
      p.dev.splice(idx, 1); t.devPlayed = true;
      g.stats.seats[seat].pieces.devPlayed++;
      events.push({ t: "devPlayed", seat: seat, card: "plenty" });
      want.forEach(function (r) {
        if (g.bank[r] > 0) {
          gain(g, seat, r, 1, "dev");
          events.push({ t: "gain", seat: seat, res: r, n: 1, src: "dev" });
        }
      });
      return null;
    }
    if (card === "monopoly") {
      var res = a.args && a.args.resource;
      if (RES.indexOf(res) < 0) return err("cost");
      p.dev.splice(idx, 1); t.devPlayed = true;
      g.stats.seats[seat].pieces.devPlayed++;
      var took = 0;
      for (var s = 0; s < g.seatCount; s++) {
        if (s === seat) continue;
        var give = g.players[s].hand[res];
        if (give > 0) {
          g.players[s].hand[res] = 0;
          g.players[seat].hand[res] += give;
          g.stats.seats[seat].gained.steals[res] += give;
          took += give;
        }
      }
      events.push({ t: "devPlayed", seat: seat, card: "monopoly" });
      events.push({ t: "monopoly", seat: seat, res: res, n: took });   // amount is public
      return null;
    }
    return err("bad");
  }

  /* ── bank / harbour trade ─────────────────────────────────────── */
  function bankTrade(g, a, ctx, events) {
    if (g.phase !== "main" || !g.turn.rolled || g.turn.pending) return err("phase");
    var seat = g.turn.seat, give = a.give, get = a.get;
    var n = a.n == null ? 1 : a.n;                    // optional multi-unit trade
    if (n !== Math.floor(n) || n < 1) return err("rate");
    if (RES.indexOf(give) < 0 || RES.indexOf(get) < 0 || give === get) return err("rate");
    if (g.bank[get] < n) return err("empty");
    var geo = geoOf(g.board);
    var rate = tradeRate(playerHarbors(g, geo, seat), give);
    if (g.players[seat].hand[give] < rate * n) return err("cost");
    g.players[seat].hand[give] -= rate * n; g.bank[give] += rate * n;
    g.players[seat].hand[get] += n; g.bank[get] -= n;
    g.stats.seats[seat].gained.trades[get] += n;
    events.push({ t: "bankTrade", seat: seat, give: give, get: get, rate: rate, n: n });
    return null;
  }

  /* ── player trading (docs/cities.md, "Trading") ───────────────── */
  function validGiveGet(gg) {
    if (!gg) return false;
    var tot = 0;
    for (var i = 0; i < RES.length; i++) {
      var c = gg[RES[i]] || 0;
      if (c < 0 || c !== Math.floor(c)) return false;
      tot += c;
    }
    return tot > 0;   // no empty side — no gifts
  }
  function handHas(hand, gg) {
    for (var i = 0; i < RES.length; i++) if (hand[RES[i]] < (gg[RES[i]] || 0)) return false;
    return true;
  }
  function moveBundle(from, to, gg) {
    RES.forEach(function (r) { var c = gg[r] || 0; from[r] -= c; to[r] += c; });
  }
  function offer(g, a, ctx, events) {
    if (g.phase !== "main" || !g.turn.rolled || g.turn.pending) return err("phase");
    var seat = a.seat;
    if (seat == null || seat < 0 || seat >= g.seatCount) return err("turn");
    if (!validGiveGet(a.give) || !validGiveGet(a.get)) return err("rate");
    // one open offer per proposer
    g.offers = g.offers.filter(function (o) { return o.from !== seat; });
    var o = {
      id: "o" + (g.offerSeq++),
      from: seat,
      toCurrent: seat !== g.turn.seat,       // non-current = a proposal to the current player
      give: clone(a.give), get: clone(a.get),
      responses: {}
    };
    g.offers.push(o);
    events.push({ t: "offer", id: o.id, from: seat });
    return null;
  }
  function respond(g, a, ctx, events) {
    var o = g.offers.filter(function (x) { return x.id === a.offerId; })[0];
    if (!o) return err("loc");
    var seat = a.seat;
    if (seat == null || seat === o.from) return err("turn");
    if (a.action === "counter") {
      if (!validGiveGet(a.give) || !validGiveGet(a.get)) return err("rate");
      // a counter is a fresh offer from the responder
      g.offers = g.offers.filter(function (x) { return x.from !== seat; });
      var c = { id: "o" + (g.offerSeq++), from: seat, toCurrent: seat !== g.turn.seat,
                give: clone(a.give), get: clone(a.get), responses: {} };
      g.offers.push(c);
      events.push({ t: "offer", id: c.id, from: seat });
      return null;
    }
    o.responses[seat] = a.action === "accept" ? "accept" : "decline";
    // a proposal aimed at the current player: their accept closes it immediately
    if (o.toCurrent && seat === g.turn.seat && a.action === "accept") {
      return execTrade(g, o, o.from, g.turn.seat, events);
    }
    events.push({ t: "respond", id: o.id, seat: seat, action: o.responses[seat] });
    // a dead offer leaves the table: everyone whose accept could still close
    // it has declined (open offer: all non-proposers; proposal: current player)
    var dead = o.toCurrent
      ? o.responses[g.turn.seat] === "decline"
      : (function () { for (var s = 0; s < g.seatCount; s++) if (s !== o.from && o.responses[s] !== "decline") return false; return true; })();
    if (dead) {
      g.offers = g.offers.filter(function (x) { return x.id !== o.id; });
      events.push({ t: "offerGone", id: o.id, declined: true });
    }
    return null;
  }
  function closeOffer(g, a, ctx, events) {
    // the current player closes their own open offer with one accepter;
    // the accepter rides `accepter` — `seat` is the actor, which the
    // transport injects and would otherwise clobber the accepter's seat
    var o = g.offers.filter(function (x) { return x.id === a.offerId; })[0];
    if (!o) return err("loc");
    if (g.turn.seat !== o.from) return err("turn");
    if (a.seat != null && a.seat !== o.from) return err("turn");
    var acc = a.accepter;
    if (acc == null || o.responses[acc] !== "accept") return err("loc");
    return execTrade(g, o, o.from, acc, events);
  }
  function execTrade(g, o, giver, taker, events) {
    // giver hands `give`, receives `get`; re-validate both sides at close
    var gh = g.players[giver].hand, th = g.players[taker].hand;
    if (!handHas(gh, o.give) || !handHas(th, o.get)) return err("cost");
    moveBundle(gh, th, o.give);
    moveBundle(th, gh, o.get);
    g.offers = g.offers.filter(function (x) { return x.id !== o.id; });
    events.push({ t: "trade", from: giver, to: taker, give: clone(o.give), get: clone(o.get) });
    return null;
  }
  function cancelOffer(g, a, ctx, events) {
    var o = g.offers.filter(function (x) { return x.id === a.offerId; })[0];
    if (!o) return err("loc");
    if (o.from !== a.seat) return err("turn");
    g.offers = g.offers.filter(function (x) { return x.id !== a.offerId; });
    events.push({ t: "offerGone", id: a.offerId });
    return null;
  }

  /* ── turn advance ─────────────────────────────────────────────── */
  function nextTurn(g) {
    g.offers = [];
    g.turn.seat = (g.turn.seat + 1) % g.seatCount;
    g.turn.rolled = false; g.turn.dice = null; g.turn.devPlayed = false; g.turn.pending = null;
    g.stats.turns++;
  }

  /* ── timer expiry (auto-resolve the pending obligation, end turn) ─ */
  function timerExpire(g, a, ctx, events) {
    if (g.phase !== "main") return err("phase");
    var t = g.turn, p = t.pending;
    if (p && p.kind === "discard") {
      // random discard for every straggler (its own shorter window upstream)
      Object.keys(p.owed).forEach(function (sk) {
        var seat = +sk, need = p.owed[seat], hand = g.players[seat].hand, pool = [], disc = {};
        RES.forEach(function (r) { for (var i = 0; i < hand[r]; i++) pool.push(r); });
        for (var k = 0; k < need && pool.length; k++) {
          var j = randInt(ctx, pool.length), r2 = pool.splice(j, 1)[0];
          hand[r2]--; g.bank[r2]++;
          disc[r2] = (disc[r2] || 0) + 1;
        }
        g.stats.seats[seat].lost.discards += need;
        events.push({ t: "discard", seat: seat, n: need, cards: disc });
      });
      g.turn.pending = { kind: "robber", viaKnight: p.viaKnight };
      p = g.turn.pending;
    }
    if (p && p.kind === "robber") {
      // move to a random legal hex, no steal
      var hexes = g.board.hexes.filter(function (h) { return hkey(h.q, h.r) !== g.board.robber; });
      var pick = hexes[randInt(ctx, hexes.length)];
      g.board.robber = hkey(pick.q, pick.r);
      events.push({ t: "robber", seat: t.seat, hex: g.board.robber });
      g.turn.pending = null;
    }
    if (g.turn.pending && g.turn.pending.kind === "steal") g.turn.pending = null;
    if (g.turn.pending && g.turn.pending.kind === "roads") g.turn.pending = null;
    if (!t.rolled) {
      // auto-roll for an idle player, then end (production applied)
      var d = [die(ctx), die(ctx)], sum = d[0] + d[1];
      t.rolled = true; t.dice = d;
      events.push({ t: "roll", seat: t.seat, d: d });
      g.stats.dice[sum] = (g.stats.dice[sum] || 0) + 1;
      if (sum === 7) { startRobber(g, ctx, events, false); return timerExpire(g, a, ctx, events); }
      produce(g, sum, events);
    }
    if (!g.turn.pending) { nextTurn(g); events.push({ t: "turn", seat: g.turn.seat, n: g.stats.turns }); }
    return null;
  }

  /* ═══ PUBLIC API ═══════════════════════════════════════════════ */
  var API = {
    RES: RES,
    createGame: createGame,
    applyAction: applyAction,
    deriveGeo: deriveGeo,
    geoOf: geoOf,
    publicVP: publicVP,
    totalVP: totalVP,
    publicVPList: publicVPList,
    playerHarbors: playerHarbors,
    tradeRate: tradeRate,
    longestRoadFor: longestRoadFor
  };

  API.selfTest = selfTest;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.CitiesEngine = API;

  /* ═══ SELF-CHECKS ══════════════════════════════════════════════
     Pure assertions — no DOM. Run with `node cities/engine.js`. Kept in
     the one engine file by design (docs/cities.md: "one shared file"). */
  function selfTest() {
    var pass = 0, fail = 0, msgs = [];
    function ok(cond, name) { if (cond) pass++; else { fail++; msgs.push("FAIL: " + name); } }
    function eq(a, b, name) { ok(a === b, name + " (got " + a + ", want " + b + ")"); }
    var seq = 12345;
    function rng() { seq = (seq * 1103515245 + 12345) & 0x7fffffff; return seq / 0x7fffffff; }
    var ctx = { rand: rng, now: 1000 };

    /* geometry — both frames close, every coastal vertex degree 2 */
    ["base", "expanded"].forEach(function (frame) {
      var def = BOARDS.BOARDS[frame];
      var geo = deriveGeo(def.hexes);
      eq(def.hexes.length, frame === "base" ? 19 : 30, frame + " hex count");
      // every hex has 6 corners, each an existing vertex
      var allV = true;
      def.hexes.forEach(function (h) {
        (geo.hexVertices[hkey(h.q, h.r)] || []).forEach(function (v) { if (!geo.vertexHexes[v]) allV = false; });
      });
      ok(allV, frame + " every corner is a real vertex");
      // interior vertices touch 3 hexes, coastal 1-2, never 0 or >3
      var vok = true;
      Object.keys(geo.vertexHexes).forEach(function (v) {
        var c = geo.vertexHexes[v].length; if (c < 1 || c > 3) vok = false;
      });
      ok(vok, frame + " vertex hex-degree in [1,3]");
      // harbours resolve to two real vertices each
      var hok = def.harborEdges.every(function (e) { return geo.edgeVertices[e] && geo.edgeVertices[e].length === 2; });
      ok(hok, frame + " every harbor edge has 2 vertices");
      eq(def.terrain.length, def.hexes.length, frame + " terrain fills every hex");
      eq(def.tokens.length, def.hexes.length - def.terrain.filter(function (t) { return t === "desert"; }).length, frame + " one token per non-desert hex");
    });

    /* board deal — token counts, 6/8 non-adjacency, robber on desert */
    (function () {
      var g = createGame({ seats: [{}, {}, {}], settings: {} }, ctx);
      eq(g.frame, "base", "3 players → base frame");
      var withTok = g.board.hexes.filter(function (h) { return h.token != null; }).length;
      eq(withTok, 18, "18 tokens placed");
      var robberHex = g.board.hexes.filter(function (h) { return hkey(h.q, h.r) === g.board.robber; })[0];
      eq(robberHex.terrain, "desert", "robber starts on desert");
      // 6/8 non-adjacency
      var adjBad = false;
      g.board.hexes.forEach(function (h) {
        if (h.token !== 6 && h.token !== 8) return;
        hexNeighbors(h.q, h.r).forEach(function (nb) {
          var o = g.board.hexes.filter(function (x) { return x.q === nb.q && x.r === nb.r; })[0];
          if (o && (o.token === 6 || o.token === 8)) adjBad = true;
        });
      });
      ok(!adjBad, "no two 6/8 hexes adjacent");
      eq(g.phase, "setup", "new game starts in setup");
      eq(g.devDeck.length, 25, "base dev deck = 25");
    })();

    /* full setup snake draft + a scripted hot-seat game to `over` */
    (function () {
      var g = createGame({ seats: [{ name: "A" }, { name: "B" }, { name: "C" }], settings: { timerSec: 0 } }, ctx);
      var geo = geoOf(g.board);
      // helper: apply and unwrap, asserting success
      function act(a) {
        var r = applyAction(g, a, ctx);
        if (r.error) { fail++; msgs.push("FAIL action " + a.type + " → " + r.error.code); return false; }
        g = r.game; return true;
      }
      // pick a legal settlement vertex honoring the distance rule
      function freeVertex() {
        var vs = Object.keys(geo.vertexHexes);
        for (var i = 0; i < vs.length; i++) {
          var v = vs[i];
          if (g.buildings[v]) continue;
          var bad = (geo.vertexNeighbors[v] || []).some(function (n) { return g.buildings[n]; });
          if (!bad) return v;
        }
        return null;
      }
      function anyRoadFrom(v) {
        var edges = geo.vertexEdges[v] || [];
        for (var i = 0; i < edges.length; i++) if (g.roads[edges[i]] == null) return edges[i];
        return null;
      }
      // run the whole 2N snake draft
      var guard = 0;
      while (g.phase === "setup" && guard++ < 50) {
        var v = freeVertex();
        ok(!!v, "setup: a free vertex exists");
        act({ type: "place", kind: "settlement", loc: v });
        var e = anyRoadFrom(v);
        ok(!!e, "setup: a road edge exists off the settlement");
        act({ type: "place", kind: "road", loc: e });
      }
      eq(g.phase, "main", "setup completes → main");
      eq(g.turn.seat, 0, "main begins with seat 0");
      // second-round settlements paid resources → someone holds cards
      var totalCards = 0;
      for (var s = 0; s < 3; s++) totalCards += handSize(g.players[s].hand);
      ok(totalCards > 0, "second settlements paid production");

      // seat 0 rolls; roll must set dice + either produce or trigger robber
      var before = g.turn.rolled;
      act({ type: "roll" });
      ok(g.turn.rolled, "roll marks the turn rolled");
      ok(g.turn.dice && g.turn.dice.length === 2, "roll produced two dice");
      // cannot roll twice
      var r2 = applyAction(g, { type: "roll" }, ctx);
      ok(r2.error && r2.error.code === "turn", "second roll rejected");
      // if a robber interrupt is pending, resolve it so we can end the turn
      function resolvePending() {
        var guard2 = 0;
        while (g.turn.pending && guard2++ < 20) {
          var p = g.turn.pending;
          if (p.kind === "discard") {
            Object.keys(p.owed).forEach(function (sk) {
              var seat = +sk, need = p.owed[seat], hand = g.players[seat].hand, cards = {};
              var left = need;
              for (var i = 0; i < RES.length && left > 0; i++) {
                var take = Math.min(hand[RES[i]], left); if (take > 0) { cards[RES[i]] = take; left -= take; }
              }
              act({ type: "discard", seat: seat, cards: cards });
            });
          } else if (p.kind === "robber") {
            var dest = g.board.hexes.filter(function (h) { return hkey(h.q, h.r) !== g.board.robber; })[0];
            act({ type: "moveRobber", hex: hkey(dest.q, dest.r) });
          } else if (p.kind === "steal") {
            act({ type: "steal", target: p.targets[0] });
          } else break;
        }
      }
      resolvePending();
      ok(!g.turn.pending, "robber interrupt resolved");
      act({ type: "endTurn" });
      eq(g.turn.seat, 1, "endTurn advances to seat 1");

      // longest road: isolate the DFS on a clean board — a true 5-edge simple
      // path with no opponent buildings breaking it
      (function () {
        var gc = createGame({ seats: [{}, {}, {}], settings: {} }, ctx);
        var gco = geoOf(gc.board);
        gc.buildings = {}; gc.roads = {}; gc.phase = "main";
        var chain = simplePath(gco, 5);
        ok(!!chain, "found a 5-edge simple path");
        if (chain) {
          chain.forEach(function (eid) { gc.roads[eid] = 1; });
          eq(longestRoadFor(gc, gco, 1), 5, "longestRoadFor counts the 5-edge path");
          var evs = [];
          recomputeLongestRoad(gc, gco, evs);
          ok(gc.awards.longestRoad === 1, "5-road chain earns longest road");
          ok(publicVP(gc, 1) >= 2, "longest road worth 2 VP");
          // an opponent settlement mid-path breaks it below 5
          var mid = gco.edgeVertices[chain[2]][0];
          gc.buildings[mid] = { seat: 0, kind: "settlement" };
          ok(longestRoadFor(gc, gco, 1) < 5, "opponent settlement breaks the road");
        }
      })();

      // largest army via three knights handed to seat 1
      g.players[1].dev.push({ card: "knight", turnBought: -1 }, { card: "knight", turnBought: -1 }, { card: "knight", turnBought: -1 });
      g.turn.seat = 1; g.turn.rolled = true; g.turn.pending = null; g.turn.devPlayed = false;
      for (var kk = 0; kk < 3; kk++) {
        g.turn.devPlayed = false;
        var rr = applyAction(g, { type: "playDev", card: "knight" }, ctx);
        if (!rr.error) { g = rr.game; if (g.turn.pending) { var d2 = g.board.hexes.filter(function (h) { return hkey(h.q, h.r) !== g.board.robber; })[0]; var rm = applyAction(g, { type: "moveRobber", hex: hkey(d2.q, d2.r) }, ctx); if (!rm.error) g = rm.game; if (g.turn.pending && g.turn.pending.kind === "steal") { var rs = applyAction(g, { type: "steal", target: g.turn.pending.targets[0] }, ctx); if (!rs.error) g = rs.game; } } }
      }
      ok(g.awards.largestArmy === 1, "three knights earn largest army");

      // monopoly: give everyone some ore, seat 1 plays monopoly, collects all
      for (var s3 = 0; s3 < 3; s3++) g.players[s3].hand.ore = 2;
      g.players[1].dev.push({ card: "monopoly", turnBought: -1 });
      g.turn.seat = 1; g.turn.devPlayed = false; g.turn.rolled = true; g.turn.pending = null;
      var mono = applyAction(g, { type: "playDev", card: "monopoly", args: { resource: "ore" } }, ctx);
      ok(!mono.error, "monopoly plays");
      if (!mono.error) { g = mono.game; eq(g.players[1].hand.ore, 6, "monopoly collected all ore"); eq(g.players[0].hand.ore, 0, "monopoly emptied opponents"); }

      // bank trade at 4:1 (no harbor guaranteed) — give 4 wood for 1 brick
      g.players[1].hand.wood = 4; var brickBefore = g.players[1].hand.brick;
      g.turn.seat = 1; g.turn.rolled = true; g.turn.pending = null;
      var bt = applyAction(g, { type: "bankTrade", give: "wood", get: "brick" }, ctx);
      ok(!bt.error, "bank trade succeeds");
      if (!bt.error) { g = bt.game; eq(g.players[1].hand.brick, brickBefore + 1, "bank trade gave 1 brick"); }

      // multi-unit bank trade: 8 wood → 2 brick in one action (n: 2)
      g.players[1].hand.wood = 8; var brick2 = g.players[1].hand.brick;
      var btn2 = applyAction(g, { type: "bankTrade", give: "wood", get: "brick", n: 2 }, ctx);
      ok(!btn2.error, "multi-unit bank trade succeeds");
      if (!btn2.error) { g = btn2.game; eq(g.players[1].hand.brick, brick2 + 2, "n:2 gave 2 brick"); eq(g.players[1].hand.wood, 0, "n:2 took 8 wood"); }
      var btBad = applyAction(g, { type: "bankTrade", give: "wood", get: "brick", n: 0 }, ctx);
      ok(btBad.error && btBad.error.code === "rate", "n:0 bank trade rejected");

      // win: push seat 1 to 10 VP via cities and re-check on a build
      // (direct-state shove is fine here — we only assert the win transition)
    })();

    /* trading: no empty side (no gifts) */
    (function () {
      var g = createGame({ seats: [{}, {}, {}], settings: {} }, ctx);
      g.phase = "main"; g.turn = { seat: 0, rolled: true, dice: [3, 4], devPlayed: false, pending: null };
      var r = applyAction(g, { type: "offer", seat: 0, give: { wood: 1 }, get: {} }, ctx);
      ok(r.error && r.error.code === "rate", "empty-side offer rejected (no gifts)");
      g.players[0].hand.wood = 1; g.players[1].hand.brick = 1;
      var r2 = applyAction(g, { type: "offer", seat: 0, give: { wood: 1 }, get: { brick: 1 } }, ctx);
      ok(!r2.error, "valid offer posts");
      g = r2.game;
      var oid = g.offers[0].id;
      var r3 = applyAction(g, { type: "respond", seat: 1, offerId: oid, action: "accept" }, ctx);
      ok(!r3.error, "opponent accepts"); g = r3.error ? g : r3.game;
      var r4 = applyAction(g, { type: "close", seat: 0, offerId: oid, accepter: 1 }, ctx);
      ok(!r4.error, "current player closes the trade");
      if (!r4.error) { g = r4.game; eq(g.players[0].hand.brick, 1, "giver received brick"); eq(g.players[1].hand.wood, 1, "taker received wood"); }

      // all-decline: the offer disappears on the spot
      g.players[0].hand.wood = 1;
      var r5 = applyAction(g, { type: "offer", seat: 0, give: { wood: 1 }, get: { brick: 1 } }, ctx);
      ok(!r5.error, "second offer posts"); g = r5.game;
      var oid2 = g.offers[0].id;
      g = applyAction(g, { type: "respond", seat: 1, offerId: oid2, action: "decline" }, ctx).game;
      var r6 = applyAction(g, { type: "respond", seat: 2, offerId: oid2, action: "decline" }, ctx);
      ok(!r6.error, "last decline accepted"); g = r6.game;
      eq(g.offers.length, 0, "fully-declined offer removed");
      ok((r6.events || []).some(function (e) { return e.t === "offerGone" && e.declined; }), "offerGone(declined) emitted");
    })();

    /* immutability: a rejected action leaves the input untouched */
    (function () {
      var g = createGame({ seats: [{}, {}, {}], settings: {} }, ctx);
      var snap = JSON.stringify(g);
      applyAction(g, { type: "roll" }, ctx);            // illegal in setup
      eq(JSON.stringify(g), snap, "rejected action does not mutate input");
      var r = applyAction(g, { type: "place", kind: "settlement", loc: Object.keys(geoOf(g.board).vertexHexes)[0] }, ctx);
      ok(!r.error, "legal setup placement succeeds");
      eq(JSON.stringify(g), snap, "successful action returns a fresh object, input unchanged");
    })();

    // find an N-edge simple path (distinct vertices) for the longest-road test
    function simplePath(geo, n) {
      var adj = {};
      Object.keys(geo.edgeVertices).forEach(function (e) {
        var v = geo.edgeVertices[e];
        (adj[v[0]] = adj[v[0]] || []).push({ e: e, to: v[1] });
        (adj[v[1]] = adj[v[1]] || []).push({ e: e, to: v[0] });
      });
      var found = null;
      function dfs(v, path, usedV) {
        if (found) return;
        if (path.length === n) { found = path.slice(); return; }
        (adj[v] || []).forEach(function (nx) {
          if (found || usedV[nx.to]) return;
          usedV[nx.to] = 1; path.push(nx.e);
          dfs(nx.to, path, usedV);
          path.pop(); usedV[nx.to] = 0;
        });
      }
      Object.keys(adj).forEach(function (v) { if (!found) { var uv = {}; uv[v] = 1; dfs(v, [], uv); } });
      return found;
    }

    /* fuzz: random playout — no throw, resources conserved, nothing negative.
       Invariant: bank[res] + Σ hands[res] == starting bank, always (resources
       only ever move between bank and hands). */
    (function () {
      var seeds = 0;
      function frng() { seeds = (seeds * 1103515245 + 12345) & 0x7fffffff; return seeds / 0x7fffffff; }
      var threw = false, conserveBad = false, negBad = false, reached = 0;
      for (var trial = 0; trial < 8; trial++) {
        seeds = 999 + trial * 7;
        var fctx = { rand: frng, now: 5000 };
        var g = createGame({ seats: [{}, {}, {}, {}], settings: { timerSec: 0 } }, fctx);
        var start = BOARDS.BOARDS[g.frame].bank;
        function check() {
          for (var i = 0; i < RES.length; i++) {
            var r = RES[i], tot = g.bank[r];
            if (g.bank[r] < 0) negBad = true;
            for (var s = 0; s < g.seatCount; s++) { tot += g.players[s].hand[r]; if (g.players[s].hand[r] < 0) negBad = true; }
            if (tot !== start) conserveBad = true;
          }
        }
        try {
          var steps = 0;
          while (g.phase !== "over" && steps++ < 400) {
            var a = randomAction(g, fctx);
            var res = applyAction(g, a, fctx);
            if (!res.error) g = res.game;
            check();
          }
          if (g.phase === "over") reached++;
        } catch (e) { threw = true; msgs.push("FAIL fuzz threw: " + (e && e.message)); }
      }
      ok(!threw, "fuzz: no action throws");
      ok(!conserveBad, "fuzz: resources conserved (bank + hands invariant)");
      ok(!negBad, "fuzz: no negative bank or hand");
    })();

    // a plausible random legal action for the current game state (fuzz driver)
    function randomAction(g, ctx) {
      var geo = geoOf(g.board);
      if (g.phase === "setup") {
        if (g.setup.need === "settlement") {
          var vs = Object.keys(geo.vertexHexes);
          for (var i = 0; i < vs.length; i++) {
            var v = vs[i];
            if (g.buildings[v]) continue;
            var bad = (geo.vertexNeighbors[v] || []).some(function (n) { return g.buildings[n]; });
            if (!bad) return { type: "place", kind: "settlement", loc: v };
          }
          return { type: "noop" };
        }
        var edges = geo.vertexEdges[g.setup.lastVid] || [];
        for (var j = 0; j < edges.length; j++) if (g.roads[edges[j]] == null) return { type: "place", kind: "road", loc: edges[j] };
        return { type: "noop" };
      }
      var t = g.turn;
      if (t.pending) {
        var p = t.pending;
        if (p.kind === "discard") {
          var sk = Object.keys(p.owed)[0], seat = +sk, need = p.owed[seat], hand = g.players[seat].hand, cards = {}, left = need;
          for (var d = 0; d < RES.length && left > 0; d++) { var take = Math.min(hand[RES[d]], left); if (take > 0) { cards[RES[d]] = take; left -= take; } }
          return { type: "discard", seat: seat, cards: cards };
        }
        if (p.kind === "robber") { var h = g.board.hexes.filter(function (x) { return hkey(x.q, x.r) !== g.board.robber; })[randInt(ctx, g.board.hexes.length - 1)]; return { type: "moveRobber", hex: hkey(h.q, h.r) }; }
        if (p.kind === "steal") return { type: "steal", target: p.targets[0] };
        if (p.kind === "roads") { var e2 = Object.keys(geo.edgeVertices).filter(function (e) { return g.roads[e] == null && roadConnects(g, geo, t.seat, e); })[0]; return e2 ? { type: "place", kind: "road", loc: e2 } : { type: "endTurn" }; }
      }
      if (!t.rolled) return { type: "roll" };
      // random build/trade/dev/end
      var seat = t.seat, p2 = g.players[seat], roll = ctx.rand();
      if (roll < 0.25 && canAfford(p2.hand, COST.road) && p2.supply.road > 0) {
        var re = Object.keys(geo.edgeVertices).filter(function (e) { return g.roads[e] == null && roadConnects(g, geo, seat, e); })[0];
        if (re) return { type: "place", kind: "road", loc: re };
      }
      if (roll < 0.5 && canAfford(p2.hand, COST.settlement) && p2.supply.settlement > 0) {
        var vv = Object.keys(geo.vertexHexes).filter(function (v) {
          if (g.buildings[v]) return false;
          if ((geo.vertexNeighbors[v] || []).some(function (n) { return g.buildings[n]; })) return false;
          return touchesOwnRoad(g, geo, seat, v);
        })[0];
        if (vv) return { type: "place", kind: "settlement", loc: vv };
      }
      if (roll < 0.65 && canAfford(p2.hand, COST.city) && p2.supply.city > 0) {
        var sv = Object.keys(g.buildings).filter(function (v) { return g.buildings[v].seat === seat && g.buildings[v].kind === "settlement"; })[0];
        if (sv) return { type: "place", kind: "city", loc: sv };
      }
      if (roll < 0.75 && canAfford(p2.hand, COST.dev) && g.devDeck.length) return { type: "buyDev" };
      if (roll < 0.85) {
        for (var gi = 0; gi < RES.length; gi++) if (p2.hand[RES[gi]] >= 4) { var get = RES[(gi + 1) % RES.length]; return { type: "bankTrade", give: RES[gi], get: get }; }
      }
      return { type: "endTurn" };
    }

    var line = "cities/engine.js self-test: " + pass + " passed, " + fail + " failed";
    if (typeof console !== "undefined") { console.log(line); msgs.forEach(function (m) { console.log("  " + m); }); }
    return fail === 0;
  }

  if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
    process.exit(selfTest() ? 0 : 1);
  }
})();
