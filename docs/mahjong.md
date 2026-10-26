---
status: live
sources: [mahjong/engine.js, mahjong/mahjong.js, mahjong/mahjong.css, mahjong/transport-mock.js, scripts/build-mahjong-tiles.py, styles/skin.css]
updated: 2026-10-26
---
# DeetsMahjong — the Hong Kong mahjong tab

> **The shared half lives in [games.md](games.md)** — the wire protocol,
> the table shell (`games/table.js`), the Durable Object base
> (`games/table-do.js`), seat colors, and the conventions every game
> inherits. This document covers only what makes DeetsMahjong itself.

Four-seat Hong Kong Old Style mahjong at `/mahjong`, built on the
DeetsCities playbook: a pure rules engine, a mock transport that speaks
the real wire protocol, a bento page, and a Cloudflare Worker
(sibling repo `../DeetsMahjong`, `mahjong-api.deets.solutions`) that
vendors the engine verbatim. **The worker is built and deployed, and
`transport.js` defaults to it** — the mock is now a dev tool behind
`?mock`, and its disconnect semantics diverge sharply from production
(see "Disconnects" below). Read
[architecture.md](architecture.md) for site-wide conventions and
[cities.md](cities.md) for the patterns this tab copies deliberately.

## Decisions already made (chat, 2026-07-23)

- **Hong Kong Old Style, locked to exactly 4 players.** No 3-player
  variant, no capacity setting.
- **Flowers are in** (8 bonus tiles, replacement draws, flower faan).
- **Minimum faan is a host table setting**: quick picks 0 / 1 / 3
  (default **3**) plus a custom text box (0–13).
