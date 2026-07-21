# DeetsCities — design + build log

**Status (2026-07-21):** **Phase 1 is built.** The full mock-playable
game runs at `cities/?mock` — `engine.js` (rules), `board-data.js`,
`transport-mock.js` (phantom seats running the real engine), and the
whole bento UI in `cities.js`; a solo-vs-phantoms game plays start to
finish, hidden-info holds, winner + stats present. This document is both
the original implementation contract and a running record of what
shipped: where the built UI refined the spec, the prose below is updated
to match (the **Page layout** section carries the *current* layout).
Still ahead: Phase 2 (the worker), Phase 3 (betting), Phase 4 (Aditya's
copy + art) — see **Build order**. All Phase-1 work is on branch
`DeetsCities`: the supporting scaffolding landed in `f13c042` (this doc,
`styles/main.css`, the nav links, `.claude/launch.json`), and the
`cities/` app code (`engine.js`, `cities.js`, `board-data.js`, the two
transports, `strings.js`, `index.html`) plus the `assets/sprites/cities/`
placeholders are now committed as well — the branch checks out and runs.

Design for the **DeetsCities** tab (`cities/`, nav label "DeetsCities"):
a playable, real-time hex-settlement board game in the spirit of the
classic — 3–6 players around a shared table, WebSockets, spectators, and
(later) spectator betting. The name is deliberate: **no Catan trademarks
anywhere** — not in code, copy, repo names, or art. Resource and piece
names are generic in code (`wood, brick, wheat, sheep, ore`;
`settlement, city, road`) and the *displayed* names come from
`cities/strings.js`, which Aditya authors.

Like League and DeetsRadio, this tab needs a **Cloudflare Worker** — a
Durable Object per table — while the page stays flat HTML/CSS/JS. The
worker lives in a new sibling repo, **DeetsCities**
(`../DeetsCities`, deployed with `npx wrangler deploy`), at
**`cities-api.deets.solutions`** (custom-domain binding, one DNS record
on the existing zone). Expected load: 1–2 tables at a time.

## Decisions already made

- **3-player floor, 6-player ceiling.** Seated players at Start decide
  the board: **3–4 → base board**, **5–6 → expanded board**. No 2-player
  mode, no AI/CPU seats, ever (a dead seat ends the game, it is not
  replaced by a bot).
- **No special building phase** in 5–6 games. Standard turn order only.
- **Pure random dice.** Server-rolled (`crypto.getRandomValues`), two
  independent d6. No card-deck/"balanced" dice mode.
- **Turn timers are a table setting.** Default **off**; host may pick
  45 / 60 / 90 / 120 s per turn. Expiry auto-resolves (see "Timers").
- **Spectators are first-class.** Anyone may watch a running or full
  table; spectators get a dedicated view (public state only + the
  betting panel where players see their hand).
- **Betting is ephemeral chips, designed-in, built later.** Every
  spectator gets a fixed stack when the game starts; chips die with the
  table. Bet *types* are extensible so per-stage micro-bets can land
  later without protocol changes. Seated device tokens can never bet.
- **Desktop only.** The tab is not `data-nav-core` (so the mobile nav
  menu never lists it), and below the site's 56rem nav breakpoint the
  page renders a short desktop-only note instead of the game. No mobile
  layout work in v1.
- **Minimal mechanical text; Aditya authors flavor.** Log lines and
  rules prompts are plain, terse, Claude-authored, rendered from typed
  event records (never sent as prose over the wire). Flavor surfaces —
  gate copy, buttons, empty states, **resource/piece display names** —
  live in `cities/strings.js` under the radio convention: Claude may
  only add `[ph]`-prefixed placeholders; Aditya handwrites the rest.
- **Stats are tracked all game, revealed at the end.** Per-player
  resource ledgers, dice histogram, superlatives ("most resources",
  "most robbed") on the game-over screen. Ephemeral — they die with the table.
- **Seats bind to the device token** (radio's identity layer verbatim:
  32-hex `localStorage` token, sent on every `join`, never broadcast).
  Reconnect = new socket + `join` + fresh personalized snapshot back
  into your seat, mid-game.
- **Host = radio's owner idiom.** Creator's token while connected,
  longest-seated fallback while away. Host edits lobby settings, starts
  the game, can kick a seat (which ends a running game), can close the
  table.
- **Tables expire like rooms.** Idle AND empty for 1 hour → the DO wipes
  storage and the code returns to the pool. A running game with people
  connected never expires.
- **The board is a token-discipline carve-out** (the League
  champion-art precedent): terrain fills, player colors, and card art
  use a fixed game palette that does not vary by theme. All surrounding
  chrome — bar, tiles, pills, popovers, toasts — stays on the
  themes.css/skin.css token system and must survive all 30 combos.
