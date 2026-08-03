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
../DeetsPoker/           the worker repo — DOES NOT EXIST YET (phase 2)
```

`node poker/engine.js` runs the engine's self-checks (94 at last count).

## Build phases

**Phase 1 (now): mock-first.** There is no worker repo, so the page runs
the mock WITHOUT `?mock` — the `mockDefault: true` flag in poker.js's
shell config (a small shared-shell addition). When `../DeetsPoker`
deploys at `poker-api.deets.solutions`, delete that flag and poker joins
the transports-default-to-prod rule. Everything the worker will need is
already shaped for vendoring: `engine.js` is the contract file, the mock
spec is the DO subclass hook-for-hook.

## The decisions (chat 2026-08-03)

- **Money is integer cents; chips are real at the betting line.** Every
  buy-in, blind, and raise-to amount must be composable from the table's
  chip denominations (`Engine.representable`, real coin-change — greedy
  fails on 10/25). The ONE exception: a full all-in is always legal (your
  last chips are whatever they are). Stacks are plain cent totals; how a
  stack would be drawn as chips is display-only (`Engine.chipBreak`).
- **Chip ladder**: default white 10¢ < red 20¢ < green 25¢ < blue 50¢ <
  black $1. Host-editable values in the lobby, and **drag to reorder** —
  no affordance by design (his call, chat 2026-08-03); the order is the
  host's to mean something by and the wire keeps it verbatim (the engine
  only reads the values). On-felt chip ART is still deferred — bets and
  stacks render as plain amounts.
- **Blinds**: one `bigBlind` setting (default 20¢); the small blind is
  half, so the big blind must be even and BOTH halves must split into the
  chips — refused with the `blind` code, surfaced as a red toast. Blinds
  post automatically.
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
- **No bots, ever, in live play.** `rejoin` is locked to `"none"` (the
  shell hides the one-mode row): standing, a mid-game kick, and grace
  expiry all **concede = cash out** — fold out of the hand, freeze the
  stack, sever the seat. **Disconnects auto-fold** (phase-2 worker rule:
  no grace-window bot takeover; the seat folds each hand until the player
  returns or the host kicks). The mock keeps host-added **dev bots** so a
  solo lobby can watch hands play out — see "Bots" below.
- **Seating** setting: `open` (default — anyone may sit down mid-game at
  the set buy-in, dealt in next hand) or `lobby` (only Start's roster
  plays). Open-seat sit-in is the poker-only `sitIn` verb: a NEW seat
  appended mid-game, which the core's adopt-a-bot `sit` can't express.
- **Busting**: stack 0 marks you out; a **Buy in** button appears in the
  hand panel where your cards were, re-buys at the table buy-in, and
  deals you into the next hand. `bought` accumulates for the cash-out
  math.
- **Ending a game** (three doors, all landing in the cash-out lobby):
  **Stand up** (toolbar, two-step, hover "Cash out") cashes *you* out;
  **Vote to end** — a strict majority of live seats flips the table to
  `over`; **End game** — the host's two-step pill, no vote needed. An
  ending mid-hand cancels the hand: every live bet walks home before the
  math. The cash-out lobby ranks by net (stack − bought), host gets
  Rematch.
- **12 seats vs six presets**: `--gseat-6..11` fallbacks were added to
  `styles/table.css` (empty-seat dots), and seats past the presets get a
  **random clash-free hex** — the mock assigns one on mid-game sit-in;
  for lobby sits poker.js auto-recolors its own seat when the assigned
  color clashes (one attempt per clash; profile colors get their shot
  first via the shell's own seeding). Known gap: two host-added dev bots
  past seat six can still share a preset — dev-only, lives with it.

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
`chips` (doesn't split into the denominations). Settings refusals:
`blind`, `buyin`, `chips`, `seating`.

The hand loop: blinds → deal (two each, left of the button) → preflop
(UTG opens; heads-up the button is SB and opens; BB keeps the option) →
flop/turn/river with fresh betting each street → showdown, or fold-through.
All-in with no one left to act runs the board out. `handOver` is the
settlement interstitial (reveal at showdown only), auto-advancing after
6s (`nextHand` skips the wait). Fewer than 2 dealable stacks → `waiting`
until a re-buy or sit-in.

Heads-up blind order is handled; the button walks to the next eligible
seat each hand. **Simplification, recorded:** there is no dead-button /
dead-blind rule — a seat that busts or joins can shift who posts, exactly
like a home game.

## Hidden information

Hole cards and the acting seat's options (`you.hole`, `you.options`,
`you.myVote`, `you.canBuyIn`) ride only each connection's `you`. The deck
never leaves the table. Reveals become public ONLY via `handOver.reveal`
(showdown). Fold-through pots reveal nothing. Never widen these onto the
broadcast without updating this list (mahjong's rule, same reason).

## The view (public fields)

`handNo dealer street board waiting blinds{sb,bb} pot players[] turn{seat}
handOver handOverAt votes{n,need,seats} transfers turnEndsAt
over{endedBy,standings,hands,results}` — per-player: `seat stack bought
inHand folded allIn out left waiting betStreet stats`.

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

## Page layout — the bento

Three tiles where cities keeps five: the **felt** (big — circular table,
dealer seat at 12 o'clock, seats around the rim with D/1/2 badges, the
actor glowing through the shared timer ring when timed, board + pot
centered, the settlement card floating over, and the **Winnings + Log
popovers** on its bottom-left corner), the **players tile** (FULL
player cards in the cities-pstrip anatomy — accent edge, name + D/1/2
badges, state chip, stack + live bet in the money column — one tall
column over cities' dice+players+log slots), and the
**hand panel** (role — cities' play grid verbatim: "Your Hand" title
with the two cards at 1.5× in the left column, the Fold/Check/Call/Raise
pills top-right with their dictated hover lines as NATIVE TOOLTIPS only,
and the "Raise by" tray beneath them — slider + type-in speak in the
amount over the current bet, the wire still says raise-to. The tray is
always in the layout, ghosted when unarmed, so the panel never jitters —
cities' universal layout rule. The buy-in button appears in the card
slot when bust). Card faces are geometric placeholders in the `--pk*`
carve-out (felt, faces, backs); everything else rides the tokens, `gt-`
nodes untouched.

## Bots (dev-only)

`BOT_TIER_LIST` is **empty** — no tiers, no picker, and the live game
philosophy is no bots at all. `botAct` exists for the mock's host-added
dev bots: check when free, complete a call ≤ one big blind, fold to
anything more; never raises, votes, or re-buys. That's one notch above
the timeout policy (which is strict check-or-fold) so solo review reaches
showdowns. If Aditya wants the Add Bot pill gone from poker's lobby
before the worker ships, that's a one-flag shell change — say the word.

## Shared-shell changes this game required (all additive)

| Change | File | Why |
| --- | --- | --- |
| `cfg.mockDefault` | `games/table.js` | phase-1 mock without `?mock` |
| `S.standHover` → title on the mid-game Stand pill | `games/table.js` | "Cash out" |
| single-mode `rejoinModes` renders no row | `games/table.js` | poker locks `"none"` |
| `--gseat-6..11` fallbacks + `.pk` root | `styles/table.css` | 12-seat tables |

`table-do.js` is untouched — the worker-side halves of these (sitIn,
endGame, concede-as-cashout, auto-fold-on-disconnect) are phase-2 work in
the DO subclass, shaped in transport-mock.js already.

## Deferred / open

- Chip stack ART on the felt (his call once the scaffold is reviewed);
  bet chips sweeping into the pot; the chip-ladder drag-reorder.
- Muck/show choices at showdown (v1 reveals every live hand).
- The worker repo + stats hooks (`poker_seats` counters, results POST) —
  [stats.md](stats.md) when phase 2 starts.
- The lobby copy pass: everything but the dictated lines is `[ph]`.
