/* Dev driver hooks — DeetsMahjong (core.js, "games"). What the generic
   commands can't know: which rolls start a hand, when this seat must act,
   and when the page has caught up with the table (tile flights still in the
   air, docs/mahjong.md "Tile flights"). Read from the mock's engine state. */
GAMES.mahjong = {
  mock: "MahjongTransport",
  rolls: "rollSeat,rollBreak",
  waitsOnMe: function (g, seat, type) {
    if (type === "rollSeat") {
      if (g.phase !== "seating") return false;
      var scope = (g.seating && g.seating.reroll) || [0, 1, 2, 3];
      return scope.indexOf(seat) >= 0 && !(g.seating && g.seating.rolls && g.seating.rolls[seat]);
    }
    // the engine's own state has no needBreak (that's the broadcast's): a
    // hand waits on its dealer's break roll while the wall isn't built yet
    if (type === "rollBreak") return g.phase === "play" && g.wall == null && !!g.order && !!g.round && g.order[g.round.dealerIdx] === seat;
    return true;
  },
  // my discard is due: my seat holds the turn with its draw made, no claim open
  myTurn: function (g, seat) {
    return g.phase === "play" && !g.handOver && !g.claims && !!g.turn && g.turn.seat === seat && g.turn.drawn != null;
  },
  claimWaits: function (g, seat) {
    return !!g.claims && !g.claims.robbing && (g.claims.waiting || Object.keys(g.claims.can || {}).map(Number)).indexOf(seat) >= 0 &&
      !(g.claims.responses && g.claims.responses[seat]);
  },
  pass: function (send) { send({ type: "claim", action: "pass" }); },
  // no tile in flight and no slot still waiting for one
  idle: function () {
    return !document.querySelector(".mj-fly") && !document.querySelector(".mj .is-pending");
  },
  // End hand pills (core.js, endhand): ready the game, return the actions
  ends: {
    // the wall runs dry: the seat on turn throws, every claim passes, and
    // the next draw finds nothing
    Draw: function (g) {
      var s = g.turn ? g.turn.seat : g.claims ? g.claims.from : 0;
      var drawn = g.turn && g.turn.seat === s ? g.turn.drawn : null;
      var tile = drawn != null ? drawn : g.players[s].hand[0];
      g.claims = null;
      g.turn = { seat: s, drawn: drawn, justKonged: false, anyDiscard: true, firstTurn: false };
      g.wall = [];
      return [{ type: "discard", seat: s, tile: tile },
        function (g2) { return g2.claims ? { type: "timerExpire" } : null; }];
    },
    // a random seat self-draws a random hand that clears the table minimum
    Win: function (g) {
      var E = window.MahjongEngine, seat = Math.floor(Math.random() * 4);
      for (var tries = 0; tries < 500; tries++) {
        var hand = mjRandomWin(E, seat);
        if (!hand) continue;
        var p = g.players[seat];
        p.hand = hand.hand; p.melds = hand.melds; p.flowers = hand.flowers;
        g.claims = null;
        g.turn = { seat: seat, drawn: hand.drawn, justKonged: false, anyDiscard: true, firstTurn: false };
        var ctx = { seat: seat, selfDraw: true, discarder: null, robbing: false, lastWall: false, replacement: false, firstTurn: false };
        if (E.winCheck(g, seat, null, ctx)) return [{ type: "win", seat: seat }];
      }
      return { error: "no hand over the minimum in 500 tries" };
    }
  }
};
// four sets (honors weighted in, some melded, the odd kong) + a pair,
// never more than four of a tile, and 0-3 flowers
function mjRandomWin(E, seat) {
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  var nums = E.KINDS.filter(function (k) { return !E.isHonor(k); });
  var honors = E.WINDS.concat(E.DRAGONS);
  var used = {};
  function take(t, n) { used[t] = (used[t] || 0) + n; return used[t] <= 4; }
  var concealed = [], melds = [];
  for (var i = 0; i < 4; i++) {
    var r = Math.random(), from = (seat + 1 + Math.floor(Math.random() * 3)) % 4;
    if (r < 0.3) {
      var c = pick(nums.filter(function (k) { return E.numOf(k) <= 7; }));
      var run = [0, 1, 2].map(function (d) { return E.suitOf(c) + (E.numOf(c) + d); });
      if (!run.every(function (t) { return take(t, 1); })) return null;
      if (Math.random() < 0.4) melds.push({ kind: "chow", tile: c, from: from, claimed: pick(run) });
      else concealed = concealed.concat(run);
    } else {
      var t = pick(Math.random() < 0.45 ? honors : nums);
      var kong = Math.random() < 0.15;
      if (!take(t, kong ? 4 : 3)) return null;
      if (kong) melds.push({ kind: pick(["kong", "kongA", "kongC"]), tile: t, from: from });
      else if (Math.random() < 0.4) melds.push({ kind: "pung", tile: t, from: from });
      else concealed.push(t, t, t);
    }
  }
  var pair = pick(Math.random() < 0.4 ? honors : nums);
  if (!take(pair, 2)) return null;
  concealed.push(pair, pair);
  var drawn = concealed.splice(Math.floor(Math.random() * concealed.length), 1)[0];
  var flowers = E.FLOWERS.slice().sort(function () { return Math.random() - 0.5; }).slice(0, Math.floor(Math.random() * 4));
  return { hand: concealed.sort(), drawn: drawn, melds: melds, flowers: flowers };
}
