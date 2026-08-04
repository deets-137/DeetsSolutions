# DeetsPoker — no-limit hold'em, 2–12 seats

The poker tab: no-limit Texas Hold'em played as a **cash game** on the
shared table foundation ([games.md](games.md) — read that first; this file
covers only what makes poker itself). Built on branch `gamba`,
design settled with Aditya in chat 2026-08-03.

```
poker/index.html         the page (bar + bento)
poker/strings.js         ALL user-facing copy ([ph] convention)
poker/engine.js          the rules: pure, DOM-free, dual-export, self-tested
poker/poker.js           the felt/hand-panel UI + the shell's hooks
poker/transport-mock.js  the mock's game half (a spec on table-mock.js)
poker/poker.css          the game's own art + layout
assets/sprites/poker/    chip art (templates: scripts/build-poker-chips.py)
../DeetsPoker/           the worker repo (src/index.js is the mock's port)
```

`node poker/engine.js` runs the engine's self-checks (290 at last count).
`node scripts/poker-bot-duel.js` measures the bot tiers ([bots.md](bots.md)).

## Build phases

**Phase 1: mock-first.** The whole game was built and reviewed against
the in-page mock, which ran WITHOUT `?mock` behind a `mockDefault: true`
flag in poker.js's shell config. Everything the worker would need was
shaped for vendoring from the start: `engine.js` is the contract file,
the mock spec is the DO subclass hook-for-hook. The flag is gone now, but
the shell hook stays — the next game gets to build this way too.

**Phase 2: the worker (LIVE).** `../DeetsPoker` is deployed at
`poker-api.deets.solutions` — a `PokerTable` subclass of the shared
`GameTable` base, vendoring `table-do.js`, `colors.js` and
`poker/engine.js` byte-identically, and porting `transport-mock.js` hook
for hook (the mock is the reference implementation; where the two
disagree, the mock is right). The away-seat half of the base landed with
it (see "Stepping away"), as did the stats hooks (`poker_seats` counters
on the accounts D1, `score` = net cents).

The mock is still one `?mock` away and is still where a rules change gets
tried first. Three checks guard the pair, all dependency-free:
`node src/engine.js` (the rules), `scripts/check.mjs` (the results
payload maps onto the D1 columns), `scripts/check-table.mjs` (the away
paths, through the real DO over fake sockets — the mock models no
disconnects, so that file is the only thing standing between a
grace-expiry bug and somebody's stack).

## The decisions (chat 2026-08-03)

- **Money is integer cents; chips are real at the betting line.** Every
  buy-in, blind, and raise-to amount must be composable from the table's
  chip denominations (`Engine.representable`, real coin-change — greedy
  fails on 10/25). The ONE exception: a full all-in is always legal (your
  last chips are whatever they are). Stacks are plain cent totals; how a
  stack would be drawn as chips is display-only (`Engine.chipBreak`).
- **Chip ladder**: derived, not typed — see "The settings cascade"
  below. Host-editable values in the lobby, and **drag to reorder** —
  no affordance by design (his call, chat 2026-08-03); the order is the
  host's to mean something by and the wire keeps it verbatim (the engine
  only reads the values). Stacks render as CHIPS on the felt and in the
  hand panel ("Chips on the table"); bet piles are still plain amounts.
- **Blinds**: one `bigBlind` setting, derived from the buy-in; the small
  blind is half, so the big blind must be even and BOTH halves must
  split into the chips — refused with the `blind` code, surfaced as a
  red toast. A derived ladder can't produce that refusal (its smallest
  chip IS the small blind); only a hand-built one can. Blinds post
  automatically.
- **Buy-in**: $5/$10/$20/$50/$100 presets + any custom amount (also
  chip-splittable, ≥ the big blind). Everyone buys in at Start.
- **Min raise** setting: `prev` (default — at least the previous raise,
  standard NL), `double` (at least 2× the current bet), `none` (any
  amount over the current bet, floor one smallest chip). The
  **incomplete-raise rule** is in: a short all-in doesn't reset the raise
  size and re-opens only *calling* for money already matched short
  (`bet.capped` seats may call or fold, not re-raise).
- **Side pots** are computed at settlement by contribution layering;
  folded money stays in, folded players are never eligible; the uncalled
  top of the last bet walks home first; odd cents go to the first winner
  clockwise from the button.
- **Turn timer**: Off by default, presets 15/30/60/120s + custom (5–600).
  Expiry checks when checking is free, else folds. The timer only runs
  for a present human; with the timer off a player can stall forever and
  the host's kick is the remedy (his call).
- **Hand recap** (`handOverSec`): how long the settlement card stays up,
  presets 5/15/30/60s + custom (3–120), default **30**. It has a floor
  and no "off" because that card is the only place a `reveal` can be
  asked for. Anyone can cut it short with Next hand.
- **No bots, ever, in live play.** No bot inherits a poker seat in any
  mode — the drive is a dev tool, not a player. What the three `rejoin`
  modes decide is what **leaving costs**; see "Stepping away" below. The
  mock keeps host-added **dev bots** so a solo lobby can watch hands play
  out — see "Bots" below.
