# DeetsMahjong — the Hong Kong mahjong tab

Four-seat Hong Kong Old Style mahjong at `/mahjong`, built on the
DeetsCities playbook: a pure rules engine, a mock transport that speaks
the real wire protocol, a bento page, and a Phase-2 Cloudflare Worker
(sibling repo `../DeetsMahjong`, `mahjong-api.deets.solutions`) that
vendors the engine verbatim. Read
[architecture.md](architecture.md) for site-wide conventions and
[cities.md](cities.md) for the patterns this tab copies deliberately.

## Decisions already made (chat, 2026-07-23)

- **Hong Kong Old Style, locked to exactly 4 players.** No 3-player
  variant, no capacity setting.
- **Flowers are in** (8 bonus tiles, replacement draws, flower faan).
- **Minimum faan is a host table setting**: quick picks 0 / 1 / 3
  (default **3**) plus a custom text box (0–13).
- **Faan cap is a host setting**: 8 / 10 / 13, default **13**. Limit
  hands score the cap outright.
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
  colors.js         seat-color contract (identical algorithm to cities/colors.js)
  strings.js        every user-facing flavor string ([ph] convention)
  transport.js      real WS client (mahjong-api.deets.solutions; Phase 2)
  transport-mock.js in-page fake worker + bot AI (?mock; the Phase-1 way in)
  mahjong.js        page UI (sixth copy of the toolbar/popover kit)
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
| 3 | All Pungs, Mixed One Suit, Small Dragons (+the 2 dragon-pung faan → 5 total), Small Winds (+wind-pung faan) |
| 1 each | Common Hand (all chows, non-honor pair), dragon pung, seat wind pung, round wind pung, concealed (no claimed melds, discard win), self-draw, robbing the kong, kong replacement, last-tile draw/claim, no flowers, each own-seat flower/season |
| 2 | a complete flower or season quad (on top of its seat faan) |

Total clamps to the cap. All of this is data Aditya can retune inside
`scoreDecomposition` — the table above is the v1 baseline, not doctrine.

## State & wire protocol

Same envelope as cities: `snapshot` on join, `state {v, serverNow, ev}`
broadcasts, `error {code}`, `kicked`, `closed`. Lobby commands: `sit`,
`stand`, `addBot`, `shuffle`, `recolor` (colors.js contract),
`setSettings {minFaan, capFaan, winds, timerSec}`, `start` (needs
exactly 4 seated; seats compact so seat index === engine player index).
Game commands are the engine actions; the server injects `seat`.

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

## Page layout — the bento

Cities' grid verbatim (big 42rem + dice / players / log right column +
full-width role row). Contents:

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
  `pond`, hover names the thrower, the newest pops and the claimable
  tile pulses gold. The felt carries no text; the break prompt overlays
  the empty box. `handOver` overlays a settlement panel (revealed hand,
  faan breakdown, payments, Next hand + auto-advance countdown); `over`
  swaps in the stats reveal (superlatives: most wins, biggest hand,
  most kongs, most deal-ins).
- **Dice tile**: cities' tumble/settle kit; shows the latest seating or
  wall-break roll, plus the countdown box when the table clock is armed.
- **Players tile**: seat strips (accent edge, timer ring on the active
  dot, Away dimming, bot tags, score + tile count, wind/dealer tag).
- **Wall tile** (between Players and Log, in-hand only): a back icon,
  the live `wallLeft` count, and the round/hand line — the felt center
  carries no text so this panel is the numeric truth. The log flexes
  down to make room.
- **Log tile**: mechanical lines from typed events, tile words tinted
  with the tile palette; hand dividers.
- **Role tile**: my rack — 13 sorted tiles + the drawn tile standing
  apart with a gold edge; click a tile to discard (hover lifts it);
  melds + flowers beneath; glowing **Mahjong!** / **Kong** pills. When a
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
- **Fly layer**: cities' steering-chip machinery flying TILES — discards
  arc into the central pond, claimed tiles hop pond → melds, draws slip
  out of the wall's live front edge (`data-wall-front`; replacements off
  the rear edge, `data-wall-back`), and settlement flies gold score
  chips losers → winner.

Token discipline: chrome rides theme/skin tokens (all 30 combos); the
**tile faces, backs, dice, and felt are the carve-out** (`--mj*` literals
on `.mj`). Seat colors fill `--mjseat-N` slots, cities-style.

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
falls back to the CSS glyph. The deck is a host-picked TABLE setting
(`settings.deck`, `"numeral"` default, chips in the lobby next to the
faan/winds/timer rows) — cosmetic only, the engine never reads it, but
the Phase-2 worker's `setSettings` whitelist must accept `deck` exactly
like transport-mock does. Sideways boxes (walls, side racks) reuse the
portrait art;
`main.css` rotates `.mj-tilef__art` ±90° to match, and sprites scale
with plain smooth filtering (`image-rendering: pixelated` shimmered at
fractional rem sizes).

## Worker details (Phase 2)

`../DeetsMahjong` → `mahjong-api.deets.solutions`, a Durable Object per
table, `npx wrangler deploy` — radio/cities' playbook. It vendors
`engine.js` and `colors.js` **verbatim** (byte-identical contract
files), re-runs every command through `applyAction`, builds per-seat
views with the same hidden-info rules as the mock, and owns the alarm
that fires `timerExpire`. Reconnect/backoff, `v`-gap resync, and the
25 s ping are already in `transport.js`.

## Build order (mock first, radio's playbook)

1. ✅ engine.js + selfTest (`node mahjong/engine.js`)
2. ✅ strings/colors/transport-mock/transport
3. ✅ bento UI + CSS + nav links
4. Aditya: play it at `/mahjong?mock`, ✅ copy pass, art pass
5. Phase 2: the worker repo, then flip the default transport

## Open questions (deferred, not blockers)

- Payment scheme variants (full-responsibility 全銃) as a host setting?
- Flower rules depth: "flower robbing" and instant flower-quad wins are
  not modeled; seat-flower faan only.
- Concealed-kong robbery for Thirteen Orphans (rare HK nuance) — not
  modeled.
- Rematch (worker-era, like cities).
- Spectator betting — cities' v1.1 design would port straight over.
