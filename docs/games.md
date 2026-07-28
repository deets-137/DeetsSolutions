# Deets games — the shared foundation

Every game tab on this site is the same table wearing a different game.
DeetsCities is a hex-settlement board; DeetsMahjong is four seats around a
felt. Underneath they are identical: a table code in the bar, a peek gate,
a lobby with seats and bots and seat colors, a socket that reconnects and
resyncs, a thirty-second grace window when someone drops, a bot that takes
the seat over, a toolbar, a log.

This document is that shared half — the contract a new game implements. Read
it before adding a game; the per-game docs
([cities.md](cities.md), [mahjong.md](mahjong.md)) cover only what makes each
game itself.

> **History.** Cities and mahjong were each written as a full copy of this
> machinery — about 800 lines in the client, 600 in the worker, 350 in CSS,
> per game. Every bug had to be fixed twice, and twice was already enough for
> them to drift. The shared files below are that code, once.

---

## The pieces

```
games/colors.js        seat-color contract (presets, hex validation, clash)
games/transport.js     the WebSocket client (reconnect, backoff, v-gap resync)
games/table.js         the browser table shell (gate, lobby, toolbar, frame)
games/table-do.js      the Durable Object base every worker subclasses
games/table-mock.js    the in-page fake worker behind ?mock (a dev tool)
styles/table.css       the shell's chrome, under the `gt-` class prefix
docs/games.md          this file
```

A game adds:

```
<game>/index.html         the page (bar + bento; game-prefixed hooks)
<game>/strings.js         ALL user-facing copy ([ph] convention — see below)
<game>/engine.js          the rules: pure, DOM-free, dual-export, self-tested
<game>/<game>.js          the board/table UI + the shell's hooks
<game>/transport-mock.js  the mock's game half (a spec on table-mock.js)
styles/main.css           one block: the game's own art + layout
../Deets<Game>/           the worker repo: a GameTable subclass + wrangler
```

### Contract files

`games/colors.js`, `games/table-do.js`, and each game's `engine.js` are
**contract code**: the browser and the worker must run byte-identical copies,
so each worker repo vendors them into `src/` via `node scripts/vendor.mjs`
(`--check` fails on drift; run it before every deploy). Never hand-edit a
vendored copy — change the site's copy and re-sync. This is the same rule
DeetsRadio's protocol follows.

---

## The wire protocol

One envelope for every game. Only the action verbs differ.

**Client → table**

