# The design language — how a Deets game gets designed

[games.md](games.md) is the **contract**: the wire protocol, the shell
hooks, the change radius. Nothing in it may be bent. This document is the
**precedent**: the decisions Aditya has already made across DeetsCities,
DeetsMahjong, and DeetsPoker, restated as defaults with their reasons, so
the next game inherits them instead of re-deriving them in a design
session. Everything here may be bent — **by asking Aditya**, and the
deviation gets recorded here, dated, like every other call.

Distilled from all three games in chat 2026-08-03, the same session that
wrote poker's build-style rules. When this doc and a per-game doc
disagree, the per-game doc is the record of what that game actually does;
this doc is what the *next* game should assume.

**The two tests.** A design sketched from this doc should pass both:

- **The minimum test (DeetsFour, connect four).** A game with no hidden
  information and one action per turn should come out *smaller* than its
  siblings — surfaces whose reason doesn't apply get dropped, not
  ghost-rendered out of habit.
- **The maximum test (a heavy asymmetric game).** A game with more hidden
  state, more phases, or asymmetric seats should find its extra weight
  landing in the surfaces built to hold it — and where it lands outside
  every precedent below, the answer is **stop and design it with
  Aditya**, not force the nearest branch to fit.

---

## The questionnaire — settle these in chat before code

Every game so far opened with a dated "Decisions already made" list
answering the same questions. Ask them in order; the precedents below
answer most of them by default, so the conversation is about the
deviations.

1. **Seat count** — fixed by the rules, or a capacity setting? (Mahjong:
   exactly 4, no knob. Cities: 3–6. Poker: 2–12.) A rules-fixed count
   offers no setting.
2. **Bots** — real players, dev tools, or absent? This one answer decides
   the whole rejoin posture (see "Decision trees").
3. **Hidden information** — the exact list, written down as hard
   invariants before the wire exists. "None" is a valid answer and still
   gets its section in the doc.
