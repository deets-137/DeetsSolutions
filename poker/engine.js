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

   BOTS play three tiers over one brain (docs/bots.md). A bot is always
   HOST-ADDED and never inherited: a released seat goes AWAY with its
   stack or cashes out, never to a bot (docs/poker.md, "Stepping away").
   Poker's bot is the one that may not read the table — see the hidden
   information note above botAct, which the self-checks hold it to.

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

  /* ── the settings cascade ─────────────────────────────────────
     A real cash table doesn't pick its chips out of the air. The
     buy-in fixes the blind (100 big blinds is the standard anchor),
     the blind fixes the smallest chip (anything under the small blind
     is unspendable), and the ladder is that rung plus N-1 more up the
     values people actually mint. Every preset then lands with the top
     chip at a tenth of the buy-in without anyone writing that rule
     down — and because the smallest chip IS the small blind, a blind
     that doesn't split into the ladder stops being possible.
     Pure and exported, so the lobby, the mock and (phase 2) the worker
     all derive the same table. */
  var CANON = [5, 10, 25, 50, 100, 200, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
  function nearestCanon(v) {
    var best = CANON[0];
    for (var i = 1; i < CANON.length; i++) {
      if (Math.abs(CANON[i] - v) < Math.abs(best - v)) best = CANON[i];
    }
    return best;
  }
  /* 100 BB, snapped so the SMALL blind lands on a canonical rung —
     custom buy-ins round to the nearest, so odd numbers still produce a
     table made of round money (his call, chat 2026-08-03). */
  function suggestBlind(buyIn) { return nearestCanon(buyIn / 200) * 2; }
  /* the ladder: the small blind, then count-1 rungs up the canonical
     list. `count` is the lobby's 4|5 pill — it is the ONLY knob, which
     is why there is no separate "top chip" rule to contradict it. */
  function suggestChips(bigBlind, count) {
    var sb = nearestCanon(bigBlind / 2);
    var at = CANON.indexOf(sb);
    if (at < 0) at = 0;
    var n = Math.max(2, Math.min(8, count | 0 || 5));
    if (at + n > CANON.length) at = Math.max(0, CANON.length - n);
    return CANON.slice(at, at + n);
  }

  /* ── the tray: a stack drawn as the chips it's actually made of ──
     `chipBreak` is a canonical breakdown, so it hands back one tall
     column of the biggest chip — true, and useless to look at. A tray
     is what the cage would deal you: even-ish stacks of the low rungs
     (TRAY_SHARE of the buy-in between them) with the top chip
     absorbing the rest, so a deep stack grows the tall column and a
     rich seat reads as rich from across the felt.
     Counts are chosen per rung by searching outward from the wanted
     height for one whose remainder the HIGHER rungs can still pay —
     that is what makes the tray land on the buy-in exactly, on any
     ladder the host builds, instead of only on the tidy ones. */
  var TRAY_SHARE = 0.6;
  function trayRatio(i) { return i < 2 ? 1 : Math.max(0.3, 1 - 0.2 * (i - 1)); }
  /* the largest representable amount ≤ cap; the rest is loose cents.
     Odd cents are real — a three-way split of an odd pot leaves one —
     and no ladder can draw them, so the tray carries them as a number
     rather than pretending they're a chip. */
  function fitDown(cap, chips) {
    var floor = Math.max(0, cap - minChip(chips) * 2);
    for (var v = cap; v >= floor; v--) if (representable(v, chips)) return v;
    return 0;
  }
  function traySum(t) {
    var s = 0;
    for (var v in t) if (Object.prototype.hasOwnProperty.call(t, v)) s += (+v) * t[v];
    return s;
  }
  function dealTray(amount, chips) {
    var vals = chips.slice().sort(function (a, b) { return a - b; });
    var target = fitDown(Math.max(0, amount), vals);
    var odd = Math.max(0, amount) - target;
    var flat = function () { return { chips: chipBreak(target, vals) || {}, odd: odd }; };
    if (vals.length < 2 || !target) return flat();
    var tray = {}, rem = target, i;
    var denom = 0;
    for (i = 0; i < vals.length - 1; i++) denom += trayRatio(i) * vals[i];
    var k = denom > 0 ? Math.round(TRAY_SHARE * target / denom) : 0;
    k = Math.max(1, Math.min(40, k));
    for (i = 0; i < vals.length - 1; i++) {
      var higher = vals.slice(i + 1);
      var want = Math.max(0, Math.round(k * trayRatio(i)));
      var max = Math.floor(rem / vals[i]);
      var span = Math.max(want, max) + 1;
      var pick = null;
      for (var d = 0; d < span && pick === null; d++) {
        var up = want + d, dn = want - d;
        if (up <= max && representable(rem - up * vals[i], higher)) pick = up;
        else if (dn >= 0 && dn <= max && representable(rem - dn * vals[i], higher)) pick = dn;
      }
      if (pick === null) return flat();
      if (pick) tray[vals[i]] = pick;
      rem -= pick * vals[i];
    }
    var top = vals[vals.length - 1];
    if (rem % top) return flat();
    if (rem) tray[top] = (tray[top] || 0) + rem / top;
    return { chips: tray, odd: odd };
  }
  /* take `amount` OFF a tray, the way it happens at a table: push in the
     biggest chips that fit, and when the last of it is smaller than
     anything you're still holding, push one chip over and take the
     change back. Breaking chips down in place looks equivalent and
     isn't — a greedy break can strand you (a 50¢ split into two
     quarters can no longer pay 45¢ on a ladder whose 20¢ chip it
     skipped). Returns null only when the change itself won't split, and
     the caller re-deals. */
  function trayPay(tray, amount, chips) {
    var vals = chips.slice().sort(function (a, b) { return b - a; });   // high → low
    var t = {}, v, i;
    for (v in tray) if (Object.prototype.hasOwnProperty.call(tray, v)) t[v] = tray[v];
    var rem = amount;
    for (i = 0; i < vals.length; i++) {
      var take = Math.min(t[vals[i]] || 0, Math.floor(rem / vals[i]));
      if (take > 0) { t[vals[i]] -= take; rem -= take * vals[i]; }
    }
    if (rem === 0) return t;
    var over = null;                       // smallest chip still held, all too big
    for (i = vals.length - 1; i >= 0 && over === null; i--) if (t[vals[i]] > 0) over = vals[i];
    if (over === null) return null;
    var back = chipBreak(over - rem, vals);
    if (!back) return null;
    t[over]--;
    for (var bv in back) if (Object.prototype.hasOwnProperty.call(back, bv)) {
      t[bv] = (t[bv] || 0) + back[bv];
    }
    return t;
  }
  /* the tray follows the stack. ADJUSTING rather than re-dealing is the
     point: a bet takes chips off your tray (breaking one for change if
     it must) and a pot adds the winnings as a fresh handful, so your
     chips keep looking like your chips instead of re-composing under
     you every hand. Chips never gate legality — `representable` already
     does that at the betting line — so a payment can't fail the rules;
     the worst case is a re-deal, and the invariant holds either way. */
  function syncTray(p, chips) {
    if (!p || p.left) return;
    if (!p.tray) { p.tray = dealTray(p.stack, chips); return; }
    var have = traySum(p.tray.chips) + p.tray.odd;
    if (have === p.stack) return;
    if (p.stack > have) {
      var add = dealTray(p.stack - have + p.tray.odd, chips);
      var merged = {}, v;
      for (v in p.tray.chips) if (Object.prototype.hasOwnProperty.call(p.tray.chips, v)) {
        merged[v] = p.tray.chips[v];
      }
      for (v in add.chips) if (Object.prototype.hasOwnProperty.call(add.chips, v)) {
        merged[v] = (merged[v] || 0) + add.chips[v];
      }
      p.tray = { chips: merged, odd: add.odd };
    } else {
      var down = have - p.stack;
      var oddUse = Math.min(p.tray.odd, down);
      var next = trayPay(p.tray.chips, down - oddUse, chips);
      p.tray = next ? { chips: next, odd: p.tray.odd - oddUse } : dealTray(p.stack, chips);
    }
    if (traySum(p.tray.chips) + p.tray.odd !== p.stack) p.tray = dealTray(p.stack, chips);
  }
  /* ── the pot, as the chips that were actually pushed into it ──────
     The pot used to be drawn by racking its TOTAL — `dealTray(pot)` —
     which is a true statement about how much is in the middle and a
     false one about what is in the middle: bet three quarters and the
     middle would show a 50¢ and a 25¢, because that is the tidy way to
     make 75¢. The chips a player pushes are already known exactly (the
     drop between their tray before a sync and after it), so the pot
     accumulates those instead and the middle shows the very chips that
     were slid into it.

     Two things keep it honest:

     - Only DECREASES count. A tray that gained chips gained them from
       the cage (a buy-in, a rebuy) or from the pot (an award), and
       neither is money being pushed in.
     - The composition is checked against the total every sync. If they
       ever disagree — a rung gone negative because someone overpaid and
       took change out of a pot that didn't hold it, or a re-deal having
       thrown a tray's history away — the pot falls back to the canonical
       racking of its total. Wrong-looking beats lying: the amount under
       the pile is the number of record either way.

     Nothing here resets the pot explicitly. The next hand zeroes every
     `betHand`, so the total becomes 0, the check fails against the
     leftover chips, and the fallback deals an empty pot. */
  function potTotal(g) {
    var s = 0;
    for (var i = 0; i < g.players.length; i++) {
      var p = g.players[i];
      if (p) s += p.betHand || 0;
    }
    return s;
  }
  /* What is actually IN the middle: everything committed this hand, less
     whatever is still sitting on the betting line in front of a seat.
     Live bets are drawn as their own piles now, so the pot pile must not
     also claim them — the same chips would be on the felt twice. The two
     agree the instant a street closes, because the sweep empties every
     bet pile into the pot. */
  function potFloor(g) {
    var s = 0;
    for (var i = 0; i < g.players.length; i++) {
      var p = g.players[i];
      if (p) s += (p.betHand || 0) - (p.betStreet || 0);
    }
    return s;
  }
  /* A street closes: every pile in front of a seat is pushed into the
     middle. The pot takes the CHIPS that were bet — which is the whole
     reason for holding them per seat rather than racking the new total. */
  function sweepBets(g) {
    if (!g.potTray) g.potTray = { chips: {}, odd: 0 };
    var pot = g.potTray;
    for (var i = 0; i < g.players.length; i++) {
      var p = g.players[i];
      if (!p || !p.betTray) continue;
      for (var v in p.betTray.chips) {
        if (Object.prototype.hasOwnProperty.call(p.betTray.chips, v)) {
          pot.chips[v] = (pot.chips[v] || 0) + p.betTray.chips[v];
        }
      }
      pot.odd += p.betTray.odd;
      p.betTray = { chips: {}, odd: 0 };
    }
  }
  function copyChips(t) {
    var c = {}, v;
    for (v in t) if (Object.prototype.hasOwnProperty.call(t, v)) c[v] = t[v];
    return c;
  }
  function syncTrays(g) {
    if (!g.potTray) g.potTray = { chips: {}, odd: 0 };
    var pot = g.potTray, v, i, p;
    /* The drop — the chips that just left a tray — now lands on that
       seat's own pile rather than in the middle. It is the same
       subtraction as before, held one step longer: the pot gets it at
       the sweep, which is exactly when the felt animates it moving. */
    for (i = 0; i < g.players.length; i++) {
      p = g.players[i];
      if (p && !p.left && !p.betTray) p.betTray = { chips: {}, odd: 0 };
      var was = p && !p.left && p.tray ? { chips: copyChips(p.tray.chips), odd: p.tray.odd } : null;
      syncTray(p, g.settings.chips);
      if (!was || !p.tray) continue;
      if (traySum(p.tray.chips) + p.tray.odd >= traySum(was.chips) + was.odd) continue;
      var bt = p.betTray;
      for (v in was.chips) if (Object.prototype.hasOwnProperty.call(was.chips, v)) {
        bt.chips[v] = (bt.chips[v] || 0) + was.chips[v] - (p.tray.chips[v] || 0);
      }
      for (v in p.tray.chips) if (Object.prototype.hasOwnProperty.call(p.tray.chips, v)) {
        if (!Object.prototype.hasOwnProperty.call(was.chips, v)) {
          bt.chips[v] = (bt.chips[v] || 0) - p.tray.chips[v];
        }
      }
      bt.odd += was.odd - p.tray.odd;
    }
    /* Every pile is held to the number of record, the pot's own rule
       applied per seat. The case that genuinely trips it is an ANTE:
       it moves cents into betHand and never into betStreet, so a seat
       that owes one drops more than its bet and the composition
       disagrees. Racking from `betStreet` is then both truthful about
       the amount and right about what the line holds. */
    for (i = 0; i < g.players.length; i++) {
      p = g.players[i];
      if (!p || !p.betTray) continue;
      var okBet = p.betTray.odd >= 0;
      for (v in p.betTray.chips) if (Object.prototype.hasOwnProperty.call(p.betTray.chips, v)) {
        if (p.betTray.chips[v] < 0) okBet = false;
        if (!p.betTray.chips[v]) delete p.betTray.chips[v];
      }
      if (!okBet || traySum(p.betTray.chips) + p.betTray.odd !== (p.betStreet || 0)) {
        p.betTray = dealTray(p.betStreet || 0, g.settings.chips);
      }
    }
    var sane = pot.odd >= 0;
    for (v in pot.chips) if (Object.prototype.hasOwnProperty.call(pot.chips, v)) {
      if (pot.chips[v] < 0) sane = false;
      if (!pot.chips[v]) delete pot.chips[v];              // a spent rung leaves no group
    }
    if (!sane || traySum(pot.chips) + pot.odd !== potFloor(g)) {
      g.potTray = dealTray(potFloor(g), g.settings.chips);
    }
  }

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
      p.betTray = { chips: {}, odd: 0 };   // the line is clear before the deal
    });
    g.handOver = null; g.board = []; g.turn = null; g.street = null;
    g.showTo = {};                    // private shows die with their hand
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
    /* Who tables first at showdown: the last player to bet or raise on the
       final street. Preflop that is the BIG BLIND until someone raises —
       the forced bet is still a bet — which is what makes a limped pot
       show from the blind rather than from the button. Reset on every new
       street; null means nobody bet, and the walk starts left of the
       button instead (docs/poker.md, "Showdown order"). */
    g.aggr = bb;
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
    sweepBets(g);                     // the piles go in before the line clears
    g.players.forEach(function (p) { if (p) p.betStreet = 0; });
    g.aggr = null;                    // a new street has no aggressor yet
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
    /* A hand cannot be settled with money still on the betting line: the
       fold-through path reaches here without a street ever closing, and
       the `win` flight has to fly chips that are already in the middle. */
    sweepBets(g);
    g.players.forEach(function (p) { if (p) p.betStreet = 0; });
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
    if (showdown) {
      ps.forEach(function (p, i) {
        if (!inHand(p)) return;
        scores[i] = bestOf(p.hole.concat(g.board));
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
      hands: contenders(g, showdown, scores, awards),
      board: g.board.slice(),
      pots: pots.map(function (pot) { return { amount: pot.amount, elig: pot.elig }; }),
      awards: awards
    };
    g.stats.hands++;
  }

  /* ── who tables and who mucks (docs/poker.md, "Showdown order") ──
     The rule a real room runs: the last aggressor on the final street
     shows first (nobody bet → the first live seat left of the button),
     and from there around the table each seat shows ONLY if it can beat
     everything already face-up. A beaten hand is mucked — never exposed,
     never even sent — and its owner can still choose to show with the
     `reveal` verb while the interstitial is up.

     Two seats that the walk would muck get tabled anyway: anyone who
     WINS a pot. A short stack can take the main pot with the best hand
     while losing the side pot, and a side-pot winner can be beaten by an
     all-in they were never contesting; either way the money has to be
     seen to be believed.

     `hole: null` is the hidden-information contract, not a display flag:
     handOver is broadcast whole, so a mucked hand's cards must not be in
     the object at all. */
  function contenders(g, showdown, scores, awards) {
    var ps = g.players;
    var live = [];
    ps.forEach(function (p, i) { if (inHand(p)) live.push(i); });
    // a fold-through exposes nothing — but the last player standing may
    // still want the table to see what they got there with
    if (!showdown) {
      return live.map(function (i) {
        return { seat: i, hole: null, name: null, shown: false };
      });
    }
    var n = ps.length;
    var from = g.aggr != null && scores[g.aggr] ? g.aggr : (g.dealer + 1) % n;
    var order = live.slice().sort(function (a, b) {
      return ((a - from + n) % n) - ((b - from + n) % n);
    });
    var shown = {};
    var best = null;
    order.forEach(function (i) {
      var sc = scores[i].score;
      // ties table too: a chopped pot needs both halves face-up
      if (best === null || cmpScore(sc, best) >= 0) { shown[i] = true; }
      if (best === null || cmpScore(sc, best) > 0) best = sc;
    });
    awards.forEach(function (a) { shown[a.seat] = true; });
    return order.map(function (i) {
      return { seat: i,
               hole: shown[i] ? ps[i].hole.slice() : null,
               name: shown[i] ? scores[i].name : null,
               shown: !!shown[i] };
    });
  }

  /* ── showing a live hand to a player who is out of it ──────────
     `g.showTo[seat]` is the list of seats that seat has shown its hole
     cards to during the CURRENT hand. It lives on the game rather than
     on a message because a reconnect has to land on the same table
     everyone else is looking at: a private show delivered once and
     forgotten would vanish on a refresh.

     Two rules, both his (chat 2026-08-04): anyone still HOLDING cards
     may show, and only a player OUT of the hand may be shown to. That
     second one is the whole safety argument — a folded or sat-out seat
     cannot act on what it sees, so this can't move the betting. The
     engine keeps the seat list; the table is what turns it into cards on
     the wire, and only for those seats (docs/poker.md, "Hidden
     information"). */
  function canShow(g, i) {
    var p = g.players[i];
    return !!(g.street && p && inHand(p) && p.hole && p.hole.length === 2);
  }
  function showTargets(g, i) {
    // out of the hand, still AT the table, and not yourself
    var out = [];
    if (!canShow(g, i)) return out;
    g.players.forEach(function (p, j) {
      if (!p || j === i || p.left) return;
      if (inHand(p) && !p.away) return;          // still live — can't be shown
      out.push(j);
    });
    return out;
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
      p.betTray = { chips: {}, odd: 0 };   // a cancelled hand leaves no pile
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
      // `score` is the shared-shell name for "the number this rank sorts on"
      // — the stats pipeline reads it off every game (docs/stats.md) and a
      // null there is a refused result. For a cash game that number is net.
      out.push({ seat: r.seat, rank: rank, score: r.net,
                 net: r.net, bought: r.bought, stack: r.stack });
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
      showTo: {},                       // seat -> seats it showed this hand
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
    syncTrays(g);       // everyone's buy-in, dealt as chips
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
      tray: null,                       // {chips:{value:count}, odd} — syncTrays fills it
      betTray: null,                    // the same shape, for what is ON the betting line
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

    /* the private show: your live hand, to seats that are out of the hand.
       Additive — showing Mira and then Ozan leaves both holding it — and
       it clears with the hand (tryStartHand). The cards do NOT travel
       here; only the seat list does. */
    if (type === "showTo") {
      if (!canShow(g, seat)) return err("phase");
      var allowed = showTargets(g, seat);
      var want = (action.seats || []).map(Number).filter(function (j) {
        return allowed.indexOf(j) >= 0;
      });
      if (!want.length) return err("perm");
      if (!g.showTo) g.showTo = {};
      var have = g.showTo[seat] || [];
      var added = [];
      want.forEach(function (j) {
        if (have.indexOf(j) >= 0) return;
        have.push(j); added.push(j);
      });
      g.showTo[seat] = have;
      // the FACT is public, the cards are not — the table sees that a hand
      // was shown and to whom, exactly as it would across a real felt
      if (added.length) events.push({ t: "showTo", seat: seat, to: added });
      return done();
    }

    /* the opt-in show: a mucked hand tables itself while the settlement
       card is up. Only your OWN hand, only a hand that reached the end of
       this one, and only once — a second call is a no-op rather than an
       error, because the auto-show tick and a click can race. */
    if (type === "reveal") {
      if (!g.handOver) return err("phase");
      var mine = null;
      g.handOver.hands.forEach(function (h) { if (h.seat === seat) mine = h; });
      if (!mine) return err("perm");
      var rp = g.players[seat];
      if (!rp || !rp.hole || rp.hole.length < 2) return err("phase");
      if (mine.shown) return done();
      mine.hole = rp.hole.slice();
      mine.shown = true;
      // a fold-through has no five-card board to read, so it shows the
      // cards and names nothing
      if (g.handOver.reason === "showdown") {
        mine.name = bestOf(rp.hole.concat(g.handOver.board)).name;
      }
      events.push({ t: "show", seat: seat, hole: mine.hole.slice(), name: mine.name });
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
        g.aggr = i;                   // they show first if it gets to showdown
        events.push({ t: "raise", seat: i, to: to, allIn: p.allIn });
      }
      afterAction(g, ctx, events);
      return done();
    }

    /* ONE sync point for the trays: every stack change in the engine —
       blinds, antes, calls, raises, refunds, awards, re-buys, the
       mid-hand cancel — funnels through here, so the tray can never
       drift from the stack it draws. */
    function done() { syncTrays(g); return { game: g, events: events }; }
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

  /* ── bots (docs/bots.md, docs/poker.md "Bots") ────────────────
     Three tiers over ONE brain, the same shape cities and mahjong use:
     a single strength heuristic, and a table of parameters deciding how
     clearly a tier gets to see it and what it does about it. There is
     no second brain, and there is no separate "dev" bot any more — a
     host-added bot plays the same game at the mock and on the live
     table.

     HIDDEN INFORMATION — the one rule poker does NOT share with the
     other two. Their bots read the whole `game` (every mahjong hand,
     every dev card), and that is safe there because what botAct RETURNS
     is public the instant it applies. A poker fold is not: it is a
     decision DERIVED from whatever the bot looked at, so a bot that
     peeked would leak the peek through its own betting. Therefore

       botStrength and everything under it read ONLY g.players[me].hole,
       g.board, and the public betting state — never another seat's
       `hole`, never `g.deck`.

     Nothing structural enforces that; `botIsBlind` in the self-checks
     does, by scrambling every other hand and the undealt deck and
     asserting the same seed still produces the same action. */

  /* The tiers ARE the difficulty knobs.
       tight    preflop strength it needs to put money in at all
       jitter   noise added to the strength read; high = sloppy, which
                is how a weak tier is built (worse choices, not fewer)
       aggro    chance of raising once a hand clears the bar
       bluff    chance of betting one that didn't
       betAt    strength it bets at when nothing is owed
       raiseAt  strength it raises at when facing a bet (a higher bar)
       commit   strength it shoves the stack in at, POSTFLOP only —
                preflop the ordinary raise path handles it, because
                shoving aces into the blinds wins nothing
       odds     compares the price against the pot instead of against a
                flat number of blinds. This is the discipline axis
       slack    multiplier on the equity the price demands, so it reads
                the way cities' `loss` does: >1 wants a margin before it
                puts money in, <1 calls wider than the price justifies
       callBB   odds:false only — calls anything up to this many blinds
       loose    odds:false only — strength it calls a BIG bet at anyway
       size     bet as a fraction of the pot
       pick     choose among this many sizings, so two bots at the same
                tier don't bet the identical number every hand

     Difficulty runs along a FEW axes — the read (`jitter`), and the
     discipline (`odds`/`slack`/`tight`) — with the tiers kept CLOSE on
     aggression and sizing. That restraint is load-bearing: the first
     ladder gave hard its own value for all ten knobs and came out
     non-transitive (hard crushed easy and lost to normal). Independent
     knobs make a tier different, not better. */
  var BOT_TIERS = {
    easy:   { tight: 0.12, jitter: 0.45, aggro: 0.30, bluff: 0.12,
              betAt: 0.34, raiseAt: 0.58, commit: 0.95,
              odds: false, slack: 1.00, callBB: 6, loose: 0.30,
              size: 0.55, pick: 5 },
    normal: { tight: 0.26, jitter: 0.14, aggro: 0.55, bluff: 0.07,
              betAt: 0.36, raiseAt: 0.55, commit: 0.90,
              odds: true,  slack: 1.00, callBB: 0, loose: 0,
              size: 0.60, pick: 2 },
    hard:   { tight: 0.34, jitter: 0.02, aggro: 0.65, bluff: 0.10,
              betAt: 0.36, raiseAt: 0.54, commit: 0.86,
              odds: true,  slack: 1.12, callBB: 0, loose: 0,
              size: 0.62, pick: 1 }
  };
  var BOT_TIER_LIST = ["easy", "normal", "hard"];
  function botTier(name) { return BOT_TIERS[name] || BOT_TIERS.normal; }
  // cities' idiom, spelled again here rather than shared: an engine is a
  // self-contained contract file, vendored on its own (docs/bots.md).
  function botChoose(list, pick, rand) {
    if (!list.length) return null;
    var n = pick === Infinity ? list.length : Math.min(pick, list.length);
    return list[Math.floor(rand() * n)];
  }

  /* Preflop: Chen's formula, the standard pencil-and-paper ranking —
     high card, doubled for a pair, plus suited, minus the gap. It runs
     about −1 (72o) to 20 (AA), which normalizes onto 0..1. */
  var CHEN_HI = { 14: 10, 13: 8, 12: 7, 11: 6 };
  function chenScore(hole) {
    var a = rankOf(hole[0]), b = rankOf(hole[1]);
    var hi = Math.max(a, b), lo = Math.min(a, b);
    var v = CHEN_HI[hi] || hi / 2;
    if (a === b) v = Math.max(v * 2, 5);                   // a pair is worth double, floor 5
    if (suitOf(hole[0]) === suitOf(hole[1])) v += 2;
    if (a !== b) {
      var gap = hi - lo - 1;
      v -= gap >= 4 ? 5 : gap === 3 ? 4 : gap;             // 0/1/2 gaps cost their own size
      if (gap <= 1 && hi < 12) v += 1;                     // connected and low: straights play
    }
    return Math.ceil(v);
  }

  /* Postflop: the category you hold, refined by what it actually beats.
     `bestOf` does the reading — the same function the hand panel uses,
     so the bot cannot disagree with the client about what it holds. */
  var CAT_BASE = [0.05, 0.24, 0.52, 0.70, 0.78, 0.85, 0.93, 0.98, 1.00];
  function botMadeStrength(hole, board) {
    var made = bestOf(hole.concat(board));
    var cat = made.score[0], s = CAT_BASE[cat];
    if (cat === 0) {
      s += (made.score[1] - 2) / 12 * 0.10;                // all that separates two of these is the top card
    } else if (cat === 1) {
      // a pair is only as good as what it beats: an overpair and bottom
      // pair carry the same name and are not the same hand
      var pr = made.score[1], beat = 0;
      board.forEach(function (c) { if (pr > rankOf(c)) beat++; });
      s += 0.14 * (beat / Math.max(1, board.length));
    }
    // playing the board: everyone still in holds this exact hand, so it
    // cannot win the pot outright, only chop it
    if (board.length === 5 && cmpScore(made.score, bestOf(board).score) === 0) {
      s = Math.min(s, 0.10);
    }
    return s;
  }
  // how many distinct straights are one card away
  function botStraightWays(cards) {
    var have = {}, ways = 0;
    cards.forEach(function (c) {
      var r = rankOf(c);
      have[r] = 1;
      if (r === 14) have[1] = 1;                           // the wheel counts the ace low
    });
    for (var lo = 1; lo <= 10; lo++) {
      var n = 0;
      for (var k = 0; k < 5; k++) if (have[lo + k]) n++;
      if (n === 4) ways++;
    }
    return ways;
  }
  function botSuitMax(cards) {
    var c = {}, m = 0;
    cards.forEach(function (x) { var s = suitOf(x); c[s] = (c[s] || 0) + 1; m = Math.max(m, c[s]); });
    return m;
  }
  /* A hand that isn't made yet but is going somewhere. Only counts the
     draws the HOLE cards make — four to a flush on the board is not
     your draw, it is everyone's. */
  function botDrawBonus(hole, board) {
    var all = hole.concat(board), b = 0;
    if (botSuitMax(all) === 4 && botSuitMax(board) < 4) b += 0.15;
    var ways = botStraightWays(all);
    if (ways > botStraightWays(board)) b += ways >= 2 ? 0.12 : 0.05;   // open-ended, else a gutshot
    return b;
  }

  function botStrength(g, me) {
    var p = g.players[me];
    if (!p || !p.hole || p.hole.length < 2) return 0;
    var board = g.board || [];
    if (board.length < 3) return Math.max(0, Math.min(1, (chenScore(p.hole) + 1) / 21));
    var s = botMadeStrength(p.hole, board);
    // a draw is worth chips and is not worth a made hand's chips
    if (board.length < 5) s = Math.min(0.72, s + botDrawBonus(p.hole, board));
    return Math.max(0, Math.min(1, s));
  }

  /* The smallest amount at or above `lo` that the chips can actually pay.

     `minTo` is NOT always representable, which is the trap here: a short
     all-in is legal at ANY amount (the one exception to the chip rule),
     so `bet.current` can land on cents no ladder makes, and the minimum
     raise built on it inherits that. Walking by one cent is what finds
     the way out — stepping by a chip from an unrepresentable base only
     ever reaches more unrepresentable amounts. */
  function botFit(want, chips, lo, hi) {
    var v = Math.max(want, lo);
    for (var k = 0; v + k <= hi && k < 512; k++) {
      if (representable(v + k, chips)) return v + k;
    }
    return 0;
  }
  /* A raise-to the chips can pay. The size is a fraction of the pot;
     candidates around it fit to the ladder, and the tier's `pick`
     chooses among the closest. */
  function botRaiseTo(g, i, T, rand) {
    var o = options(g, i);
    if (!o || !o.canRaise) return 0;
    var chips = g.settings.chips;
    var base = Math.round(potTotal(g) * T.size);
    var seen = {}, cands = [];
    [1, 0.7, 1.4, 0.5, 1.8].forEach(function (m) {
      var v = botFit(g.bet.current + Math.round(base * m), chips, o.minTo, o.maxTo);
      if (v && !seen[v]) { seen[v] = 1; cands.push(v); }
    });
    // nothing on the ladder fits between the minimum and the stack — but
    // a full all-in never needs one
    if (!cands.length) return o.maxTo;
    cands.sort(function (a, b) {
      return Math.abs(a - g.bet.current - base) - Math.abs(b - g.bet.current - base);
    });
    return botChoose(cands, T.pick, rand) || 0;
  }

  /* A busted bot buys back in. Deliberately NOT a tier knob: a cash game
     without re-buys empties itself one seat at a time and leaves the
     human alone at a `waiting` felt, which is docs/bots.md finding #1 in
     poker's clothing — a weak tier must play worse, not less. */
  function botRebuySeat(g, isBot) {
    for (var i = 0; i < g.players.length; i++) {
      var p = g.players[i];
      if (p && alive(p) && p.out && isBot(i)) return i;
    }
    return null;
  }

  function botPending(g, isBot) {
    if (!g || g.phase !== "play") return false;
    if (botRebuySeat(g, isBot) != null) return true;
    if (g.handOver || !g.turn) return false;              // settled hands are the timer's
    return isBot(g.turn.seat);
  }

  function botAct(g, isBot, opts, ctx) {
    if (!botPending(g, isBot)) return null;
    opts = opts || {};
    ctx = ctx || { rand: Math.random, now: 0 };
    var rand = ctx.rand;
    var tierOf = typeof opts.tier === "function"
      ? function (s) { return botTier(opts.tier(s)); }
      : function () { return botTier(opts.tier); };

    var rb = botRebuySeat(g, isBot);
    if (rb != null) return { type: "buyIn", seat: rb };

    if (g.handOver || !g.turn || !isBot(g.turn.seat)) return null;
    var i = g.turn.seat, T = tierOf(i), o = options(g, i);
    var call = o.toCall, pot = potTotal(g);
    var preflop = (g.board || []).length === 0;
    // the jitter is CENTERED, so noise blurs the read without inflating it
    var s = botStrength(g, i) + (rand() - 0.5) * T.jitter;

    if (call === 0) {
      // nothing owed: bet the good ones, and occasionally the bad ones
      if (s >= T.betAt ? rand() < T.aggro : rand() < T.bluff) {
        var to = botRaiseTo(g, i, T, rand);
        if (to > g.bet.current) return { type: "raise", seat: i, to: to };
      }
      return { type: "check", seat: i };
    }

    // facing a bet
    if (preflop && s < T.tight) return { type: "fold", seat: i };
    if (!preflop && s >= T.commit && o.canRaise) return { type: "raise", seat: i, to: o.maxTo };
    if (s >= T.raiseAt && o.canRaise && rand() < T.aggro) {
      var up = botRaiseTo(g, i, T, rand);
      if (up > g.bet.current) return { type: "raise", seat: i, to: up };
    }
    if (T.odds) {
      // the equity the price demands. `slack` is the whole difference
      // between a tier that calls too wide and one that wants a profit
      if (s < (call / (pot + call)) * T.slack) return { type: "fold", seat: i };
    } else if (call > T.callBB * g.settings.bigBlind && s < T.loose) {
      return { type: "fold", seat: i };
    }
    return { type: "call", seat: i };
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

    (function cascade() {
      /* the buy-in presets, each walked all the way down the chain:
         buy-in → blind (100 BB, snapped) → ladder (SB + N-1 rungs). */
      var presets = [[500, 10], [1000, 10], [2000, 20], [5000, 50], [10000, 100]];
      presets.forEach(function (pr) {
        var bb = suggestBlind(pr[0]);
        eq(bb, pr[1], "$" + (pr[0] / 100) + " buy-in → " + pr[1] + "¢ big blind");
        var lad = suggestChips(bb, 5);
        eq(lad.length, 5, "five rungs");
        eq(lad[0], bb / 2, "the smallest chip IS the small blind");
        ok(representable(bb, lad) && representable(bb / 2, lad), "both blind halves split");
        ok(representable(pr[0], lad), "the buy-in splits");
        // the top chip lands on a tenth of the buy-in — nobody wrote that
        // rule, it falls out of the cascade (the $5 short-buy is the one
        // exception: it is a 50 BB table, so the ladder outruns it)
        if (pr[0] >= 1000) eq(lad[4], pr[0] / 10, "top chip = buy-in ÷ 10");
      });
      eq(suggestChips(20, 4), [10, 25, 50, 100], "the 4-chip ladder drops the top rung");
      eq(suggestBlind(3700), 50, "a custom buy-in snaps to round money");
    })();

    (function trays() {
      /* a tray must land on the amount EXACTLY, on any ladder, and must
         look like a staircase rather than one tall column. */
      [[1000, CHIPS], [2000, CHIPS], [2000, suggestChips(20, 5)],
       [10000, suggestChips(100, 5)], [500, suggestChips(10, 4)],
       [1000, [10, 25]], [2000, [5, 100]]].forEach(function (c) {
        var t = dealTray(c[0], c[1]);
        eq(traySum(t.chips) + t.odd, c[0], "tray sums to " + c[0] + " on [" + c[1] + "]");
        eq(t.odd, 0, "a representable amount leaves no loose cents");
        var used = Object.keys(t.chips).length;
        ok(used >= Math.min(3, c[1].length), "the tray spreads across the ladder (" + used + " rungs)");
      });
      // odd cents are real (an odd pot split three ways) and no ladder
      // draws them — the tray carries them as a number, not a chip
      var oddT = dealTray(1008, [10, 20, 50, 100]);
      eq(traySum(oddT.chips) + oddT.odd, 1008, "loose cents ride along");
      eq(oddT.odd, 8, "8¢ can't be a chip on a 10¢ ladder");
      // paying off a tray makes change when it has to
      var pay = trayPay({ 100: 3 }, 45, CHIPS);
      ok(pay && traySum(pay) === 255, "a $1 chip broke down to pay 45¢");
      eq(trayPay({ 25: 1 }, 10, [10, 25]), null, "an unbreakable rung refuses");
    })();

    (function trayFollowsStack() {
      /* the invariant the whole feature rests on: after ANY action, every
         tray still sums to the stack it draws. */
      var g = mkGame(4, 11);
      var chips = g.settings.chips;
      g.players.forEach(function (p, i) {
        eq(traySum(p.tray.chips) + p.tray.odd, p.stack, "seat " + i + " dealt a tray at start");
      });
      var acted = 0;
      for (var n = 0; n < 40 && g.phase !== "over"; n++) {
        if (!g.turn) { if (!g.handOver) break; g = step(g, { type: "nextHand", seat: g.handOver.seats ? 0 : 0 }, 3); continue; }
        var i2 = g.turn.seat;
        var o = options(g, i2);
        if (!o) break;
        var r = applyAction(g, { type: o.toCall > 0 ? "call" : "check", seat: i2 }, mkCtx(n + 5));
        if (r.error) break;
        g = r.game; acted++;
        var bad = 0;
        g.players.forEach(function (p) {
          if (traySum(p.tray.chips) + p.tray.odd !== p.stack) bad++;
        });
        eq(bad, 0, "trays match stacks after action " + acted);
      }
      ok(acted > 3, "the loop actually played (" + acted + " actions)");
      ok(chips.length > 1, "settings kept the ladder");
    })();

    (function potHoldsWhatWasPushed() {
      /* The pot's chips are the chips people pushed in, not a tidy
         racking of the total. Two things to hold: the pile always adds
         up to the pot (a composition that doesn't is a lie, and the
         fallback exists to catch exactly that), and it is genuinely
         ACCUMULATED — a pot of three quarters must not come back as the
         50¢-and-a-25¢ that `dealTray` would rack 75¢ into. */
      /* Every cent committed this hand is drawn exactly once: either on a
         seat's own betting line or in the middle, never both and never
         neither. This is the guarantee that lets the felt draw two kinds
         of pile without double-counting a single chip. */
      function feltTotal(gg) {
        var s = traySum(gg.potTray.chips) + gg.potTray.odd;
        gg.players.forEach(function (p) {
          if (p && p.betTray) s += traySum(p.betTray.chips) + p.betTray.odd;
        });
        return s;
      }
      function linesHold(gg, when) {
        gg.players.forEach(function (p, i) {
          if (!p || !p.betTray) return;
          eq(traySum(p.betTray.chips) + p.betTray.odd, p.betStreet || 0,
             "seat " + i + "'s pile is exactly its bet " + when);
        });
      }
      var g = mkGame(4, 21);
      // mkGame has already dealt a hand, so the blinds are posted — and a
      // blind sits on the BETTING LINE, not in the middle, until a street
      // closes. The pot pile is empty and the two blinds are in front of
      // their seats, which is where a real table would have them.
      eq(potTotal(g), g.settings.bigBlind * 1.5, "the blinds are the opening pot");
      eq(potFloor(g), 0, "but nothing has reached the middle yet");
      eq(traySum(g.potTray.chips) + g.potTray.odd, 0, "so the pot pile is empty");
      eq(feltTotal(g), potTotal(g), "and the blinds are on the felt exactly once");
      linesHold(g, "at the deal");
      var acted = 0;
      for (var n = 0; n < 40 && g.phase !== "over"; n++) {
        if (!g.turn) break;
        var i = g.turn.seat;
        var o = options(g, i);
        if (!o) break;
        var r = applyAction(g, { type: o.toCall > 0 ? "call" : "check", seat: i }, mkCtx(n + 9));
        if (r.error) break;
        g = r.game; acted++;
        eq(traySum(g.potTray.chips) + g.potTray.odd, potFloor(g),
           "the pot's chips add up to the middle after action " + acted);
        eq(feltTotal(g), potTotal(g),
           "every cent is drawn exactly once after action " + acted);
        linesHold(g, "after action " + acted);
      }
      ok(acted > 3, "the pot loop actually played (" + acted + " actions)");

      /* the accumulation itself, in isolation: three seats each push one
         25¢ chip. The chips must land on their own lines first, and the
         SWEEP must move those same three quarters into the middle —
         dealTray would have racked the same 75¢ as 50¢ + 25¢. */
      var q = mkGame(3, 31);
      q.settings.chips = [25, 50, 100];
      q.potTray = { chips: {}, odd: 0 };
      q.players.forEach(function (p) {
        p.tray = { chips: { 25: 4 }, odd: 0 }; p.stack = 100;
        p.betHand = 0; p.betStreet = 0; p.betTray = { chips: {}, odd: 0 };
      });
      q.players.forEach(function (p) { p.stack -= 25; p.betHand += 25; p.betStreet += 25; });
      syncTrays(q);
      q.players.forEach(function (p, i) {
        eq(p.betTray.chips[25], 1, "seat " + i + " has one quarter on its line");
      });
      eq(traySum(q.potTray.chips) + q.potTray.odd, 0, "nothing is in the middle before the sweep");
      sweepBets(q);
      eq(q.potTray.chips[25], 3, "three quarters swept in are three quarters in the pot");
      eq(q.potTray.chips[50], undefined, "the pot did not re-rack them into a 50¢");
      eq(traySum(q.potTray.chips), 75, "and they still add up to 75¢");
      q.players.forEach(function (p, i) {
        eq(traySum(p.betTray.chips) + p.betTray.odd, 0, "seat " + i + "'s line is clear after the sweep");
      });

      /* an ANTE is the one thing that moves cents without touching the
         betting line, so the seat drops more than its bet. The pile must
         rack from betStreet rather than claim chips the line doesn't hold,
         and the ante has to turn up in the middle instead. */
      var a = mkGame(2, 51);
      a.settings.chips = [25, 50, 100];
      a.potTray = { chips: {}, odd: 0 };
      a.players.forEach(function (p) {
        p.tray = { chips: { 25: 8 }, odd: 0 }; p.stack = 200;
        p.betHand = 0; p.betStreet = 0; p.betTray = { chips: {}, odd: 0 };
      });
      var ap = a.players[0];
      ap.stack -= 75; ap.betHand += 75; ap.betStreet += 25;   // a 25¢ blind + a 50¢ ante
      syncTrays(a);
      eq(traySum(ap.betTray.chips) + ap.betTray.odd, 25, "the ante is not on the betting line");
      eq(traySum(a.potTray.chips) + a.potTray.odd, potFloor(a), "and the ante is already in the middle");
      eq(feltTotal(a), potTotal(a), "the anteing seat still draws every cent once");

      // a composition that can't be true falls back to racking the total
      var f = mkGame(2, 41);
      f.potTray = { chips: { 25: -3 }, odd: 0 };
      syncTrays(f);
      ok(traySum(f.potTray.chips) + f.potTray.odd === potFloor(f), "a broken pot re-racks to its total");
      // and the same guard, one level down, on a seat's own pile
      var b = mkGame(2, 61);
      b.players[0].betTray = { chips: { 25: -2 }, odd: 0 };
      syncTrays(b);
      eq(traySum(b.players[0].betTray.chips) + b.players[0].betTray.odd, b.players[0].betStreet,
         "a broken bet pile re-racks to its bet");
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
      eq(g.handOver.hands.length, 3, "all three contenders listed");
      var ho = g.handOver;
      // the showdown walk: every winner is face-up, every mucked hand is
      // face-DOWN and its cards are not in the broadcast object at all
      ho.awards.forEach(function (a) {
        ok(ho.hands.some(function (h) { return h.seat === a.seat && h.shown; }),
           "a pot winner always tables");
      });
      ho.hands.forEach(function (h) {
        eq(h.shown, !!h.hole, "shown and hole agree");
        if (!h.shown) eq(h.name, null, "a mucked hand names nothing");
      });
      // ...and a mucked hand can still choose to show
      var muck = ho.hands.filter(function (h) { return !h.shown; })[0];
      if (muck) {
        var g2 = step(g, { type: "reveal", seat: muck.seat });
        var back = g2.handOver.hands.filter(function (h) { return h.seat === muck.seat; })[0];
        ok(back.shown && back.hole.length === 2, "the opt-in show tables the hand");
        ok(!!back.name, "a showdown reveal names the hand");
      }
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
      eq(g.handOver.hands.length, 1, "one seat left standing");
      eq(g.handOver.hands[0].hole, null, "no cards revealed on folds");
      // the bluff-show: the winner of a fold-through may still table it
      var gs = step(g, { type: "reveal", seat: g.handOver.hands[0].seat });
      eq(gs.handOver.hands[0].hole.length, 2, "the fold-through winner can show");
      eq(gs.handOver.hands[0].name, null, "a fold-through show names no hand");
      var total = g.players.reduce(function (s, p) { return s + p.stack; }, 0);
      eq(total, 6000, "cents conserved on fold-through");
    })();

    (function privateShows() {
      var g = mkGame(4, 21);
      var first = g.turn.seat;
      g = step(g, { type: "fold", seat: first });
      var live = g.turn.seat;
      // only the folded seat is a legal target; a live one is refused
      var targets = showTargets(g, live);
      ok(targets.indexOf(first) >= 0, "a folded seat can be shown to");
      ok(targets.indexOf(live) < 0, "you are not your own target");
      g.players.forEach(function (p, i) {
        if (inHand(p) && i !== live) ok(targets.indexOf(i) < 0, "a live seat can't be shown to");
      });
      var bad = applyAction(g, { type: "showTo", seat: live, seats: [g.turn.seat] }, mkCtx(1));
      ok(!!bad.error, "showing a live seat is refused");
      var g2 = step(g, { type: "showTo", seat: live, seats: [first] });
      eq((g2.showTo[live] || []).join(","), String(first), "the show is recorded on the game");
      // additive, and idempotent on a repeat
      var g3 = step(g2, { type: "showTo", seat: live, seats: [first] });
      eq((g3.showTo[live] || []).length, 1, "showing twice doesn't duplicate");
      // a folded seat holds no live hand, so it can't show
      var no = applyAction(g, { type: "showTo", seat: first, seats: [live] }, mkCtx(1));
      ok(!!no.error, "a folded seat can't show");
      // and the record dies with the hand
      var g4 = g2;
      var guard = 0;
      while (!g4.handOver && g4.turn && guard++ < 100) {
        var i2 = g4.turn.seat, o2 = options(g4, i2);
        g4 = step(g4, { type: o2.canCheck ? "check" : "call", seat: i2 });
      }
      g4 = applyAction(g4, { type: "timerExpire" }, mkCtx(1)).game;
      eq(Object.keys(g4.showTo || {}).length, 0, "a new hand clears the private shows");
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

    /* Drive an all-bot table. `tiers` is a seat→name list (rotated by the
       caller so turn-order advantage is never scored as tier strength).
       Returns the finished game plus what went wrong on the way. */
    var everyoneBot = function () { return true; };
    function botTable(seats, seed, tiers, hands) {
      var g = mkGame(seats, seed);
      var c = mkCtx(seed + 7);
      var tierFn = function (s) { return tiers[s % tiers.length]; };
      var guard = 0, bad = 0, disagree = 0, peeked = 0;
      while (g.phase === "play" && g.stats.hands < hands && guard++ < hands * 400) {
        var pend = botPending(g, everyoneBot);
        var a = botAct(g, everyoneBot, { tier: tierFn }, mkCtx(guard));
        if (!!a !== pend) disagree++;
        if (a) {
          // the blindness guard: the same seed against a game whose OTHER
          // hands and undealt deck have been replaced must produce the
          // identical action, or the bot is reading something it may not
          if (botScrambled(g, a.seat, tierFn, guard)) peeked++;
          var r = applyAction(g, a, c);
          if (r.error) { bad++; break; }
          g = r.game;
          continue;
        }
        if (g.handOver) { g = applyAction(g, { type: "timerExpire" }, c).game; continue; }
        break;
      }
      return { g: g, bad: bad, disagree: disagree, peeked: peeked, hands: g.stats.hands };
    }
    /* Re-ask on a clone with every hand but `me`'s replaced and the deck
       emptied. Same seed in, same action out — or the bot peeked. */
    function botScrambled(g, me, tierFn, seed) {
      var probe = JSON.parse(JSON.stringify(g));
      probe.players.forEach(function (p, i) {
        if (p && i !== me && p.hole) p.hole = ["2c", "3d"];
      });
      probe.deck = [];
      var a = botAct(g, everyoneBot, { tier: tierFn }, mkCtx(seed));
      var b = botAct(probe, everyoneBot, { tier: tierFn }, mkCtx(seed));
      return JSON.stringify(a) !== JSON.stringify(b);
    }

    (function botStrengthReads() {
      function pf(hole) { return botStrength({ players: [{ hole: hole }], board: [] }, 0); }
      ok(pf(["As", "Ah"]) > 0.95, "AA reads as the best preflop hand");
      ok(pf(["Ks", "Kh"]) > pf(["As", "Ks"]), "KK beats AKs");
      ok(pf(["As", "Ks"]) > pf(["Ad", "Kc"]), "suited beats offsuit");
      ok(pf(["7c", "2d"]) < 0.06, "72o is the bottom of the range");
      ok(pf(["8s", "9s"]) > pf(["8s", "3s"]), "connected beats gapped");
      function post(hole, board) { return botStrength({ players: [{ hole: hole }], board: board }, 0); }
      var quads = post(["As", "Ah"], ["Ad", "Ac", "7h", "2s", "3d"]);
      ok(quads > 0.95, "quads read near the top");
      ok(post(["As", "Ah"], ["Ad", "7h", "2s"]) > post(["7s", "7h"], ["Ad", "Kh", "2s"]),
         "trips beat an underpair");
      // an overpair and bottom pair carry the same category and are not
      // the same hand — this is the refinement the tiers bet on
      ok(post(["As", "Ac"], ["Kd", "7h", "2s"]) > post(["2h", "3c"], ["Kd", "7h", "2s"]),
         "an overpair beats bottom pair");
      // four to a flush on the BOARD is everyone's, so it is nobody's draw
      var mine = post(["Ts", "4s"], ["2s", "9s", "Kd"]);
      var theirs = post(["Th", "4d"], ["2s", "9s", "Ks"]);
      ok(mine > theirs, "a flush draw counts only when the hole cards make it");
      ok(post(["3c", "4d"], ["As", "Ks", "Qs", "Js", "Ts"]) <= 0.10,
         "playing the board can't win the pot outright");
    })();

    (function botRaisesTheLadderCanPay() {
      /* A short all-in is legal at ANY amount — the one exception to the
         chip rule — so `bet.current`, and the minimum raise built on it,
         can land on cents no ladder makes. A bot that emitted that
         minimum was refused with `chips`. The tuning sim hit this around
         hand 400; a 12-hand soak never reached it, which is why the soak
         below is 150 and why this case is pinned here directly. */
      var bad = 0, raises = 0, seen = 0;
      for (var d = 0; d < 60; d++) {
        var g = mkGame(4, 200 + d * 13);                  // vary the DEAL, not just the noise
        var i = g.turn.seat;
        g.players[i].stack = 583;                        // off the 10/20/25/50/100 ladder
        var r = applyAction(g, { type: "raise", seat: i, to: g.players[i].betStreet + 583 }, mkCtx(9));
        if (r.error) continue;
        var g2 = r.game, j = g2.turn && g2.turn.seat;
        var o = j == null ? null : options(g2, j);
        if (!o || representable(o.minTo, CHIPS)) continue;
        seen++;
        BOT_TIER_LIST.forEach(function (t) {
          var a = botAct(g2, everyoneBot, { tier: t }, mkCtx(d * 7 + 1));
          if (!a) return;
          if (a.type === "raise") raises++;
          if (applyAction(g2, a, mkCtx(d * 7 + 1)).error) bad++;
        });
      }
      ok(seen > 20, "the unrepresentable minimum is reachable (" + seen + " deals)");
      eq(bad, 0, "every tier acts legally against an unrepresentable minimum");
      ok(raises > 0, "...and some of those actions really were raises (" + raises + ")");
    })();

    (function botsPlayLegally() {
      // every tier, alone and mixed, over a stretch of real hands
      var tables = [["easy"], ["normal"], ["hard"], ["easy", "normal", "hard", "normal"]];
      var bad = 0, disagree = 0, peeked = 0, short = 0;
      tables.forEach(function (tiers, k) {
        var r = botTable(4, 101 + k * 37, tiers, 150);
        bad += r.bad; disagree += r.disagree; peeked += r.peeked;
        if (r.hands < 150) short++;
      });
      eq(bad, 0, "every tier plays only legal moves");
      eq(short, 0, "every tier plays its hands out");
      eq(disagree, 0, "botPending agrees with botAct at every step");
      // the one guard poker needs and the other two games don't
      eq(peeked, 0, "the bot never reads another seat's hand or the deck");
      eq(botAct({ phase: "over" }, everyoneBot, {}, null), null, "no bot act after over");
    })();

    (function botsRebuy() {
      // a busted bot buys back in — otherwise a cash table empties itself
      // and leaves the human at a `waiting` felt (docs/bots.md, finding 1)
      var g = mkGame(3, 71);
      g.players[2].stack = 0;
      g.players[2].out = true;
      ok(botPending(g, everyoneBot), "a busted bot owes a re-buy");
      var a = botAct(g, everyoneBot, { tier: "normal" }, mkCtx(3));
      eq(a && a.type, "buyIn", "...and takes it");
      eq(a && a.seat, 2, "...at the busted seat");
      var r = applyAction(g, a, mkCtx(3));
      ok(!r.error && !r.game.players[2].out, "the re-buy is legal and seats them again");
      ok(!botPending(r.game, function (i) { return i === 2; }), "and is not owed twice");
    })();

    (function botLedgerHolds() {
      var g = botTable(4, 101, ["easy", "normal", "hard", "normal"], 60).g;
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
    suggestBlind: suggestBlind,
    suggestChips: suggestChips,
    dealTray: dealTray,
    traySum: traySum,
    CANON_CHIPS: CANON,
    toCall: toCall,
    minRaiseTo: minRaiseTo,
    voteNeed: voteNeed,
    showTargets: showTargets,
    bestOf: bestOf,
    HAND_NAMES: HAND_NAMES,
    botAct: botAct,
    botPending: botPending,
    botStrength: botStrength,          // exported for the tuning harness
    botFit: botFit,                    // exported for the raise tray: same climb as the bot's
    BOT_TIERS: BOT_TIERS,
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
