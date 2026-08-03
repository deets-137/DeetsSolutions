/* DeetsPoker — rules engine (docs/poker.md, "Rules engine (engine.js)").

   PURE, environment-agnostic module: state + action → new state + events. No
   DOM, no I/O, no Date.now — the caller passes time and randomness in via
   `ctx = { rand, now }` (rand() → [0,1), like Math.random). applyAction never
   mutates its input; it clones, mutates the clone, and returns it.

     createGame(opts, ctx)            → game            (→ first hand dealt)
     applyAction(game, action, ctx)   → { game, events } | { error: {code} }

   No-limit Texas Hold'em as a CASH GAME: 2–12 seats, fixed buy-in, blinds,
   streets, side pots, the incomplete-raise rule, busts and re-buys, mid-game
   mid-game sit-ins, sit-outs that keep your stack (sitOut/sitBack,
   ante to return), stand-up cash-outs (concede), a majority vote to end,
   and the host's endGame. There is no tournament clock and no blind
   escalation — the game ends when the table decides it does.

   MONEY IS INTEGER CENTS everywhere. Chips are real at the betting line:
   every buy-in, blind, and raise-to amount must be composable from the
   table's chip denominations (`representable`), with one exception — a full
   all-in is always legal, because your last chips are whatever they are.
   Stacks themselves are plain cent totals; how a stack is DRAWN as chips is
   the client's business (docs/poker.md, "Chips").

   Illegal actions return a typed error and change nothing. Every rule is
   enforced here (the client's disabled pills are cosmetic). The phase-2
   worker repo (../DeetsPoker) will carry a VERBATIM vendored copy — this
   file and its copy are contract, exactly like mahjong's engine.

   BOT_TIER_LIST is deliberately EMPTY: DeetsPoker has no difficulty tiers,
   and live play has no bot takeover at all — a released seat either goes
   AWAY with its stack or cashes out, never to a bot (docs/poker.md,
   "Stepping away"). botAct exists
   for the mock's host-added dev bots only: a bot checks when it can,
   completes a small call (≤ one big blind), and folds to anything more.
   It never raises, votes, or re-buys.

   Browser: window.PokerEngine. Node (self-checks): module.exports, and
   `node poker/engine.js` runs selfTest(). */