4. **How a game ends** — win condition, match length, and every door out
   (mahjong's `winds`, cities' 10 VP, poker's vote/host-end/stand).
5. **Table settings** — run every candidate through the settings filter
   below; expect most to fail it.
6. **Timer semantics** — what expiry auto-resolves to, per obligation
   (always game-specific: cities auto-rolls, mahjong auto-discards and
   even auto-wins, poker checks-or-folds).
7. **The typed events** — they drive the log, the fly-ins, and any
   client ledger, so the list is worth sketching early.
8. **The art carve-out** — which literals the `--<g>*` palette owns, and
   what stays on tokens (see "Decision trees" for the seat-color line).
9. **Which sibling's bento shape it takes** — and what the big tile holds
   in each phase.
10. **Flavor and identity** — the name, what the log calls things, any
    twist on the vanilla rules. This one is never derivable; it's the
    heart of the ten-minute chat.

---

## Why each piece exists — form follows information

Do not start from "a game has these tiles." Start from what kind of
information the game produces; each surface below exists to hold one
kind, and its size in a new game is proportional to how much of that
kind the game has. A surface whose reason doesn't apply is dropped.

- **The big tile is the shared world** — the one thing everyone is
  looking at (board, felt, table). Lobby settings render into it at its
  in-game size; game over swaps in the stats reveal; contents change,
  the tile never moves. Fixed height in CSS (`clamp()`), contents
  meet-fit or scroll internally.
- **The right rail is public per-seat status**, players above log. A
  tile earns a rail slot only when the game produces a public number
  that must stay visible (cities' dice, mahjong's wall count). Poker
  proved the 3-tile bento: no dice-like concept, no fourth tile.
- **The role tile holds your hidden state and your controls.** Its value
  is proportional to how much "you" the game has. Poker: two cards and
  four pills — modest. Mahjong: the whole rack — dominant. A game with
  no hidden state collapses it to a controls strip, and the honest bento
  is two tiles. Never keep a hand area because the siblings have one.
- **Overlays dock over the big tile's right edge** for anything that
  interrupts or negotiates (cities' trade hub, mahjong's claim window —
  the same dock repurposed). They float; they never push.
- **The log is the mechanical record** — terse Claude-authored lines
  rendered from typed events, never prose over the wire. Every game has
  one; a second pane on its rail (cities' Deck) exists only when the
  game has a public pool worth counting.
- **Fly-ins are legibility, not decoration** — they exist so state
  changes read at a glance across the table, which is why they derive
  from the same typed events as the log and cost nothing to drop under
  `reduceMotion`. If a movement matters, it flies; if it flies, the log
  also says it.
- **Settings exist to encode variance, not to expose the rules.** See
  the filter below.
- **Strings exist so Aditya's voice is the game's voice.** The `[ph]`
  convention exists **so he reviews every word once — not once per
  game**. Every consequence in the `[ph]` decision tree below follows
  from that sentence.

---

## The pattern index — game concept → precedent

The cross-game mappings that die with a session. Before designing a
mechanism, check whether a sibling already built it wearing different
art.

| The new game needs… | The precedent | Where |
| --- | --- | --- |
| Simultaneous hidden commitment (all seats answer in secret, then resolve) | mahjong's claim window: public `waiting`, per-seat options on `you`, resolve when all answer, capped timer | mahjong.md, "Claim windows" |
| An auction / sequential bidding | the claim window's shape + poker's betting line (actor-checked `raise {to}`) | mahjong.md, poker.md |
| Offers, deals, negotiation | cities' trade hub: offers are **state, not notifications** — they persist until answered, die at phase end, and an incoming one auto-opens the dock | cities.md, "Trade overlay" |
| Different clocks for different phases | ships' `cfg.timerBudget()` | games.md, "Teams" |
| A game bots can't credibly play | poker's whole posture: empty `BOT_TIER_LIST`, away seats, `awayAction`/`adoptAction`, `standCopy()` | poker.md, "Stepping away" |
| A match of several games with a running score | mahjong's `winds` + its `handOver` settlement interstitial (auto-advancing) | mahjong.md |
| Hover-teach on the board | cities: native `<title>` for facts, ghost piece previews in seat color for placements, overlay badges that never reflow | cities.md, "Big tile" |
| Board-corner popovers (hover previews, click pins) | the cities/poker bpop kit — third user promotes it into the shell | games.md, "Known duplication" |
| A derived display count that must survive mid-game joins | **derive, never accumulate** — poker's burn-pile depth, cities' `dice` histogram and `turn.n` riding the view | poker.md, cities.md |
| One-shot animations on a repainted surface | the `seen` diff-gate: paint() rebuilds the DOM, so keyframes fire on a JS diff, never on a class alone | poker.md, "Motion" |
| In-progress typing that broadcasts must not wipe | `ui.*` drafts (cities' `botDraft`, poker's `chipDrafts`) | cities.md, poker.md |
| A count that should land with its chip, not before | the count-lags-the-chip hold (`pendingHand`), registered pre-paint, released by `onLand`/`onAbort` | cities.md, "Fly-ins" |
| Settings that imply each other | poker's cascade: derive each stage until the host overrides it, dirty flags, `reset` link as the only mark, validate the candidate ONCE | poker.md, "The settings cascade" |
| Per-viewer cosmetics (art decks, hand order) | mahjong: localStorage, never on the wire — no host picks legibility for anyone else | mahjong.md, "Art", "Role tile" |

---

## Decision trees

### Bots decide the rejoin posture

One question — **could a bot credibly hold a seat mid-game?** — and
everything downstream follows:

- **Yes** (cities, mahjong): the brain lives in `engine.js`, tiers in
  `BOT_TIER_LIST`, grace expiry converts the seat, `rejoinModes` defaults
  to `["anyone", "rejoin"]` (offer `"none"` only if the engine speaks
  `concede`). Tuning is measured, not guessed — [bots.md](bots.md).
- **No** (poker): no bot ever *inherits* a seat, and the rejoin modes
  decide what *leaving costs* instead — away seats via
  `awayAction`/`adoptAction`, the pill re-worded per mode through
  `standCopy()`. This is orthogonal to whether bots play at all: poker's
  bots are first-class host-added opponents with a full `BOT_TIER_LIST`;
  the "No" only means a seat somebody left is never a bot's to catch.
- **Sort of** — a game where a bot could shuffle through the motions but
  would betray a teammate or an alliance — is **new territory**. Ask.

### Seat colors vs. the carve-out

**Pieces belong to players; boards belong to the game.** Anything on the
board that *is* a player's — discs, roads, meld accents, bet pills —
rides `--gseat` through `TBL.seatAccent`, because difficulty tiers and
seat colors are public for the same reason: you should know what you're
sitting across from, in the color they picked. The carve-out (`--<g>*`
literals) is only the game's own material: terrain, felt, tile faces,
card backs. A game whose factions have canonical identities (an
asymmetric game where a seat *is* green) collides with this line — new
territory, ask.

### The settings filter

A candidate becomes a table setting only if it is one of:

1. **Match length** (winds, best-of, max turns);
2. **Pace** (`timerSec`; per-phase budgets via `timerBudget` when one
   number can't be honest);
3. **The rejoin policy** (the shared row, labelled in the game's words);
4. **A variant the game's real-world community actually plays** (min
   faan, faan cap, min raise, capacity where the rules allow a range).

Everything else is the rules, and the rules are not toggles: mahjong's
flowers are locked in, cities' dice are pure random, its house rules were
deferred rather than shipped as rows. Two more clauses from poker:
settings that derive from each other **cascade with dirty flags** rather
than sitting as independent knobs, and two settings that can contradict
each other **merge into one** (the Seating row died for saying what
Mid-game Join already said). Defaults are the most standard community
ruleset.

### `[ph]` — when a string doesn't need the prefix

The convention exists so Aditya reviews every word **once**. Therefore:

- A string carried **verbatim** from a sibling's handwritten pass lands
  un-prefixed, under a section comment naming the source — he already
  approved those exact words.
- A string *adapted* from a sibling — same shape, new game's nouns — is
  authorship and arrives as `[ph]` again.
- Single-character labels (badge letters) and strings he dictates in
  chat land un-prefixed, provenance-marked.
- Mechanical log lines are Claude-authored by design and never touch
  `strings.js` as prose.
- Everything else arrives as `[ph]`, and nothing carrying `[ph]` ships.

An un-prefixed string must always be traceable to his pass or a named
sibling's. (The shell-facing strings — Leave, Invite, Sit down, the
timer labels — are re-declared per game today; a shell-owned common
strings file is the eventual promotion, and carry-verbatim is the bridge
until then.)

---

## The jitter doctrine — named techniques

"No piece may resize or offset another, including across phase
transitions" is the law ([games.md](games.md)); these are the tools that
enforce it, each learned in a specific game:

- **Ghost reservation** — the element is laid out at full size with
  `visibility: hidden` (cities' `.is-ghost`: the tray gauge, the dev-card
  row; poker's raise tray, bet pills, empty chip rungs). The default tool.
- **Fixed-height scrollers** — the tile is sized in CSS or measured once
  (`fitLog`), and over-length content scrolls inside on the themed
  scrollbar. Measure synchronously at the end of `render()` — rAF
  throttles in background tabs.
- **Reserved lines** — a caption or hint row keeps its height while
  empty (the dice caption, the timer box riding along from the lobby).
- **Absolute overlays** — anything transient floats (popovers, trade
  hub, settlement cards); anchored piles are one node whose depth is
  drawn inside it, so depth costs no size.
- **Centered elements own their height** — a `translate(-50%,-50%)` node
  re-centers when its height changes, so its optional children are
  blanked, never omitted (poker's seat tag and bet pill).
- **The lobby reserves the in-game geometry** — settings fit the tile at
  its full size, rosters render at in-game strip height with empty rows,
  so Start fills numbers in instead of reflowing.
- **One node per repeated visual** — a chip column is one tiled
  background, whole-px sizes, smooth filtering; N adjacent boxes round
  their own widths independently and taper at fractional zoom
  (`image-rendering: pixelated` shimmers on identical tiles — mahjong
  and poker both paid for this one).

---

## Build order — mock-first is the default

Poker proved the phase-1 path and it is now doctrine for a new game:

1. **Engine first**, with self-checks growing alongside the rules
   (`node <game>/engine.js`; cities holds 69 assertions, poker 94, plus
   invariants checked after every action — conservation, zero-sum).
2. **The mock spec** (`transport-mock.js` on `table-mock.js`) — the view,
   the settings, the extra verbs. It IS the worker design; write it as
   the DO subclass you'll vendor into later.
3. **The UI against the mock**, `mockDefault: true` in the shell config —
   the whole tab ships with **no worker repo at all**. When
   `../Deets<Game>` deploys, delete the flag and the game joins the
   transports-default-to-prod rule.
4. **Motion last** — flights and one-shots are derived theater over a
   state the DOM already carries, which is only true if the state came
   first.
5. **The worker is phase 2**, shaped in advance: engine as the contract
   file, the mock spec hook-for-hook, a "Still to build in the worker"
   list kept honestly in the per-game doc (poker.md's is the template).

What a game actually authors: the engine, the UI file, the mock spec,
the strings, its CSS, its doc. Everything else is the shared foundation —
if you're writing lobby, identity, timers, or reconnect code, you're in
the wrong file ([games.md](games.md), "Change radius").

---

## The per-game doc

Each game's `docs/<game>.md` follows the shape the three converged on —
**Decisions already made (dated) → Architecture → Rules engine → State &
wire (with the hidden-info hard list) → Page layout / bento → Worker
details → State of the tab → Open questions** — and the house voice:

- Decisions carry their owner and date ("his call, chat 2026-08-03").
- Simplifications are **recorded**, not hidden ("Simplification,
  recorded: there is no dead-button rule").
- Failures are kept — "bit us in 6-player games" is why the rule exists,
  and deleting the story deletes the reason.
- "State of the tab" stays honest: built, partly built, not built,
  Aditya's passes outstanding.
- The doc is written as the spec first, then edited to match what
  shipped — it is both the contract and the running record.

## Build style — mirror the siblings before inventing

How a new game's UI stays indistinguishable from the ones beside it.
Applied verbatim while building DeetsPoker (chat 2026-08-03); the
default for every game after it.

- **Copy a sibling's geometry, not its spirit.** When poker needed a
  players tile, a hand/controls panel, or board popovers, the answer was
  cities' actual rules — the pstrip card anatomy, the `1fr 1fr` play
  grid with actions `justify-content: flex-end`, the board-popover kit
  (pill row bottom-left, absolute panels, hover previews / click pins /
  150ms grace), the log list's exact font, gap, and last-line highlight.
  Open the sibling's CSS and take the numbers; don't approximate them.
- **Control glosses ride native tooltips** (`title=`), not visible hint
  lines. A visible line is a layout liability and a second copy of the
  same words.
- **Same-shaped data gets the sibling's presentation.** Timer chips,
  custom-value boxes (`gt-chip--num`), choice rows, seat dots, accent
  edges: if the shell or a sibling already renders the concept, a new
  game re-uses the pattern (ideally the shell's own helper) rather than
  designing a variant.
- **No meta line under the bar** (cities, Aditya's call): the game state
  says everything a status line would; transient notices ride the toast
  host.
- **Hover teaches, click pins** — facts on native titles, previews on
  hover, a pin that survives re-renders and dies on Esc/outside-click.
- **Art ships as geometric placeholders** with probe-once sprite swap
  points at stable filenames, a template generator script per art family
  (`scripts/build-mahjong-tiles.py`, `build-poker-chips.py`), and a
  README in the sprites folder. His art drops in by landing a file.

---

## The promotion pass — how this doc stays alive

At the end of each game's build (real or design-exercise), every
decision made during it either **matches this doc** — cite the section
in the per-game doc — or **amends it**: add the new precedent here,
dated, the way poker's build added the build-style rules. A decision
that had to be made from scratch twice is a section this doc is missing.

Known edges, named so nobody force-fits them (all three surfaced by
design exercises 2026-08-03; King of the Coop will hit the first for
real):

- **Asymmetric seats** — every existing game has interchangeable seats;
  faction picks, per-faction powers, and faction-canonical colors are
  all undesigned.
- **Negotiation / chat** — no game has chat; structured offers (the
  trade-hub pattern) are the closest existing tool.
- **Phase-structured rounds** — a turn containing many ordered phases
  with different actors is a bigger state machine than any shipped
  engine; `timerBudget` covers the clocks, nothing yet covers the shape.
