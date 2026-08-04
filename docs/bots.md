# Bots

How the Deets games play themselves: where a bot's brain lives, the
contract it speaks, what each game's bot actually decides, how difficulty
tiers are defined, and how they were measured.

[games.md](games.md)'s "Bots" section is the **summary** — the contract
and the rules a new game must follow. This file is the **deep dive**: the
decision procedures, the tier tables, the measurement method, and the
findings that shaped both.

---

## The rule

**A bot's brain lives in that game's `engine.js`.** Never in the mock,
never in a worker's `src/index.js`.

This is not a style preference, it is the same rule the rules themselves
follow. `engine.js` is vendored **VERBATIM** into the game's worker repo
(`../Deets<Game>/src/engine.js`, guarded by that repo's
`node scripts/vendor.mjs --check`). Anything living there is automatically
one copy, run identically by the mock and the worker.

### What it cost to learn this

Cities and mahjong each carried **two hand-ported copies** of their bot:
an ES5 `phantomOne` in `<game>/transport-mock.js` and an ES6 one in the
worker's `src/index.js`. They were written to be equivalent, and mostly
were — but every tuning pass meant writing the same change twice, in two
dialects, in two repos, and keeping them parallel by eye. There was no
guard: `vendor.mjs --check` covers vendored files, and neither copy was
vendored.

That is the same failure mode CLAUDE.md already warns about for the turn
timer and the `--gseat` accent ("promote it, don't copy it"). Cities'
`phantomOne` was ~110 lines. The promotion deleted both copies and
replaced each with two lines that delegate.

**A bot is also allowed to read hidden information**, which is the second
reason it belongs in the engine and not the client. `botAct` receives the
whole `game` — every hand in mahjong, every dev card in cities. That is
correct *because it only ever runs inside the worker* (and the mock,
which **is** the worker for dev purposes). Never call `botAct` from page
code. What it returns is safe regardless: a discard, a claim, a
placement, a roll — all public the instant they apply.

### …except in poker

That last sentence is the whole argument, and **poker breaks it**. A
discard is public the moment it applies, so a mahjong bot that read your
hand to choose one gives nothing away. A **fold is not**: it is a
decision *derived from* whatever the bot looked at, so a bot that peeked
leaks the peek through its own betting, every hand, to everyone at the
table. The action being public does not make the reasoning safe.

So poker's bot is held to a narrower rule than the engine can enforce:

> `botStrength` and everything under it read **only** `g.players[me].hole`,
> `g.board`, and the public betting state. Never another seat's `hole`,
> never `g.deck`.

Nothing structural stops a future edit from widening that — so
`poker/engine.js` carries a self-check that does. It re-asks `botAct` on
a clone whose other hands are replaced and whose deck is emptied, with
the same seed, and requires the identical action. A deliberately peeking
bot was caught by it 26 times in a 150-hand soak.

**This is the test to copy into any future hidden-information game where
a bot's *choice* is itself a signal.** Mahjong and cities do not need
it; a betting game does.

---

## The contract

Each engine exports three things:

```js
botAct(game, isBot, opts, ctx) → action | null   // ONE action, or null
botPending(game, isBot)        → bool            // cheap: does anyone owe a move?
BOT_TIER_LIST                  → ["easy", "normal", "hard"]
```

### `botAct(game, isBot, opts, ctx)`

Returns **one action**, or `null` when no bot owes anything right now.

- **One action per call** is deliberate. The table's drive loop calls
  again after `BOT_STEP` (700 ms in the worker, 650 ms in the mock),
  which is what makes a bot *watchable* instead of a burst of state.
- **`isBot(seat) → bool`** is the caller's. The table owns who is a bot;
  the engine owns what one does. This matters for correctness, not just
  taste — a bot decides differently depending on whether the seat it is
  robbing is human.
- **`opts.tier`** is either one tier name (every bot the same) or a
  **`seat → name` function**. It must support the function form because a
  table can mix tiers and *which* seat acts is decided **inside**
  `botAct`, not by the caller — the caller cannot look up a tier for a
  seat it has not chosen yet.