- **All art ships as geometric placeholders until Aditya draws it**
  (the radio blank-cover convention, applied to everything). Resource
  cards are flat **rectangles**, number tokens and resource icons are
  flat **circles**, each in its resource's palette color; hexes are
  flat color fills; pieces are simple shapes. No illustrated art, no
  attempts to draw sprites — Aditya hand-draws the real sprites/PNGs
  later. Anything that will become a drawn asset renders from a
  swappable path under `assets/sprites/cities/` (stable filenames, so
  his art drops in without code changes); pure-CSS/SVG shapes are fine
  where a file would be overkill, as long as the swap point is one
  rule or one function.
- **The rules engine is one shared file.** `cities/engine.js` is a pure,
  environment-agnostic module (state + action → new state + events, no
  DOM, no I/O, no `Date.now()` — the caller passes time and randomness
  in). The worker repo carries a **verbatim vendored copy**; like the
  radio wire protocol, the two copies are contract and must stay
  byte-identical. This is what lets the in-page mock run the *real*
  rules before the worker exists.

## Architecture

```
cities/index.html + js  (static — no build step)
  ├── wss://cities-api.deets.solutions/table/{code}
  │                     ──> CF Worker ──> Durable Object per table
  │                           ├─ private SQLite storage: table, seats,
  │                           │    settings, game state, stats, bets
  │                           ├─ hibernatable WebSockets (players +
  │                           │    spectators; ping/pong auto-answered)
  │                           ├─ alarm: turn-timer expiry, idle expiry
  │                           └─ GET /table/{code}/peek:
  │                                {exists, phase, seated, capacity,
  │                                 spectators} — powers the gate
  └── no third-party scripts at all (no CDN exception needed here)
```

Files, following the radio anatomy:

```
cities/index.html        page shell (bar + bento mounts)
cities/cities.js         UI: gate, lobby, board render, panels
cities/engine.js         rules engine (pure; vendored into the worker)
cities/board-data.js     static board definitions (hex layouts, harbor
                         positions, token/harbor/deck counts, per board)
cities/transport.js      real WebSocket client (reconnect, v-gap)
cities/transport-mock.js in-page fake table speaking the protocol
                         verbatim (?mock selects it); runs engine.js
                         locally, simulates phantom players
cities/strings.js        all flavor copy — Aditya's, [ph] convention
docs/cities.md           this file
../DeetsCities/          worker repo: worker.js + vendored engine.js +
                         board-data.js + wrangler config
```

`transport.js` / `transport-mock.js` follow radio's interface (connect,
send, onMessage, onStatus) and its reconnect rules: backoff + rejoin,
`v`-gap detection forcing a fresh snapshot. `?api=<url>` (localhost
only) points at `npx wrangler dev`. Per the site's deliberate-duplication
convention, `cities.js` carries its own copy of the toolbar/popover kit
(fifth copy: sotd, movies, league, radio, cities) — a fix to that
machinery must be mirrored across all five.

## The two boards

All counts below are the classic base game and its 5–6 extension,
restated here so the implementation never needs an outside reference.

|  | Base (3–4) | Expanded (5–6) |
|---|---|---|
| Terrain hexes | 19: 4 wood, 4 sheep, 4 wheat, 3 brick, 3 ore, 1 desert | 30: 6 wood, 6 sheep, 6 wheat, 5 brick, 5 ore, 2 desert |
| Number tokens | 18: one 2, one 12, two each 3–6 and 8–11 | 28: base 18 + one more each of 2,3,4,5,6,8,9,10,11,12 |
| Harbors | 9: four 3:1, one 2:1 per resource | 11: five 3:1, six 2:1 (one per resource + a second sheep) |
| Resource bank | 19 per resource | 24 per resource |
| Dev deck | 25: 14 knights, 5 VP, 2 each road-building / year-of-plenty / monopoly | 34: 20 knights, 5 VP, 3 each progress |
| Per-player pieces | 5 settlements, 4 cities, 15 roads | same |
| Win | 10 VP, declared on your own turn | same |