- **Faan cap is fixed at 13** (the engine's default). It was a host
  setting (8 / 10 / 13) until 2026-10-25, when he dropped the row as
  never used; `capFaan` stays in the engine and worker settings, so no
  re-vendor. Limit hands score the cap outright.
- **Beginner (the chick), his design 2026-10-25.** A per-seat flag: a
  beginner wins at **0 faan** (chicken hands count) while everyone else
  keeps the table minimum — `Engine.minFaanFor(g, seat)`, the one gate
  `winCheck` reads. Human seats only (bots never). Every human seat in
  the lobby shows the chick (outlined off, filled on); the host may flip
  any seat and a player their own — a casual table, friends moderate.
  Lobby only: `setBeginner {seat, on}` (an `extraCommand`) sets
  `seat.beginner`, views carry `beginner: true`, and Start stamps the
  flags into `settings.beginners` in seat order. In play a static chick
  rides the beginner's Players strip and seat zone. In the lobby the chick
  is boxed like a toolbar pill and sits in a column left of HOST / ✕: the
  shell's `seatExtra` hook, with the trailing controls in one
  `.gt-seat__tail` the shell equalizes across rows. A seat dealt in as a
  bot at Start drops its flag. The worker port is written but **not yet
  deployed** (docs/HANDOFF.md).
- **Settlement is HK-classic half-spread**, integer-doubled so no
  half-points exist: with `v = 2^min(faan, cap)` chips,
  - win by discard → the discarder pays `2v`, the other two pay `v`
    each (winner +4v);
  - self-draw → all three pay `2v` (winner +6v).
  Scores are chips on a zero-sum ledger, not money.
- **Match length is a host setting** (`winds`): one hand (`0` — a single
  settled hand, no dealer repeat), one wind (`1`, default — a full East
  round) or four winds (`4`). In the wind modes the dealer repeats on a
  dealer win or an exhaustive draw, per HK rules, so a round is
  at-least-four hands.
- **Dice are ceremonial AND structural**: every player rolls two dice
  for seating (highest deals as East; ties re-roll among the tied), and
  the dealer rolls three dice to break the wall before each deal. Both
  ride the cities dice-tumble animation.
- **Turn timer is a host setting** (Off / 45 / 60 / 90 / 120 s), same
  slots as cities. On expiry the engine auto-resolves: auto-roll,
  auto-pass claims, auto-discard the drawn tile — and if the idle
  player's drawn tile already completes a legal win, it wins for them
  (player-friendly, keeps a match finite).
- **A log, no deck pane** — mahjong's public record is the ponds; the
  log tile is a single pane.

## Architecture

Exactly cities':

```
mahjong/
  engine.js         pure rules engine (contract file — worker vendors verbatim)
  strings.js        every user-facing flavor string ([ph] convention)
  (transport + the table shell + seat colors are shared: games/)
  transport-mock.js in-page fake worker + bot AI (?mock; dev tool, no disconnect model)
  mahjong.js        page UI (the board half; the shell is games/table.js)
  index.html
```

`window.MahjongTransport` is the seam: `peek(code)` and
`connect(code, {name, create, token}) → conn` with
`send / onMessage / onStatus / close`. `?mock` selects the in-page mock;
`?api=` points at a local `wrangler dev` (localhost only).

## Rules engine (engine.js)

Pure, DOM-free, `ctx = { rand, now }` injected; `applyAction` clones and
never mutates; illegal actions return typed errors (`turn`, `phase`,
`loc`, `bad`). `node mahjong/engine.js` runs selfTest().

**Tiles.** 34 kinds × 4 = 136 + 8 bonus = 144. Ids: `m1–m9`
(characters), `p1–p9` (dots), `s1–s9` (bamboo), `we ws ww wn` (winds),
`dr dg dw` (dragons), `f1–f4` / `g1–g4` (flowers / seasons, seat-numbered
E=1…N=4).

**Phases.** `seating` → `play` → `over`. Within `play` a hand cycles:
`rollBreak` (wall === null) → deal (13 each, dealer auto-draws the 14th;
flowers replace from the back of the wall) → discard loop → `handOver`
(settlement interstitial) → `nextHand`.

**Actions.** `rollSeat`, `rollBreak`, `discard {tile}`, `win`
(self-draw), `kong {tile}` (concealed or added; an added kong opens a
robbing window), `claim {action: win|pung|kong|chow|pass, tiles}`,
`nextHand`, `timerExpire`.

**Claim windows.** A discard computes, per other seat, which claims are
legal (win checks the full hand at min-faan; chow only for the next
seat in turn order). Only seats with an option are asked; the window
resolves when all have answered (or `timerExpire` passes the rest).
Priority: **win > kong/pung > chow**, ties to the seat nearest the
discarder in turn order. All-pass → the discard stands and the next
seat draws. Wall empty on a required draw → exhaustive draw, dealer
repeats.

**Winds.** `order[windIdx] = seat` is fixed at seating. The dealer is
`order[dealerIdx]`; a seat's wind for the hand is
`(orderIdx − dealerIdx) mod 4`. Dealership passes on a non-dealer win;
when it wraps past North the prevailing wind advances; past the last
configured wind the game is `over` (top score wins).

**Faan table** (best decomposition wins — the scorer enumerates every
split, so a hand that parses as both chows and pungs scores as pungs):

| faan | hands |
| --- | --- |
| cap (limit) | Thirteen Orphans, Heavenly/Earthly, All Honors, Great Dragons, Great Winds, All Kongs, Nine Gates |
| 7 | Pure One Suit |
| 4 | Seven Pairs (seven *different* pairs, nothing melded; the scorer weighs it against every set split) |
| 3 | All Pungs, Mixed One Suit, Small Dragons (+the 2 dragon-pung faan → 5 total), Small Winds (+wind-pung faan) |
| 1 each | Common Hand (all chows, non-honor pair), dragon pung, seat wind pung, round wind pung, concealed (no claimed melds, discard win), self-draw, robbing the kong, kong replacement, last-tile draw/claim, no flowers, each own-seat flower/season |
| 2 | a complete flower or season quad (on top of its seat faan) |

Total clamps to the cap. All of this is data Aditya can retune inside
`scoreDecomposition` — the table above is the v1 baseline, not doctrine.

## State & wire protocol

Same envelope as cities: `snapshot` on join, `state {v, serverNow, ev}`
broadcasts, `error {code}`, `kicked`, `closed`, plus the client-
synthesized `replaced` (the socket closed 4408 because another tab on
this device joined — final, no reconnect). Lobby commands: `sit`,
`stand`, `addBot`, `shuffle`, `recolor` (colors.js contract),
`setSettings {minFaan, capFaan, winds, timerSec}`, `start` (needs
exactly 4 seated; seats compact so seat index === engine player index;
any seat **disconnected at that moment converts to a bot**, one
`takeover` event each, with the host warned by a count under the Start
button — see "Identity, disconnects & rejoining"). `kickSeat` is host-
only: in the lobby it opens the seat, in a running game the seat becomes
a bot **and its token is dropped**, so the kicked player's rejoin can't
reclaim it. Game commands are the engine actions; the server injects `seat`.
`rematch` (host, game `over` only) clears the finished game back to the
lobby — seats, colors, bots, and settings persist; scores lived in the
discarded game, so Start deals a fresh match. It is a **shared table
verb** ([games.md](games.md)), not mahjong's own: the base handles it and
the client rebuilds its per-game UI through the `onRematch` hook.

**Hidden information** — the mock enforces what the worker must:

- a hand's tiles + the drawn tile ride only the owner's `you`
  (`you.hand`, `you.drawn`); everyone else sees `handCount`
- melds, flowers, ponds, scores, and the wall COUNTS are public; wall
  contents never leave the table. Two count fields drive the drawn wall:
  `wallLeft` (tiles remaining) and `wallBack` (rear draws this hand —
  flower/kong replacements), plus the public `pond` — the chronological
  discard list `[{seat, tile}]` (a claim pops its entry). All three are
  engine state the worker's views must relay unchanged.
- a claim window broadcasts who may act (`claims.waiting`), but each
  seat's legal OPTIONS ride only its own `you.claims`
  (`{options, chows}`); a `claimAck` reveals pass-vs-claim only to the
  actor until resolution
- `you.canWin` / `you.kongs` are server-computed so the client stays dumb
- `you.nearWin = {faan, need}` rides only the drawn player's `you` when
  the 14 tiles win structurally but score under the table minimum — the
  rack-title hint and the dead Mahjong pill's tooltip read it
- the winning hand reveals in the public `handOver` summary — the moment
  it hits the table for real

## Identity, disconnects & rejoining

Cities' table-session layer verbatim — [cities.md](cities.md) is the
fuller writeup; this is what's mahjong-specific.

**Identity is a device token**: 32 hex chars in `localStorage`
(`deets-mahjong-token`), sent as a field on the first frame's `join`,
never a cookie or query param, never broadcast. It's what binds the
hidden information: `viewFor` resolves `seatOfToken` first and attaches
`you.hand` / `you.drawn` / `you.claims` only inside `if (seat != null)`,
and game commands ignore any client-supplied seat — the server injects
`action.seat` from the token. A client therefore cannot act as, or peek
at, a seat it doesn't hold. Identity is the **browser profile**, not the
person: two people on one device share a seat.

**One device, one connection.** A second tab joining with the same token
supersedes the first, which is closed with code **4408**. The client
treats that as final and says so — reconnecting instead would make the
two tabs evict each other indefinitely.

**A dropped seat stays reserved for its token**, always. Mid-game, the
last socket dropping opens a **30 s grace window**: `seat.graceUntil`
rides every view, a `leaving` event fires, and every client shows a red
countdown toast reconciled *from the model* (so a spectator arriving
mid-grace sees it too). The turn clock **suspends** — a disconnected
human isn't "human" for timer purposes. Return in time (`returned`) and
play resumes; otherwise the seat converts to a bot (`takeover`) and the
hand plays on. Reclaim works at any point until the game is `over` —
rejoin with the same token and the seat comes back off the bot with the
concealed hand intact, since the hand is DO state re-derived from the
seat, never held client-side. The `handOver` interstitial auto-advances
at 9 s regardless of who's connected.

**A lobby seat is held indefinitely** — no grace, no timeout; the grace
window is strictly mid-game. Because of that, `start` converts any
seated-but-disconnected player to a bot as it deals (see the command
table); without it such a seat would be neither bot nor connected human,
no deadline would arm, and the table would hang forever.

⚠️ **The mock cannot exercise any of this.** `transport-mock.js` has no
grace, no takeover-on-disconnect, no reconnect, and its `onStatus` is a
no-op — a dropped mock connection just goes silently dead. Test
disconnect behavior against the worker.

**Stand-ins (mock only).** Mahjong's mock sets `standIns: true`, so the
lobby's Add Bot seats a stand-in "real" player: the drive plays it with
the engine's bot brain exactly like a bot, but `baseView`
(`games/table-mock.js`) sends it as a connected human — no `(bot)` tag,
no tier. It exists to try per-player UI (the Beginner toggle) on one
browser. The worker has no such seat.

## Page layout — the bento

Cities' grid verbatim (big 42rem + dice / players / log right column +
full-width role row). **Below 64rem** that right column no longer leaves
the board room for the fixed-size felt plus both side zones (the felt
slid over the right seat from ~1010px down), so the bento re-flows into
one column: the **bar** on top, the board under it (his call, 2026-10-25).
The bar is the wall panel stretched full width: tiles left + round line,
a divider, then one box per seat in play order from the dealer (leftmost),
each tinted its seat color, dot left and score right (name on hover;
the active seat outlined, an away seat dimmed), then a divider and a
**Log** pill whose dropdown is the toolbar Settings pill's (the shell's
pop kit: hover peeks, click pins across re-renders). As the bar narrows,
the space in each seat box gives first, then "pts" drops to the bare
number (a container query per box, under 4.75rem), and under a 46rem bar
the round line drops, leaving the tile icon and count. The dice, players
and log tiles sit out the narrow layout entirely, so there are no
wall-break dice.