- **`opts.acts`** is a per-turn budget the caller counts, for games that
  have one (cities' build budget). A turn's budget outlives a single
  call, so the engine cannot hold it without becoming stateful.
- **`ctx`** is the usual `{ rand, now }`. `botAct` never mutates `game`.

### `botPending(game, isBot)`

The drive loop asks this on **every alarm**, so it stays a cheap
predicate — no `applyAction` probes, no cloning. It answers only "does
some bot owe a move?", which is exactly what the alarm scheduler needs.

Invariant worth keeping: **`botPending` is true whenever `botAct` would
return non-null.** Both engines' self-tests assert this mid-game. If they
drift, the table either spins on a bot with nothing to do or stalls with
one that has something.

### Who supplies what

| Piece | Owner | Where |
|---|---|---|
| Who is a bot | the table | `botFn()` (DO base) / `H.botFn(t)` (mock) |
| How hard each plays | the table | `tierFn()` / `H.tierFn(t)` |
| What a bot does about it | the engine | `botAct` |
| The tier vocabulary | the engine | `BOT_TIER_LIST` |
| Rendering the picker | the shell | `cfg.botTiers`, `S.botTier_<name>` |

> **Naming trap.** The DO base has had `botAt(i) → bool` since it existed
> — a plain predicate `deadlineFor` and others use. The function-form
> lookups are `botFn()` / `tierFn()`. **Do not merge the names**: a JS
> class body silently keeps only the last definition of a name, so a
> second `botAt` either dead-ends or breaks every existing caller
> depending on order. This branch shipped that bug and caught it in
> testing, not review.

Both drive hooks receive what they need: `needsPhantom(t, H)` and
`phantomOne(t, H)` in the mock, and in the worker they are methods, so
`this` carries it.

A worker's hooks should be two lines:

```js
needsPhantom() { return Engine.botPending(this.t.game, this.botFn()); }
phantomOne() {
  const a = Engine.botAct(this.t.game, this.botFn(), { tier: this.tierFn() }, this.ctx2());
  return a ? this.tryAct(a) : false;
}
```

**A worker that still carries its own copy of a brain is a bug waiting to
drift.**

---

## Difficulty tiers

**A tier is a NAME, not a number**, and the vocabulary belongs to the
engine. The foundation only *validates* against `BOT_TIER_LIST`; the
shell only *renders* it.

- Set by the host on **`addBot {seat, name, tier}`**. Re-adding at a
  bot's seat re-tiers it, the same way it already renames.
- Stored on the seat, and it **survives Start's seat compaction**.
- **Public**: the tier rides every seat view and shows as a badge on the
  lobby row, not just in the host's editor. You should know what you are
  sitting across from.
- **Unknown or missing falls back to the MIDDLE of the list.** This is
  the important case: a seat converted mid-game — grace expiry, a
  mid-game kick, a lobby seat that went dark at Start — has no tier,
  because nobody chose one for it. It plays the default rather than
  inheriting whatever the host last typed.
- A game that declares **no** tiers gets no picker and nothing else
  changes. That is DeetsShips today ([ships.md](ships.md)); its bot is a
  deliberate v1 anchor.

The tiers are **parameters over one brain**, never separate brains. A
second brain would double the surface that has to stay correct, which is
the problem this whole change exists to remove.

---

## Cities

`cities/engine.js`, `botAct` → `BOT_TIERS`. The rules themselves are in
[cities.md](cities.md).

### Decision order

Checked top to bottom; the first that applies produces the action.

1. **A forced discard** owed by any bot, whoever's turn it is (a 7 was
   rolled). Sheds deepest stacks first when `keepPairs`, else in list
   order.
2. **Opening placement** (setup snake draft) — settlement, then the road
   off it.
3. **Answer an open trade offer.** Runs *before* the turn-seat check,
   because a human can offer on their own turn and the bots must answer.
4. Then, only if it is this bot's turn:
   - **robber** placement → **steal** target
   - **road-building card** placements (bails the turn if boxed in)
   - **before rolling**: maybe play a held knight, then **roll**
   - **after rolling**: city → settlement → road → dev card →
     **bank-trade** → **end turn**

City before settlement before road is not arbitrary: a city doubles a
spot already earned, which is the cheapest VP on the board.

### Legality without cloning

`applyAction` **clones the whole game**. The first cut of this bot probed
every candidate placement through it — roughly 180 clones per action —
and a single game took minutes. That is fine at a 700 ms cadence but
absurd inside a Durable Object, and it made measurement impossible.