| Verb | Payload | Who |
|---|---|---|
| `join` | `{name, create, token}` | first message on every socket |
| `sit` / `stand` | `{seat?}` | lobby; mid-game too under the re-join policy — `stand` releases your seat (two-stepped in the UI), `sit {seat}` adopts a bot-held one at an "anyone" table |
| `rename` | `{name}` | own seat, lobby only (names lock at Start, like colors) |
| `addBot` | `{seat, name}` | host, lobby only (re-adding at a bot's seat renames) |
| `kickSeat` | `{seat}` | host; lobby opens the seat, mid-game converts it to a bot |
| `shuffle` | — | host, lobby only |
| `recolor` | `{seat?, color}` | own seat, or host on a bot seat; lobby only |
| `setSettings` | game-specific keys, plus the shared `rejoin` | host, lobby only |
| `start` | — | host |
| `rematch` | — | host, game `over` only |
| `closeTable` | — | host |
| *(game verbs)* | game-specific | routed to the engine with the actor injected |

**Table → client**

| Type | Meaning |
|---|---|
| `snapshot` | full personalized view; `v` is the version this socket is now at |
| `state` | full personalized view + `ev[]`; a **gap in `v` means a missed broadcast** — the client force-reconnects and repairs from the fresh snapshot |
| `error` | `{code}` — a refusal |
| `kicked` / `closed` | terminal; the socket stays gone |

Every broadcast is a **full personalized view**, never a delta. `serverNow`
rides along so clients can tick deadlines against the server's clock.

**Refusal codes.** Table-level: `no-table`, `name-taken`, `full`, `perm`,
`phase`, `turn`, `color`, `color-taken`, `flood`. A game adds its own through
`errExtra` (client) — the engine's `err(code)` codes.

`no-table` / `name-taken` / `full` are **final when they answer a join**: the
transport stops reconnecting. The same code mid-session is an ordinary no and
the socket lives on.

**Socket close codes.** `4200` closed, `4403` kicked, `4404` no-table, `4408`
replaced (another tab on this device took the table — the client says so and
stays down rather than ping-ponging), `4409` name-taken, `4429` full.

### Identity and rejoin

A device's `token` (localStorage, per game) is the identity. A seat record
holds the token, so a returning player repossesses their seat from the bot
that took it over — whichever gate pill they pressed. `name` is display only,
and must be unique among live connections and seats.

**Signed in, a seat also carries the account `uid`** — and the identity
becomes portable across devices. The `ds_sess` cookie is scoped to
`.deets.solutions`, so the browser sends it on the WebSocket upgrade by
itself; the DO verifies its HMAC against the shared `SESSION_SECRET`
(each game worker sets it with `npx wrangler secret put SESSION_SECRET`,
same value as DeetsAccounts) and stashes the verified uid on the
connection. Nothing about it rides the wire, a client message can't forge
it, and without the secret or the cookie everything degrades to the guest
path above. The rules ([table-do.js](../games/table-do.js), `sessionUid`
and the join handler):

- Reclaim matches **token first, then verified uid — but only a dark
  seat** (grace, bot, or lobby-disconnected). A seat whose token still
  has a live socket is never pulled out from under its session: hop out
  on one device, then in on the other.
- A uid reclaim **adopts the new device's token** onto the seat, and the
  name-taken check skips the seat being reclaimed — same name + same
  verified identity is you returning, not an imposter.
- **Kick deletes the uid alongside the token**, so a kicked player can't
  uid-waltz back in.
- **`uid` never rides a view or broadcast** — identity is hidden info
  even though it isn't game info.
- `token_epoch` is not checked (that would take the accounts D1); a
  stale session keeps seat-reclaim rights until its 30-day expiry,
  which stakes nothing but a chair.

The grace window is **model-driven, not event-driven**: a disconnected seat
carries `graceUntil` in every broadcast, so a spectator arriving mid-grace
sees the countdown from their first snapshot. The `leaving` / `returned` /
`takeover` events are one-shot narration on top.

### The re-join policy (`settings.rejoin`)

One shared host setting on every lobby — the base's own settings key,
rendered by the shell as the "Re-joining" chip row and validated against
the game's `REJOIN_MODES` (default `["anyone", "rejoin"]`; offering
`"none"` requires the game's engine to speak a `concede` action — cities
opted in, mahjong never offers it because the game needs its four seats):

- **anyone** — a dark seat's bot holds it *and* any spectator may adopt
  it mid-game (`sit {seat}`, one toolbar pill per adoptable seat); the
  original player keeps reclaim rights until someone else takes it.
  Adoption keeps the seat's color and pieces and takes the adopter's
  name (the `adopted` event).
- **rejoin** (the default) — bots hold, token/uid reclaim only: exactly
  the identity rules above.
- **none** — no bots. Grace expiry, a mid-game kick, and standing all
  **concede** the seat: the engine settles it (cities — resources back
  to the bank, dev cards stay out of the deck so drawing odds hold,
  buildings and held awards stand until overtaken), the roster grays it
  (`conceded` rides the seat view) and severs its identity. Below two
  live seats the game ends on current standings. One recorded corner: if
  the current roller concedes while others still owe 7-roll discards,
  those debts dissolve with the turn — a house-rule simplification.

Standing mid-game is a voluntary release in every mode. The host's
chosen policy is remembered client-side (`deets-games-rejoin`,
deliberately shared across games) and applied once to the next table
they create.

**Stats rule (for phase-2 results):** a table where any seat changed
hands mid-game (adoption) is unrated — its results attach to no one.

### Hidden information

`viewFor(token)` is computed **per connection**. Anything a seat shouldn't
see rides only that connection's `you`, and `maskEvent(e, seat)` scrubs
events before delivery. Mahjong is the strict case (hands, the drawn tile,
per-seat claim options) — see [mahjong.md](mahjong.md)'s hidden-info list
before widening any broadcast field.

