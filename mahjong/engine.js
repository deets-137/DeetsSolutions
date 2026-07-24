/* DeetsMahjong — rules engine (docs/mahjong.md, "Rules engine (engine.js)").

   PURE, environment-agnostic module: state + action → new state + events. No
   DOM, no I/O, no Date.now — the caller passes time and randomness in via
   `ctx = { rand, now }` (rand() → [0,1), like Math.random). applyAction never
   mutates its input; it clones, mutates the clone, and returns it.

     createGame(opts, ctx)            → game            (→ seating rolls)
     applyAction(game, action, ctx)   → { game, events } | { error: {code} }

   Hong Kong Old Style, four seats always. Flowers in. Host settings ride
   opts.settings: { minFaan (0|1|3|custom int), capFaan (8|10|13),
   winds (1|4), timerSec }. Settlement is HK-classic half-spread with the
   doubled-integer convention (docs/mahjong.md, "Scoring"): with
   v = 2^min(faan, capFaan) chips, a discard win costs the discarder 2v and
   the other two v each; a self-draw costs everyone 2v.

   Illegal actions return a typed error and change nothing. Every rule is
   enforced here (the client's disabled pills are cosmetic). The Phase-2
   worker repo (../DeetsMahjong) carries a VERBATIM vendored copy — this
   file and its copy are contract, exactly like DeetsCities' engine.

   Browser: window.MahjongEngine. Node (self-checks): module.exports, and
   `node mahjong/engine.js` runs selfTest(). */