(function () {
  "use strict";

  /* ── cards ─────────────────────────────────────────────────────
     52 strings, rank then suit: "2c".."As". Ranks 2–9, T, J, Q, K, A;
     suits c d h s. */
  var RANKS = "23456789TJQKA";
  var SUITS = ["c", "d", "h", "s"];
  var DECK = (function () {
    var out = [];
    for (var r = 0; r < RANKS.length; r++) {
      for (var s = 0; s < SUITS.length; s++) out.push(RANKS[r] + SUITS[s]);
    }
    return out;
  })();
  function rankOf(c) { return RANKS.indexOf(c.charAt(0)) + 2; }   // 2..14
  function suitOf(c) { return c.charAt(1); }

  /* ── small helpers ────────────────────────────────────────────── */
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function err(code) { return { error: { code: code } }; }
  function shuffle(ctx, a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(ctx.rand() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  /* ── chips (real at the betting line) ─────────────────────────
     `chips` is the table's denomination list in cents, any order.
     representable(amount, chips): can this exact amount be paid in
     these chips? Classic coin-change reachability, memoized per
     denomination set. Amounts are cents; the gcd shortcut keeps the
     table small for real ladders. */
  var REP_MEMO = {};
  function chipKey(chips) { return chips.slice().sort(function (a, b) { return a - b; }).join(","); }
  function gcd2(a, b) { while (b) { var t = a % b; a = b; b = t; } return a; }
  function representable(amount, chips) {
    if (amount === 0) return true;
    if (amount < 0 || !chips || !chips.length) return false;
    var g = chips.reduce(function (acc, v) { return gcd2(acc, v); }, 0);
    if (g <= 0 || amount % g) return false;
    var key = chipKey(chips);
    var memo = REP_MEMO[key];
    if (!memo) memo = REP_MEMO[key] = { reach: [true], upto: 0, units: chips.map(function (v) { return v / g; }) };
    var target = amount / g;
    if (target > 200000) return false;   // $20k in 10¢ units — beyond any sane table
    while (memo.upto < target) {
      var n = memo.upto + 1;
      var ok = false;
      for (var i = 0; i < memo.units.length && !ok; i++) {
        var u = memo.units[i];
        if (u <= n && memo.reach[n - u]) ok = true;
      }
      memo.reach[n] = ok;
      memo.upto = n;
    }
    return !!memo.reach[target];
  }
  /* greedy-with-backtracking breakdown for DISPLAY — {value: count}, or
     null. Cosmetic (the client draws stacks with it); settlement never
     needs it. */
  function chipBreak(amount, chips) {
    var vals = chips.slice().sort(function (a, b) { return b - a; });
    var out = {};
    function walk(amt, i) {
      if (amt === 0) return true;
      if (i >= vals.length) return false;
      var max = Math.floor(amt / vals[i]);
      for (var k = max; k >= 0; k--) {
        if (walk(amt - k * vals[i], i + 1)) { if (k) out[vals[i]] = k; return true; }
      }
      return false;
    }
    return walk(amount, 0) ? out : null;
  }
  function minChip(chips) { return Math.min.apply(null, chips); }

  /* ── hand evaluation ──────────────────────────────────────────
     evaluate5 → [category, kicker, ...] comparable lexicographically;
     bestOf(cards 5..7) → { score, name } over every 5-card subset.
     Categories: 8 straight flush, 7 quads, 6 full house, 5 flush,
     4 straight, 3 trips, 2 two pair, 1 pair, 0 high card. */
  var HAND_NAMES = ["high", "pair", "twoPair", "trips", "straight", "flush",
                    "fullHouse", "quads", "straightFlush"];
  function evaluate5(cs) {
    var ranks = cs.map(rankOf).sort(function (a, b) { return b - a; });
    var flush = cs.every(function (c) { return suitOf(c) === suitOf(cs[0]); });
    // straight: 5 distinct descending, or the wheel (A-5 counts A as 1)
    var distinct = ranks.filter(function (r, i) { return ranks.indexOf(r) === i; });
    var straightHigh = 0;
    if (distinct.length === 5) {
      if (distinct[0] - distinct[4] === 4) straightHigh = distinct[0];
      else if (distinct[0] === 14 && distinct[1] === 5 && distinct[4] === 2) straightHigh = 5;
    }
    if (flush && straightHigh) return [8, straightHigh];
    // rank multiplicities, sorted by (count, rank) desc
    var counts = {};
    ranks.forEach(function (r) { counts[r] = (counts[r] || 0) + 1; });
    var groups = Object.keys(counts).map(function (r) { return [counts[r], +r]; });
    groups.sort(function (a, b) { return b[0] - a[0] || b[1] - a[1]; });
    var shape = groups.map(function (g) { return g[0]; }).join("");
    var order = groups.map(function (g) { return g[1]; });
    if (shape === "41") return [7].concat(order);
    if (shape === "32") return [6].concat(order);
    if (flush) return [5].concat(ranks);
    if (straightHigh) return [4, straightHigh];
    if (shape === "311") return [3].concat(order);
    if (shape === "221") return [2].concat(order);
    if (shape === "2111") return [1].concat(order);
    return [0].concat(ranks);
  }
  function cmpScore(a, b) {
    for (var i = 0; i < Math.max(a.length, b.length); i++) {
      var d = (a[i] || 0) - (b[i] || 0);
      if (d) return d;
    }
    return 0;
  }
  function bestOf(cards) {
    var best = null;
    var n = cards.length;
    // every 5-card subset (n ≤ 7 → ≤ 21)
    for (var a = 0; a < n - 4; a++)
      for (var b = a + 1; b < n - 3; b++)
        for (var c = b + 1; c < n - 2; c++)
          for (var d = c + 1; d < n - 1; d++)
            for (var e = d + 1; e < n; e++) {
              var sc = evaluate5([cards[a], cards[b], cards[c], cards[d], cards[e]]);
              if (!best || cmpScore(sc, best) > 0) best = sc;
            }
    return { score: best, name: HAND_NAMES[best[0]] };
  }

  /* ── seat scans ───────────────────────────────────────────────── */
  function alive(p) { return p && !p.left; }                 // still owns a stake
  function eligible(p) {                                     // can be dealt in
    return alive(p) && !p.out && !p.waiting && !p.away && p.stack > 0;
  }
  function inHand(p) { return p && p.inHand && !p.folded; }
  function nextSeat(g, from, pred) {
    var n = g.players.length;
    for (var k = 1; k <= n; k++) {
      var i = (from + k) % n;
      if (pred(g.players[i], i)) return i;
    }
    return null;
  }
  function countBy(g, pred) {
    var n = 0;
    g.players.forEach(function (p, i) { if (pred(p, i)) n++; });
    return n;
  }

  /* ── the betting round ────────────────────────────────────────── */
  function toCall(g, i) {
    var p = g.players[i];
    return Math.max(0, Math.min(g.bet.current - p.betStreet, p.stack));
  }
  function minRaiseTo(g) {
    var mode = g.settings.minRaise;
    var mc = minChip(g.settings.chips);
    if (g.bet.current === 0) return mode === "none" ? mc : g.settings.bigBlind;
    if (mode === "double") return g.bet.current * 2;
    if (mode === "none") return g.bet.current + mc;
    return g.bet.current + g.bet.lastRaise;                  // "prev" — standard NL
  }
  function commit(g, i, amount) {                            // move cents into the street
    var p = g.players[i];
    amount = Math.min(amount, p.stack);
    p.stack -= amount;
    p.betStreet += amount;
    p.betHand += amount;
    if (p.stack === 0) p.allIn = true;
    return amount;
  }
  function openPending(g) {
    // everyone still holding chips owes an action — unless nobody can be
    // bet at (one live stack, nothing to call): then the street just runs
    g.bet.pending = {};
    g.players.forEach(function (p, i) {
      if (inHand(p) && !p.allIn) g.bet.pending[i] = true;
    });
    var keys = Object.keys(g.bet.pending);
    if (keys.length === 1 && toCall(g, +keys[0]) === 0) g.bet.pending = {};
  }
  function firstActor(g, preflop) {
    var headsUp = countBy(g, inHand) === 2;
    if (preflop) {
      var from = headsUp ? g.dealer - 1 : g.blinds.bb;       // heads-up: the button is SB and acts first
      return nextSeat(g, (from + g.players.length) % g.players.length,
                      function (p, i) { return inHand(p) && !p.allIn && g.bet.pending[i]; });
    }
    return nextSeat(g, g.dealer, function (p, i) { return inHand(p) && !p.allIn && g.bet.pending[i]; });
  }
  function advanceActor(g) {
    var keys = Object.keys(g.bet.pending);
    if (!keys.length) { g.turn = null; return; }
    var from = g.turn ? g.turn.seat : g.dealer;
    var nx = nextSeat(g, from, function (p, i) { return !!g.bet.pending[i]; });
    g.turn = nx == null ? null : { seat: nx };
  }

  /* ── hand lifecycle ───────────────────────────────────────────── */
  function tryStartHand(g, ctx, events) {
    g.players.forEach(function (p) {
      if (!p) return;
      p.waiting = false;
      if (alive(p) && p.stack === 0) p.out = true;
      p.inHand = false; p.folded = false; p.allIn = false;
      p.betStreet = 0; p.betHand = 0; p.hole = null;
    });
    g.handOver = null; g.board = []; g.turn = null; g.street = null;
    var n = countBy(g, eligible);
    if (n < 2) { g.waiting = true; return; }                 // the felt idles until it can deal
    g.waiting = false;
    g.handNo++;
    // the button walks to the next eligible seat (first hand: rand-seeded)
    g.dealer = g.dealer == null
      ? (function () {
          var els = []; g.players.forEach(function (p, i) { if (eligible(p)) els.push(i); });
          return els[Math.floor(ctx.rand() * els.length)];
        })()
      : nextSeat(g, g.dealer, eligible);
    g.players.forEach(function (p) { if (eligible(p)) { p.inHand = true; p.stats.hands++; } });
    var headsUp = n === 2;
    var sb = headsUp ? g.dealer : nextSeat(g, g.dealer, inHand);
    var bb = nextSeat(g, sb, inHand);
    g.blinds = { sb: sb, bb: bb };
    g.deck = shuffle(ctx, DECK);
    // deal two to each live seat, starting left of the button
    var order = [];
    var at = g.dealer;
    for (var k = 0; k < g.players.length; k++) {
      at = nextSeat(g, at, inHand);
      if (order.indexOf(at) >= 0) break;
      order.push(at);
    }
    order.forEach(function (i) { g.players[i].hole = [g.deck.pop()]; });
    order.forEach(function (i) { g.players[i].hole.push(g.deck.pop()); });
    var sbAmt = commit(g, sb, Math.floor(g.settings.bigBlind / 2));
    var bbAmt = commit(g, bb, g.settings.bigBlind);
    /* The house rule for coming back: your first hand back costs you ONE
       BIG BLIND, posted as an ante — unless you ARE the big blind that
       hand, who is already paying it. No missed-blind ledger, no orbit
       counting: you sat out, you buy back in. The cents leave the stack
       into betHand (so the side-pot layering sees them) but never touch
       betStreet, so the ante buys no call (docs/poker.md). */
    var antes = [];
    g.players.forEach(function (p, i) {
      if (!p || !p.owesAnte || !inHand(p)) return;            // not dealt in — still owes
      p.owesAnte = false;
      if (i === bb) return;                                   // already posting it live
      var amt = Math.min(g.settings.bigBlind, p.stack);
      if (!amt) return;
      p.stack -= amt; p.betHand += amt;
      if (p.stack === 0) p.allIn = true;
      antes.push({ seat: i, amt: amt });
    });
    g.street = "preflop";
    g.bet = { current: g.settings.bigBlind, lastRaise: g.settings.bigBlind,
              pending: {}, capped: {} };
    openPending(g);
    delete g.bet.pending[sb]; delete g.bet.pending[bb];      // blinds re-owe below
    if (inHand(g.players[sb]) && !g.players[sb].allIn) g.bet.pending[sb] = true;
    if (inHand(g.players[bb]) && !g.players[bb].allIn) g.bet.pending[bb] = true;   // the BB option
    g.turn = { seat: firstActor(g, true) };
    if (g.turn.seat == null) g.turn = null;
    events.push({ t: "hand", n: g.handNo, dealer: g.dealer });
    events.push({ t: "blind", seat: sb, kind: "sb", amt: sbAmt });
    events.push({ t: "blind", seat: bb, kind: "bb", amt: bbAmt });
    antes.forEach(function (a) {
      events.push({ t: "blind", seat: a.seat, kind: "ante", amt: a.amt });
    });
    if (!g.turn) runOut(g, events);                          // everyone blind-all-in
  }
  var STREETS = { preflop: "flop", flop: "turn", turn: "river" };
  function dealStreet(g, events) {
    var next = STREETS[g.street];
    if (!next) return false;
    g.street = next;
    var take = next === "flop" ? 3 : 1;
    for (var i = 0; i < take; i++) g.board.push(g.deck.pop());
    events.push({ t: "street", name: next, cards: g.board.slice() });
    return true;
  }
  function streetDone(g, ctx, events) {
    // one player left standing → the pot walks over uncontested
    if (countBy(g, inHand) <= 1) return settle(g, events, false);
    g.players.forEach(function (p) { if (p) p.betStreet = 0; });
    g.bet.current = 0; g.bet.lastRaise = g.settings.bigBlind; g.bet.capped = {};
    if (!STREETS[g.street]) return settle(g, events, true);  // river closed → showdown
    dealStreet(g, events);
    openPending(g);
    var canAct = Object.keys(g.bet.pending);
    if (!canAct.length) {                                    // all-in — run the board out
      runOut(g, events);
      return;
    }
    g.turn = { seat: firstActor(g, false) };
  }
  function runOut(g, events) {
    while (dealStreet(g, events)) { /* flop, turn, river */ }
    settle(g, events, true);
  }

  /* the Winnings ledger's shape: one row and one column per seat —
     sized lazily so a table persisted before the ledger existed heals */
  function ensureLedger(g) {
    if (!g.transfers) g.transfers = [];
    while (g.transfers.length < g.players.length) g.transfers.push([]);
    g.transfers.forEach(function (row) {
      while (row.length < g.players.length) row.push(0);
    });
  }

  /* ── settlement: uncalled refund, side pots, awards ───────────── */
  function settle(g, events, showdown) {
    g.turn = null;
    ensureLedger(g);
    var ps = g.players;
    // refund the uncalled top of the last bet
    var maxI = null, maxV = 0, secV = 0;
    ps.forEach(function (p, i) {
      if (!p || !p.betHand) return;
      if (p.betHand > maxV) { secV = maxV; maxV = p.betHand; maxI = i; }
      else if (p.betHand > secV) secV = p.betHand;
    });
    if (maxI != null && maxV > secV) {
      var refund = maxV - secV;
      ps[maxI].stack += refund; ps[maxI].betHand -= refund;
      if (refund && ps[maxI].stack > 0) ps[maxI].allIn = false;
    }
    // layer the contributions into pots (folded money stays in, folded
    // players are just never eligible)
    var levels = [];
    ps.forEach(function (p) {
      if (p && p.betHand && levels.indexOf(p.betHand) < 0) levels.push(p.betHand);
    });
    levels.sort(function (a, b) { return a - b; });
    var pots = [];
    var prev = 0;
    levels.forEach(function (L) {
      var amt = 0;
      var contrib = {};                 // per-seat cents in THIS layer (ledger)
      ps.forEach(function (p, i) {
        if (!p || !p.betHand) return;
        var c = Math.max(0, Math.min(p.betHand, L) - prev);
        if (c > 0) { amt += c; contrib[i] = c; }
      });
      var elig = [];
      ps.forEach(function (p, i) { if (inHand(p) && p.betHand >= L) elig.push(i); });
      if (amt > 0) pots.push({ amount: amt, elig: elig, contrib: contrib });
      prev = L;
    });
    // merge layers with identical eligibility (display + fewer splits)
    for (var i = pots.length - 1; i > 0; i--) {
      if (pots[i].elig.join(",") === pots[i - 1].elig.join(",")) {
        pots[i - 1].amount += pots[i].amount;
        Object.keys(pots[i].contrib).forEach(function (k) {
          pots[i - 1].contrib[k] = (pots[i - 1].contrib[k] || 0) + pots[i].contrib[k];
        });
        pots.splice(i, 1);
      }
    }
    // score the live hands once — only a showdown has five cards to read;
    // a fold-through pot walks to its one eligible seat unevaluated
    var scores = {};
    var reveal = [];
    if (showdown) {
      ps.forEach(function (p, i) {
        if (!inHand(p)) return;
        var ev = bestOf(p.hole.concat(g.board));
        scores[i] = ev;
        reveal.push({ seat: i, hole: p.hole.slice(), name: ev.name });
      });
    }
    var awards = [];
    pots.forEach(function (pot) {
      var winners = [];
      var best = null;
      pot.elig.forEach(function (i) {
        if (!showdown) { winners.push(i); return; }
        var sc = scores[i].score;
        if (!best || cmpScore(sc, best) > 0) { best = sc; winners = [i]; }
        else if (cmpScore(sc, best) === 0) winners.push(i);
      });
      // odd cents: first winner clockwise from the button takes them
      winners.sort(function (a, b) {
        var da = (a - g.dealer + ps.length) % ps.length;
        var db = (b - g.dealer + ps.length) % ps.length;
        return da - db;
      });
      var share = Math.floor(pot.amount / winners.length);
      var rem = pot.amount - share * winners.length;
      var awardBy = {};
      winners.forEach(function (w, k) {
        var take = share + (k === 0 ? rem : 0);
        ps[w].stack += take;
        awardBy[w] = take;
        awards.push({ seat: w, amt: take, name: scores[w] ? scores[w].name : null });
      });
      /* the transfer ledger (docs/poker.md, "Winnings"): every NON-winner's
         contribution to this pot drains into the winners' PROFITS (award
         minus their own contribution, which simply comes home) — walked in
         seat order, integer-exact, so the ledger stays a zero-sum mirror
         of every stack's net; the self-checks hold it to that. */
      var profits = winners.map(function (w) { return awardBy[w] - (pot.contrib[w] || 0); });
      var wi = 0;
      Object.keys(pot.contrib).map(Number).sort(function (a, b) { return a - b; })
        .forEach(function (from) {
          if (winners.indexOf(from) >= 0) return;
          var owe = pot.contrib[from];
          while (owe > 0 && wi < winners.length) {
            if (profits[wi] <= 0) { wi++; continue; }
            var t = Math.min(owe, profits[wi]);
            g.transfers[from][winners[wi]] += t;
            owe -= t; profits[wi] -= t;
          }
        });
    });
    // fold-through awards carry no hand name
    if (!showdown) awards.forEach(function (a) { a.name = null; });
    // roll per-winner totals for stats + events
    var byWinner = {};
    awards.forEach(function (a) { byWinner[a.seat] = (byWinner[a.seat] || 0) + a.amt; });
    Object.keys(byWinner).forEach(function (w) {
      var p = ps[+w];
      p.stats.wins++;
      if (byWinner[w] > p.stats.biggestPot) p.stats.biggestPot = byWinner[w];
      events.push({ t: "win", seat: +w, amt: byWinner[w],
                    name: showdown && scores[w] ? scores[w].name : null });
    });
    ps.forEach(function (p, i) {
      if (alive(p) && p.inHand && p.stack === 0) { p.out = true; events.push({ t: "bust", seat: i }); }
      if (p) p.betHand = 0;
    });
    g.handOver = {
      reason: showdown ? "showdown" : "folds",
      reveal: showdown ? reveal : [],
      board: g.board.slice(),
      pots: pots.map(function (pot) { return { amount: pot.amount, elig: pot.elig }; }),
      awards: awards
    };
    g.stats.hands++;
  }

  /* ── ending the game (votes, the host, attrition) ─────────────── */
  function voteNeed(g) {
    var denom = countBy(g, alive);
    return Math.floor(denom / 2) + 1;
  }
  function abortHand(g) {
    // an ended game cancels the hand in flight: every live bet walks home
    if (!g.street) return;
    g.players.forEach(function (p) {
      if (!p) return;
      p.stack += p.betHand;
      p.betHand = 0; p.betStreet = 0; p.inHand = false; p.folded = false;
      p.allIn = false; p.hole = null;
    });
    g.street = null; g.turn = null; g.board = []; g.handOver = null;
  }
  function finishGame(g, events, how) {
    abortHand(g);
    g.phase = "over";
    g.endedBy = how;
    g.results = g.players.map(function (p, i) {
      if (!p) return null;
      return { seat: i, bought: p.bought, stack: p.stack, net: p.stack - p.bought,
               left: !!p.left, stats: p.stats };
    });
    events.push({ t: "gameOver", how: how });
  }
  function standings(g) {
    var rows = [];
    (g.results || []).forEach(function (r) { if (r) rows.push(r); });
    rows.sort(function (a, b) { return b.net - a.net; });
    var out = [];
    rows.forEach(function (r, i) {
      var rank = i > 0 && rows[i - 1].net === r.net ? out[i - 1].rank : i + 1;
      out.push({ seat: r.seat, rank: rank, net: r.net, bought: r.bought, stack: r.stack });
    });
    out.forEach(function (r) {
      r.tied = out.filter(function (x) { return x.rank === r.rank; }).length > 1;
    });
    return out;
  }

  /* ── the acting seat's options (mirrored onto `you` by the table) ── */
  function options(g, i) {
    if (!g.turn || g.turn.seat !== i) return null;
    var p = g.players[i];
    var call = toCall(g, i);
    var maxTo = p.betStreet + p.stack;
    var minTo = Math.min(minRaiseTo(g), maxTo);
    return {
      toCall: call,
      canCheck: call === 0,
      canRaise: !g.bet.capped[i] && maxTo > g.bet.current,
      minTo: minTo,
      maxTo: maxTo
    };
  }

  /* ── createGame ───────────────────────────────────────────────── */
  /* opts = { settings: { buyIn, bigBlind, chips: [cents...], minRaise,
     timerSec }, seats: count }. Engine player index === table seat index
     (poker never compacts differently — the mock compacts AT start, so
     the two are born equal; sit-ins append). */
  function createGame(opts, ctx) {
    var st = opts.settings;
    var g = {
      phase: "play",
      settings: {
        buyIn: st.buyIn, bigBlind: st.bigBlind,
        chips: st.chips.slice(), minRaise: st.minRaise || "prev",
        timerSec: st.timerSec || 0
      },
      handNo: 0, dealer: null, street: null,
      deck: [], board: [],
      players: [],
      blinds: null, bet: null, turn: null,
      handOver: null, waiting: false,
      endVotes: {},
      transfers: [],                    // [from][to] cents, cumulative ("Winnings")
      stats: { hands: 0 },
      results: null, endedBy: null
    };
    for (var i = 0; i < opts.seats; i++) g.players.push(newPlayer(g));
    g.players.forEach(function () {
      g.transfers.push(g.players.map(function () { return 0; }));
    });
    var events = [];
    tryStartHand(g, ctx, events);
    g._boot = events;   // the caller broadcasts these as the start events
    return g;
  }
  function newPlayer(g) {
    return {
      stack: g.settings.buyIn, bought: g.settings.buyIn,
      hole: null, inHand: false, folded: false, allIn: false,
      betStreet: 0, betHand: 0,
      out: false, left: false, waiting: false,
      away: false, owesAnte: false,
      stats: { hands: 0, wins: 0, biggestPot: 0 }
    };
  }

  /* ── applyAction ──────────────────────────────────────────────── */
  function applyAction(game, action, ctx) {
    if (!game || game.phase === "over") return err("phase");
    var g = clone(game);
    var events = [];
    var type = action.type;
    var seat = action.seat;

    /* the deadline fired: settle whatever is owed (games/table-mock.js
       and the DO both send this — never a client) */
    if (type === "timerExpire") {
      if (g.handOver) { tryStartHand(g, ctx, events); return done(); }
      if (g.turn) {
        var ti = g.turn.seat;
        var auto = toCall(g, ti) === 0 ? "check" : "fold";
        events.push({ t: "timeout", seat: ti, did: auto });
        return act(auto, ti);
      }
      return done();
    }

    if (type === "nextHand") {
      if (!g.handOver) return err("phase");
      if (!alive(g.players[seat])) return err("perm");
      tryStartHand(g, ctx, events);
      return done();
    }

    /* stand-up / kick at a "none" table: fold out of the hand, freeze the
       stack for the cash-out math, release the seat for good */
    if (type === "concede") {
      var cp = g.players[seat];
      if (!alive(cp)) return err("perm");
      if (inHand(cp) && g.turn) foldSeat(g, seat, events);
      else if (inHand(cp)) { cp.folded = true; }
      cp.left = true;
      delete g.endVotes[seat];
      events.push({ t: "cashout", seat: seat, net: cp.stack - cp.bought });
      if (countBy(g, alive) < 2) { finishGame(g, events, "attrition"); return done(); }
      if (g.street && countBy(g, inHand) <= 1 && !g.handOver) settle(g, events, false);
      else if (g.turn && g.turn.seat === seat) afterAction(g, ctx, events);
      return done();
    }

    /* stepping away at an "anyone"/"rejoin" table: fold out of the hand,
       stop being dealt in, but KEEP the stack on the felt. This is the
       non-permanent exit — `concede` above is the permanent one. */
    if (type === "sitOut") {
      var op = g.players[seat];
      if (!alive(op)) return err("perm");
      if (op.away) return err("phase");
      if (inHand(op) && g.turn) foldSeat(g, seat, events);
      else if (inHand(op)) { op.folded = true; }
      op.away = true;
      delete g.endVotes[seat];
      events.push({ t: "away", seat: seat });
      if (g.street && countBy(g, inHand) <= 1 && !g.handOver) settle(g, events, false);
      else if (g.turn && g.turn.seat === seat) afterAction(g, ctx, events);
      else if (!g.street && !g.handOver) tryStartHand(g, ctx, events);
      return done();
    }

    /* ...and back. Mid-hand returns wait for the next deal, exactly like
       a sit-in or a re-buy. Coming back costs one big blind, posted as an
       ante on the first hand you're dealt (tryStartHand). */
    if (type === "sitBack") {
      var rp = g.players[seat];
      if (!alive(rp) || !rp.away) return err("perm");
      rp.away = false;
      rp.owesAnte = true;
      rp.waiting = !!g.street;
      events.push({ t: "back", seat: seat });
      if (!g.street && !g.handOver) tryStartHand(g, ctx, events);
      return done();
    }

    if (type === "sitIn") {
      // a NEW seat appears mid-game, buys in, and waits for
      // the next deal. The table validated the seat index and the policy.
      if (g.players[seat]) return err("perm");
      while (g.players.length < seat) g.players.push(null);
      var np = newPlayer(g);
      np.waiting = !!g.street;                    // a hand is running — sit out until it ends
      g.players[seat] = np;
      ensureLedger(g);                  // the ledger grows with the roster
      events.push({ t: "sitIn", seat: seat });
      if (!g.street && !g.handOver) tryStartHand(g, ctx, events);
      return done();
    }

    if (type === "buyIn") {
      var bp = g.players[seat];
      if (!alive(bp)) return err("perm");
      if (!bp.out) return err("phase");                     // re-buys are for busted stacks
      bp.stack += g.settings.buyIn;
      bp.bought += g.settings.buyIn;
      bp.out = false;
      bp.waiting = !!g.street;
      events.push({ t: "rebuy", seat: seat });
      if (!g.street && !g.handOver) tryStartHand(g, ctx, events);
      return done();
    }

    if (type === "voteEnd") {
      var vp = g.players[seat];
      if (!alive(vp)) return err("perm");
      if (g.endVotes[seat]) delete g.endVotes[seat];
      else g.endVotes[seat] = true;
      var n = Object.keys(g.endVotes).length;
      var need = voteNeed(g);
      events.push({ t: "voteEnd", seat: seat, on: !!g.endVotes[seat], n: n, need: need });
      if (n >= need) finishGame(g, events, "vote");
      return done();
    }

    if (type === "endGame") {
      // host-only: the table checked the badge before routing it here
      finishGame(g, events, "host");
      return done();
    }

    /* betting actions — must be the acting seat */
    if (type === "fold" || type === "check" || type === "call" || type === "raise") {
      if (!g.turn || g.turn.seat !== seat) return err("turn");
      return act(type, seat);
    }

    return err("phase");

    function act(kind, i) {
      var p = g.players[i];
      var call = toCall(g, i);
      if (kind === "fold") {
        foldSeat(g, i, events);
      } else if (kind === "check") {
        if (call > 0) return err("phase");
        events.push({ t: "check", seat: i });
        delete g.bet.pending[i];
      } else if (kind === "call") {
        if (call === 0) return err("phase");
        var paid = commit(g, i, call);
        events.push({ t: "call", seat: i, amt: paid, allIn: p.allIn });
        delete g.bet.pending[i];
      } else if (kind === "raise") {
        var to = action.to | 0;
        var maxTo = p.betStreet + p.stack;
        if (g.bet.capped[i]) return err("raise");
        if (to <= g.bet.current || to > maxTo) return err("raise");
        var min = minRaiseTo(g);
        var allIn = to === maxTo;
        if (to < min && !allIn) return err("raise");
        if (!allIn && !representable(to, g.settings.chips)) return err("chips");
        var size = to - g.bet.current;
        commit(g, i, to - p.betStreet);
        var full = size >= g.bet.lastRaise || g.bet.current === 0 ||
                   (g.settings.minRaise !== "prev" && to >= min);
        // a full raise re-opens everyone; a short all-in only re-opens
        // calling for money already matched short (the incomplete-raise rule)
        var reopened = {};
        g.players.forEach(function (q, qi) {
          if (qi === i || !inHand(q) || q.allIn) return;
          if (q.betStreet < to) { reopened[qi] = true; }
        });
        if (full) {
          g.bet.lastRaise = size;
          g.bet.capped = {};
          g.bet.pending = reopened;
        } else {
          Object.keys(reopened).forEach(function (qi) {
            if (!g.bet.pending[qi]) g.bet.capped[qi] = true;   // they already acted — call or fold only
            g.bet.pending[qi] = true;
          });
        }
        delete g.bet.pending[i];
        g.bet.current = to;
        events.push({ t: "raise", seat: i, to: to, allIn: p.allIn });
      }
      afterAction(g, ctx, events);
      return done();
    }

    function done() { return { game: g, events: events }; }
  }

  function foldSeat(g, i, events) {
    var p = g.players[i];
    p.folded = true;
    if (g.bet) { delete g.bet.pending[i]; delete g.bet.capped[i]; }
    events.push({ t: "fold", seat: i });
  }
  function afterAction(g, ctx, events) {
    if (!g.street || g.handOver) return;
    if (countBy(g, inHand) <= 1) { settle(g, events, false); return; }
    if (!Object.keys(g.bet.pending).length) { streetDone(g, ctx, events); return; }
    advanceActor(g);
    if (!g.turn) streetDone(g, ctx, events);
  }

  /* ── the mock's dev bots (docs/poker.md, "Bots") ──────────────
     Not a poker player: checks when free, completes a small call
     (≤ one big blind), folds to pressure. Exists so a solo lobby can
     watch hands play out; live tables have no bots at all. */
  var BOT_TIER_LIST = [];
  function botPending(g, isBot) {
    if (!g || g.phase !== "play") return false;
    if (g.handOver || !g.turn) return false;              // settled hands are the timer's
    return isBot(g.turn.seat);
  }
  function botAct(g, isBot, opts, ctx) {
    if (!botPending(g, isBot)) return null;
    var i = g.turn.seat;
    var call = toCall(g, i);
    if (call === 0) return { type: "check", seat: i };
    if (call <= g.settings.bigBlind) return { type: "call", seat: i };
    return { type: "fold", seat: i };
  }

  /* ── self-checks ──────────────────────────────────────────────── */
  function selfTest() {
    var pass = 0, fail = 0, msgs = [];
    function ok(cond, label) {
      if (cond) pass++;
      else { fail++; msgs.push("FAIL: " + label); }
    }
    function eq(a, b, label) { ok(JSON.stringify(a) === JSON.stringify(b), label + " (got " + JSON.stringify(a) + ")"); }
    function lcg(seed) {
      var s = seed >>> 0;
      return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    }
    function mkCtx(seed) { return { rand: lcg(seed), now: 0 }; }
    var CHIPS = [10, 20, 25, 50, 100];
    function mkGame(seats, seed, over) {
      var st = Object.assign({ buyIn: 2000, bigBlind: 20, chips: CHIPS, minRaise: "prev", timerSec: 0 }, over || {});
      return createGame({ settings: st, seats: seats }, mkCtx(seed));
    }
    function step(g, a, seed) {
      var r = applyAction(g, a, mkCtx(seed || 7));
      ok(!r.error, "legal: " + a.type + (r.error ? " → " + r.error.code : ""));
      return r.game;
    }

    (function chips() {
      ok(representable(20, CHIPS), "20¢ splits");
      ok(representable(45, CHIPS), "45¢ = 20+25");
      ok(representable(30, [10, 25]), "30 = 10+10+10 (greedy trap)");
      ok(!representable(15, [10, 20]), "15 doesn't split into 10/20");
      ok(!representable(5, CHIPS), "below the smallest chip");
      var br = chipBreak(45, CHIPS);
      eq(br && (br[20] || 0) * 20 + (br[25] || 0) * 25, 45, "chipBreak sums back");
      eq(chipBreak(15, [10, 20]), null, "chipBreak refuses the unsplittable");
    })();

    (function evaluator() {
      function sc(cs) { return evaluate5(cs); }
      ok(cmpScore(sc(["As", "Ks", "Qs", "Js", "Ts"]), sc(["Ah", "Ad", "Ac", "As", "Kh"])) > 0, "royal beats quads");
      ok(cmpScore(sc(["2c", "2d", "2h", "3c", "3d"]), sc(["Ac", "Ad", "Kh", "Ks", "Qc"])) > 0, "boat beats two pair");
      ok(cmpScore(sc(["Ac", "2d", "3h", "4s", "5c"]), sc(["2c", "3d", "4h", "5s", "7c"])) > 0, "wheel beats 7-high (2-3-4-5-7 is no straight)");
      ok(cmpScore(sc(["6c", "7d", "8h", "9s", "Tc"]), sc(["Ac", "2d", "3h", "4s", "5c"])) > 0, "T-high straight beats the wheel");
      var b = bestOf(["As", "Ks", "Qs", "Js", "Ts", "2c", "3d"]);
      eq(b.name, "straightFlush", "bestOf finds the royal in seven");
      eq(bestOf(["Ah", "Ad", "Kc", "Kd", "Qh", "2s", "3s"]).name, "twoPair", "two pair named");
    })();

    (function blindsAndOrder() {
      var g = mkGame(3, 42);
      eq(g._boot.filter(function (e) { return e.t === "blind"; }).length, 2, "two blinds posted");
      var sb = g.blinds.sb, bb = g.blinds.bb;
      eq(g.players[sb].betStreet, 10, "SB posts half the BB");
      eq(g.players[bb].betStreet, 20, "BB posts in full");
      eq(g.turn.seat, nextSeat(g, bb, function (p) { return inHand(p); }), "UTG opens preflop");
      // heads-up: the button posts SB and acts first
      var h = mkGame(2, 43);
      eq(h.blinds.sb, h.dealer, "heads-up button is the small blind");
      eq(h.turn.seat, h.dealer, "heads-up button acts first preflop");
    })();

    (function playAHand() {
      var g = mkGame(3, 99);
      var order = [];
      // everyone calls, then checks every street to showdown
      var guard = 0;
      while (!g.handOver && guard++ < 100) {
        var i = g.turn.seat;
        var o = options(g, i);
        g = step(g, { type: o.canCheck ? "check" : "call", seat: i });
      }
      ok(!!g.handOver, "checked-down hand reaches settlement");
      eq(g.handOver.reason, "showdown", "it was a showdown");
      eq(g.handOver.board.length, 5, "five community cards out");
      eq(g.handOver.reveal.length, 3, "all three hands revealed");
      var total = g.players.reduce(function (s, p) { return s + p.stack; }, 0);
      eq(total, 6000, "cents conserved through settlement");
      g = applyAction(g, { type: "timerExpire" }, mkCtx(1)).game;
      eq(g.handNo, 2, "the interstitial auto-deals the next hand");
    })();

    (function foldsEndEarly() {
      var g = mkGame(3, 7);
      var first = g.turn.seat;
      g = step(g, { type: "fold", seat: first });
      g = step(g, { type: "fold", seat: g.turn.seat });
      ok(!!g.handOver, "two folds end a 3-hand pot");
      eq(g.handOver.reason, "folds", "no showdown on folds");
      eq(g.handOver.reveal.length, 0, "no cards revealed on folds");
      var total = g.players.reduce(function (s, p) { return s + p.stack; }, 0);
      eq(total, 6000, "cents conserved on fold-through");
    })();

    (function raiseRules() {
      var g = mkGame(3, 11);
      var i = g.turn.seat;
      ok(applyAction(g, { type: "raise", seat: i, to: 30 }, mkCtx(1)).error, "raise below min refused");
      ok(applyAction(g, { type: "raise", seat: i, to: 47 }, mkCtx(1)).error, "unsplittable raise refused");
      g = step(g, { type: "raise", seat: i, to: 60 });                 // min raise: 20 + 20 = 40, 60 is fine
      eq(g.bet.current, 60, "current bet moves to the raise");
      eq(g.bet.lastRaise, 40, "raise size recorded");
      var j = g.turn.seat;
      ok(applyAction(g, { type: "raise", seat: j, to: 80 }, mkCtx(1)).error, "re-raise below prev size refused");
      g = step(g, { type: "raise", seat: j, to: 100 });
      eq(g.bet.lastRaise, 40, "re-raise of exactly prev keeps the size");
      // wrong-turn guard
      ok(applyAction(g, { type: "check", seat: j, }, mkCtx(1)).error, "acting out of turn refused");
    })();

    (function minRaiseModes() {
      var g = mkGame(2, 21, { minRaise: "double" });
      var i = g.turn.seat;
      ok(applyAction(g, { type: "raise", seat: i, to: 30 }, mkCtx(1)).error, "double-mode: 30 < 2xBB refused");
      g = step(g, { type: "raise", seat: i, to: 40 });
      var j = g.turn.seat;
      ok(applyAction(g, { type: "raise", seat: j, to: 70 }, mkCtx(1)).error, "double-mode: below 2x current refused");
      var h = mkGame(2, 22, { minRaise: "none" });
      var k = h.turn.seat;
      var r = applyAction(h, { type: "raise", seat: k, to: 30 }, mkCtx(1));
      ok(!r.error, "no-min: any splittable raise above current stands");
    })();

    (function shortAllInNoReopen() {
      // seat B shoves short over a raise; the raiser may call but not re-raise
      var g = mkGame(3, 5);
      // find seats: engineer stacks so one is short
      var i = g.turn.seat;
      g = step(g, { type: "raise", seat: i, to: 200 });
      var j = g.turn.seat;
      g.players[j].stack = 260;                            // 260 + 40? craft: betStreet may be 0/10/20
      var maxTo = g.players[j].betStreet + g.players[j].stack;
      var need = minRaiseTo(g);
      if (maxTo <= g.bet.current || maxTo >= need) {
        g.players[j].stack = (g.bet.current - g.players[j].betStreet) + 150;  // 150 over = short of the 180 raise size
        maxTo = g.players[j].betStreet + g.players[j].stack;
      }
      ok(maxTo > g.bet.current && maxTo < minRaiseTo(g), "crafted a short all-in spot");
      g = step(g, { type: "raise", seat: j, to: maxTo });
      ok(g.players[j].allIn, "short raiser is all-in");
      eq(g.bet.lastRaise, 180, "short all-in leaves the raise size alone");
      // the original raiser owes the difference but is capped
      ok(g.bet.pending[i], "original raiser re-owes the difference");
      ok(g.bet.capped[i], "…but is capped to call/fold");
      var rr = applyAction(g, { type: "raise", seat: g.turn.seat === i ? i : g.turn.seat, to: 600 }, mkCtx(1));
      if (g.turn.seat === i) ok(rr.error && rr.error.code === "raise", "capped raise refused");
    })();

    (function sidePots() {
      // three stacks: 100, 300, 1000 — everyone shoves preflop
      var g = mkGame(3, 33);
      var a = g.turn.seat;
      var order = [a];
      var g2 = clone(g);
      // set stacks post-blind so all-in totals are 100 / 300 / 1000 in the pot
      g2.players.forEach(function (p, idx) {
        var target = [100, 300, 1000][idx];
        p.stack = target - p.betStreet;
      });
      var guard = 0;
      while (!g2.handOver && g2.turn && guard++ < 20) {
        var s = g2.turn.seat;
        var o = options(g2, s);
        var res = applyAction(g2, { type: "raise", seat: s, to: o.maxTo }, mkCtx(2));
        if (res.error) res = applyAction(g2, { type: "call", seat: s }, mkCtx(2));
        if (res.error) res = applyAction(g2, { type: "check", seat: s }, mkCtx(2));
        ok(!res.error, "all-in cascade step");
        g2 = res.game;
      }
      ok(!!g2.handOver, "triple all-in settles");
      var total2 = g2.players.reduce(function (s, p) { return s + p.stack; }, 0);
      eq(total2, 100 + 300 + 1000, "side-pot settlement conserves cents");
      ok(g2.handOver.pots.length >= 1, "at least a main pot");
      if (g2.handOver.pots.length >= 2) {
        ok(g2.handOver.pots[0].elig.length >= g2.handOver.pots[1].elig.length,
           "main pot has the widest eligibility");
      }
    })();

    (function uncalledRefund() {
      var g = mkGame(2, 55);
      var i = g.turn.seat;
      var before = g.players[i].stack + g.players[i].betStreet;
      g = step(g, { type: "raise", seat: i, to: 500 });
      g = step(g, { type: "fold", seat: g.turn.seat });
      // the raiser wins SB+BB only; the uncalled 480 comes home
      var after = g.players[i].stack;
      eq(after, before + (i === g.blinds.sb ? 20 : 10), "uncalled bet refunded, blind won");
    })();

    (function bustAndRebuy() {
      var g = mkGame(2, 66);
      // drain one stack via a called shove with a rigged board? Simpler:
      // force stacks and settle
      var i = g.turn.seat;
      var j = (i + 1) % 2;
      g.players[i].stack = 80;
      var o = options(g, i);
      g = step(g, { type: "raise", seat: i, to: g.players[i].betStreet + 80 });
      var r2 = applyAction(g, { type: "call", seat: g.turn ? g.turn.seat : j }, mkCtx(3));
      if (!r2.error) g = r2.game;
      ok(!!g.handOver, "heads-up all-in settles");
      var busted = null;
      g.players.forEach(function (p, k) { if (p.out) busted = k; });
      if (busted != null) {
        ok(g.waiting === false || g.handOver != null, "table state sane after bust");
        var g3 = applyAction(g, { type: "timerExpire" }, mkCtx(4)).game;
        ok(g3.waiting, "one live stack → the felt waits");
        var g4 = applyAction(g3, { type: "buyIn", seat: busted }, mkCtx(5)).game;
        eq(g4.players[busted].bought, 4000, "re-buy doubles the bought total");
        ok(!g4.waiting && g4.street === "preflop", "re-buy restarts the deal");
      }
    })();

    (function sitInMidGame() {
      var g = mkGame(2, 77);
      var r = applyAction(g, { type: "sitIn", seat: 2 }, mkCtx(6));
      ok(!r.error, "sit-in lands");
      g = r.game;
      ok(g.players[2].waiting, "mid-hand sitter waits for the next deal");
      eq(g.players[2].stack, 2000, "sitter bought in");
      // finish the hand; the next deal includes them
      var guard = 0;
      while (!g.handOver && g.turn && guard++ < 100) {
        var o = options(g, g.turn.seat);
        g = applyAction(g, { type: o.canCheck ? "check" : "call", seat: g.turn.seat }, mkCtx(8)).game;
      }
      g = applyAction(g, { type: "timerExpire" }, mkCtx(9)).game;
      ok(g.players[2].inHand, "sitter dealt into the next hand");
      eq(countBy(g, inHand), 3, "three-handed now");
    })();

    (function voteAndHostEnd() {
      var g = mkGame(3, 88);
      g = applyAction(g, { type: "voteEnd", seat: 0 }, mkCtx(1)).game;
      eq(g.phase, "play", "one vote of three isn't a majority");
      g = applyAction(g, { type: "voteEnd", seat: 1 }, mkCtx(1)).game;
      eq(g.phase, "over", "two of three ends it");
      eq(g.endedBy, "vote", "ended by vote");
      var total = g.results.reduce(function (s, r) { return s + (r ? r.stack : 0); }, 0);
      eq(total, 6000, "aborted hand refunds every live bet");
      var h = mkGame(2, 89);
      h = applyAction(h, { type: "endGame", seat: 0 }, mkCtx(1)).game;
      eq(h.phase, "over", "the host's endGame ends it");
      var st = standings(h);
      eq(st.length, 2, "standings cover both seats");
      eq(st[0].net + st[1].net, 0, "nets sum to zero");
    })();

    (function concedeCashesOut() {
      var g = mkGame(3, 91);
      var i = g.turn.seat;
      g = applyAction(g, { type: "concede", seat: i }, mkCtx(1)).game;
      ok(g.players[i].left, "conceded seat is gone for good");
      ok(g.phase === "play", "two remain — play continues");
      var j = g.players.findIndex(function (p, k) { return alive(p) && k !== i && inHand(p); });
      g = applyAction(g, { type: "concede", seat: j }, mkCtx(1)).game;
      eq(g.phase, "over", "down to one live seat → over by attrition");
    })();

    (function sitOutKeepsTheStack() {
      var g = mkGame(3, 93);
      var i = g.turn.seat;
      var before = g.players[i].stack + g.players[i].betHand;
      g = applyAction(g, { type: "sitOut", seat: i }, mkCtx(1)).game;
      ok(g.players[i].away, "sitting out flags the seat away");
      ok(!g.players[i].left, "sitting out is NOT a cash-out");
      ok(!eligible(g.players[i]), "an away seat is not dealt in");
      ok(g.players[i].stack <= before, "the stack stays on the felt");
      // a second sit-out is a no-op refusal, not a double-fold
      ok(applyAction(g, { type: "sitOut", seat: i }, mkCtx(1)).error, "can't sit out twice");
      // play on until a hand is dealt without them, then come back
      var guard = 0, c = mkCtx(7);
      while (g.phase === "play" && g.stats.hands < 3 && guard++ < 400) {
        if (g.handOver) { g = applyAction(g, { type: "timerExpire" }, c).game; continue; }
        if (!g.turn) break;
        g = applyAction(g, { type: "timerExpire" }, c).game;
      }
      var r = applyAction(g, { type: "sitBack", seat: i }, mkCtx(1));
      ok(!r.error, "sitBack is allowed from away");
      g = r.game;
      ok(!g.players[i].away, "sitBack clears away");
      ok(g.players[i].owesAnte, "coming back owes an ante");
      ok(applyAction(g, { type: "sitBack", seat: i }, mkCtx(1)).error, "can't return twice");
    })();

    (function anteOnReturn() {
      var g = mkGame(3, 97);
      var i = g.turn.seat;
      var bb = g.settings.bigBlind;
      g = applyAction(g, { type: "sitOut", seat: i }, mkCtx(1)).game;
      g = applyAction(g, { type: "sitBack", seat: i }, mkCtx(1)).game;
      ok(g.players[i].owesAnte, "ante owed the moment you sit back in");
      // roll to the next deal and check the ante landed
      var guard = 0, c = mkCtx(11);
      while (g.phase === "play" && !g.street && guard++ < 80) {
        g = applyAction(g, { type: "timerExpire" }, c).game;
      }
      if (g.street && inHand(g.players[i])) {
        ok(!g.players[i].owesAnte, "the ante clears on the deal");
        if (g.blinds.bb === i) {
          eq(g.players[i].betHand, bb, "the big blind pays it as their blind, not twice");
          eq(g.players[i].betStreet, bb, "...and it IS their live blind");
        } else if (g.blinds.sb === i) {
          eq(g.players[i].betHand, bb + Math.floor(bb / 2), "the small blind pays ante + SB");
          eq(g.players[i].betStreet, Math.floor(bb / 2), "...only the SB is live");
        } else {
          eq(g.players[i].betHand, bb, "the ante sits in betHand");
          eq(g.players[i].betStreet, 0, "...and buys no call");
        }
      }
    })();

    (function timeoutPolicy() {
      var g = mkGame(3, 95);
      var i = g.turn.seat;
      // facing the BB, UTG's timeout folds
      var r = applyAction(g, { type: "timerExpire" }, mkCtx(1));
      ok(r.game.players[i].folded, "timeout facing a bet folds");
    })();

    (function botsFinishHands() {
      var g = mkGame(4, 101);
      var everyoneBot = function () { return true; };
      var guard = 0, badActs = 0;
      var c = mkCtx(500);
      while (g.phase === "play" && g.stats.hands < 6 && guard++ < 2000) {
        if (g.handOver) { g = applyAction(g, { type: "timerExpire" }, c).game; continue; }
        if (g.waiting) break;
        var a = botAct(g, everyoneBot, {}, c);
        if (!a) break;
        var r = applyAction(g, a, c);
        if (r.error) { badActs++; break; }
        g = r.game;
      }
      eq(badActs, 0, "dev bots only make legal moves");
      ok(g.stats.hands >= 6 || g.waiting, "dev bots play hands to completion (" + g.stats.hands + ")");
      eq(botAct({ phase: "over" }, everyoneBot, {}, null), null, "no bot act after over");
      // the Winnings ledger is a zero-sum mirror of every stack's net —
      // exactly, in cents, after any number of settled hands
      var offLedger = 0, moved = 0;
      g.players.forEach(function (p, i) {
        var net = p.stack - p.bought;
        var ledger = 0;
        g.players.forEach(function (q, j) {
          ledger += g.transfers[j][i] - g.transfers[i][j];
          if (g.transfers[i][j] < 0) offLedger++;
          moved += g.transfers[i][j];
        });
        if (ledger !== net) offLedger++;
      });
      eq(offLedger, 0, "ledger mirrors every net exactly (" + g.stats.hands + " hands)");
      ok(moved > 0, "the ledger saw money move (" + moved + "c)");
    })();

    (function ledgerSidePots() {
      // triple all-in with unequal stacks: nets and ledger must still agree
      var g = mkGame(3, 33);
      g.players.forEach(function (p, idx) {
        var target = [100, 300, 1000][idx];
        p.bought = target;                       // pretend these were the buy-ins
        p.stack = target - p.betStreet;
      });
      var guard = 0;
      var c = mkCtx(41);
      while (!g.handOver && g.turn && guard++ < 20) {
        var s = g.turn.seat;
        var o = options(g, s);
        var res = applyAction(g, { type: "raise", seat: s, to: o.maxTo }, c);
        if (res.error) res = applyAction(g, { type: "call", seat: s }, c);
        if (res.error) res = applyAction(g, { type: "check", seat: s }, c);
        if (res.error) break;
        g = res.game;
      }
      ok(!!g.handOver, "ledger side-pot hand settles");
      var bad = 0;
      g.players.forEach(function (p, i) {
        var net = p.stack - p.bought;
        var ledger = 0;
        g.players.forEach(function (q, j) { ledger += g.transfers[j][i] - g.transfers[i][j]; });
        if (ledger !== net) bad++;
      });
      eq(bad, 0, "ledger mirrors nets through side pots");
    })();

    var summary = "poker engine selfTest: " + pass + " passed, " + fail + " failed";
    if (typeof console !== "undefined") {
      console.log(summary);
      msgs.forEach(function (m) { console.log("  " + m); });
    }
    return { pass: pass, fail: fail, msgs: msgs };
  }

  /* ── exports ──────────────────────────────────────────────────── */
  var API = {
    createGame: createGame,
    applyAction: applyAction,
    options: options,
    standings: standings,
    representable: representable,
    chipBreak: chipBreak,
    minChip: minChip,
    toCall: toCall,
    minRaiseTo: minRaiseTo,
    voteNeed: voteNeed,
    bestOf: bestOf,
    HAND_NAMES: HAND_NAMES,
    botAct: botAct,
    botPending: botPending,
    BOT_TIER_LIST: BOT_TIER_LIST,
    selfTest: selfTest
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.PokerEngine = API;

  /* node CLI: `node poker/engine.js` runs the checks */
  if (typeof module !== "undefined" && module.exports && typeof require !== "undefined" &&
      typeof process !== "undefined" && require.main === module) {
    var r = selfTest();
    process.exit(r.fail ? 1 : 0);
  }
})();