The fix keeps exactly one copy of the rules: placement asks the engine's
**own predicates** — `occupied`, `touchesOwnRoad`, `roadConnects`,
`canAfford`, `COST`, supply counts. Those are the same functions
`placeMain` calls, so this is *reuse*, not a parallel implementation.
`applyAction` is still the final authority for the one-off verbs
(`buyDev`, `playDev`), where a single probe is cheap.

`botLegal` uses a **zeroed rand** so a probe never consumes the caller's
RNG.

### Scoring

`botPipValue(vertex)` = Σ pips over adjacent hexes (`6 − |7 − token|`, so
6 and 8 score highest) **+ 0.5 per distinct terrain** touched. Roads are
scored by the best *unoccupied* vertex they reach, so a road points at
ground worth settling.

`botChoose(list, pick, rand)` takes a best-first list and picks randomly
among the top `pick`. That single knob is most of the difficulty: `pick:
1` always takes the best spot it can see, `pick: 6` is careless. It also
stops a tier replaying an identical opening every game.

### Tier table

| | `pick` | `knight` | `road` | `dev` | `acts` | `robber` | `evenPass` | `loss` | `trade` | `keepPairs` |
|---|---|---|---|---|---|---|---|---|---|---|
| easy | 6 | 0.05 | 0.55 | 0.25 | 10 | `random` | 0.10 | 2 | 0.40 | no |
| normal | 3 | 0.35 | 0.65 | 0.45 | 14 | `steal` | 0.40 | 0 | 0.75 | yes |
| hard | 1 | 0.85 | 0.80 | 0.55 | 20 | `leader` | 0.75 | −1 | 1.00 | yes |

- **`pick`** — choose among this many best-scoring legal spots.
- **`knight`** — chance of playing a held knight before rolling.
- **`road`** — chance of spending on a road toward open ground.
- **`dev`** — chance of buying a development card.
- **`acts`** — build actions per turn before ending it.
- **`robber`** — `random`, `steal` (anyone holding cards), or `leader`
  (the public-VP leader, ties to the bigger hand).
- **`evenPass`** — chance of declining a dead-even trade.
- **`loss`** — worst net card loss it will still accept. `−1` means hard
  demands profit; `2` means easy will take a bath.
- **`trade`** — eagerness to bank-trade surplus toward a goal.
- **`keepPairs`** — sheds deepest stacks on a forced discard instead of
  shedding blindly and breaking its own sets.

### Bank trading

`botBankTrade` picks the best goal the bot can still use (city →
settlement → dev → road), finds the first resource that goal is short of,
and trades away surplus **that the goal does not itself need**, at the
seat's real `tradeRate` (harbors included).

This was missing entirely, and its absence was the single worst bug in
the old bots — see Findings below. Every tier does it; `trade` only sets
how eagerly.

---

## Mahjong

`mahjong/engine.js`, `botAct` → `BOT_TIERS`. Hong Kong rules, four seats;
see [mahjong.md](mahjong.md).

### Decision order

1. **Seating roll** — mechanical, no judgement.
2. **A claim window** — every bot that has not answered owes a response.
   A **win is never declined**. Otherwise kong → pung → chow by tier
   probability, else pass.
3. **Breaking the wall** — the dealer's, equally mechanical.
4. **Its own turn**: win on the drawn tile if it is one → self-kong (a
   kong draws a replacement, so it is close to free value) → **discard
   the least useful tile**.

`botAct` returns `null` on `handOver` — a settled hand is the *table's*
timer to advance, not a bot's.

### Discard scoring

`botUsefulness(tile)` — higher means keep:

- `(count − 1) × 4` — pairs and triplets dominate.
- **Lone honour: −1.5.** An honour joins no run, so a single one can only
  ever become a pung. It is the cheapest thing in hand to shed, and
  holding them is much of why an unturned hand drifts to a drawn wall.
- **`shape`** — for suited tiles, +2 per adjacent neighbour held, +1 per
  gap-of-two, and −0.5 for terminals (which sit on fewer runs).
- **`chase`** — keeps honours that carry faan: a dragon pair, or a pair
  of your own seat wind / the prevailing wind. Slow, but they score.
- **`safe`** — subtracts `1.5 × pond count`. A tile already showing three
  times face-up is nearly dead and therefore the safest thing to throw.
  This is the defensive axis, and it is what separates the tiers most.