(function () {
  "use strict";

  /* ── tiles ─────────────────────────────────────────────────────
     34 kinds: m1-m9 (characters), p1-p9 (dots), s1-s9 (bamboo),
     we/ws/ww/wn (winds E S W N), dr/dg/dw (dragons red green white).
     Bonus: f1-f4 flowers, g1-g4 seasons (seat-numbered E=1..N=4). */
  var SUITS = ["m", "p", "s"];
  var WINDS = ["we", "ws", "ww", "wn"];
  var DRAGONS = ["dr", "dg", "dw"];
  var KINDS = (function () {
    var out = [];
    SUITS.forEach(function (s) { for (var n = 1; n <= 9; n++) out.push(s + n); });
    return out.concat(WINDS).concat(DRAGONS);
  })();
  var FLOWERS = ["f1", "f2", "f3", "f4", "g1", "g2", "g3", "g4"];

  function isFlower(t) { return t.charAt(0) === "f" || t.charAt(0) === "g"; }
  function isHonor(t) { return t.charAt(0) === "w" || t.charAt(0) === "d"; }
  function suitOf(t) { return t.charAt(0); }
  function numOf(t) { return isHonor(t) ? 0 : +t.charAt(1); }

  /* ── small helpers ────────────────────────────────────────────── */
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
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
  function countsOf(tiles) {
    var c = {};
    tiles.forEach(function (t) { c[t] = (c[t] || 0) + 1; });
    return c;
  }
  function removeOne(arr, t) {
    var i = arr.indexOf(t);
    if (i < 0) return false;
    arr.splice(i, 1);
    return true;
  }
  function err(code) { return { error: { code: code } }; }

  /* ── new game (lobby start → seating rolls) ───────────────────── */
  function createGame(opts, ctx) {
    var settings = opts.settings || {};
    var game = {
      phase: "seating",                     // seating → play → over
      seatCount: 4,
      settings: {
        minFaan: settings.minFaan != null ? settings.minFaan : 3,
        capFaan: settings.capFaan != null ? settings.capFaan : 13,
        winds: settings.winds === 4 ? 4 : (settings.winds === 0 ? 0 : 1),
        timerSec: settings.timerSec || 0
      },
      // seating: each seat rolls two dice; ranking assigns winds (highest =
      // East = first dealer). Ties re-roll among the tied seats only.
      seating: { rolls: [null, null, null, null], reroll: null },
      order: null,                          // order[windIdx 0..3] = seat (fixed for the match)
      round: null,                          // { prevailing, dealerIdx, hand }
      breakRoll: null,                      // dealer's 3-dice wall-break roll (ceremonial, logged)
      wall: null,
      wallBack: 0,                          // rear draws taken this hand (flower/kong replacements — public count)
      pond: [],                             // chronological discards { seat, tile }; a claim pops its entry
      players: [],                          // seat-indexed
      turn: null,                           // { seat, drawn, justKonged, anyDiscard }
      claims: null,                        // { tile, from, can, responses, robbing }
      handOver: null,                       // per-hand settlement summary
      results: [],                          // finished hands
      stats: { hands: 0, startedAt: ctx.now },
      winner: null
    };
    for (var i = 0; i < 4; i++) {
      game.players.push({
        hand: [], melds: [], flowers: [], discards: [],
        score: 0,
        stats: { wins: 0, selfDraws: 0, dealIns: 0, kongs: 0, bestFaan: 0 }
      });
    }
    return game;
  }

  /* wind index of a seat for the CURRENT hand (0=E .. 3=N), and dealer */
  function dealerSeat(g) { return g.order[g.round.dealerIdx]; }
  function seatWindIdx(g, seat) {
    var oi = g.order.indexOf(seat);
    return (oi - g.round.dealerIdx + 4) % 4;
  }
  // next seat in play order (counterclockwise = ascending wind index)
  function nextSeat(g, seat) {
    var oi = g.order.indexOf(seat);
    return g.order[(oi + 1) % 4];
  }
  // distance from `from` in turn order (1..3) — claim priority tiebreak
  function orderDist(g, from, seat) {
    var a = g.order.indexOf(from), b = g.order.indexOf(seat);
    return (b - a + 4) % 4;
  }

  /* ── dealing ──────────────────────────────────────────────────── */
  function buildWall(ctx) {
    var wall = [];
    KINDS.forEach(function (k) { for (var i = 0; i < 4; i++) wall.push(k); });
    FLOWERS.forEach(function (f) { wall.push(f); });
    return shuffle(ctx, wall);
  }
  // draw from the front; replacement (flower/kong) draws come off the back
  function drawFront(g) { return g.wall.length ? g.wall.shift() : null; }
  function drawBack(g) { if (!g.wall.length) return null; g.wallBack++; return g.wall.pop(); }
  // give `seat` a front draw, cycling flowers to the rack with back-wall
  // replacements. Returns the settled tile (into turn.drawn or hand), or
  // null when the wall ran dry (exhaustive draw). kong=true marks the draw
  // itself as a replacement (嶺上 win flag rides turn.justKonged).
  function drawFor(g, seat, events, fromBack) {
    for (;;) {
      var t = fromBack ? drawBack(g) : drawFront(g);
      if (t == null) return null;
      if (!isFlower(t)) return t;
      g.players[seat].flowers.push(t);
      events.push({ t: "flower", seat: seat, tile: t });
      fromBack = true;   // every replacement comes off the back
    }
  }
  function deal(g, ctx, events) {
    g.wall = buildWall(ctx);
    g.wallBack = 0;
    g.pond = [];
    var dealer = dealerSeat(g);
    // 13 tiles each in wind order, dealer first; flowers replace immediately
    for (var w = 0; w < 4; w++) {
      var seat = g.order[(g.round.dealerIdx + w) % 4];
      var p = g.players[seat];
      p.hand = []; p.melds = []; p.flowers = []; p.discards = [];
      for (var i = 0; i < 13; i++) {
        var t = drawFor(g, seat, events, false);
        if (t != null) p.hand.push(t);
      }
      p.hand.sort();
    }
    events.push({ t: "deal", dealer: dealer, hand: g.round.hand, prevailing: g.round.prevailing });
    // dealer's 14th = the first draw of the hand
    g.turn = { seat: dealer, drawn: null, justKonged: false, anyDiscard: false, firstTurn: true };
    g.claims = null;
    g.handOver = null;
    startDraw(g, ctx, events);
  }
  // the seat's turn begins with a draw (or the wall dies → exhaustive draw)
  function startDraw(g, ctx, events, fromBack) {
    var seat = g.turn.seat;
    var t = drawFor(g, seat, events, !!fromBack);
    if (t == null) return endHandDrawn(g, ctx, events);
    g.turn.drawn = t;
    events.push({ t: "draw", seat: seat, left: g.wall.length });
    return null;
  }

  /* ── win validation ───────────────────────────────────────────
     tiles = full 14-set of CONCEALED tiles incl. the winning tile
     (melds counted separately). Decompose into (4 - melds) sets + pair. */
  function canFormSets(counts, sets) {
    if (sets === 0) return true;
    var k = null;
    for (var i = 0; i < KINDS.length; i++) if (counts[KINDS[i]]) { k = KINDS[i]; break; }
    if (!k) return false;
    // pung
    if (counts[k] >= 3) {
      counts[k] -= 3;
      if (canFormSets(counts, sets - 1)) { counts[k] += 3; return true; }
      counts[k] += 3;
    }
    // chow
    if (!isHonor(k)) {
      var n = numOf(k), s = suitOf(k);
      if (n <= 7) {
        var a = s + (n + 1), b = s + (n + 2);
        if (counts[a] && counts[b]) {
          counts[k]--; counts[a]--; counts[b]--;
          if (canFormSets(counts, sets - 1)) { counts[k]++; counts[a]++; counts[b]++; return true; }
          counts[k]++; counts[a]++; counts[b]++;
        }
      }
    }
    return false;
  }
  // ALL decompositions (pair + set list), so the scorer can pick the best
  // arrangement (a hand splitting both ways scores as all-pungs, not chows)
  function decomposeAll(tiles, meldCount) {
    var need = 4 - meldCount;
    var counts = countsOf(tiles);
    var out = [];
    for (var i = 0; i < KINDS.length; i++) {
      var k = KINDS[i];
      if ((counts[k] || 0) >= 2) {
        counts[k] -= 2;
        formSetsAll(counts, need, [], function (sets) {
          out.push({ pair: k, sets: sets.slice() });
        });
        counts[k] += 2;
      }
    }
    return out;
  }
  function decompose(tiles, meldCount) {
    var all = decomposeAll(tiles, meldCount);
    return all.length ? all[0] : null;
  }
  function formSetsAll(counts, need, acc, emit) {
    if (need === 0) { emit(acc); return; }
    var k = null;
    for (var i = 0; i < KINDS.length; i++) if (counts[KINDS[i]]) { k = KINDS[i]; break; }
    if (!k) return;
    if (counts[k] >= 3) {
      counts[k] -= 3; acc.push({ kind: "pung", tile: k });
      formSetsAll(counts, need - 1, acc, emit);
      counts[k] += 3; acc.pop();
    }
    if (!isHonor(k)) {
      var n = numOf(k), s = suitOf(k);
      if (n <= 7) {
        var a = s + (n + 1), b = s + (n + 2);
        if (counts[a] && counts[b]) {
          counts[k]--; counts[a]--; counts[b]--; acc.push({ kind: "chow", tile: k });
          formSetsAll(counts, need - 1, acc, emit);
          counts[k]++; counts[a]++; counts[b]++; acc.pop();
        }
      }
    }
  }
  var ORPHANS = ["m1", "m9", "p1", "p9", "s1", "s9"].concat(WINDS).concat(DRAGONS);
  function isThirteenOrphans(tiles, meldCount) {
    if (meldCount > 0 || tiles.length !== 14) return false;
    var c = countsOf(tiles), pair = 0;
    for (var i = 0; i < ORPHANS.length; i++) {
      var n = c[ORPHANS[i]] || 0;
      if (n === 0 || n > 2) return false;
      if (n === 2) pair++;
    }
    var total = 0;
    for (var k in c) { if (ORPHANS.indexOf(k) < 0) return false; total += c[k]; }
    return pair === 1 && total === 14;
  }
  function isWinningTiles(tiles, meldCount) {
    if (isThirteenOrphans(tiles, meldCount)) return true;
    if (tiles.length !== 14 - meldCount * 3) return false;
    return !!decompose(tiles, meldCount);
  }

  /* ── faan scoring ─────────────────────────────────────────────
     Returns { faan, limit, parts: [{key, faan}] }. `winCtx`:
     { seat, winTile, selfDraw, robbing, lastWall, replacement,
       firstTurn (heavenly/earthly), discarder }. Limit hands report
     faan = capFaan with limit:true. */
  function scoreHand(g, seat, tiles, winCtx) {
    var meldCount = g.players[seat].melds.length;
    var thirteen = isThirteenOrphans(tiles, meldCount);
    var decs = thirteen ? [null] : decomposeAll(tiles, meldCount);
    if (!thirteen && !decs.length) return null;
    var best = null;
    decs.forEach(function (dec) {
      var sc = scoreDecomposition(g, seat, tiles, winCtx, dec, thirteen);
      if (sc && (!best || sc.faan > best.faan)) best = sc;
    });
    return best;
  }
  function scoreDecomposition(g, seat, tiles, winCtx, dec, thirteen) {
    var p = g.players[seat];
    var cap = g.settings.capFaan;
    var meldCount = p.melds.length;
    var parts = [];
    var limit = false;
    function add(key, n) { parts.push({ key: key, faan: n }); }
    function lim(key) { parts.push({ key: key, faan: cap }); limit = true; }

    // the full picture: concealed sets + melds
    var allSets = [];
    if (dec) {
      dec.sets.forEach(function (s) { allSets.push({ kind: s.kind, tile: s.tile, open: false }); });
      p.melds.forEach(function (m) {
        allSets.push({ kind: m.kind === "chow" ? "chow" : "pung", tile: m.tile, open: m.kind !== "kongC", kong: m.kind.indexOf("kong") === 0 });
      });
    }
    var allTiles = tiles.slice();
    p.melds.forEach(function (m) {
      var n = m.kind.indexOf("kong") === 0 ? 4 : 3;
      if (m.kind === "chow") { allTiles.push(m.tile); allTiles.push(suitOf(m.tile) + (numOf(m.tile) + 1)); allTiles.push(suitOf(m.tile) + (numOf(m.tile) + 2)); }
      else for (var i = 0; i < n; i++) allTiles.push(m.tile);
    });

    var suits = {};
    var honors = 0;
    allTiles.forEach(function (t) { if (isHonor(t)) honors++; else suits[suitOf(t)] = 1; });
    var suitN = Object.keys(suits).length;

    /* limit hands first */
    if (thirteen) lim("thirteenOrphans");
    if (winCtx.firstTurn && winCtx.selfDraw && seat === dealerSeat(g)) lim("heavenly");
    if (winCtx.firstTurn && !winCtx.selfDraw && seat !== dealerSeat(g) && !g.turn.anyDiscardOther) { /* earthly: win on dealer's first discard */ lim("earthly"); }
    if (dec) {
      var pungs = allSets.filter(function (s) { return s.kind === "pung"; });
      var kongs = allSets.filter(function (s) { return s.kong; });
      var dragonPungs = pungs.filter(function (s) { return DRAGONS.indexOf(s.tile) >= 0; });
      var windPungs = pungs.filter(function (s) { return WINDS.indexOf(s.tile) >= 0; });
      if (suitN === 0) lim("allHonors");
      if (dragonPungs.length === 3) lim("greatDragons");
      if (windPungs.length === 4) lim("greatWinds");
      if (kongs.length === 4) lim("allKongs");
      if (!limit && suitN === 1 && honors === 0 && meldCount === 0 && nineGates(tiles)) lim("nineGates");
    }
    if (limit) {
      return { faan: cap, limit: true, parts: parts };
    }

    /* ordinary faan */
    if (dec) {
      var pungs2 = allSets.filter(function (s) { return s.kind === "pung"; });
      var chows2 = allSets.filter(function (s) { return s.kind === "chow"; });
      var dragonP = pungs2.filter(function (s) { return DRAGONS.indexOf(s.tile) >= 0; });
      var windP = pungs2.filter(function (s) { return WINDS.indexOf(s.tile) >= 0; });
      if (chows2.length === 4 && !isHonor(dec.pair)) add("allChows", 1);
      if (pungs2.length === 4) add("allPungs", 3);
      if (suitN === 1) add(honors > 0 ? "halfFlush" : "fullFlush", honors > 0 ? 3 : 7);
      dragonP.forEach(function () { add("dragonPung", 1); });
      // small dragons: two dragon pungs + dragon pair (+3 on top of the pungs)
      if (dragonP.length === 2 && DRAGONS.indexOf(dec.pair) >= 0) add("smallDragons", 3);
      windP.forEach(function (s) {
        var wi = WINDS.indexOf(s.tile);
        if (wi === seatWindIdx(g, seat)) add("seatWind", 1);
        if (wi === g.round.prevailing % 4) add("prevWind", 1);
      });
      // small winds: three wind pungs + wind pair (+3)
      if (windP.length === 3 && WINDS.indexOf(dec.pair) >= 0) add("smallWinds", 3);
    }
    // concealment: no claimed melds (concealed kongs allowed)
    var open = p.melds.some(function (m) { return m.kind !== "kongC"; });
    if (!open && !winCtx.selfDraw) add("concealed", 1);
    if (winCtx.selfDraw) add("selfDraw", 1);
    if (winCtx.robbing) add("robbingKong", 1);
    if (winCtx.replacement) add("kongReplacement", 1);
    if (winCtx.lastWall) add(winCtx.selfDraw ? "lastTileDraw" : "lastTileDiscard", 1);
    // flowers: none = 1; each own-seat flower/season = 1; a complete quad = +2
    var wi2 = seatWindIdx(g, seat);
    if (!p.flowers.length) add("noFlowers", 1);
    else {
      p.flowers.forEach(function (f) { if (+f.charAt(1) === wi2 + 1) add("seatFlower", 1); });
      ["f", "g"].forEach(function (pre) {
        var have = p.flowers.filter(function (f) { return f.charAt(0) === pre; }).length;
        if (have === 4) add("flowerQuad", 2);
      });
    }
    var faan = 0;
    parts.forEach(function (x) { faan += x.faan; });
    if (faan > cap) faan = cap;
    return { faan: faan, limit: false, parts: parts };
  }
  function nineGates(tiles) {
    // 1112345678999 + any tile of the same suit (concealed pure hand)
    var s = suitOf(tiles[0]);
    var c = countsOf(tiles);
    var need = { 1: 3, 9: 3 };
    for (var n = 1; n <= 9; n++) {
      var have = c[s + n] || 0;
      var base = need[n] || 1;
      if (have < base) return false;
    }
    return true;
  }

  /* faan FACTS an incomplete hand already holds (the scoring guide's
     live marks): meld-locked dragon/wind pungs, banked flowers, and
     current suit purity. Returns { faan, parts } like scoreHand, but
     only from what the tiles show right now — win-moment bonuses
     (self-draw, concealed, robbing, limit hands) are never counted,
     and suit purity is a live reading, not a guaranteed floor.
     Callable any time during play for any seat; scoring a COMPLETE
     hand stays scoreHand's job. */
  function scoreProgress(g, seat) {
    var p = g.players[seat];
    var cap = g.settings.capFaan;
    var parts = [];
    function add(key, n) { parts.push({ key: key, faan: n }); }
    p.melds.forEach(function (m) {
      if (m.kind === "chow") return;
      if (DRAGONS.indexOf(m.tile) >= 0) add("dragonPung", 1);
      var wi = WINDS.indexOf(m.tile);
      if (wi >= 0) {
        if (wi === seatWindIdx(g, seat)) add("seatWind", 1);
        if (wi === g.round.prevailing % 4) add("prevWind", 1);
      }
    });
    // suit purity across the whole hand: concealed + drawn + meld tiles
    var tiles = p.hand.slice();
    if (g.turn && g.turn.seat === seat && g.turn.drawn != null) tiles.push(g.turn.drawn);
    p.melds.forEach(function (m) { tiles.push(m.tile); });
    var suits = {}, honors = 0;
    tiles.forEach(function (t) { if (isHonor(t)) honors++; else suits[suitOf(t)] = 1; });
    if (Object.keys(suits).length === 1 && tiles.length) {
      add(honors > 0 ? "halfFlush" : "fullFlush", honors > 0 ? 3 : 7);
    }
    var wi2 = seatWindIdx(g, seat);
    p.flowers.forEach(function (f) { if (+f.charAt(1) === wi2 + 1) add("seatFlower", 1); });
    ["f", "g"].forEach(function (pre) {
      var have = p.flowers.filter(function (f) { return f.charAt(0) === pre; }).length;
      if (have === 4) add("flowerQuad", 2);
    });
    var faan = 0;
    parts.forEach(function (x) { faan += x.faan; });
    if (faan > cap) faan = cap;
    return { faan: faan, parts: parts };
  }

  /* the 14 concealed tiles a seat would win with, given a candidate tile
     (null → the seat's own drawn tile is already in scope) */
  function winningTilesFor(g, seat, extra) {
    var p = g.players[seat];
    var tiles = p.hand.slice();
    if (g.turn && g.turn.seat === seat && g.turn.drawn != null) tiles.push(g.turn.drawn);
    if (extra != null) tiles.push(extra);
    return tiles;
  }
  function winCheck(g, seat, extra, winCtx) {
    var tiles = winningTilesFor(g, seat, extra);
    if (!isWinningTiles(tiles, g.players[seat].melds.length)) return null;
    var sc = scoreHand(g, seat, tiles, winCtx);
    if (!sc || sc.faan < g.settings.minFaan) return null;
    sc.tiles = tiles;
    return sc;
  }

  /* ── settlement (HK-classic half-spread, doubled integers) ────── */
  function settle(g, winSeat, sc, winCtx, events) {
    var v = Math.pow(2, Math.min(sc.faan, g.settings.capFaan));
    var pay = [0, 0, 0, 0];
    if (winCtx.selfDraw) {
      for (var s = 0; s < 4; s++) if (s !== winSeat) pay[s] = 2 * v;
    } else {
      for (var s2 = 0; s2 < 4; s2++) {
        if (s2 === winSeat) continue;
        pay[s2] = s2 === winCtx.discarder ? 2 * v : v;
      }
    }
    var total = 0;
    for (var s3 = 0; s3 < 4; s3++) { g.players[s3].score -= pay[s3]; total += pay[s3]; }
    g.players[winSeat].score += total;
    var p = g.players[winSeat];
    p.stats.wins++;
    if (winCtx.selfDraw) p.stats.selfDraws++;
    if (winCtx.discarder != null) g.players[winCtx.discarder].stats.dealIns++;
    if (sc.faan > p.stats.bestFaan) p.stats.bestFaan = sc.faan;
    endHand(g, events, {
      result: "win", seat: winSeat, faan: sc.faan, limit: sc.limit, parts: sc.parts,
      selfDraw: !!winCtx.selfDraw, discarder: winCtx.discarder != null ? winCtx.discarder : null,
      tiles: sc.tiles.slice().sort(), melds: clone(p.melds), flowers: p.flowers.slice(),
      payments: pay, value: total
    });
  }
  function endHandDrawn(g, ctx, events) {
    endHand(g, events, { result: "drawn" });
    return null;
  }
  function endHand(g, events, summary) {
    summary.hand = g.round.hand;
    summary.prevailing = g.round.prevailing;
    summary.dealer = dealerSeat(g);
    summary.scores = g.players.map(function (p) { return p.score; });
    g.results.push(summary);
    g.stats.hands++;
    g.handOver = summary;
    g.turn = null;
    g.claims = null;
    events.push({ t: "handOver", summary: clone(summary) });
  }

  /* end the match: winner = top score; ties share (first in seat order reported) */
  function finishGame(g, events) {
    g.phase = "over";
    g.handOver = null;
    var best = -Infinity, who = null;
    for (var i = 0; i < 4; i++) if (g.players[i].score > best) { best = g.players[i].score; who = i; }
    g.winner = who;
    events.push({ t: "gameOver", winner: who });
    return true;
  }

  /* rotate the dealership after a settled hand (nextHand applies it) */
  function advanceRound(g, events) {
    var s = g.handOver;
    // one-hand length: the match is a single settled hand, no dealer repeat
    if (g.settings.winds === 0) { g.round.hand++; return finishGame(g, events); }
    var repeat = s.result === "drawn" || (s.result === "win" && s.seat === dealerSeat(g));
    g.round.hand++;
    if (!repeat) {
      g.round.dealerIdx = (g.round.dealerIdx + 1) % 4;
      if (g.round.dealerIdx === 0) {
        g.round.prevailing++;
        if (g.round.prevailing >= g.settings.winds) return finishGame(g, events);
        events.push({ t: "newWind", prevailing: g.round.prevailing });
      }
    }
    return false;
  }

  /* ── claims machinery ─────────────────────────────────────────── */
  // what `seat` may do about `tile` discarded by `from`
  function claimOptions(g, seat, tile, from, robbing) {
    var opts = [];
    var winCtx = {
      seat: seat, selfDraw: false, discarder: from, robbing: !!robbing,
      lastWall: g.wall.length === 0, replacement: false,
      firstTurn: false
    };
    if (winCheck(g, seat, tile, winCtx)) opts.push("win");
    if (robbing) return opts;               // a kong is only ever robbed for a win
    var c = countsOf(g.players[seat].hand);
    if ((c[tile] || 0) >= 3) opts.push("kong");
    if ((c[tile] || 0) >= 2) opts.push("pung");
    if (!isHonor(tile) && nextSeat(g, from) === seat) {
      if (chowChoices(g.players[seat].hand, tile).length) opts.push("chow");
    }
    return opts;
  }
  function chowChoices(hand, tile) {
    var s = suitOf(tile), n = numOf(tile), c = countsOf(hand), out = [];
    if (n >= 3 && c[s + (n - 2)] && c[s + (n - 1)]) out.push([s + (n - 2), s + (n - 1)]);
    if (n >= 2 && n <= 8 && c[s + (n - 1)] && c[s + (n + 1)]) out.push([s + (n - 1), s + (n + 1)]);
    if (n <= 7 && c[s + (n + 1)] && c[s + (n + 2)]) out.push([s + (n + 1), s + (n + 2)]);
    return out;
  }
  function openClaims(g, tile, from, events, robbing) {
    var can = {};
    var any = false;
    for (var s = 0; s < 4; s++) {
      if (s === from) continue;
      var opts = claimOptions(g, s, tile, from, robbing);
      if (opts.length) { can[s] = opts; any = true; }
    }
    if (!any) return false;
    g.claims = { tile: tile, from: from, can: can, responses: {}, robbing: !!robbing };
    events.push({ t: "claimsOpen", tile: robbing ? null : tile, from: from, seats: Object.keys(can).map(Number), robbing: !!robbing });
    return true;
  }
  function resolveClaims(g, ctx, events) {
    var cl = g.claims;
    var picks = [];
    Object.keys(cl.can).forEach(function (k) {
      var r = cl.responses[k];
      if (r && r.action !== "pass") picks.push({ seat: +k, action: r.action, tiles: r.tiles });
    });
    var RANK = { win: 3, kong: 2, pung: 2, chow: 1 };
    picks.sort(function (a, b) {
      if (RANK[b.action] !== RANK[a.action]) return RANK[b.action] - RANK[a.action];
      return orderDist(g, cl.from, a.seat) - orderDist(g, cl.from, b.seat);   // nearest wins ties
    });
    var pick = picks[0] || null;
    g.claims = null;
    if (!pick) {
      if (cl.robbing) {                     // nobody robbed: the kong completes
        return finishAddedKong(g, ctx, events);
      }
      // discard stands; next seat draws
      g.turn = { seat: nextSeat(g, cl.from), drawn: null, justKonged: false, anyDiscard: true };
      return startDraw(g, ctx, events);
    }
    var seat = pick.seat, p = g.players[seat];
    if (pick.action === "win") {
      var winCtx = {
        seat: seat, selfDraw: false, discarder: cl.from, robbing: cl.robbing,
        lastWall: g.wall.length === 0, replacement: false, firstTurn: false
      };
      var sc = winCheck(g, seat, cl.tile != null ? cl.tile : cl.robTile, winCtx);
      if (!sc) { /* validated at claim time; can't happen */ return err("phase"); }
      if (!cl.robbing) takeDiscard(g, cl.from);
      events.push({ t: "win", seat: seat, from: cl.from, selfDraw: false, robbing: cl.robbing });
      settle(g, seat, sc, winCtx, events);
      return null;
    }
    // pung / kong / chow: the tile leaves the pond, the meld goes down,
    // and (post-kong replacement aside) the claimant must discard
    takeDiscard(g, cl.from);
    if (pick.action === "pung") {
      removeOne(p.hand, cl.tile); removeOne(p.hand, cl.tile);
      p.melds.push({ kind: "pung", tile: cl.tile, from: cl.from });
      events.push({ t: "meld", seat: seat, kind: "pung", tile: cl.tile, from: cl.from });
      g.turn = { seat: seat, drawn: null, justKonged: false, anyDiscard: true };
      return null;
    }
    if (pick.action === "kong") {
      removeOne(p.hand, cl.tile); removeOne(p.hand, cl.tile); removeOne(p.hand, cl.tile);
      p.melds.push({ kind: "kong", tile: cl.tile, from: cl.from });
      p.stats.kongs++;
      events.push({ t: "meld", seat: seat, kind: "kong", tile: cl.tile, from: cl.from });
      g.turn = { seat: seat, drawn: null, justKonged: true, anyDiscard: true };
      return startDraw(g, ctx, events, true);
    }
    // chow
    var pairT = pick.tiles;
    var choices = chowChoices(p.hand, cl.tile);
    var ok = choices.some(function (c) { return pairT && c[0] === pairT[0] && c[1] === pairT[1]; });
    var use = ok ? pairT : choices[0];
    if (!use) return err("phase");
    removeOne(p.hand, use[0]); removeOne(p.hand, use[1]);
    var low = Math.min(numOf(cl.tile), numOf(use[0]), numOf(use[1]));
    p.melds.push({ kind: "chow", tile: suitOf(cl.tile) + low, from: cl.from, claimed: cl.tile });
    events.push({ t: "meld", seat: seat, kind: "chow", tile: suitOf(cl.tile) + low, from: cl.from });
    g.turn = { seat: seat, drawn: null, justKonged: false, anyDiscard: true };
    return null;
  }
  function takeDiscard(g, from) {
    var d = g.players[from].discards;
    d.pop();   // the claimed tile is always the newest discard
    if (g.pond.length && g.pond[g.pond.length - 1].seat === from) g.pond.pop();
  }
  function finishAddedKong(g, ctx, events) {
    var k = g.pendingKong;
    g.pendingKong = null;
    var p = g.players[k.seat];
    if (k.kind === "added") {
      var m = p.melds.filter(function (x) { return x.kind === "pung" && x.tile === k.tile; })[0];
      m.kind = "kongA";
    } else {
      for (var i = 0; i < 4; i++) removeOne(p.hand, k.tile);
      p.melds.push({ kind: "kongC", tile: k.tile, from: null });
    }
    p.stats.kongs++;
    events.push({ t: "meld", seat: k.seat, kind: k.kind === "added" ? "kongA" : "kongC", tile: k.kind === "kongC" ? null : k.tile, from: null });
    g.turn = { seat: k.seat, drawn: null, justKonged: true, anyDiscard: g.turn ? g.turn.anyDiscard : true };
    return startDraw(g, ctx, events, true);
  }

  /* ═══ ACTION DISPATCH ══════════════════════════════════════════ */
  function applyAction(game, action, ctx) {
    if (!action || !action.type) return err("bad");
    var handler = ACTIONS[action.type];
    if (!handler) return err("bad");
    var g = clone(game);
    var events = [];
    var res = handler(g, action, ctx, events);
    if (res && res.error) return res;
    return { game: g, events: events };
  }

  var ACTIONS = {
    /* seating: each seat rolls two dice; ties among the leaders re-roll */
    rollSeat: function (g, a, ctx, events) {
      if (g.phase !== "seating") return err("phase");
      var seat = a.seat;
      if (seat == null || seat < 0 || seat > 3) return err("turn");
      var st = g.seating;
      if (st.reroll && st.reroll.indexOf(seat) < 0) return err("turn");
      if (st.rolls[seat]) return err("turn");
      var d = [die(ctx), die(ctx)];
      st.rolls[seat] = d;
      events.push({ t: "seatRoll", seat: seat, d: d });
      var pending = [];
      for (var s = 0; s < 4; s++) {
        if (!st.rolls[s] && (!st.reroll || st.reroll.indexOf(s) >= 0)) pending.push(s);
      }
      if (pending.length) return null;
      // everyone (in scope) has rolled: rank; leaders tied → they re-roll
      var sums = st.rolls.map(function (r) { return r[0] + r[1]; });
      var ranked = [0, 1, 2, 3].sort(function (x, y) { return sums[y] - sums[x] || x - y; });
      var top = sums[ranked[0]];
      var tied = [0, 1, 2, 3].filter(function (s2) { return sums[s2] === top; });
      if (tied.length > 1) {
        tied.forEach(function (s3) { st.rolls[s3] = null; });
        st.reroll = tied;
        events.push({ t: "seatReroll", seats: tied });
        return null;
      }
      g.order = ranked;                     // order[0]=E(dealer), then S, W, N
      g.phase = "play";
      g.round = { prevailing: 0, dealerIdx: 0, hand: 1 };
      g.seating = null;
      events.push({ t: "seated", order: ranked });
      return null;
    },

    /* the dealer's ceremonial wall-break roll → the deal */
    rollBreak: function (g, a, ctx, events) {
      if (g.phase !== "play" || g.wall !== null || g.handOver) return err("phase");
      if (a.seat != null && a.seat !== dealerSeat(g)) return err("turn");
      var d = [die(ctx), die(ctx), die(ctx)];
      g.breakRoll = d;
      events.push({ t: "breakRoll", seat: dealerSeat(g), d: d });
      deal(g, ctx, events);
      return null;
    },

    discard: function (g, a, ctx, events) {
      if (g.phase !== "play" || !g.turn || g.claims || g.handOver) return err("phase");
      var seat = g.turn.seat;
      if (a.seat != null && a.seat !== seat) return err("turn");
      var p = g.players[seat], t = a.tile;
      // the discarded tile comes out of hand+drawn; the drawn tile (if kept)
      // merges into the hand
      if (g.turn.drawn === t) g.turn.drawn = null;
      else {
        if (!removeOne(p.hand, t)) return err("loc");
        if (g.turn.drawn != null) { p.hand.push(g.turn.drawn); g.turn.drawn = null; }
      }
      p.hand.sort();
      p.discards.push(t);
      g.pond.push({ seat: seat, tile: t });
      g.turn.justKonged = false;
      var wasFirst = g.turn.firstTurn; g.turn.firstTurn = false;
      events.push({ t: "discard", seat: seat, tile: t });
      if (openClaims(g, t, seat, events, false)) return null;
      g.turn = { seat: nextSeat(g, seat), drawn: null, justKonged: false, anyDiscard: true, firstTurn: false };
      return startDraw(g, ctx, events);
    },

    /* self-draw win (or robbing decisions ride `claim`) */
    win: function (g, a, ctx, events) {
      if (g.phase !== "play" || !g.turn || g.claims || g.handOver) return err("phase");
      var seat = g.turn.seat;
      if (a.seat != null && a.seat !== seat) return err("turn");
      if (g.turn.drawn == null) return err("turn");
      var winCtx = {
        seat: seat, selfDraw: true, discarder: null, robbing: false,
        lastWall: g.wall.length === 0, replacement: g.turn.justKonged,
        firstTurn: !!g.turn.firstTurn
      };
      var sc = winCheck(g, seat, null, winCtx);
      if (!sc) return err("loc");
      events.push({ t: "win", seat: seat, selfDraw: true });
      settle(g, seat, sc, winCtx, events);
      return null;
    },

    /* concealed kong (4 in hand+drawn) or added kong (drawn/hand tile onto
       an own pung). An added kong opens the robbing window. */
    kong: function (g, a, ctx, events) {
      if (g.phase !== "play" || !g.turn || g.claims || g.handOver) return err("phase");
      var seat = g.turn.seat;
      if (a.seat != null && a.seat !== seat) return err("turn");
      if (g.turn.drawn == null && !g.turn.postClaim) { /* must be holding 14 */ }
      var p = g.players[seat], t = a.tile;
      var pool = p.hand.slice();
      if (g.turn.drawn != null) pool.push(g.turn.drawn);
      var c = countsOf(pool);
      var ownPung = p.melds.filter(function (m) { return m.kind === "pung" && m.tile === t; })[0];
      if (ownPung && (c[t] || 0) >= 1) {
        // added kong: merge drawn into hand, pull the 4th tile out
        if (g.turn.drawn != null) { p.hand.push(g.turn.drawn); g.turn.drawn = null; }
        removeOne(p.hand, t);
        p.hand.sort();
        g.pendingKong = { seat: seat, kind: "added", tile: t };
        events.push({ t: "kongTry", seat: seat, tile: t });
        if (openClaims(g, t, seat, events, true)) { g.claims.robTile = t; return null; }
        return finishAddedKong(g, ctx, events);
      }
      if ((c[t] || 0) >= 4) {
        if (g.turn.drawn != null) { p.hand.push(g.turn.drawn); g.turn.drawn = null; }
        p.hand.sort();
        g.pendingKong = { seat: seat, kind: "concealed", tile: t };
        return finishAddedKong(g, ctx, events);   // concealed kongs aren't robbable here
      }
      return err("loc");
    },

    /* claim-window responses: {action: "win"|"pung"|"kong"|"chow"|"pass"} */
    claim: function (g, a, ctx, events) {
      if (g.phase !== "play" || !g.claims) return err("phase");
      var seat = a.seat;
      var cl = g.claims;
      if (seat == null || !cl.can[seat]) return err("turn");
      if (cl.responses[seat]) return err("turn");
      var act = a.action;
      if (act !== "pass" && cl.can[seat].indexOf(act) < 0) return err("loc");
      cl.responses[seat] = { action: act, tiles: a.tiles || null };
      events.push({ t: "claimAck", seat: seat, pass: act === "pass" });
      var allIn = Object.keys(cl.can).every(function (k) { return !!cl.responses[k]; });
      if (allIn) return resolveClaims(g, ctx, events);
      // a win claim short-circuits nothing here: priority still needs the
      // window (a nearer winner may still speak) — the timer bounds it
      return null;
    },

    /* the hand-over interstitial → the next deal (or game over) */
    nextHand: function (g, a, ctx, events) {
      if (g.phase !== "play" || !g.handOver) return err("phase");
      if (advanceRound(g, events)) return null;
      g.handOver = null;
      g.wall = null;                        // rollBreak deals the next hand
      g.breakRoll = null;
      events.push({ t: "nextHand", dealer: dealerSeat(g), hand: g.round.hand, prevailing: g.round.prevailing });
      return null;
    },

    /* timer expiry — auto-resolve whatever the table is waiting on */
    timerExpire: function (g, a, ctx, events) {
      if (g.phase === "seating") {
        // auto-roll every straggler
        var st = g.seating;
        for (var s = 0; s < 4; s++) {
          if (!st.rolls[s] && (!st.reroll || st.reroll.indexOf(s) >= 0)) {
            var r = ACTIONS.rollSeat(g, { seat: s }, ctx, events);
            if (r && r.error) return r;
            if (g.phase !== "seating") return null;
            st = g.seating;
            if (!st) return null;
          }
        }
        return null;
      }
      if (g.phase !== "play") return err("phase");
      if (g.handOver) return ACTIONS.nextHand(g, a, ctx, events);
      if (g.wall === null) return ACTIONS.rollBreak(g, { seat: dealerSeat(g) }, ctx, events);
      if (g.claims) {
        // every unanswered seat passes
        Object.keys(g.claims.can).forEach(function (k) {
          if (!g.claims.responses[k]) g.claims.responses[k] = { action: "pass" };
        });
        return resolveClaims(g, ctx, events);
      }
      if (g.turn) {
        var seat2 = g.turn.seat, p = g.players[seat2];
        // an idle player's completed hand wins on autopilot rather than
        // being thrown away — player-friendly, and it keeps a match finite
        if (g.turn.drawn != null) {
          var r2 = ACTIONS.win(g, { seat: seat2 }, ctx, events);
          if (!r2 || !r2.error) return r2;
        }
        // otherwise auto-discard: the drawn tile, else a random hand tile
        var t = g.turn.drawn != null ? g.turn.drawn : p.hand[randInt(ctx, p.hand.length)];
        return ACTIONS.discard(g, { seat: seat2, tile: t }, ctx, events);
      }
      return err("phase");
    }
  };

  /* ═══ PUBLIC API ═══════════════════════════════════════════════ */
  var API = {
    KINDS: KINDS,
    FLOWERS: FLOWERS,
    WINDS: WINDS,
    DRAGONS: DRAGONS,
    isFlower: isFlower,
    isHonor: isHonor,
    suitOf: suitOf,
    numOf: numOf,
    createGame: createGame,
    applyAction: applyAction,
    dealerSeat: dealerSeat,
    seatWindIdx: seatWindIdx,
    nextSeat: nextSeat,
    chowChoices: chowChoices,
    claimOptions: claimOptions,
    isWinningTiles: isWinningTiles,
    winCheck: winCheck,
    scoreHand: scoreHand,
    scoreProgress: scoreProgress
  };

  API.selfTest = selfTest;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.MahjongEngine = API;

  /* ═══ SELF-CHECKS ══════════════════════════════════════════════
     Pure assertions — no DOM. Run with `node mahjong/engine.js`. */
  function selfTest() {
    var pass = 0, fail = 0, msgs = [];
    function ok(cond, name) { if (cond) pass++; else { fail++; msgs.push("FAIL: " + name); } }
    function eq(a, b, name) { ok(a === b, name + " (got " + a + ", want " + b + ")"); }
    var seq = 424242;
    function rng() { seq = (seq * 1103515245 + 12345) & 0x7fffffff; return seq / 0x7fffffff; }
    var ctx = { rand: rng, now: 1000 };

    /* wall composition */
    (function () {
      var w = buildWall(ctx);
      eq(w.length, 144, "wall holds 144 tiles");
      var c = countsOf(w);
      ok(KINDS.every(function (k) { return c[k] === 4; }), "each kind x4");
      ok(FLOWERS.every(function (f) { return c[f] === 1; }), "each flower x1");
    })();

    /* win validation basics */
    ok(isWinningTiles(["m1","m1","m1","m2","m3","m4","p5","p6","p7","s7","s8","s9","dr","dr"], 0), "basic 4 sets + pair wins");
    ok(!isWinningTiles(["m1","m1","m1","m2","m3","m4","p5","p6","p7","s7","s8","s9","dr","dg"], 0), "no pair = no win");
    ok(isWinningTiles(["m1","m9","p1","p9","s1","s9","we","ws","ww","wn","dr","dg","dw","m1"], 0), "thirteen orphans wins");
    ok(isWinningTiles(["m2","m3","m4","dr","dr"], 3), "3 melds + chow + pair wins");
    ok(!isWinningTiles(["m2","m3","m5","dr","dr"], 3), "broken chow doesn't win");

    /* chow choices */
    eq(chowChoices(["m1","m2","m4","m5"], "m3").length, 3, "m3 chows three ways");
    eq(chowChoices(["m1","m2"], "m3").length, 1, "edge chow one way");

    /* a full scripted game to `over` */
    (function () {
      var g = createGame({ settings: { minFaan: 0, capFaan: 13, winds: 1, timerSec: 0 } }, ctx);
      function act(a) {
        var r = applyAction(g, a, ctx);
        if (r.error) { fail++; msgs.push("FAIL action " + a.type + " → " + r.error.code); return false; }
        g = r.game; return true;
      }
      eq(g.phase, "seating", "game opens in seating");
      for (var s = 0; s < 4; s++) {
        if (g.phase !== "seating") break;
        var scope = g.seating.reroll || [0, 1, 2, 3];
        act({ type: "rollSeat", seat: scope.filter(function (x) { return !g.seating.rolls[x]; })[0] });
      }
      var guard = 0;
      while (g.phase === "seating" && guard++ < 40) {
        var scope2 = (g.seating.reroll || [0, 1, 2, 3]).filter(function (x) { return !g.seating.rolls[x]; });
        act({ type: "rollSeat", seat: scope2[0] });
      }
      eq(g.phase, "play", "seating resolves to play");
      ok(g.order && g.order.length === 4, "order set");
      act({ type: "rollBreak", seat: dealerSeat(g) });
      ok(g.turn && g.turn.drawn != null, "dealer holds the first draw");
      var handTiles = g.players[dealerSeat(g)].hand.length;
      eq(handTiles, 13, "dealer hand is 13 + drawn");
      // wall bookkeeping: front draws = 52 deal + dealer's 14th; every
      // revealed flower took one replacement off the back
      var flowersOut = g.players.reduce(function (a, p) { return a + p.flowers.length; }, 0);
      eq(g.wallBack, flowersOut, "wallBack counts replacement draws");
      eq(144 - g.wall.length, 53 + g.wallBack, "wall front+back draws reconcile");
      eq(g.pond.length, 0, "pond opens empty");
      // soak the idle path (auto-discard / auto-pass / auto-deal): several
      // hands must complete without an error, and scores stay zero-sum.
      // (Random discards essentially never WIN, so reaching `over` is the
      // rigged test below, not this soak.)
      guard = 0;
      while (g.results.length < 5 && guard++ < 3000) {
        if (!act({ type: "timerExpire" })) break;
      }
      ok(g.results.length >= 5, "idle soak completes hands (" + g.results.length + ")");
      var totals = g.players.reduce(function (a, p) { return a + p.score; }, 0);
      eq(totals, 0, "scores are zero-sum");
    })();

    /* deterministic: a rigged self-draw win → settlement → rotation → over */
    (function () {
      var g = createGame({ settings: { minFaan: 0, capFaan: 13, winds: 1, timerSec: 0 } }, ctx);
      g.phase = "play";
      g.order = [0, 1, 2, 3];
      g.round = { prevailing: 0, dealerIdx: 3, hand: 4 };   // North seat deals
      g.wall = ["m9", "m9"];
      g.players[0].hand = ["m1","m1","m1","m2","m3","m4","m5","m6","m7","p1","p2","p3","dr"];
      g.turn = { seat: 0, drawn: "dr", justKonged: false, anyDiscard: true, firstTurn: false };
      var r = applyAction(g, { type: "win", seat: 0 }, ctx);
      ok(!r.error, "rigged self-draw win applies");
      g = r.game;
      ok(g.handOver && g.handOver.result === "win" && g.handOver.seat === 0, "handOver records the win");
      // self-draw: each of 3 pays 2v — winner takes 6v
      var v = Math.pow(2, g.handOver.faan);
      eq(g.players[0].score, 6 * v, "self-draw pays 3 x 2v");
      eq(g.players[1].score, -2 * v, "each loser pays 2v");
      r = applyAction(g, { type: "nextHand" }, ctx);
      ok(!r.error, "nextHand applies");
      g = r.game;
      eq(g.phase, "over", "non-dealer win off North's deal ends the East-only match");
      eq(g.winner, 0, "top score wins the match");
    })();

    /* scoring: full flush + all pungs style checks via scoreHand */
    (function () {
      var g = createGame({ settings: { minFaan: 0, capFaan: 13, winds: 1 } }, ctx);
      g.phase = "play"; g.order = [0, 1, 2, 3];
      g.round = { prevailing: 0, dealerIdx: 0, hand: 1 };
      g.wall = ["m1"]; g.turn = { seat: 0, drawn: null, firstTurn: false };
      var tiles = ["m1","m1","m1","m2","m2","m2","m3","m3","m3","m4","m4","m4","m5","m5"];
      var sc = scoreHand(g, 0, tiles, { seat: 0, selfDraw: false, discarder: 1 });
      ok(sc && sc.faan >= 10, "pure flush + all pungs scores 10+ (got " + (sc && sc.faan) + ")");
      var t13 = ["m1","m9","p1","p9","s1","s9","we","ws","ww","wn","dr","dg","dw","dr"];
      var sc13 = scoreHand(g, 0, t13, { seat: 0, selfDraw: false, discarder: 1 });
      ok(sc13 && sc13.limit && sc13.faan === 13, "thirteen orphans is a limit hand");
    })();

    /* scoreProgress: mid-hand facts only (the guide's live marks) */
    (function () {
      var g = createGame({ settings: { minFaan: 0, capFaan: 13, winds: 1 } }, ctx);
      g.phase = "play"; g.order = [0, 1, 2, 3];
      g.round = { prevailing: 0, dealerIdx: 0, hand: 1 };   // seat 0 = East
      g.wall = ["m1"]; g.turn = { seat: 1, drawn: null, firstTurn: false };
      var p = g.players[0];
      p.melds = [{ kind: "pung", tile: "dr", from: 1 }, { kind: "kong", tile: "we", from: 2 }];
      p.flowers = ["f1", "g1"];                            // both match East's seat number
      p.hand = ["m2", "m3", "m4", "m7", "m7", "we", "dr"]; // one suit + honors
      var pr = scoreProgress(g, 0);
      // dragon pung 1 + seat wind 1 + round wind 1 + mixed one suit 3 + 2 seat flowers 2
      eq(pr.faan, 8, "progress: dragon + double wind + half flush + flowers");
      ok(pr.parts.filter(function (x) { return x.key === "seatFlower"; }).length === 2, "progress counts each seat flower");
      ok(!pr.parts.some(function (x) { return x.key === "selfDraw" || x.key === "concealed"; }), "progress never counts win-moment bonuses");
      p.hand = ["m2", "m3", "m4", "m7", "m7", "m8", "m9"];
      p.melds = [];
      var pr2 = scoreProgress(g, 0);
      // pure one suit 7 + the two flowers
      eq(pr2.faan, 9, "progress: pure flush reads from concealed tiles alone");
    })();

    var summary = "mahjong engine selfTest: " + pass + " passed, " + fail + " failed";
    if (typeof console !== "undefined") {
      console.log(summary);
      msgs.forEach(function (m) { console.log("  " + m); });
    }
    return { pass: pass, fail: fail, msgs: msgs };
  }

  /* node CLI: `node mahjong/engine.js` runs the checks */
  if (typeof module !== "undefined" && module.exports && typeof require !== "undefined" && typeof process !== "undefined" && require.main === module) {
    var r = selfTest();
    process.exit(r.fail ? 1 : 0);
  }
})();