---

## The browser: `games/table.js`

```js
var model = null;
var TBL = window.DeetsTable.create({ /* config + hooks */ });
var el = TBL.el, load = TBL.load, /* ... */;
function send(msg) { TBL.send(msg); }
function render() { TBL.render(); }
```

The shell keeps the authoritative model and hands it back through `onModel`,
so a game file keeps its own `model` var and its own `send()` under the old
names — the board code doesn't know the shell exists.

**Order per broadcast:**

```
beforeMerge(isSnapshot)   snapshot any "previous value" state (pre-merge)
<merge>                   shell merges (state) or replaces (snapshot)
onModel(model)            rebind the game's model var
onEvent(e) per event      react; the shell then appends cfg.logLine(e)
postEvents()              sweep event-driven UI
<grace toasts, auto-sit>
preRender()               fix up interaction modes
<seat colors, gate hidden>
render()                  draw
postRender()              anything that needs the new DOM
```

**Config:** `ns` (localStorage namespace), `api`, `mock`, `strings`,
`rootSel`, `capacity`, `minSeats`, `startNeedsHint`, `errExtra`, `logCap`,
`clearFields` / `clearYouFields` (fields a broadcast omits must clear, not
linger), `els`.

**Hooks:** the order above, plus `onJoin`, `onLeave`, `onRematch`,
`onResize`, `blockRender`, `extraPills`, `lobbySettings`, `settingsRows`.

`onRematch` fires when a broadcast takes this socket from `over` to
`lobby` — the host rematched, so the game drops what belonged to the
finished game (sticky toasts, per-game caches, open modes) before the
lobby renders. Both games implement it as the game-scoped half of their
`onLeave`. The model half is `clearFields` / `clearYouFields`: a rematch
omits every game field, so a game that doesn't list them paints the
discarded game into its own lobby.

**Provided:** `send`, `leave`, `render`, `renderLobby`, `buildToolbar`,
`fitLog`, `mySeat`, `seatName`, `seatedCount`, `seatDot`, `pill`, `chip`,
`setRow`, `choiceRow`, `toast`, `pop`, `skew`, `graceSecs`, `logLines`, `ui`,
`code()`, `boot()`, and the utilities (`el`, `load`, `save`, `fmt`,
`slugify`, `reduceMotion`).

### Class prefixes

Shell-rendered nodes carry **`gt-`** and are styled by `styles/table.css`.
A game's stylesheet must never restyle a `gt-` class; if the shell needs to
look different for some game, the shell grows a modifier. Game-owned nodes
keep the game's own prefix (`.cities-*`, `.mj-*`).

---

## The worker: `games/table-do.js`

```js
import { GameTable, tableFetch } from "./table-do.js";
export class PokerTable extends GameTable { /* the game half */ }
export default { fetch: (req, env) => tableFetch(req, env) };
```

The base owns hibernatable sockets, the join handshake, the seat roster with
host fallback, every lobby verb, `rematch` (host, game `over` only: the
finished game is discarded and the table drops back to its own lobby — seats,
tokens, colors, bots, settings and the host all live on `t`, not `t.game`, so
the same players stay put and Start deals a fresh one), personalized
broadcasts, the single alarm, and the idle fuse. Routes are `GET /table/:code/peek` and
`/table/:code/ws`; `tableFetch` handles CORS, the origin check on the
upgrade, and the IP rate limit on the enumerable peek.

The mock (`games/table-mock.js`) mirrors this contract **hook for hook**,
so a game's `transport-mock.js` is the same spec in browser form and the two
read as one design. What the mock deliberately does not model: disconnects
(no grace window, no bot takeover, no reconnect), so rejoin behavior can only
be tested live.

**Subclass must provide:** `Engine`, `Colors`, `GAME_VERBS`,
`defaultSettings()`, `viewGame(view, token, seat)`, `applySettings(msg)`,
`minSeats()`, `createGame(seated)`, `deadlineFor()`, `dlSig()`,
`needsPhantom()`, `phantomOne()`.