- **`jitter`** — uniform noise added last. High jitter blurs a correct
  evaluation into a sloppy one, which is a cleaner way to build a weak
  bot than giving it a worse heuristic.

### Tier table

| | `kong` | `pung` | `chow` | `jitter` | `shape` | `safe` | `chase` |
|---|---|---|---|---|---|---|---|
| easy | 0.55 | 0.75 | 0.65 | 3.0 | no | no | no |
| normal | 0.80 | 0.55 | 0.30 | 0.5 | yes | no | no |
| hard | 0.90 | 0.60 | 0.20 | 0.1 | yes | yes | yes |

Claim rates are **not** monotonic, and should not be. Easy chows
constantly (0.65) and pungs freely; that wins more hands of *low value*,
which under a `minFaan` table is bad play. Normal and hard decline most
chows to protect hand value. Difficulty here is discipline, not appetite.

---

## Poker

`poker/engine.js`, `botAct` → `BOT_TIERS`. No-limit hold'em as a cash
game; the rules are in [poker.md](poker.md).

Bots here are **host-added and never inherited** — a released seat goes
away with its stack or cashes out, never to a bot ([poker.md](poker.md),
"Stepping away"). What the tiers decide is how hard a seat somebody
*chose* to fill plays.

### Decision order

1. **A busted bot re-buys**, whoever's turn it is. Deliberately **not** a
   tier knob — see finding #5.
2. Then, only on its own turn:
   - **nothing owed** → bet if the hand clears `betAt` (at `aggro`), else
     bluff at `bluff`, else check.
   - **facing a bet** → preflop, fold below `tight`; postflop, shove above
     `commit`; raise above `raiseAt` (at `aggro`); then the price test;
     else call.

`botAct` returns `null` on `handOver` — a settled hand is the table's
timer to advance, not a bot's.

### Strength (0..1)

One heuristic, read the way cities reads a vertex and mahjong reads a
tile. It is **not** an equity estimate and does not pretend to be; a
Monte-Carlo rollout would be stronger and would have to read the deck,
which is exactly what poker's bot may not do.

- **Preflop: Chen's formula**, the standard pencil-and-paper ranking —
  high card, doubled for a pair, plus suited, minus the gap. It runs
  about −1 (72o) to 20 (AA), which normalizes cleanly onto 0..1.
- **Postflop: `Engine.bestOf`** — the same function the hand panel uses,
  so the bot cannot disagree with the client about what it holds — with
  three refinements that matter more than the category does:
  - **a pair is only as good as what it beats.** An overpair and bottom
    pair carry the same name and the same category. Scaling by how many
    board cards the pair outranks is most of the postflop skill.
  - **playing the board caps at 0.10.** If your five best cards are the
    five on the table, everyone still in holds them too — that hand can
    chop, never win.
  - **draws count only when the hole cards make them.** Four to a flush
    on the board is everyone's, so it is nobody's edge. A draw is also
    capped below a made hand (0.72), because it is worth chips and not
    worth a made hand's chips.

### Tier table

| | `tight` | `jitter` | `aggro` | `bluff` | `betAt` | `raiseAt` | `commit` | `odds` | `slack` | `size` | `pick` |
|---|---|---|---|---|---|---|---|---|---|---|---|
| easy | 0.12 | 0.45 | 0.30 | 0.12 | 0.34 | 0.58 | 0.95 | no (`callBB` 6) | — | 0.55 | 5 |
| normal | 0.26 | 0.14 | 0.55 | 0.07 | 0.36 | 0.55 | 0.90 | yes | 1.00 | 0.60 | 2 |
| hard | 0.34 | 0.02 | 0.65 | 0.10 | 0.36 | 0.54 | 0.86 | yes | 1.12 | 0.62 | 1 |

- **`jitter`** — centered noise on the strength read. Mahjong's axis,
  and the same reasoning: blurring a correct evaluation is a cleaner way
  to build a weak bot than giving it a worse one.
- **`odds` / `slack`** — the discipline axis. `odds` compares the price
  against the pot (`call / (pot + call)` is the equity it demands);
  `slack` scales that, so >1 wants a margin before putting money in.
  Easy doesn't do this at all — it calls anything up to `callBB` blinds,
  which is what the old dev bot did and is the single biggest leak.
- **`commit`** is **postflop only**. Shoving aces into the blinds wins
  the blinds; preflop the ordinary raise path handles it.
