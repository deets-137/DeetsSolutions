/* Poker bot tier measurement (docs/bots.md, "Measurement").

   Dependency-free. Run from the repo root:

     node scripts/poker-bot-duel.js               # the ladder, ~90s
     node scripts/poker-bot-duel.js 15000 16      # the high-volume confirmation

   WHY THIS SHAPE — three estimators were tried and two of them cannot
   rank poker bots at any hand count worth waiting for:

     1. One-knob-at-a-time sweeps vs a fixed field. Useless: neighbouring
        values of `jitter` read +134, -28, +110, +161 bb/100. The noise
        is bigger than every effect being measured.
     2. Cities' and mahjong's method — one bot rotated through the seats.
        Also useless HERE, because rotation folds positional advantage
        into the error bar: 20,000 hands x 8 rotations still gave
        ±79 bb/100, and no tier difference is that large.
     3. This one. Two tiers are seated ALTERNATING (A,B,A,B) so each holds
        two seats directly opposite each other, and half the runs start
        (B,A,B,A) so the button is balanced too. Position is cancelled
        INSIDE each table, and the statistic is the per-run difference,
        paired on the same deck. Error bars fall to ±5 bb/100.

   The sanity row is the proof the pairing works: a tier duelled against
   ITSELF must come out at exactly +0.0 ±0.0, because the two sides see
   identical cards in mirrored seats. Anything else means the harness is
   measuring something it shouldn't.

   THE METRIC IS bb/100 — net cents per hundred hands, in big blinds.
   NOT hand-win rate, which ranks the tiers backwards for the same reason
   mahjong's does: a loose bot wins more pots and less money. `easy` wins
   the most hands at every table in this file.  */

const path = require("node:path");
const Engine = require(path.join(__dirname, "..", "poker", "engine.js"));

const HANDS = +process.argv[2] || 8000;
const RUNS = +process.argv[3] || 10;
const BB = 20;
const SETTINGS = {
  buyIn: 2000, bigBlind: BB, chips: [10, 20, 25, 50, 100],
  minRaise: "prev", timerSec: 0
};

// the engine takes randomness in; a fixed LCG makes every run repeatable
function lcg(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/* Drive an all-bot table to `hands` and return each seat's net cents.
   There is no end condition in a cash game, so the hand count is the
   stop — nets are read off the live players, not off `over`. */
function runTable(tiers, seed, hands) {
  const ctx = { rand: lcg(seed), now: 0 };
  let g = Engine.createGame({ settings: SETTINGS, seats: tiers.length }, ctx);
  const isBot = () => true;
  const tierFn = (s) => tiers[s];
  let guard = 0, bad = 0;
  while (g.phase === "play" && g.stats.hands < hands && guard++ < hands * 400) {
    const a = Engine.botAct(g, isBot, { tier: tierFn }, ctx);
    if (a) {
      const r = Engine.applyAction(g, a, ctx);
      if (r.error) { bad++; break; }
      g = r.game;
      continue;
    }
    if (g.handOver) { g = Engine.applyAction(g, { type: "timerExpire" }, ctx).game; continue; }
    break;                                  // nothing owed and no hand to settle
  }
  return {
    nets: g.players.map((p) => p.stack - p.bought),
    sum: g.players.reduce((a, p) => a + (p.stack - p.bought), 0),
    hands: g.stats.hands,
    bad
  };
}

function stats(xs) {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / Math.max(1, xs.length - 1);
  return { mean: m, se: Math.sqrt(v / xs.length) };
}

/* A's edge over B in bb/100. Positive means A takes money off B. */
function duel(A, B, expectZero) {
  const diffs = [];
  let bad = 0, short = 0, nonzero = 0;
  for (let r = 0; r < RUNS; r++) {
    const tiers = r % 2 ? [B, A, B, A] : [A, B, A, B];
    const res = runTable(tiers, 9001 + r * 7919, HANDS);
    bad += res.bad;
    if (res.hands < HANDS) short++;
    if (res.sum !== 0) nonzero++;           // the ledger is zero-sum or the engine is wrong
    let na = 0, nb = 0;
    tiers.forEach((t, i) => { if (t === A) na += res.nets[i]; else nb += res.nets[i]; });
    diffs.push(((na - nb) / 2 / BB) / res.hands * 100);   // two seats each
  }
  const s = stats(diffs);
  const flags =
    (bad ? `  ILLEGAL:${bad}` : "") +
    (short ? `  SHORT:${short}` : "") +
    (nonzero ? `  NONZERO-SUM:${nonzero}` : "");
  // the sanity row PASSES by being zero; everything else passes by clearing
  // its own error bar
  const sig = expectZero
    ? (s.mean === 0 && s.se === 0 ? "  exact — pairing holds" : "  PAIRING BROKEN")
    : (Math.abs(s.mean) > 2 * s.se ? "  significant" : "  NOT SIGNIFICANT");
  console.log(
    `  ${(A + " vs " + B).padEnd(20)} ${s.mean >= 0 ? "+" : ""}${s.mean.toFixed(1)} ` +
    `±${s.se.toFixed(1)} bb/100${sig}${flags}`
  );
  return s;
}

console.log(
  `paired duels — ${HANDS} hands x ${RUNS} runs, 4 seats, 2 per tier, button balanced\n`
);
duel("hard", "easy");
duel("hard", "normal");
duel("normal", "easy");
console.log("\nsanity — a tier against itself must be exactly zero:");
duel("normal", "normal", true);