**Below 48rem the board stacks** (his call, 2026-10-25): too narrow for
side seats beside the felt, so the felt goes on top and every seat is a
full-width row under it: you first (with the rack merged in), then the
others in play order. Side seats render as rows there (no sideways
backs). The board becomes a size container and the one tile rectangle
(`--mjwallw`/`--mjwallh`) shrinks until the felt fits its width, so
every board tile shrinks together. `STACK_MQ` in mahjong.js and the CSS
query must stay at the same width. OPEN for the phone pass: the stacked
play board is taller than the 818px stage (≈900–1040px depending on
width), and so is the lobby below ~430px, so the phases don't match
there yet. The rack tiles are also very small at 375–390px. While the board is up, the rack also **merges into your own seat
zone** there (`mergedZone()` in mahjong.js): the prompt rides the zone's
name line, the zone's own meld row yields to the rack's, the role tile
hides, the board drops its fixed height, and rack tiles shrink to fit one
row (capped at 2rem). (WIP — his polish pass pending.)

**One stage for every phase** (his call, 2026-10-25: switching screens
shouldn't jitter). Lobby, seating, play and the stats reveal all fill the
play layout's footprint, `--mjstageh` in mahjong.css: board + gap + rack
on desktop, bar + gap + merged board below 64rem (`--mjbarh` is the
desktop wall panel's height). `--mjrackh` and the
narrow `--mjboardh` are the measured maxima across all six skins plus
slack. Raise them if the rack or merged board grows. A phase change
moves only the dividers (`seamShift` in mahjong.js, 2026-10-25): each
panel whose rect changes is cloned just before the render (a ghost,
its CSS animations landed on their end state and its scroll kept) and
laid over the new layout at its old rect. The ghosts' contents fade
first, then the ghosts themselves, so a divider opening across one old
panel dissolves out of its surface while the new contents come up
through it. A panel spanning an old divider starts with it cut out (an
SVG mask of the old rects, alpha `--seam-a`) and fills in. Shadows move
on a layer under the tiles, old to new with `plus-lighter`, so a shared
edge never dims. `--seam-shift` / `--seam-ease` in skin.css. A phase
that moves no divider (play → over) doesn't animate; leaving a table
resets it; reduced motion skips it.

**Waves** (`waveStart` / `waveApply` in mahjong.js, his call
2026-10-25): the pieces inside the panels arrive in nested waves at three
moments. A **phase change** waves every panel's contents, starting as the
dividers are half dissolved. A **new hand** builds the wall, side by side
from the dealer. **The break** deals the hands seat by seat from the dealer
(my rack in my turn), tile by tile. Siblings step apart, each level at
`WAVE_NEST` (0.6) of its parent's step, and the whole tree is fitted to the
skin's `--wave-span` (Press 0.35s, Ocean 0.7s, else 0.5s). Each piece rises
by the skin's `--boot-rise` over `--boot-dur` / `--boot-ease` (the look
change's own arrival), on `translate` / `scale` so a side seat's rotation
is untouched, to an implicit end keyframe so a dimmed piece lands on its
own opacity. `waveApply` runs after every paint and anchors each piece to
the wave's start, so a piece rebuilt mid-wave (bots act at once) joins at
the point its wave has reached. Scroll boxes with nothing to scroll are
held at `overflow: hidden` for the wave (a rising piece would flash a
scrollbar); in one that already scrolls (a long log) pieces only fade.
While a wave runs, the stats reveal's own `mj-overin` is cancelled.
The lobby's pieces are shell-rendered (`gt-`) nodes; the wave only
animates them from mahjong.js and never restyles them.

A phase with one
panel stretches it to fill: the lobby at every width, and seating below
64rem. Seating has no role tile at any width. Your **Roll** sits on your
own seating pad, right of your dice, and stays there disabled once you've
rolled. On desktop the board runs down through the rack's row and the log
meets it. The seating board takes the stage height outright instead of
stretching, because the shell's `fitLog` sizes the log to the board's
bottom and the two would grow together. The toolbar opts into the shell's `iconToolbar`: Invite, Table
Settings, Leave and Close Table render as icons (link, cog, door-arrow,
power), their words kept as tooltip + accessible name. Close Table keeps
its two steps: the first click turns the power glyph away and draws a
check in its place (tooltip "Confirm?"); the second closes the table, and
the 2.6 s disarm runs the check back to power (`--icon-swap-turn`).
Stand up is an up arrow over a floor line: in the lobby (one step) the
arrow rises out and then you stand; mid-game (two steps) the arrow rises
out and the floor bends into the check, a `d` morph (Safari, which can't
tween `d`, fades the check in instead). Sit down is a line with a down
arrow under it, which dips on click; mid-game's "Take over for:" pill
wears the same glyph with its caret. Glyphs and motion follow
DeetsMusicWindows' title bar (16px, 24-unit grid, 1.6 stroke; the cog is
its path verbatim and turns `--cog-step` per click, never unwinding; the
links part and rejoin; the arrow flies out before the table is left).
Tokens: `--icon-*` / `--cog-step` in `skin.css`. Glyph nodes are built
once and moved into each toolbar rebuild so a Web Animation survives it. The tile rectangle stays fixed; the shell's `fitLog` drops its
height lock once the log sits below the board. Below 56rem the table is
still swapped for the "needs a wider screen" note (shared shell). Contents:

- **Big tile**: lobby settings → seating dice pads → the table: four
  seat zones rotated so YOUR seat is the bottom (turn order runs
  bottom → right → top → left), each with name + wind chip (dealer's
  glows gold), face-down backs, and face-up melds + flowers. The side
  seats sit AT the table: their hand is a column of sideways backs with
  melds + flowers running down a second sideways column beside it
  (faces rotated toward the center). Every board tile — wall stack,
  back, meld, flower, pond — renders at the ONE shared rectangle
  `--mjwallw` × `--mjwallh`. The center is the FELT: a fixed square
  (side derived from that same rectangle, so tile size never changes
  with viewport) carrying the
  classical pinwheel wall — 72 two-tile stacks, 18 a side, each side
  overhanging the next corner counterclockwise. Depletion is cosmetic
  but honest: front draws eat clockwise from the REAL break point
  (computed from `breakRoll` + dealer, entering each side at its
  player's right hand), replacement draws eat backwards from it
  (`wallBack`); a half-eaten stack dims. Inside the wall sits the
  shared discard box — every discard in play order from the public
  `pond`, hover names the thrower, and the claimable tile pulses gold
  (each discard arrives by its flight — see "Tile flights" below). The felt carries no text; the break prompt overlays
  the empty box. `handOver` overlays a settlement panel (revealed hand,
  faan breakdown, payments, Next hand + auto-advance countdown); `over`
  swaps in the stats reveal (superlatives: most wins, biggest hand,
  most kongs, most deal-ins).
- **Dice tile**: cities' tumble/settle kit; shows the latest seating or
  wall-break roll, plus the countdown box when the table clock is armed.
- **Players tile**: seat strips (the shared `--gseat` accent edge, the
  shell's `.gt-ring` timer on **every** active dot — a claim window waits
  on several seats at once — Away dimming, bot tags, score + tile count,
  wind/dealer tag). Accent and ring are both `games/table.js`
  ([games.md](games.md), "Turn timer"), not mahjong's.
- **Wall tile** (between Players and Log, in-hand only): a back icon,
  the live `wallLeft` count, and the round/hand line — the felt center
  carries no text so this panel is the numeric truth. The log flexes
  down to make room.
- **Log tile**: mechanical lines from typed events, tile words tinted
  with the tile palette; hand dividers.
- **Role tile**: my rack — 13 sorted tiles + the drawn tile standing
  apart with a gold edge; click a tile to discard (hover lifts it);
  melds + flowers beneath. The controls column ends in one split button,
  **Mahjong! | Scoring**, cut by a hairline: Mahjong! stays greyed until
  a win is on and then glows alone, and Scoring opens the guide. A
  **Kong** pill shows above it only while a kong is declarable (his
  calls, 2026-10-25). Below 48rem the controls leave the column for a
  row under the hand: the split button and Kong on the left, Auto-Arrange
  on the right, so the tiles get the zone's full width. When a
  drawn hand wins structurally but misses the faan minimum, a
  right-aligned hint on the "Your hand" title line (and the disabled
  Mahjong pill's tooltip) says how many faan it scores vs. the minimum
  (`you.nearWin`). An **Auto-Arrange** switch sits bottom-right of the
  rack (default on, persisted in `localStorage`): on, the hand is the
  engine's canonical sort and a tap discards (today's behavior); off, the
  player arranges the hand by dragging, and discards by dragging a tile
  up out of the strip (the felt lights as the drop target) — tap no
  longer discards, killing the fat-finger. The arrangement is a purely
  **client-side, per-seat** concern (`ui.handOrder`, a tile-id sequence
  reconciled by multiset each render as tiles come and go, re-seeded from
  the sort on each `deal`) — it never touches the engine, the transport,
  or a broadcast; the hand is hidden info, and order carries no game
  meaning. Reorder works any time; the drag-out-to-discard target only
  arms on your turn. Renders are suppressed while a drag is in flight
  (`dragActive`) so the strip stays stable under the pointer.
- **Claim window**: the trade-hub dock (over the board's right quarter)
  repurposed — the discarded tile writ large, my claim buttons (chow
  variants as tile-pair pickers), Pass; pulses while it awaits me. The
  claimable tile in the pond pulses gold in sympathy.
- **Fly layer** (`.mj-flylayer`): the tile flights below, and the
  settlement's gold score chips losers → winner (those still ride the
  shared chip layer, `games/flights.js`).

### Tile flights

(Built 2026-10-26 from his contact-sheet review: a perfectly neat pond, no
sound, everything else as proposed.) Before this, every tile was already in
its final place when its chip launched, so a copy flew over the real tile;
chips flew centre to centre, popped in from scale 0 and shrank out; and a
discard and the next draw left on the same frame, overlapping the next turn.

**The turn plays in order.** A broadcast still renders the instant it
arrives. What it *moved* becomes steps in a client-side queue (`TQ` in
mahjong.js): each discard, draw, flower and claimed tile, in event order.
The shell's `postEvents` hook builds them (`choreograph`) before the
render, so a waiting step can hold its pieces back:

| While a step… | the origin keeps | the destination keeps |
| --- | --- | --- |
| waits | the tile: an extra back in that hand, the stack on the wall (and the wall count), the claimed tile in the pond | a hidden slot (`.is-pending` + `data-step`): the pond slot, the end of that hand's backs, my drawn slot, the meld or flower |
| flies | nothing (it let go at lift-off) | the hidden slot |
| has landed | — | the tile, revealed on the frame the copy goes |

Tile counts follow the same holds (`shownCount`); a discard's, flower's or
claim's log line waits for its landing (`entry.hold`), and the claim dock
opens once the discard is down. Renderers read all of it from `HOLD`.

**One flight.** A copy of the tile flies from the real tile's rectangle to
the real slot's (`endOf` reads centre, upright size and quarter-turn), so
the size and turn blend on the way: a rack tile shrinks to pond size, a
draw to a side seat turns 90°. Lift (rise `--tile-rise`), glide on
`--tile-ease`, settle (the last `--tile-drop`). The copy keeps its size;
height off the table is a small scale-up at mid-flight (`--tile-hop`, less
for short hops) and a shadow. A back that becomes a face — my draw, a
flower, another seat's discard — turns over at mid-flight. Web Animations,
transform and opacity only, so a bot's broadcast re-rendering the board
doesn't stutter it.

**Timing** (skin tokens, `styles/skin.css`): a discard is lift + glide +
settle, then `--tile-beat`, then the next draw at 0.6/0.7/0.6 of the same
three. A whole turn has to fit the worker's 700 ms bot step: base 680 ms,
Press 550, Ocean 697. If the queue falls more than a turn behind (two
waiting steps after the current one) it plays at double speed; more than
eight waiting, it shows the table as it stands.

**My moves never wait.** My discard or claim finishes everything still
playing and goes at once. A tapped tile rises the moment it's tapped
(`.is-lifting`) and the flight starts from up there; a dragged one flies
on from where it was let go. My hand tiles stay live while my draw is in
the air, and the drawn slot is tappable before it lands. The rack slides
(`snapRack` / `flipRack`): tiles that stay move from their old place to
the new one, so a gap closes and the drawn tile sorts into the hand.

**When it doesn't run.** Reduced motion, a hidden tab, a new hand or a
settlement (the wave carries those), a snapshot (reconnect), and leaving
the table all show the table as it stands. A window Chrome has stopped
painting can reach an animation's end without settling its promise, so
each flight also has a timer that lands it (`s.watch`); a copy paused on
purpose (the dev driver's stepped clock) is left alone.

To step through a flight: [tooling.md](tooling.md) §3 (`clock/freeze`,
`clock/step`, `trap`). The tab must be visible: a window behind others
goes hidden, and hidden tabs don't fly.

Token discipline: chrome rides theme/skin tokens (all 30 combos); the
**tile faces, backs, dice, and felt are the carve-out** (`--mj*` literals
on `.mj`). Seat colors are NOT part of this carve-out — they fill the
shared `--gseat-N` slots every game table uses (styles/table.css).

## Timers

One table deadline at a time (`turnEndsAt` in every broadcast, ticked
client-side off `serverNow` skew): seating rolls, the break roll, the
discard turn — all `timerSec` when a HUMAN must act; claim windows cap
at 10 s; the hand-over interstitial always auto-advances after 9 s.
Bots act on their own ~700 ms cadence, timer or no timer.

## Copy

`strings.js`, radio/cities convention: Claude adds only `[ph]`-prefixed
placeholders; Aditya rewrites and drops the prefix; nothing carrying
`[ph]` ships. Aditya's copy pass landed 2026-07-23 — every string in the
file is now handwritten, so Claude edits none of them; only newly wired
UI arrives as `[ph]` and waits for him.

## Art

Placeholders are glyph-on-ivory CSS tiles (萬/筒/條 + number, wind and
dragon characters, the white dragon as an empty frame). Two sprite decks
ship above them: `assets/sprites/mahjong/numeral/` (number + suit glyph)
and `traditional/` (drawn pips / bamboo sticks / characters), 43 PNGs
each (`tile-{id}.png` per face, `back.png` for the woven back) — all
generated 256×352 templates from `scripts/build-mahjong-tiles.py`, drawn
over in LibreSprite tile by tile (`assets/sprites/mahjong/README.md`).
Every file of both decks is probed once at load; a face with no sprite
falls back to the CSS glyph. The deck is a **per-viewer** setting, not a
table one (`deets-mahjong-deck` in localStorage, `"numeral"` default) —
tile art is a legibility call, so no host picks it for anyone else and it
never touches the wire. Two mirrored controls write it: the lobby chips
(live for guests, unlike the host-only faan/winds/timer rows above them)
and an "Art" toolbar pill (value `#` = Numerals, `萬` = Traditional; his
words, 2026-10-25) whose popover is open in **every** phase,
so an unreadable deck is swappable mid-hand. Neither carries a "yours
only" caption — the pill's own value readout says which deck you're on,
and that's enough (his call).
Nothing server-side knows about it. Sideways boxes (walls, side racks) reuse the
portrait art;
`mahjong/mahjong.css` rotates `.mj-tilef__art` ±90° to match, and sprites scale
with plain smooth filtering (`image-rendering: pixelated` shimmered at
fractional rem sizes).

## Worker details (built + deployed)

`../DeetsMahjong` → `mahjong-api.deets.solutions`, a Durable Object per
table, `npx wrangler deploy` — radio/cities' playbook. It vendors
`engine.js`, `games/table-do.js` and `games/colors.js` **verbatim** (byte-identical contract files,
guarded pre-deploy by `node scripts/vendor.mjs --check`), re-runs every
command through `applyAction`, builds per-seat views with the same
hidden-info rules as the mock, and owns the alarm that fires
`timerExpire`. Reconnect/backoff, `v`-gap resync, and the 25 s ping are
in `games/transport.js`, which **defaults to prod** — `?mock` is the opt-out.

One storage alarm multiplexes everything: the table deadline, the
disconnect-grace deadlines, the ~700 ms bot step, and the 1-hour
idle-empty fuse. With nobody connected the drives **freeze** and only
the fuse is armed, so grace deadlines don't tick down while a table sits
empty; they resolve on the next join. Sockets are hibernatable
(`acceptWebSocket` + a `ping`/`pong` auto-response), so the 25 s
keepalive never wakes the DO, and identity rides the socket attachment
rather than storage.

## State of the tab

**Built and live.** The rules engine (`node mahjong/engine.js` runs its
self-checks), both transports, the bento UI and CSS, the nav links, and
the worker (`../DeetsMahjong`, `mahjong-api.deets.solutions`), which
vendors `engine.js`, `colors.js` and `table-do.js` verbatim and is
deployed. `transport.js` defaults to prod.

The turn timer and the seat accent are **not** mahjong's own — they are
the shell's ([games.md](games.md), "Turn timer"). The ring renders on
*every* active seat, which matters here: a claim window waits on several
at once.

**Not built — Aditya's passes.**

- **Art**: tiles render as generated placeholders under
  `assets/sprites/mahjong/{numeral,traditional}/`. Drop in
  `tile-{id}.png` / `back.png` at the same sizes to replace them;
  `scripts/build-mahjong-tiles.py` regenerates the templates.
- **A real four-browser game** — the mock models no disconnects, so
  grace, bot takeover and rejoin are testable only live.

**Copy: his pass is done, but six newer strings await him.** Everything
un-prefixed in `mahjong/strings.js` is Aditya's and Claude edits none of
it. Six entries added *after* that pass still carry `[ph]`: the re-join
wiring (`rejoinButton`, `adoptedToast`) and the four rename ARIA labels.
Nothing carrying `[ph]` may ship.

**Known gaps in the stats the engine keeps** — relevant to
[stats.md](stats.md): there are no pung or chow counters (only kongs),
and losers' melds are destroyed at each deal, so those counts cannot be
reconstructed after the fact. `bestFaan` only records *winning* hands.

## Open questions (deferred, not blockers)

- Payment scheme variants (full-responsibility 全銃) as a host setting?
- Flower rules depth: "flower robbing" and instant flower-quad wins are
  not modeled; seat-flower faan only.
- Concealed-kong robbery for Thirteen Orphans (rare HK nuance) — not
  modeled.
- Spectator betting — cities' v1.1 design would port straight over.