- **Joining a running table** is one setting, **Mid-game Join** (see
  "Stepping away"). There is no separate Seating row — it said the same
  thing twice. `sitIn` (the poker-only verb: a NEW seat appended
  mid-game at the set buy-in, dealt in next hand, which the core's
  adopt-an-existing-seat `sit` can't express) is the `"anyone"` half of
  that one control.
- **Busting**: stack 0 marks you out; a **Buy in** button appears in the
  hand panel where your cards were, re-buys at the table buy-in, and
  deals you into the next hand. `bought` accumulates for the cash-out
  math.
- **Ending a game** (three doors, all landing in the cash-out lobby):
  **Stand up** (toolbar, two-step) cashes *you* out — but only at a
  `"none"` table; in the other two modes the same pill reads "Sit out"
  and your stack stays on the felt (see "Stepping away");
  **Vote to end** — a strict majority of live seats flips the table to
  `over`, but the pill is **hidden** (`SHOW_END_VOTE = false` in
  `poker.js`; the verb, the `votes`/`you.myVote` fields, the toasts and
  the log line all still work, so flipping the flag is the whole
  restore); **End game** — the host's two-step pill, no vote needed. An
  ending mid-hand cancels the hand: every live bet walks home before the
  math. The cash-out lobby ranks by net (stack − bought), host gets
  Rematch.
- **12 seats vs six presets**: `--gseat-6..11` fallbacks were added to
  `styles/table.css` (empty-seat dots), and seats past the presets are
  assigned by **`Colors.freeColor`** — see docs/games.md, "Seat colors".
  poker.js still auto-recolors its own seat when a PROFILE color lands on
  someone (the table can't see that one coming), now drawing from the
  same generator. The old "two bots past seat six share a preset" gap is
  closed: it was every seat past the sixth, not two, and they shared an
  identical hex rather than a near one.

## Hand Rankings + the made hand (chat 2026-08-04)

The hand panel's left column reads top to bottom: "Your Hand", your two
cards at 1.5x, **what you actually hold**, and a **Hand Rankings** button
pinned to the bottom (`margin-top: auto`).

The made-hand line is computed CLIENT-SIDE from your own two cards plus
the public board — `Engine.bestOf` is already exported, and asking the
table for it would put a hand on the wire that only you may see. `bestOf`
needs five cards, so preflop the line reads the two in your hand directly
(you do hold a pair or a high card before the flop, and blanking the line
for a whole street would be worse). It is always in the layout, blanked
rather than omitted, so the flop can't jog the panel.

The guide is mahjong's `mj-guide` in poker's clothing: an absolute
overlay — on the **bento**, not one tile, because the button lives in the
hand panel and the reading wants the felt's width — a fixed-width panel
that scrolls inside itself, Escape and backdrop-click to close, and
deliberately **no entrance animation**, because the page rebuilds on
every broadcast while it is open and anything that replayed would flicker
once a second at a busy table. The bento is the one node `paint()` does
not rebuild, so the overlay is removed by hand at the top of each paint
or every broadcast would stack another copy.

Nine rows, best first, each carrying a five-card example that IS that
category — the fastest answer to "does a flush beat a full house" is one
of each side by side. `HAND_GUIDE`'s keys are the engine's `HAND_NAMES`
keys, so the row names come from his strings and **the category you
currently hold lights up**. The examples are checked against
`Engine.bestOf`, so the guide cannot claim a hand it isn't.

## Rotation (chat 2026-08-04)

A moving dealer button has two readings and the felt can only draw one,
so the **Rotation** toolbar pill lets the viewer pick:

| option | 12 o'clock | what moves |
| --- | --- | --- |
| **Rotate Dealer** (default) | seat order | the D badge walks; every player keeps their chair all game |
| Rotate Seats | the dealer | the button never moves; everyone else shuffles one seat each hand |

Display only — a per-viewer localStorage preference
(`deets-poker-rotate`), nothing on the wire, and two people at the same
table may read it differently. Rotate Seats was the original and only
behavior; it is a real convention (the button anchors the geometry) but
it means the table rearranges itself every hand, which is the opposite
of what a table is for. Hence the default flip.

Related, same conversation: the **1** and **2** blind badges now wear the
dealer's dress. They were a transparent variant inked in `--pkface` —
ivory on a seat pill whose background is `--menu-surface`, which is ivory
in all three light themes. 10–26 redmean units apart, against
`colors.js`'s own `MIN_DIST` of 60: not subtle, *invisible*, and only in
half the themes. A carve-out literal used as a foreground is the failure
mode to watch for here.

## The settings cascade (chat 2026-08-03)

A real cash table doesn't pick its chips out of the air, so neither does
this one. **Buy-in → blind → ladder**, each stage derived from the one
above:

| Buy-in | Blinds | Ladder (5 chips) |
| --- | --- | --- |
| $5 | 5¢ / 10¢ | 5¢ · 10¢ · 25¢ · 50¢ · $1 |
| $10 | 5¢ / 10¢ | 5¢ · 10¢ · 25¢ · 50¢ · $1 |
| $20 | 10¢ / 20¢ | 10¢ · 25¢ · 50¢ · $1 · $2 |
| $50 | 25¢ / 50¢ | 25¢ · 50¢ · $1 · $2 · $5 |
| $100 | 50¢ / $1 | 50¢ · $1 · $2 · $5 · $10 |

Two real-world rules do all the work. The blind is **100 big blinds** of
the buy-in, snapped so the small blind lands on a canonical money value
(`Engine.CANON_CHIPS`) — a custom $37 buy-in still yields a table made of
round money. The smallest chip **is** the small blind, because anything
under it is unspendable. The ladder is that rung plus N-1 more up the
canonical list.

Notice what nobody wrote down: **the top chip lands on buy-in ÷ 10 at
every preset** (÷ 20 at four chips). It falls out of the cascade. That is
also why the old "top chip ≈ a tenth of the buy-in" heuristic is *not* in
the code — it would be a second rule able to contradict the first.

- `Engine.suggestBlind(buyIn)` and `Engine.suggestChips(bigBlind, count)`
  are pure and exported, so the lobby, the mock and (phase 2) the worker
  all derive the same table.
- **`chipCount` is the lobby's `4 | 5` pill** — the ladder's only knob.
  It is a *parameter* of the cascade, not an override: flipping it
  re-derives. Typing a chip value is what freezes the ladder.
- **Dirty flags**: `blindManual` / `chipsManual`. Each stage derives
  until the host takes it over by hand; `autoBlind` / `autoChips` on
  `setSettings` hand it back. A derived row carries **no mark** — it was
  derived before anyone touched it, so an "auto" label told the host
  something they already knew (his call, chat 2026-08-03). An overridden
  row grows a **reset** link instead: the dirty flag's only UI, showing
  up exactly when there is something to undo.
- **`applySettings` validates ONCE, at the end.** A derived stage depends
  on a stage that may be changing in the same message, so the three are
  staged into a candidate first; validating field-by-field would refuse a
  perfectly good buy-in for failing against a ladder about to be replaced.
- **Chip colour follows RANK, not value** (`RANK_HEX` in
  transport-mock.js). Values are derived now, so the same green would
  otherwise mean 25¢ at one table and $2 at the next. Rank-coloured, the
  bottom chip is always white — and the drag-reorder finally has a
  visible consequence.

## Chips on the table

`chipBreak` is a canonical breakdown, so it returns one tall column of
the biggest chip — true, and useless to look at ($21 is 21 blacks). A
**tray** is what the cage would actually deal you, and it is real state:

- `p.tray = { chips: {value: count}, odd }`, public on the seat view
  (money is public at a poker table). The invariant, engine-self-checked
  after every action: **`traySum(chips) + odd === stack`**.
- `Engine.dealTray(amount, chips)` spreads `TRAY_SHARE` (60%) of the
  amount in even-ish stacks across the low rungs and lets the **top chip
  absorb the rest**, so a deep stack grows the tall column and a rich
  seat reads as rich from across the felt. Counts are chosen per rung by
  searching outward from the wanted height for one whose remainder the
  *higher* rungs can still pay — that is what makes a tray land on the
  buy-in exactly on **any** ladder the host builds, not just the tidy
  ones. $20 deals 10 · 10 · 7 · 5 · 4.
- **`odd`** is loose cents. A three-way split of an odd pot leaves one,
  and no ladder can draw it, so the tray carries it as a number rather
  than pretending it's a chip.
- **Betting spends the tray, but chips never gate legality** —
  `representable` already does that at the betting line, so a payment
  cannot fail the rules. `trayPay` does what a table does: push in the
  biggest chips that fit, and when the last of it is smaller than
  anything you still hold, push one chip over and **take change back**.
  Breaking chips down in place looks equivalent and isn't — a greedy
  break strands you (a 50¢ split into two quarters can no longer pay 45¢
  on a ladder whose 20¢ chip it skipped). Both self-checked.
- `syncTrays` runs at **one** call site — `done()` inside `applyAction`,
  plus `createGame`. Every stack change in the engine funnels through it,
  so the tray can't drift. It *adjusts* rather than re-dealing, which is
  the point: your chips keep looking like your chips instead of
  re-composing under you every hand. A re-deal is the fallback when a
  tray genuinely can't make change.
- **The pot holds the chips that were pushed into it**, not a racking of
  its total. `g.potTray` is public and accumulates the *drop* between
  each tray before a sync and after it, in the same `syncTrays` pass.
  Drawing the pot as `dealTray(pot)` was a true statement about how much
  is in the middle and a false one about what is: four seats limping a
  20¢ blind put eight 10¢ chips in the middle, and racking 80¢ would have
  shown three dimes and two quarters.

  Two things keep it honest. Only **decreases** count — a tray that gained
  chips gained them from the cage (a buy-in, a rebuy) or from the pot (an
  award), and neither is money going in. And the composition is checked
  against the total on every sync: if they ever disagree — a rung gone
  negative because someone overpaid and took change out of a pot that
  didn't hold it, or a re-deal having thrown a tray's history away — the
  pot falls back to racking its total. Wrong-*looking* beats lying; the
  amount under the pile is the number of record either way.

  Nothing resets it explicitly. The next hand zeroes every `betHand`, so
  the total becomes 0, the check fails against the leftover chips, and
  the fallback deals an empty pot.

Rendering is one function, `chipStacks`, in two placements: one group per
denomination, each group one or more columns of edge-on chips. **On the
felt** a column holds 10 and spills into a neighbour, up to 3 columns,
with the `×N` label sitting where the fourth would have started — capped
groups read as "and more of these" rather than as a shorter stack, and
the tray wraps rather than shouldering into the seat beside it. **In the
hand panel** a column holds 6 and stops, because the rail is a readout,
not a comparison; the cash total **is** its heading — a label over your
own chips only said what the chips already say. Both his call, chat
2026-08-03.

Two rules keep a stack from *looking* wrong, both learned the hard way:

- `flex: none` runs all the way down the tray, over a `max-content`
  width. A tray short of room would otherwise shrink its groups, and flex
  spends that shortfall unevenly — the first groups hit their floor and
  the last ones absorb the rest, so the ladder appears to taper from
  white down to black. A chip is one size.
- **A tray grows sideways and never wraps.** Wrapping hid the wealth in a
  second row *and* made the seat taller, which moved everything under it.
  A rich seat now spills past the felt, which is the intended read.
- **Every denomination renders, even at zero**, and a tray reserves the
  height of a full column (`--pkside × 10`, or × 6 on the rail) with its
  stacks growing up from that baseline. Nothing below a tray moves as
  chips come and go, no tray shuffles sideways when a rung runs out, and
  the rail keeps saying what a chip is worth even when you hold none.
  The pot pile renders at zero for the same reason — its amount sits
  underneath it and must not move as the pot swells.
- **A column is one node, not one per chip**: a single layer tiling the
  band once per chip. N adjacent boxes each round to a whole device pixel
  independently, so at fractional zoom they disagree about their own
  width and the stack tapers again — one tiled background cannot disagree
  with itself. Sizes are whole **px**, not rem, for the same reason, and
  the sprite scales with plain smooth filtering (never
  `image-rendering: pixelated`, which is what made mahjong's identical
  tiles shimmer — a stack is nothing but identical tiles).

**Sprite swap point**: `assets/sprites/poker/chip-side-{1..5}.png`,
mahjong's probe-once idiom, templates from
`scripts/build-poker-chips.py`. The number is the chip's **rank**, not
its value — values are derived from the buy-in, but rank 1 is always the
smallest chip and always white, which is what makes the filenames stable
across every table. There is **no top-of-stack face sprite**: a face
capping a column of bands read as odd (his call, chat 2026-08-03), so a
stack is side views the whole way up. See that folder's README.

## Stepping away

Cash games are not tournaments: standing up should not have to mean
racking your chips. The `rejoin` row (shell-rendered, labelled
**Mid-game Join**, chips **Anyone / Rejoin / None**) is poker's single
control for everything about a table already in play — what leaving
costs you, and who may sit down after the cards are out.

| Mode | Leaving mid-game | Coming back | A stranger may… |
| --- | --- | --- | --- |
| **Anyone** | seat goes **away**, stack stays on the felt | you walk back in | take an away seat (inheriting the pile) **or** open a new one (`sitIn`) |
| **Rejoin** *(default)* | seat goes **away**, stack stays on the felt | only you: same token, or the same account from any device | nothing — the table is closed to newcomers |
| **None** | seat **cashes out** | spectate only | nothing |

The old separate **Seating** row (`open` / `lobby`) is gone: it was the
same axis wearing a second name, and two controls that could contradict
each other (a "lobby only" table at an `"anyone"` re-join) is a bug
waiting to be filed.

An away seat is not dealt in, holds its chips, and keeps its name, color
and token on the roster. `away` rides the seat view as a public boolean
and `you.away` tells the one person sitting out that the **Sit down**
pill is theirs. The **Stand up** pill re-words itself per mode through
the shell's `standCopy()` hook — "Cash out" only where that's true,
"Sit out" everywhere else — and **withdraws itself** (the hook returns
`false`) once you are already sitting out, where "Sit out" next to "Sit
down" was two pills arguing about the same seat. The exception is a
`"none"` table: there Stand up means CASH OUT, which is still a real
thing to do from a sat-out seat, so it stays.

Engine verbs: **`sitOut`** (fold out of the live hand, `away = true`,
stack untouched) and **`sitBack`** (`away = false`, `owesAnte = true`,
`waiting` if a hand is running, so you're dealt into the next one). They
sit beside
`concede`, which remains the permanent exit. The shared shell reaches
them through the `awayAction` / `adoptAction` spec keys
([games.md](games.md), "Away seats").

### Coming back costs an ante

A keep-your-stack sit-out would otherwise let you leave in early
position and return on the button, never paying a blind. The house rule:

> **Sitting back in costs one big blind, posted as an ante on your first
> hand back — unless you *are* the big blind that hand.**

`owesAnte` is set by `sitBack` and cleared by the deal. No missed-blind
ledger, no orbit counting: you sat out, you buy back in. The BB is
exempt because they're already posting it; the SB pays the ante *and*
their small blind, same as walking up to a live table.

The ante moves cents from `stack` into `betHand` but **never into
`betStreet`**, so it layers into the side pots correctly and buys no
call. Log line reads `… posts $X (ante)`; the event is
`{t:"blind", kind:"ante"}`.

### What the worker does with an away seat

`games/table-do.js` now carries the DO half — `AWAY_ACTION` /
`ADOPT_ACTION` and the `awaySeat(i)` helper, the same pair the mock
spells in lower case ([games.md](games.md), "Away seats"):

- **`concedeSeat` is not the only exit any more.** Mid-game `stand` and
  grace expiry both park the seat instead, and both **keep `token` and
  `uid`** on it. Every other exit path deletes both, and that deletion is
  exactly what made leaving permanent. A seat that went dark in the lobby
  is parked at Start too, rather than converted to a bot poker refuses to
  seat.
- **A kick still severs**, at every mode. Parking a kicked player leaves
  their token on the seat, so they walk straight back in — which makes
  the host's only remedy for a staller no remedy at all. They cash out
  into the standings.
- **uid reclaim is the point of the accounts tie-in.** The DO's join path
  tries token first, then scans for a seat with a matching `uid` whose
  token is disconnected — an away seat matches, which is what makes
  "leave on your laptop, come back on your phone" work. `SESSION_SECRET`
  must be set for any of it. None of this is reachable in the mock (no
  cookie, no `sessionUid`, no `uid` on seats), so **it can only be
  verified live**, like every other rejoin behavior.
- **Disconnect became a sit-out.** A drop opens the grace window as
  usual; expiry sends the seat **away** rather than conceding it (at
  `"none"`, it still cashes out). An away seat that drops opens no second
  window — nothing is waiting on it.
- **The table's lifetime bounds the promise.** `EXPIRE_MS` (1 h idle +
  empty) evaporates the table and every parked stack with it. "Your
  chips are waiting" is only true for that long — worth saying in the
  copy if it ever becomes visible.
- **Stats.** An away stretch is an absence, not a seat change, so the
  span stays **open** across `sitOut`/`sitBack`: a player who takes a
  break keeps attribution for their own session. Adoption of an away seat
  by a stranger is a real hand-over and closes it.

## Rules engine (engine.js)

Pure, `ctx = { rand, now }`, `createGame(opts, ctx)` /
`applyAction(game, action, ctx)` → `{ game, events }` | `{ error: {code} }`.
Engine player index === table seat index for the life of the table (the
mock compacts seats at Start; sit-ins append on both sides in lockstep).

Actions: `fold` `check` `call` `raise {to}` (betting; actor-checked) ·
`buyIn` (busted stacks) · `sitIn {seat}` (table-validated) · `voteEnd`
(toggle) · `endGame` (host-validated by the table) · `concede {seat}`
(table-injected on stand/kick) · `nextHand` · `timerExpire` (the
deadline: settles the interstitial, or checks/folds the actor).

Error codes beyond the shared set: `raise` (too small / capped),
`chips` (doesn't split into the denominations), `midjoin` (a `sitIn` at
a table that isn't `"anyone"`). Settings refusals: `blind`, `buyin`,
`chips`.

The hand loop: blinds → deal (two each, left of the button) → preflop
(UTG opens; heads-up the button is SB and opens; BB keeps the option) →
flop/turn/river with fresh betting each street → showdown, or fold-through.
All-in with no one left to act runs the board out. `handOver` is the
settlement interstitial, auto-advancing after `handOverSec` (a host
setting, 30s default; `nextHand` skips the wait).

The card reads top to bottom: the **board** the hands were made from,
then the winning line(s), then **every contender as a GRID** — roughly
square, capped at four across, the column count set by poker.js because a
shrink-to-fit card collapses CSS `auto-fit` to one column. Twelve rows
stacked ran the card off the bottom of the felt, which is what the grid
fixes. A mucked seat is on the grid with its two cards face DOWN: you can
see that four people went to the river without seeing what they had. The
footer is the two ends of a settled hand — **Reveal | ☐** on the left,
**Next hand** on the right (see "Showdown order"). Fewer than 2 dealable
stacks → `waiting` until a re-buy or sit-in.

Heads-up blind order is handled; the button walks to the next eligible
seat each hand. **Simplification, recorded:** there is no dead-button /
dead-blind rule — a seat that busts or joins can shift who posts, exactly
like a home game.

## Hidden information

Hole cards and the acting seat's options (`you.hole`, `you.options`,
`you.myVote`, `you.canBuyIn`, `you.away`) ride only each connection's
`you` — `you.away` is per-viewer purely so the **Sit down** pill has
one owner; the seat's own `away` flag is public. The deck
never leaves the table.

A live hand can also travel PRIVATELY, to seats that are out of the
hand — `you.shownToMe`, see "Showing a live hand" below.

Cards become public ONLY through `handOver.hands[]`, one row per seat
that was still in the pot at the end: `{seat, hole, name, shown}`. A hand
that mucked has `hole: null` and `name: null` — the cards are not merely
hidden from the UI, they are **not in the broadcast object**, which is
what makes the auto-muck real rather than cosmetic. Fold-through pots
start with every row unshown. Never widen these onto the broadcast
without updating this list (mahjong's rule, same reason).

### Showing a live hand ("Show To")

Mid-hand, cards can also travel privately. Two rules decide it, both his
(chat 2026-08-04): **anyone still holding cards may show**, and **only a
player out of the hand may be shown to** (folded, sitting out, busted,
waiting for the next deal). That second rule is the whole safety
argument — a seat that cannot act cannot act on what it sees, so this
can never move the betting.

The engine keeps only a seat list, `g.showTo[from] = [to, …]`, cleared
by `tryStartHand`; it lives on the game rather than in a message so a
reconnect lands on the same table everyone else is looking at. Turning
that list into cards is the **table's** job: `you.shownToMe` is built
inside the per-connection branch of `buildView` and carries
`{seat, hole}` only for the named seat. It is the one channel in this
game that hands a viewer a hand they don't own, so nothing may widen it.
Alongside it ride `you.showTargets` (the picker's contents, from the
engine's `showTargets`) and `you.showedTo` (who you've already shown, so
the picker can gray them).

The `showTo` **event is public and carries no cards** — the table sees
that a hand was shown and to whom, exactly as it would across a real
felt, which is also what makes a silent side-channel between two seats
impossible. The recipient additionally gets a toast.

On screen: a fifth pill in the action row, the only one **not** gated on
the turn being yours (the moment you want to show someone is almost
never your turn — they just folded, you just took it down); it opens a
checklist of eligible seats behind one Show, because showing can't be
taken back. The cards land on the felt as `.pk-peek`, an **absolutely
positioned** box over that seat's chips — a seat is centered on its own
anchor, so anything that added height would slide it (the flop jitter),
and every seat would have to reserve the space forever for the one hand
in fifty that uses it. It clears when the hand ends and the settlement
card takes over, so the two never draw the same cards at once.

### Showdown order

The engine tracks `g.aggr`, the last seat to bet or raise on the current
street (preflop that starts as the big blind — the forced bet is still a
bet; each new street resets it to null). At a showdown the walk starts
there, or at the first live seat left of the button if nobody bet, and
goes clockwise: **a seat shows only if it can beat everything already
face-up**, and everything else mucks. Ties show, because a chopped pot
needs both halves visible. On top of the walk, **every pot winner always
tables** — a short stack can take the main pot with the best hand while
losing the side pot, and a side-pot winner can be beaten by an all-in
they were never contesting.

Nothing is ever *forced* face-up beyond that. A mucked seat — including
the lone winner of a fold-through, who was never asked to show anything
— can table its hand with the **`reveal`** verb for as long as the
settlement card is up. `reveal` is your own seat only, idempotent, and
names the hand only when there were five board cards to read it against.
The client's "Reveal | ☐" checkbox is a **per-viewer localStorage
preference** (`deets-poker-auto-reveal`, default off) that sends the same
verb automatically once per hand — never a table setting, never on the
wire.

## The view (public fields)

`handNo dealer street board waiting blinds{sb,bb} pot players[] turn{seat}
handOver handOverAt votes{n,need,seats} transfers turnEndsAt
over{endedBy,standings,hands,results}` — per-player: `seat stack bought
inHand folded allIn out left waiting away owesAnte betStreet tray stats`.
Seat views additionally carry `away` (public, like `conceded`).

## Winnings — the transfer ledger

`g.transfers[from][to]` accumulates cents across the whole game: at every
settlement, each pot drains every NON-winner's contribution into the
winners' profits (award minus their own returned contribution), walked in
seat order, integer-exact. Within one pot layer every eligible seat
contributed the same amount, which is what makes the accounting exact —
the ledger is a **zero-sum mirror of every stack's net**, and the engine
self-checks hold it to that equality in cents, side pots included. The
matrix grows with sit-ins (`ensureLedger`) and rides the public view
(money is public at a poker table).

The **Winnings** felt popover renders it as the n×n grid: rows win from
columns, cell (i, j) = net cents seat i has taken off seat j, the leading
column each player's overall net, diagonal blanked. Sits FIRST, left of
**Log** — both are cities' board-popover kit (hover previews, click
pins), bottom-left of the felt. The Log popover carries the mechanical
hand log in cities' exact log dress; the players tile is roster only.

**The pill row is pinned over the felt and in FLOW in the cash-out.** The
felt never scrolls, so an overlay anchored to the tile's bottom-left
corner is exactly right there — it can't move the board. The cash-out
tile *does* scroll, and an absolutely positioned child of a scroll
container is pinned to the scrollport rather than to the content: the row
sat at the bottom of the first screenful and then rode up through the
standings, landing on top of the Winnings grid at twelve seats. So at
`over` `buildBoardPops(panel)` mounts the row inside the cash-out panel
as an ordinary flex item (`.pk-boardbtns--flow`), and the popovers anchor
to the row instead of to the tile — including dropping `.pk-bpop`'s
tile-width clamp, which in flow would measure the ROW and crush a 24rem
log pane to the width of two pills.

At `over` the grid comes out of the popover and lies flat in the
cash-out panel, so that pill slot carries **Repayment** instead —
`repayments()` in `poker.js`, pure and client-side over `over.standings`
(no wire or engine change; the nets it needs already ride the view).
The Winnings grid says who took money off whom, which is a terrible way
to pay it back — six players is up to fifteen hand-offs. Only the NETS
have to be honored, so it pairs the biggest debtor with the biggest
creditor and repeats: each pass zeroes at least one person, so N players
settle in **at most N−1 transfers**, in cents, no rounding. The true
minimum (spotting subsets that cancel exactly) is NP-hard; this greedy
pairing is the standard answer and is optimal whenever no such subset
exists.

## The cash-out lobby

Cities' `.cities-over` / mahjong's `.mj-over` skeleton, beat for beat —
`__head` (title left, hand count right, one baseline), the `endedBy`
line — `vote` and `attrition` only, since a host closing his own table
explains itself and gets no subtitle at all — a ranked `__reveal` whose
rank-1 row wears the winner border and
the three-pulse glow, then the panel's own Rematch pill. Where those two
games show superlative cards, poker shows the money: **bought in /
walked with / net** per seat, then the Winnings grid under it. The rows
are a CSS grid on one shared template rather than a `<table>`, because
a row has to stay a single box to carry the winner's border and glow.

## Page layout — the bento

Three tiles where cities keeps five: the **felt** (big — circular table,
seats around the rim with D/1/2 badges (all three wear the same dress —
see "Rotation" below), the
actor glowing through the shared timer ring when timed, board + pot
centered, the settlement card floating over, and the **Winnings + Log
popovers** on its bottom-left corner), the **players tile** (FULL
player cards in the cities-pstrip anatomy — accent edge, name + D/1/2
badges, state chip, stack + live bet in the money column — one tall
column over cities' dice+players+log slots; the tile's height is fixed
at every seat count, so the LIST scrolls under a pinned title once the
strips outgrow it), and the
**hand panel** (role — cities' play grid verbatim: "Your Hand" title
with the two cards at 1.5× in the left column, the Fold/Check/Call/Raise
pills top-right with their dictated hover lines as NATIVE TOOLTIPS only
(Show to LEADS that row — it is the one pill not gated on the turn, and
keeping it clear of Fold/Check/Call/Raise means nobody hits it by muscle
memory under a clock),
and the "Raise by" tray beneath them — slider + type-in speak in the
amount over the current bet, the wire still says raise-to. The tray is
always in the layout, ghosted when unarmed, so the panel never jitters —
cities' universal layout rule. The buy-in button appears in the card
slot when bust). Card faces are geometric placeholders in the `--pk*`
carve-out (felt, faces, backs); everything else rides the tokens, `gt-`
nodes untouched.

The big tile wears **three boxes**, toggled in `paint()`, because the
three things it holds want different ones:

| phase | box | why |
| --- | --- | --- |
| felt | flex, `overflow: visible` | a rich seat should spill past the edge; scrolling a poker table to find the chips is worse than the mess |
| cash-out | flex, `.is-scroll` | `.pk-cashout` is `align-self: flex-start` — it runs past the tile's height now that the Winnings grid is inline, and a centered flex item that overflows loses its top edge to the scroll. Because it scrolls, the pill row goes IN FLOW inside the panel here rather than pinned to the tile corner (see "Winnings") |
| lobby | block, `.is-scroll .is-lobby` | a **flex** scroll container drops its bottom padding once content overflows — that is what smushed the Start button into the panel edge |

Seat jitter has one cause worth remembering: a seat is centered on its
anchor (`translate(-50%, -50%)`), so its **height decides where it
sits**. Drop the bet pill when a street clears and the whole seat
re-centers, sliding the name and badges down half a pill — the "jitter"
on the flop. The tag and the bet pill are therefore always in the seat,
blanked with `visibility: hidden` rather than omitted.

**The lobby reserves the bento at its in-game size** — cities' rule
verbatim. The settings render into the big tile at its full `34rem`, and
the panel is kept short enough to fit it rather than the tile being grown
to fit the panel: that is why the chip and small-blind hints and the
separate Seating row are gone.

The other two tiles hold their in-game geometry from the lobby onward:

- The **role tile** carries a `min-height` sized from `--pkcardh` (big
  cards + title + the always-present raise tray), so the bento does not
  grow at Start.
- The **players tile** renders a lobby roster — the same `pk-pstrip`
  anatomy the game uses, filled from the SEAT list alone (there is no
  engine state yet): dot, name, HOST badge, and the table buy-in in the
  money column, with the tags row present-but-empty so the strip is the
  same height before and after Start. It fills in as people sit down.

The **chip ladder** drags to reorder (host only). A drop **divider** —
a 2px rule down the middle of the gap the chip would land in — tracks
which half of a token the pointer is over, so "before this one" and
"after that one" are distinguishable; the lifted chip dims to 0.4 while
it travels. Drop math converts the divider's position to an insertion
index and decrements it when the lift came from earlier in the list.

## Bots

Three tiers — **easy / normal / hard** — over one brain, the same shape
cities and mahjong use. Full treatment in [bots.md](bots.md); what's
poker-specific:

- **Host-added, never inherited.** No bot ever takes a seat somebody
  left: that seat goes away with its stack or cashes out (see "Stepping
  away"). The tiers decide how hard a seat somebody *chose* to fill
  plays, nothing else.
- **A busted bot re-buys.** Not a tier knob — without it a cash table
  empties one seat at a time and leaves the human alone at a `waiting`
  felt.
- **The bot may not read the table.** Unlike cities' and mahjong's, a
  poker bot's own action would leak a peek, so it sees only its own hole
  cards and the board. A self-check enforces it by re-asking on a clone
  with every other hand replaced ([bots.md](bots.md), "…except in
  poker"). **Never widen what `botStrength` reads.**
- **No bot votes to end** and none is ever seated automatically.

Two things the bot work turned up that are not about bots:

- **`minTo` is not always representable.** A short all-in is legal at any
  amount — the one exception to the chip rule — so `bet.current`, and the
  minimum raise built on it, can land on cents no ladder can pay. The
  engine correctly refuses that raise with `chips`. The bot now climbs to
  the next amount the chips make; **the client's raise slider has not
  been checked against this case** and may be able to offer a minimum
  that the engine will reject.
- The old dev bot's "call anything up to one big blind" is now `easy`'s
  `callBB`, and measurement says it is the single biggest leak a tier
  can have.

## Shared-shell changes this game required (all additive)

| Change | File | Why |
| --- | --- | --- |
| `cfg.mockDefault` | `games/table.js` | phase-1 mock without `?mock` (poker no longer sets it — the hook stays for the next game) |
| `S.standHover` → title on the mid-game Stand pill | `games/table.js` | "Cash out" |
| `standCopy()` re-words that pill per render | `games/table.js` | "Sit out" outside `"none"` |
| `awayAction` / `adoptAction` spec keys | `games/table-mock.js` | away seats (no live bots) |
| Seat-row controls all one size (`1.6em`/font-inherit) | `styles/table.css` | Add Bot was the outlier at `0.78rem` |
| `--gseat-6..11` fallbacks + `.pk` root | `styles/table.css` | 12-seat tables |

`table-do.js` picked up one more in phase 2: **`AWAY_ACTION` /
`ADOPT_ACTION`** (additive, a no-op for a game that defines neither, so
cities/mahjong/ships behave exactly as before — but they carry vendored
copies and should be re-vendored when each is next touched). The rest of
the worker-side halves — `sitIn`, `sitBack`, `endGame` — are poker's own,
in `../DeetsPoker/src/index.js`.

## Motion

Nothing here rides the wire — every beat is derived from the typed
events the log already consumes, and the tray already rides the public
view, so the felt animates real chips without a protocol change.

**CSS one-shots** (`poker.css`, "motion"). The felt is rebuilt on every
paint — `paint()` clears `BIG` and re-renders it — so a `transition` on
a felt node can never fire (there is no previous value to move from) and
an `@keyframes` fires on *every* render, including renders the street
didn't cause. That is why the one-shots are gated on a diff in
`poker.js` rather than on their class alone:

| Beat | Class | Gate |
| --- | --- | --- |
| a board card arriving | `.pk-card.is-dealt` | `seenBoard` — cards past what the last paint drew, staggered by `DEAL_STEP` |
| the actor's ring breathing | `.pk-seat.is-actor` | none needed (infinite) |
| the settlement card easing up | `.pk-over.is-in` | `seenOverAt` — once per `handOverAt` |
| the winning line pulsing | `.pk-over__line.is-win` | rides `.is-in` |
| a chip landing | `.pk-catch` | the flight engine sets it |

**Chip and card flights** ride `games/flights.js` (see games.md,
"Fly-ins") — collected in `collectFlight`, flushed in `postRender`:

| Event | Flight |
| --- | --- |
| `hand` | two rounds of card backs from the **deck**, one per seat per round |
| `blind`, `call` | that seat's chips → its bet spot |
| `raise` | the same, for `e.to` **minus the pre-merge bet** |
| `street` | every live bet spot → the pot, at once; plus one burn, deck → burn pile |
| `win` | the pot → the winner (one flight per award, so a split halves the middle) |
| `fold` | two backs → the burn pile |
| `cashout` | the stack → that seat's roster line |

**A flying chip is the same object as a chip in a tray** — same rung,
same hex, same sprite, via the one `chipArt` helper, and `.pk-flychip`
is deliberately painted with the identical background rule as
`.pk-tray__col`. `chipRungs` breaks an amount down high → low so a big
bet leads with its big chips. Money moving as anonymous discs made the
felt read as a progress bar.

### The deck and the burn pile

Two piles, one object (`cardPile`), both client-side theater — neither
rides the wire. They **flank the dealt cards**: the deck on the left,
where a hand comes from, the burn on the right, where dead cards go, so
the felt reads left to right in the order the cards actually move. Both
sit on the board's own line, offset by `--pkboardhalf` (half the dealt
row plus a gap, derived from the card box so they track the board's
width rather than guessing at it).

- **The deck.** Its depth (`DECK_DEPTH`) is a look, not a count;
  tracking 52 minus what has been dealt would be a second source of
  truth for something the engine doesn't publish and nobody reads off
  the felt.
- **The burn pile** collects both kinds of dead card: one burn per
  street, and every mucked hand. Its depth is **derived** (`burnDepth`:
  `board.length - 2` once the flop is out, plus two per folded player),
  never accumulated — a reconnect mid-hand has to land on the same pile
  as everyone else, and a counter would start from zero.

**Both piles square up** and grow straight upward, like a deck someone
has tapped level. The burn was fanned sideways at first — a heap of dead
cards nobody tidies — but sitting next to the deck it read as a
different-shaped *object* rather than as a second pile, so he squared it
(chat 2026-08-04). `cardPile`'s `dx` still fans a pile; both callers
pass 0.

A pile is one card box with its cards absolutely stacked inside it and
offset by JS, so depth costs no size — both piles are pinned by their
box, and a box that grew with its contents would crawl off the spot it
marks. There is **no ghost slot** under them: a dashed outline behind the
offset stack made the pile's silhouette taller than one card, which read
as the pile being drawn at a different size than the board. An empty pile
draws nothing and still measures, which is all a flight aimed at it
needs.

> Card sizes are otherwise identical everywhere — one `--pkcardw` ×
> `--pkcardh` box under a global `box-sizing: border-box`, so the slot's
> 2px dashed border and the card's 1px solid one occupy the same space.
> The one real discrepancy was the back sprite: at the default
> `background-origin: padding-box` it landed a pixel short on each side
> and left a hairline of felt around every back. `.is-art` sets
> `border-box`.

Two things are load-bearing:

- **`beforeMerge` snapshots `betStreet` and `stack` per seat.** Events
  are handled *after* the broadcast merges, so a raise's `to` (the total
  owed this street) and the street sweep's per-seat bets are both gone
  by the time the flight is collected.
- **Fallback points are BARE** — coordinates with no `el`, so the catch
  bump can't reach them. The bump is a `scale`, and `.pk-seat` carries
  the `translate(-50%, -50%)` that pins it to its rim anchor; a scale
  would replace that transform and fling the seat into the corner.

A bust deliberately has **no** flight: those chips went to the winner
and the `win` above already flew them.

## Deferred / open

- Bet piles as chips — the bet spot is still the plain `20¢` text pill.
  It is now a flight *target* (chips land on it and it bumps), but it
  doesn't draw the pile itself.
- The `handOverSec` dwell is a LOBBY setting only — like every other
  table setting, it can't be re-tuned once the game starts. The host's
  mid-game lever is the Next hand button.
- **The worker's two secrets.** `SESSION_SECRET` and `INGEST_SECRET` are
  not set on `deets-poker` yet (`npx wrangler secret put NAME`, the same
  values DeetsAccounts holds). Without the first, every seat is a guest
  and cross-device return — the point of away seats — doesn't work.
  Without the second, a finished game waits in the DO's outbox.
- The profile page prints poker's money counters only once it grows a
  cents formatter — `net`, `bought` and `biggest_pot` land in the
  database now but carry no label yet ([stats.md](stats.md)).
- The copy pass is **done** (chat 2026-08-03): 79 placeholders cleared in
  one pass, so every string in `poker/strings.js` is now his and off
  limits to reword. Only the four `repay*` strings still carry `[ph]`,
  and they belong to work in flight elsewhere.