- **`pick`** — cities' knob, here choosing among bet sizings, so two
  bots at one tier don't bet the identical number every hand.
- **`bluff` is not monotonic** (0.12 / 0.07 / 0.10), for mahjong's
  reason: easy bluffs out of ignorance, normal is a nit, hard bluffs on
  purpose.

### The tiers stay CLOSE on aggression and sizing

This is load-bearing and was learned the hard way — see finding #6. The
tiers differ mainly on the **read** (`jitter`) and the **discipline**
(`odds`/`slack`/`tight`). Giving each tier its own value for all ten
knobs produced a ladder that was **non-transitive**: hard crushed easy
and *lost* to normal. Independent knobs make a tier different, not
better.

---

## Measurement

Tuning bot difficulty by reading the code does not work. Both tier sets
were set by simulation.

**Method.** All-bot tables driven to completion, seeded deterministically,
with **tiers rotated through seats** every game so turn-order advantage
is not scored as tier strength. Cities: 60 games per table across 7
tables. Mahjong: 200 matches per table (points are heavy-tailed enough
that 40 separated nothing).

### Cities — win share, 60 games per table

| Table | avg turns | stuck | Result |
|---|---|---|---|
| easy ×3 | 135 | 0 | — |
| normal ×3 | 109 | 0 | — |
| hard ×3 | 106 | 0 | — |
| easy / normal / hard | 105 | 0 | **8% / 17% / 75%** |
| easy ×2 / hard | 104 | 0 | easy 7.5% each, **hard 85%** |
| normal ×2 / hard | 104 | 0 | normal 26.5% each, **hard 47%** |
| easy / normal ×2 | 120 | 0 | easy 8%, normal 46% each |

Clean monotonic ladder, no stalls, and game length converged to ~105
turns across every tier.

### Mahjong — 200 matches per table

| Table | pts/match | hand-win % | deal-ins/match |
|---|---|---|---|
| easy ×3 vs **hard** | −96 / **+96** | easy 65 / hard 35 | easy 4.7 / **hard 1.0** |
| normal ×3 vs **hard** | −117 / **+117** | normal 71 / hard 29 | normal 4.5 / **hard 1.4** |
| easy ×3 vs **normal** | −73 / **+73** | easy 71 / normal 29 | easy 4.2 / **normal 1.2** |

Same-opponent comparison is the one that ranks them: against three easy
seats, **normal earns +73 and hard +96**. Ladder confirmed.

---

## Findings

Three results worth not rediscovering.

### 1. Difficulty belongs in judgement, not in refusing to play

