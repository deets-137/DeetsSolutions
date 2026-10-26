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
  }
};