**Board generation (at Start):** hex layout shape and harbor *positions*
are fixed per board (data in `board-data.js`, matching the official
frames); terrain, number tokens, and harbor *types* are shuffled with
the official variable-setup recommendation enforced: **6s and 8s are
never adjacent** (re-shuffle tokens until satisfied; cheap at this
size). Deserts get no token; the robber starts on a desert (the first,
in the expanded board's case). The seed and resulting board are stored
so reconnects and spectators see the identical board.

### Coordinates — the canonical grid

Hexes use **axial coordinates** `(q, r)` (pointy-top). Vertices and
edges get canonical ids so every placement message names exactly one
location:

- **Vertex id**: `(q, r, "N"|"S")` — every vertex is the north or south
  point of exactly one hex. `V(q,r,N)` touches hexes `(q,r)`,
  `(q, r-1)`, `(q+1, r-1)`; `V(q,r,S)` touches `(q,r)`, `(q, r+1)`,
  `(q-1, r+1)`.
- **Edge id**: `(q, r, "NE"|"E"|"SE")` — every edge belongs to exactly
  one hex in one of three directions (its NW/W/SW edges are the
  neighbors' NE/E/SE).

`engine.js` derives full adjacency (vertex↔vertex, vertex↔edge,
vertex↔hex) from `board-data.js`'s hex list at game start and works from
those maps; ids are serialized as short strings (`"q,r,N"`) on the wire.
Coastal vertices/edges (fewer than 3 touching hexes) are valid build
locations; harbor data attaches to specific coastal vertex pairs.

## Rules engine (engine.js)

Pure module. Shape: `applyAction(game, action, ctx) → {game, events} |
{error}` where `ctx` supplies `{rand, now}`. The DO and the mock both
call it; the DO persists `game` and broadcasts `events`; illegal
actions return typed errors and change nothing. Every rule below is
enforced **server-side**; client affordances (disabled pills, dimmed
vertices) are cosmetic.

**Phases** (`game.phase`):

```
lobby → setup → main → over
```

- **setup — snake draft.** In seat order: each player places 1
  settlement + 1 adjoining road; then in *reverse* order a second
  settlement + road. A setup settlement is refused on a vertex whose
  edges all carry roads already — the mandatory adjoining road must have
  a free edge, or the draft softlocks (bit us in 6-player games, where
  first-pass roads cluster). The second settlement pays out one resource
  per adjacent non-desert hex. Then `main` begins with the first seat.
- **main — turns.** A turn is `roll → act → end`:
  1. **Roll** (mandatory, once). Sum 7 → *discard interrupt* (every
     player over 7 cards discards `floor(n/2)`, simultaneously) →
     current player moves the robber to any other hex → steals 1 random
     card from one player with a settlement/city on it (skipped if
     none). Any other sum → production: each non-robbed hex with that
     token pays its resource to adjacent settlements (×1) / cities (×2).
     **Bank-empty rule:** if the bank can't cover *all* of one
     resource's payouts to *multiple* players, nobody gets that
     resource this roll; a single player collects whatever remains.
  2. **Act**, any order, any number: build road (wood+brick),
     settlement (wood+brick+wheat+sheep; distance rule — no adjacent
     occupied vertex — and must touch your own road), city
     (3 ore + 2 wheat, upgrades your settlement); buy dev card
     (ore+sheep+wheat); play **one** dev card per turn (never one
     bought this turn; knights may be played *before* rolling; VP cards
     are never "played" — they count silently); trade with the bank
     (4:1, or 3:1 / 2:1 with a matching harbor settlement); trade with
     players (below).
  3. **End turn.** Passes to the next seat.
- **Special cards.** Knight: move robber + steal (as a 7, without the
  discard), increments army. Road building: place 2 free roads (or 1 if
  only 1 piece remains). Year of plenty: take any 2 from the bank.
  Monopoly: name a resource; every other player hands over all of it.
- **Longest road** (≥5): longest simple path of one player's roads;
  opponent settlements *break* the path at that vertex. Recomputed
  after every road/settlement placement (DFS over that player's edge
  graph — trivial at ≤15 edges). Current holder keeps it on a tie; if
  the holder drops below all others *and* below 5, the card is
  unclaimed until someone re-earns it; a tie among new claimants leaves
  it unclaimed (official ruling).
- **Largest army** (≥3 knights): same keep-on-tie rule.
- **Win check** after every VP-changing action *by the current player*:
  settlements (1), cities (2), VP cards (1, hidden), longest road (2),
  largest army (2). Reaching 10 on your own turn ends the game
  instantly → `phase: over`, full reveal, stats.

**Trading (player-to-player).** Always involves the current player.
The current player may post an **open offer** `{give, get}` that any
other seated player can `accept` / `decline` / `counter`; the current
player closes it with one accepter (both sides re-validated at close —
hands may have changed). A non-current player may also post a
**proposal** aimed at the current player, who can accept it directly.
One open offer per proposer at a time; all offers die at end of turn,
robber interrupts, or explicit cancel. An offer that every eligible
responder has **declined** dies on the spot — the engine removes it and
emits `offerGone {id, declined: true}`; the client fades the card out.
No trading away from the table (no gifts — every trade needs both sides
non-empty; official rules).

**Timers** (when enabled). One timer per turn, shown as a countdown box
in the dice tile (see Page layout). Expiry auto-resolves the pending
obligation and ends the turn: unrolled → auto-roll; discard interrupt →
random discard for stragglers (its own shorter 30 s window); robber
pending → random legal hex, no steal; otherwise → end turn. Timer
suspends while the current player is disconnected (see below).

**Disconnects.** A dropped seat stays reserved for its token. If it's
the *current* player, the game pauses (banner + suspended timer). The
host may **kick a seat**: in lobby it just opens the seat; in a running
game it **ends the game** (`over`, no winner, stats still shown) — no
bots, by decision.

## State & wire protocol

All messages are small JSON. Every server broadcast carries `v`
(monotonic state version) and `serverNow`; gap in `v` → client
reconnects for a fresh snapshot (radio's rule).

### Table state (DO storage)

```
table:    { code, createdAt, hostToken, phase,
            settings: { capacity: 3..6, timerSec: 0|45|60|90|120,
                        betting: bool } }
seats:    [ { token, name, color, connected } ]   (order = turn order,
            fixed at Start by seating order)
game:     engine.js state — board (hexes, tokens, harbors, robber),
            pieces (per vertex/edge), hands, devDeck + per-player dev
            cards, bank, turn {seat, rolled, devPlayed, pendingInterrupt},
            awards {longestRoad, largestArmy}, offers, vp
stats:    per-seat ledgers (below) + dice histogram
bets:     { chips: {token: n}, book: [ {betId, token, type, params,
            stake, odds?} ] }        (v1.1)
```

### Client → table

| msg | payload | who / when |
|---|---|---|
| `join` | `{name, token, create?}` | anyone; `create:true` initializes (radio's ghost-room guard verbatim). Reply: personalized `snapshot`. Refusals: `no-table`, `name-taken` |
| `sit` | `{seat?}` | lobby; binds seat to token. Refused `full` |
| `stand` | — | lobby; frees own seat |
| `setSettings` | `{capacity?, timerSec?, betting?}` | host, lobby only. Capacity below current seated count refused |
| `start` | — | host, ≥3 seated. Deals the board, enters `setup` |
| `roll` | — | current player, once per turn |
| `place` | `{kind: "settlement"\|"city"\|"road", loc}` | setup + main; engine validates cost, legality, piece supply |
| `buyDev` | — | current player |
| `playDev` | `{card, args}` | `knight` (then `moveRobber`/`steal` follow), `roads` (two `place` follow, free), `plenty {a, b}`, `monopoly {resource}` |
| `discard` | `{cards}` | any player, during a discard interrupt |
| `moveRobber` | `{hex}` | current player, when pending |
| `steal` | `{seat}` | current player, when pending and targets exist |
| `bankTrade` | `{give, get, n?}` | current player; harbor rates applied server-side; `n` (default 1) trades that many units in one action |
| `offer` | `{give, get}` | any seated player (non-current = a proposal to the current player) |
| `respond` | `{offerId, action: "accept"\|"decline"\|"counter", give?, get?}` | seated, not the proposer |
| `close` | `{offerId, accepter}` | current player; executes the trade with `accepter`'s seat (`seat` can't carry it — the transport injects the actor's seat there) |
| `cancel` | `{offerId}` | the proposer |
| `endTurn` | — | current player, after rolling |
| `kickSeat` | `{seat}` | host (lobby: opens seat; running: ends game) |
| `close` (table) | — | host: broadcast `closed`, wipe, free the code — wire name `closeTable` to avoid the offer collision |
| `bet` | `{type, params, stake}` | v1.1, spectators only |

Denials answer `{type:"error", code}` — `perm`, `phase`, `turn`,
`cost`, `loc`, `rate`, `full`, `name-taken`, `no-table`.

### Table → clients

| msg | payload |
|---|---|
| `snapshot` | full state, **personalized**: everything public + `you` (`{seat?, hand?, devCards?, chips?}`). Spectators and opponents get hand/dev **counts** only, never contents |
| `state` | delta after any mutation: changed public sections + your `you` + `ev` (typed events, below) |
| `presence` | seats (connected flags) + spectator count |
| `interrupt` | rides `state` via `turn.pendingInterrupt` — discard (with who still owes), robber, road placement |
| `over` | winner (or none on abandonment), full VP reveal incl. hidden cards, `stats` (below) |
| `kicked` / `closed` | as radio: land back at the gate |

**Events (`ev`)** are typed records, never prose: `{t:"roll", seat, d:[3,5]}`,
`{t:"gain", seat, res, n, src:"roll"|"steal"|"trade"|"dev"}`,
`{t:"build", seat, kind, loc}`, `{t:"robber", seat, hex}`,
`{t:"stealHidden", from, to}` (the resource rides only the two parties'
`you`), `{t:"devBought", seat}`, `{t:"devPlayed", seat, card}`,
`{t:"award", kind, seat|null}`, `{t:"offer"...}`,
`{t:"turn", seat, n}` (`n` = the 1-based running turn counter,
`stats.turns` — the log's "Turn {n}" dividers need it to survive
mid-game joins, where a client can't count turns it never saw),
`{t:"win", seat}`.
The client renders them into the plain log; display names for resources
and pieces come from `strings.js`.

**Hidden-information rules (hard invariants):**

- A hand's contents ride only its owner's `you`. Everyone else sees
  counts.
- Dev card identities ride only the owner's `you` until played; VP dev
  cards are revealed only at `over`.
- A steal broadcasts *that* it happened; the resource identity goes only
  to thief and victim.
- Monopoly reveals exact amounts (official — the count is public).
- The server never sends a spectator or opponent anything a careful
  client could mine for hidden state (no "shuffled deck array" in
  public state — the dev deck lives server-side, draws are singular).

## Stats

Tracked in the DO from Start, revealed in full at `over` (and never
before — mid-game stats would leak strategy). Per seat:

```
gained:  {wood, brick, wheat, sheep, ore}   split by src:
           rolls / steals / trades / dev cards
lost:    discards / robbed / spent
rolls:   count + per-sum histogram (their own rolls)
pieces:  roads, settlements, cities built; dev bought/played; knights
robber:  times moved it, cards stolen, times victimized
```

Plus table-wide: overall dice histogram, turn count, game duration.
The game-over screen's header is **"Game Over"** with the **turn count
right-aligned on the same baseline** (`{n} turns`). Below it, four
superlatives over the full table, in order — most resources, biggest
single haul, most knights, most robbed — each card naming the seat **and
the value they topped with**
(`[{n}x]`, right-aligned). Each card is a **button that slides open on
click** (a `grid-template-rows: 0fr → 1fr` transition — no height
measurement, caret flips) to reveal **the whole field ranked** for that
category, so you can see where everyone else fell. The grid is
`align-items: start` and the big tile scrolls internally, so an open card
grows on its own and **never resizes the panel or its row-mates**; open
state rides `ui.overExpanded[key]` so a re-render doesn't collapse it.
Below them the VP reveal lists every seat
**winner-first, ties adjacent** (stable sort on total VP), with the
winner's row drawn in a **glowing accent box** (which replaces the old
"{name} wins" subtitle line). Everything dies with the table (ephemeral,
like the chips).

## Betting (v1.1 — designed, deferred)

- Spectators receive **100 chips** at game Start (joining mid-game:
  same 100). Chips are per-token, per-table, ephemeral.
- `bet {type, params, stake}` — v1.1 ships `type:"winner"`
  (`params:{seat}`); the book settles at `over`. The type field is the
  extension point for per-stage micro-bets later ("next roll is 7",
  "next robbery victim", longest-road over/unders) — the DO already
  witnesses every outcome, so settlement is trivial; **odds and stage
  betting are the polish pass**, after the game itself is playable.
- Seated tokens can't bet (a player's token is refused even from a
  second tab — the token, not the socket, is the identity).
- The betting panel lives in the spectator view's bottom tile (where
  players see their hand). Book and standings are spectator-public;
  players never see the book mid-game (no information, just decorum).

## Page layout — the bento

Doorway: the `.sotd__bar` combobox idiom verbatim (League/radio) — the
table code IS the title, slug preview, recents popover
(`localStorage`, "Your tables"), peek-below-the-bar, create-confirm so
a typo never mints a table. Peek renders the right verb: **Sit down**
(lobby with room), **Watch** (running/full). Toolbar pills: Invite
(copy link) · **View Settings** (final copy, Aditya's; a popover showing
players/timer/betting, available in any phase so the rules are always
one hover away — hover is a transient peek, **click pins it open**
through the shared popover kit, so Esc/outside-click dismiss it and the
pin survives toolbar re-renders) · Watch/Sit toggle where legal · Leave
· host-only
Close. Deep links `cities/#code`. **No meta line** under the bar (a
departure from the journals, Aditya's call): the game state already says
everything a status line would, so the bento sits flush under the bar
and transient notices (join refusals, reconnects) ride the toast host.

The content is one bento grid, **stable across all phases** — tiles
change contents, never places:

```
┌───────────────────────────────┬──────────────┐
│                               │  DICE        │
│   BIG TILE                    │  (spins)     │
│   lobby: table settings       ├──────────────┤
│   game:  the board (SVG)      │  PLAYERS     │
│   over:  stats + superlatives │  seat strips │
│                               ├──────────────┤
│                               │  LOG         │
├───────────────────────────────┴──────────────┤
│  ROLE TILE — play area:  hand │ controls+tray │
│              spectator:  betting panel        │
└──────────────────────────────────────────────┘
```

- **Big tile.** Lobby: the settings panel (host edits, everyone watches
  live) + the Start button (enabled at 3+ seated; shows "board deals on
  press"). Game: the SVG board — hexes, tokens, harbors, pieces,
  robber; legal placement targets glow on hover during a placement
  action; illegal ones are inert. Two board hovers teach the odds:
  a number token carries a native `<title>` tooltip with its roll odds
  ("{ways}/36 ({pct}%) possible rolls lead to a {n}", `strings.js
  tokenOdds`), and hovering a settlement target floats a
  placement-strength badge — the adjacent hexes' pips pooled onto one
  token-styled pill — so candidate spots compare at a glance (SVG
  overlay, nothing reflows; skipped when the corner has no tokened
  hex). Over: the stats reveal. The tile's
  height is **fixed in CSS** (`clamp(30rem, 100vh − 16rem, 42rem)`), not
  content-driven: the board SVG meet-fits inside it and over-length
  stats scroll internally, so Start swaps contents without moving the
  page — this also anchors `fitLog`'s measurement across phases.
- **Dice tile** (right rail, top). The two dice; on `roll` the faces
  spin — numbers cycling for ~600 ms before settling on the result
  (CSS-driven, honors `prefers-reduced-motion` by cutting straight to
  the result). Between rolls it shows the last result and whose roll it
  was; the caption line's height is always reserved (radio's meta idiom)
  so its appearance at Start doesn't grow the tile. **When the table has
  a turn timer**, a countdown box sits to the
  right of the two dice (dice shift left); it rides along **from the
  lobby on** — static configured duration until the clock arms in main —
  so Start doesn't shift the dice; it ticks from
  `turnEndsAt`/`serverNow` (client captures the clock skew per message),
  glows on the acting **human's** turn, turns urgent (red, pulsing)
  under 10 s, and shows the configured duration statically while a bot
  is thinking. (Design note: the spec first put the timer as a drain bar
  on the active player's strip; the dice-tile box is where it landed.)
- **Players tile.** One strip per seat, laid out as three regions: the
  **seat dot + name top-left**, the **VP / cards / dev stat column
  top-right** (right-aligned, 3 lines — it governs the strip height), and
  the **two award pills bottom-left** (Longest Road over Largest Army),
  compact and stacked. Each pill is a **progress-or-held meter**: while
  the seat does *not* hold the award it shows their count toward it —
  "{n}x Roads" / "{n}x Knights", a quiet neutral chip; when the seat
  *holds* it the pill flips to the award name with the count as the bar to
  beat — "Longest Road [{n}x]" / "Largest Army [{n}x]" — in the accent
  color with a glow (`.is-held`). Both counts are the true award metric:
  **Roads is the longest contiguous path** (the same DFS the award uses —
  `engine.js` stores it per seat in `game.roadLens`, recomputed on every
  road/settlement placement *and through the setup draft*, exposed on each
  player's public view), and Knights is knights played.
  **Both pills are always laid out** (ghosted in the lobby), so the strip
  reserves their space from the start and **never resizes** — the strip is
  the same height whether a seat holds zero, one, or both awards (the
  bento's no-resize rule; verified 0 px jitter). An embargoed seat still
  shows the 🚫 badge inline by the name. The **active player wears an
  accent ring**. Disconnected seats dim. In the **lobby** the occupied
  seats already render as strips with the stat column and both award pills
  ghosted at in-game size, so Start fills the numbers in instead of
  reflowing the tile.
  The tile is a **fixed-height scroller** (sized to exactly 4 strips —
  the base-board table): 5–6 player tables scroll inside on the themed
  scrollbar instead of expanding the panel and pushing the log down.
  Re-renders preserve the scroll position, and a turn change scrolls the
  active player's strip into view (minimal-scroll, never the page).
- **Log tile.** The typed-event log, newest last, auto-scrolled,
  bounded render. A narrow **left rail** toggles two panes — **Log**
  (the list) and **Deck** (the bank's public resource counts as mini
  hand-style cards in a centered 3-2 grid); the choice is sticky
  (localStorage), the rail a constant width so switching never moves
  anything. Log lines are structured: turn changes render as a
  full-width **"Turn {n}: {name}"** divider (`n` rides the `turn`
  event), and resource words are tinted with their fixed game-palette
  color. Its height is **locked** to fit the bento —
  `cities.js` (`fitLog`) measures the space down to the board tile's
  bottom and sets the tile to exactly that, so the tile is a **constant
  full size regardless of line count** and the right column always
  bottom-aligns with the board; overflow scrolls inside on the themed
  scrollbar. (CSS grid alone can't do this: a `1fr` track sizes to
  max-content under an indefinite-height container, so it's measured in
  JS — called *synchronously* at the end of `render()`, since `rAF` is
  throttled when the tab is backgrounded.)
- **Role tile** (bottom, full width) — the **play area**. For a seated
  player it's **always the same two-column layout, in every phase**: the
  **hand** top-left (a "Your hand" title, the resource cards, then the
  dev-card row — the row is always rendered, a ghost card holding its
  height while empty, so the first dev card bought doesn't grow the
  tile) and the **controls** top-right. The controls column grid-stacks
  the full **pills + tray gauge** (`buildGauge`) under whatever the
  phase shows instead — the setup prompt, a robber/roads/steal prompt,
  nothing in lobby/over — ghosting the gauge when covered, so the tile
  holds one size from the lobby all the way to game over. **Build**
  opens an **in-panel option tray** under the pills (Roll · Build ·
  Trade · End, tops aligned with the hand title) — no floating dropdown,
  and the tray's space is **permanently reserved** (the build tray + the
  cancel link sit grid-stacked in one always-present slot,
  visibility-hidden when closed) so toggling never resizes the tile. The
  tray is a **right-aligned 2×2 grid of four identical boxes** — Road |
  Settlement over Dev card | City (equal column widths via
  `width: max-content` + `1fr` tracks, equal rows via `1fr` auto-rows),
  flush with the pills' right edge — costs spelled out ("1x Wood,
  1x Brick"), disabled when unaffordable. **Trade** instead toggles the
  **trade hub** in the board overlay (see Trade overlay below) — the pill
  stays enabled off-turn while offers are open so a dismissed hub can be
  re-opened to respond.
  **Dev cards render in the hand, not as a pill** — each playable card
  (Knight, …) is a live button, a Victory Point is an inert marker, and
  hovering any shows what it does. Spectator: chip stack + the
  betting panel (v1.1; until then, a quiet spectating note).
- **Trade overlay — the hub.** One floating column docks **over the
  board tile's right edge, spanning its full height** (scrolls
  internally). It is a **trade hub** ("Trade Hub" titles the panel): the
  **Bank** / **Players** initiate buttons split the top row half-and-half
  (only while the viewer can act), then the live-offers list — no empty
  state when there are none. Each initiate button is a **toggle** that
  discloses its builder **inline underneath the row** (not a separate
  panel page); the built section is kept across the steady state
  re-renders so in-progress picks survive, rebuilt only on toggle. The Trade pill toggles the hub; an
  **incoming offer opens it automatically** so accept/decline is right
  there; it falls closed when there is nothing to show or start. Only
  the dev-card pickers (monopoly / plenty) still take over the column as
  dedicated panels. Live offers show offer/receive chips; on your own
  offer each participant renders as a players-tile-style accent strip
  with their verdict (✓ / ✕ / …) — an accepted strip is itself the
  close-the-deal button — plus a Withdraw control; an offer awaiting
  *your* response pulses. Offers are state,
  not notifications — they persist until accepted, declined, or
  cancelled (they clear at end of turn). In the mock, phantom seats
  **respond** to offers (accept a fair-or-better deal they can afford,
  else decline) so the full flow is exercisable solo.
  **Embargoes** are a client-side preference (localStorage, per table +
  seat): right-click a player strip in the players tile for the embargo
  menu. An embargoed seat's incoming offers are auto-declined (no toast,
  no hub pop), their responses to your offers read as declined (🚫 on
  their strip, never closeable, no accept toast), and a 🚫 badge marks
  them in the players tile. The server knows nothing about embargoes. Toasts: an
  incoming offer is announced; an **accept on your own offer raises a
  sticky success toast** whose action button closes the deal with that
  accepter (it retires itself if the offer dies or the response
  changes); posting an offer you can't cover is refused client-side
  with an error toast (the engine re-validates regardless).
- **Forced interrupts.** Robber placement uses the **board** (hexes
  become click targets, then a steal-target prompt). Discard and steal
  render in the **role tile**: a 7-discard shows the hand as a sideways
  row of tap-to-select cards with a **square Discard button** to their
  right, enabled once the exact count is picked. Never a modal outside
  the bento.

A **universal layout rule** governs the bento (Aditya's, this pass): no
UI piece may change size or offset another — **including across phase
transitions** (creating a table, Start, game over). Tiles hold constant
size and scroll internally (the locked log, the fixed-height big tile,
the 4-strip players scroller),
overlays float rather than push (the trade column), and every
contents-swap point pre-reserves its space: the role tile's ghosted
pills+tray gauge, the ghost dev-card row, the lobby players' ghosted
stat columns, the dice caption line, and the from-the-lobby timer box.
`fitRole` additionally locks the role tile's measured play-area height
as a min-height (cleared on window resize) as a belt-and-suspenders
against anything the reservations miss. Ghosts share one idiom: the
element is laid out at full size with `visibility: hidden`
(`.cities .is-ghost`).
- **Game over:** the big tile flips to stats; a Rematch pill (host)
  re-enters the lobby with the same seats and settings.

Desktop only, enforced twice: the nav link is not `data-nav-core`
(mobile menu omits it), and below 56rem the page swaps the bento for a
one-line desktop-only note (copy from `strings.js`).

### Game palette (the carve-out)

Fixed literals scoped to the board and cards only, defined once in a
`/* cities game palette — deliberate token carve-out (docs/cities.md) */`
block: terrain fills (wood/brick/wheat/sheep/ore/desert/sea), the six
seat colors (red, blue, green, orange, purple, teal — chosen to stay
distinct for common color-vision deficiencies), number-token ink (red
for 6/8). Everything else on the page uses semantic tokens and must
survive all 30 combos.

Until Aditya's hand-drawn sprites land, every art surface is a
geometric placeholder in these palette colors — rectangles for cards,
circles for tokens/icons, flat hex fills (see the placeholder-art
decision above).

## Worker details

- **DO per table**, SQLite-backed, hibernatable WebSockets,
  `setWebSocketAutoResponse` for ping/pong. One batched `storage.put`
  per mutation; presence persists nothing.
- **Alarms**: turn-timer expiry and the 1 h idle+empty wipe share the
  alarm (store the nearer deadline + its kind).
- **Randomness**: `crypto.getRandomValues` for dice, shuffles, steal
  targets — always in the DO, passed into `engine.js` via `ctx.rand`.
- **Abuse guards** (radio's numbers): per-socket command cap 20 msgs /
  10 s riding the WS attachment; IP-keyed peek limit 30 / 60 s via a
  rate-limit binding; connection cap per table — 6 seats + 24
  spectators = 30 sockets, `error:"full"` beyond.
- **Message hygiene**: 16 KB cap, every payload rebuilt field-by-field
  (never trust a client blob), locations validated against the board's
  derived adjacency before touching state.

## Build order (mock first, radio's playbook)

1. **Board + engine on the mock. — ✅ DONE (2026-07).** `board-data.js`,
   `engine.js` with full rules + an inline `selfTest()` (69 assertions,
   green in node and in-browser; runs fuzzed games with a
   resource-conservation invariant), `transport-mock.js` running the
   engine locally with phantom seats (which also auto-play *and* answer
   trade offers), and the page: gate, lobby bento, SVG board, placement,
   dice tile + turn-timer box, the two-column play area with in-panel
   build/trade trays and in-hand dev cards, the full-height trade
   overlay, the locked log, discard/robber/steal interrupts, game over +
   stats, and the View-settings hover pill. A full solo-vs-phantoms game
   plays to a winner on `?mock`. Strings are fully scaffolded as `[ph]`
   placeholders — all ~100 entries still carry the prefix, awaiting
   Aditya's copy pass. Look-and-feel + copy remain Aditya's passes.
2. **Worker + DO** in `../DeetsCities`: vendor `engine.js` +
   `board-data.js` verbatim, port the mock's command dispatch, peek,
   reconnect, timers-as-alarms, abuse guards. Deploy, then a real
   two-browser game.
3. **Spectator polish + betting v1.1**: the betting panel, winner bets,
   settlement at `over`.
4. **Site wiring**: nav link (not core) added to every page's header,
   `.claude/launch.json` already serves the tab; Aditya's copy pass
   over `strings.js`; his look-and-feel pass (visual verification is
   his, per convention).

## Open questions (deferred, not blockers)

- **Chat**: none in v1 — the log and trade overlay carry the game.
  Spectator chat is a natural rider on the betting pass.
- **Rematch stats**: chips and stats reset per game; a same-table
  series ledger ("best of N") is a later idea.
- **House rules** (friendly robber, no-6/8-adjacency toggle, discard
  threshold): the settings tile is built to grow rows; none ship in v1.
- **Odds-bearing / per-stage bets**: the `bet.type` field is the hook;
  design when the game is playable.