The first cut of cities' `easy` placed settlements at random (`pick:
Infinity`) and hoarded roads. It ran **23,583 turns without a winner**.

A bot that will not expand does not play *badly* — it stops the game
converging. There is nothing for a human to beat. Weak tiers must make
**worse choices**, not fewer: `road` in particular is not a weakness
knob, because roads are how a seat reaches new ground at all. Every tier
now expands, bank-trades, and finishes.

### 2. Not bank-trading deadlocks a table

The old cities bots could only ever spend what they rolled. Late in a
game every seat ends up holding the wrong five cards, nobody can build,
and the table rolls forever. **~3% of games produced no winner at all**
before bank trading was added; afterwards, zero stalls in 420 games, and
average length dropped from 978 turns (easy) to ~105 across the board.

### 3. Pick the metric before you tune the tier

In mahjong, **hand-win rate ranks the tiers backwards**: hard wins 29–35%
of hands, easy 65–71%. That is not a bug — a defensive hand wins less
often and loses far less. Tuning against hand-win rate would have made
every tier worse.

Points rank the tiers correctly but are heavy-tailed (a limit hand swings
hundreds), so 40 matches separated nothing and even 200 leaves noise.
**Deal-ins are the stable signal** — hard 1.0–1.4 per match against
easy's 4.2–4.7, consistent across every table — and the self-test ladder
counts those.

### Poker — paired duels, `scripts/poker-bot-duel.js`

Poker needed a **different estimator**, not just more hands. The metric
is **bb/100** (net cents per hundred hands, in big blinds), which the
transfer ledger already computes exactly and self-checks as zero-sum.
Hand-win rate ranks the tiers backwards here for mahjong's reason —
`easy` wins the most hands at every table below.

Three estimators were tried:

| Method | Result |
|---|---|
| One-knob sweeps vs a fixed field | Unusable. Neighbouring `jitter` values read +134, −28, +110, +161 bb/100 — the noise dwarfed every effect. |
| Cities/mahjong's rotation (one bot walked through the seats) | Unusable. 20,000 hands × 8 rotations still gave **±79 bb/100**. Rotation folds *positional* advantage into the error bar. |
| **Paired duels** | **±5 bb/100.** Two tiers seated alternating (A,B,A,B), each holding two opposite seats, half the runs flipped so the button is balanced too. Position cancels *inside* each table and the statistic is the per-run difference, paired on the same deck. |

The ladder, at two volumes (the tiers were settled on the first and
confirmed on the second):

| Duel | 8,000 × 10 | 15,000 × 16 |
|---|---|---|
| hard vs easy | +184.3 ±28.6 | **+201.6 ±4.8** |
| hard vs normal | +31.4 ±13.1 | **+19.2 ±10.1** |
| normal vs easy | +115.8 ±48.3 | **+130.5 ±36.5** |
| *normal vs normal* | *+0.0 ±0.0* | the harness sanity row |

All bb/100, positive meaning the first tier takes money off the second.
**Monotone at both volumes**, and every rung clears its own error bar.

That last row is the proof the pairing works: a tier duelled against
itself must come out at **exactly** zero, because both sides see
identical cards in mirrored seats. Any drift there means the harness is
measuring something it shouldn't.

**The honest reading**: easy → normal is an enormous step, normal → hard
a small one. hard is genuinely ahead of normal, but the gap sits at the
edge of significance even at a quarter-million hands. If the ladder
should feel more evenly spaced, the room is in *normal*, not in making
hard sharper — and what caps hard is the strength model, not the tier
constants (see Open).

---

### 4. Pick the ESTIMATOR before you tune, too

Finding #3 says pick the metric first. Poker adds: the metric can be
right and still unmeasurable. bb/100 was correct from the start; the
*design* around it was not. Rotating one bot through the seats — the
method that works fine for cities and mahjong — scores position as tier
strength, and poker's per-hand variance is large enough that this alone
made 160,000 hands rank nothing at all (±79 bb/100).

Balancing position **inside** each table instead of across runs took the
error bars from ±79 to ±5 on the same hardware in less time. **When a
comparison is noisy, look at what the design fails to cancel before
reaching for more samples.**

### 5. A cash game needs the re-buy, for cities' reason

Cities' first `easy` stalled the table by refusing to expand (finding
#1). Poker's version: a bot that busts and never re-buys empties the
table one seat at a time until a human is sitting alone at a `waiting`
felt. So **re-buy is not a tier knob** — every tier does it, exactly as
every cities tier expands and bank-trades.

### 6. Independent knobs make a tier DIFFERENT, not better

The first poker tier table gave `hard` its own value for all ten knobs.
The result was **non-transitive**: hard beat easy by +123 bb/100 and
*lost* to normal by −29. Two of its knobs were pulling against each
other — it raised more often *and* called wider — and the combination
was simply a third playing style rather than a stronger one.

Difficulty now runs along a **few** axes (the read, the discipline) with
the tiers held close on aggression and sizing. A ladder is a total
order; ten free parameters do not produce one by default.

*(A knob whose direction you have written down can still be backwards.
`slack` was documented as ">1 calls too wide" when it does the opposite.
The tier table built on that comment made hard the calling station.)*

---

## Self-tests

`node cities/engine.js` (124 checks) and `node mahjong/engine.js` (68)
both cover, per tier:

- every tier plays **only legal moves** for a whole game;
- every tier **finishes** — the guard against finding #1 again;
- `botPending` agrees with `botAct` mid-game;
- no action once the game is over (mahjong: nor on a settled hand);
- **the ladder itself** — cities asserts hard out-wins two easies;
  mahjong asserts a hard seat deals in less than an easy seat, for the
  reason in finding #3.

They run in ~3 s and ~1 s. Keep them fast enough that nobody skips them.

`node poker/engine.js` (290 checks) covers the same ground, minus the
"finishes" check — a cash game has no end condition, so there is nothing
to converge to — plus three of its own:

- **the blindness guard** (see "…except in poker"), run at *every*
  decision of a 150-hand soak;
- **the strength model reads sensibly** — AA is the best preflop hand,
  KK beats AKs, an overpair beats bottom pair, a board-only flush draw
  is nobody's draw, and playing the board can't win outright;
- **a raise the ladder can actually pay**, against a deliberately
  unrepresentable minimum (see below).

**The ladder itself is NOT asserted here.** Cities and mahjong can check
theirs in-process; poker's needs ~90 s of paired duels to clear its own
error bar, which is not a self-test. `scripts/poker-bot-duel.js` owns it
— re-run that after touching `BOT_TIERS`, and paste the numbers into
Measurement above.

> **The soak length is load-bearing.** The first version ran 12 hands per
> table and passed. The tuning harness then hit an **illegal action**
> around hand 400: `minTo` is not always representable — a short all-in
> is legal at any amount, so `bet.current`, and the minimum raise built
> on it, can land on cents no ladder can pay. The soak is 150 hands now
> and that case is pinned directly. **A legality soak that never reaches
> the rare state is not a legality soak.**

---

## Change radius

| What you want to change | File | Reaches | After |
|---|---|---|---|
| How one game's bot plays, or its tiers | `<game>/engine.js` | that game | **Re-vendor** (`node scripts/vendor.mjs`), redeploy — and for poker, re-run `scripts/poker-bot-duel.js` and update Measurement |
| The tier wire field, validation, fallback | `games/table-do.js` + `table-mock.js` | **every game** | **Re-vendor the base into every game worker**, redeploy |
| The lobby picker / seat badge | `games/table.js` + `styles/table.css` | every game | — (browser only) |
| Tier labels | `<game>/strings.js` (`botTier_<name>`) | that game | — (Aditya's copy) |
| Bot cadence | `BOT_STEP`, `games/table-do.js` | every game | **Re-vendor**, redeploy |

---

## Open

- **Mahjong's ~51% draw rate is high.** Real HK play sits well below
  that. Fixing it properly needs **shanten counting** (distance from a
  winning hand) rather than the per-tile heuristic here; that is a
  separate piece of work, not more tier constants.
- **One match in 599 never reached `over`.** A drawn hand repeats the
  dealer, so a pure-bot table can streak indefinitely. A human or the
  turn timer breaks it, so this is a tail risk rather than a live bug —
  but a hand cap would close it.
- **The results row does not carry the tier.** An easy bot and a hard bot
  under the same name are not the same opponent, so a tier belongs beside
  `kind = 'bot'` and `name` when Elo arrives. That is an `ALTER TABLE` in
  `../DeetsAccounts` plus a `seatCounters` change, and it should land
  **with** Elo rather than speculatively — see [stats.md](stats.md).

  This matters most in poker, where the counter is **money**. Worth
  recording that the schema already handles the coarse version: the
  counter tables are one row per game (`PRIMARY KEY (key, seat)`), not
  running aggregates, and `results.bots` is stored per game — so "my net
  against humans only" is a **query today**, no migration. It is only
  *which tier* that is unrecoverable, and only for games played before
  the column exists.
- **Poker's `hard` is capped by the strength model, not its tier.** The
  heuristic has no notion of position, opponent modelling, or board
  texture beyond what `bestOf` sees, so there is a ceiling no constant
  reaches — which is why normal → hard is a much smaller step than
  easy → normal. Going further means a real equity estimate, and the
  cheap version of that (Monte-Carlo rollouts) **reads the deck**, which
  poker's bot may not do. A rollout over the *unseen* cards from the
  bot's own point of view would be legitimate; it is a genuine piece of
  work, not a tuning pass.
- **Poker bets on nothing but its own cards.** No bluff is informed by
  what the board could be hiding, and nothing tracks how a given
  opponent has been playing. Both are the same missing piece as above.
- **Cities bots never *initiate* player trades.** They answer offers but
  never make one, so a bot-only table trades far less than a human one.
- **DeetsShips has no tiers.** Its `botAct` is a v1 anchor that stages
  legal minimums and never stalls a table. It gets tiers by adding a
  `BOT_TIER_LIST` to `ships/engine.js` and nothing else.
- **Poker's tier labels are `[ph]`.** `botTier_easy/normal/hard` and the
  short forms in `poker/strings.js` are placeholders awaiting Aditya's
  pass — the rest of that file is his.