**Optional:** `EXTRA_STATE` (extra persisted keys as `{key: () => initial}`),
`capacity()` (default: the `capacity` setting; a fixed-size table returns a
constant), `maskEvent`, `compactSeatsAtStart`, `onStart`, `onGameOver`,
`onRematch` (drop any per-game state the discarded game owned; neither game
needs it yet), `onJoined`, `extraCommand` (a verb the engine doesn't own —
cities' `bet`).

### The one alarm

A single storage alarm multiplexes four deadlines, nearest wins:

1. **disconnect grace** — `seat.graceUntil`, 30 s, then the seat becomes a bot
2. **the table deadline** — `deadlineFor()` ms, re-armed only when `dlSig()`
   changes, so unrelated broadcasts don't reset a running countdown. Only a
   **connected human's** clock runs: a disconnected player is the grace
   window's business, a bot's is the drive cadence's
3. **bot cadence** — 700 ms per action while `needsPhantom()`
4. **the idle fuse** — empty for an hour and the table evaporates

With nobody connected, drives freeze and only the fuse runs; a reconnect
re-arms everything.

### Free-tier discipline

Hibernatable WebSockets (ping/pong auto-answered without waking the object),
presence persists nothing, each mutation is one batched `storage.put`,
SQLite-backed DO class, no D1/KV — the whole table fits the object's own
key/value storage.

---

## Conventions a game inherits

- **Copy is `[ph]`-convention.** Every user-facing string lives in
  `<game>/strings.js`; Aditya writes them. Claude may only ADD entries
  prefixed `[ph]`, never edit an un-prefixed value, and never put copy inline
  in the game's JS. Nothing carrying `[ph]` may ship. The terse mechanical
  log lines are the exception — Claude authors those, rendered from typed
  event records, never sent as prose.
- **Token discipline, with one carve-out.** Every rule outside the game's art
  rides the semantic tokens and must survive all 30 theme×skin combos. The
  board/felt/tile art is a deliberate carve-out with fixed literals, scoped to
  the game's own root class. **Seat colors are not part of that carve-out** —
  they are the shared `--gseat-0..5` contract in `styles/table.css`, and
  `table.js` overrides each slot with the seat's actual pick.
- **Desktop only.** Below 56 rem the table is replaced by a one-line note.
- **Art ships as placeholders.** Geometric stand-ins under
  `assets/sprites/<game>/`, each probed once at load; a missing sprite costs
  one quiet 404 and falls back to the CSS shape. Hand-drawn art swaps in by
  landing the file.
- **The engine is pure.** DOM-free, dual-export (`window.<Game>Engine` +
  `module.exports`), `node <game>/engine.js` runs its self-checks, and the
  client's affordances (dimmed targets, disabled pills) are **cosmetic** —
  the server re-validates every action.

---

## Adding a game

1. `<game>/engine.js` — rules, `createGame(opts, ctx)` /
   `applyAction(game, action, ctx)` → `{game, events}` or `err(code)`,
   `ctx = {rand, now}`, plus self-checks.
2. `<game>/strings.js` — every string, `[ph]`-prefixed until Aditya writes it.
3. `<game>/index.html` — copy a sibling's; swap the prefixes and the scripts.
4. `<game>/<game>.js` — `DeetsTable.create({...})` + the board UI.
5. `styles/main.css` — one block: the game's art and bento. **But first
   read [css-split.md](css-split.md)** — the next game triggers the
   per-page CSS split, and its styles start in `<game>/<game>.css` instead.
6. `../Deets<Game>/` — worker repo: `GameTable` subclass, `wrangler.jsonc`,
   `scripts/vendor.mjs`, then `npx wrangler deploy`.
7. `docs/<game>.md` — the rules, the game's own view fields, its art plan.
8. Link the tab from the nav in every game page and the home page.

What you should NOT have to write: identity, recents, the code combobox, the
gate, join/leave, reconnect, version resync, the lobby, bots, seat colors,
kick, host fallback, the toolbar, grace countdowns, the alarm, the fuse, or
any of their CSS.
