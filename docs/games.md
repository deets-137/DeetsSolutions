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
styles/table.css       the shell's chrome, under the `gt-` class prefix
docs/games.md          this file
```

A game adds:

```
<game>/index.html         the page (bar + bento; game-prefixed hooks)
<game>/strings.js         ALL user-facing copy ([ph] convention — see below)
<game>/engine.js          the rules: pure, DOM-free, dual-export, self-tested
<game>/<game>.js          the board/table UI + the shell's hooks
<game>/transport-mock.js  the in-page fake worker (?mock, a dev tool)
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
| `sit` / `stand` | `{seat?}` | lobby only |
| `addBot` | `{seat, name}` | host, lobby only (re-adding at a bot's seat renames) |
| `kickSeat` | `{seat}` | host; lobby opens the seat, mid-game converts it to a bot |
| `shuffle` | — | host, lobby only |
| `recolor` | `{seat?, color}` | own seat, or host on a bot seat; lobby only |
| `setSettings` | game-specific keys | host, lobby only |
| `start` | — | host |
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

The grace window is **model-driven, not event-driven**: a disconnected seat
carries `graceUntil` in every broadcast, so a spectator arriving mid-grace
sees the countdown from their first snapshot. The `leaving` / `returned` /
`takeover` events are one-shot narration on top.

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

**Hooks:** the order above, plus `onJoin`, `onLeave`, `onResize`,
`blockRender`, `extraPills`, `lobbySettings`, `settingsRows`.

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
host fallback, every lobby verb, personalized broadcasts, the single alarm,
and the idle fuse. Routes are `GET /table/:code/peek` and
`/table/:code/ws`; `tableFetch` handles CORS, the origin check on the
upgrade, and the IP rate limit on the enumerable peek.

**Subclass must provide:** `Engine`, `Colors`, `GAME_VERBS`,
`defaultSettings()`, `viewGame(view, token, seat)`, `applySettings(msg)`,
`minSeats()`, `createGame(seated)`, `deadlineFor()`, `dlSig()`,
`needsPhantom()`, `phantomOne()`.

**Optional:** `EXTRA_STATE` (extra persisted keys as `{key: () => initial}`),
`capacity()` (default: the `capacity` setting; a fixed-size table returns a
constant), `maskEvent`, `compactSeatsAtStart`, `onStart`, `onGameOver`,
`onJoined`, `extraCommand` (a verb the engine doesn't own — cities' `bet`,
mahjong's `rematch`).

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
5. `styles/main.css` — one block: the game's art and bento.
6. `../Deets<Game>/` — worker repo: `GameTable` subclass, `wrangler.jsonc`,
   `scripts/vendor.mjs`, then `npx wrangler deploy`.
7. `docs/<game>.md` — the rules, the game's own view fields, its art plan.
8. Link the tab from the nav in every game page and the home page.

What you should NOT have to write: identity, recents, the code combobox, the
gate, join/leave, reconnect, version resync, the lobby, bots, seat colors,
kick, host fallback, the toolbar, grace countdowns, the alarm, the fuse, or
any of their CSS.
