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
games/table.js         the browser table shell (gate, lobby, toolbar, frame,
                       seat accent, turn-timer readouts)
games/flights.js       the steering chip-flight layer (every game's fly-ins)
games/table-do.js      the Durable Object base every worker subclasses
games/table-mock.js    the in-page fake worker behind ?mock (a dev tool)
styles/chrome.css      shared site chrome + the token @imports (every page)
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
<game>/<game>.css         the game's own art + layout (its own stylesheet)
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
| `addBot` | `{seat, name, tier?}` | host, lobby only (re-adding at a bot's seat renames **and** re-tiers — see "Bots") |
| `kickSeat` | `{seat}` | host; lobby opens the seat (bots included — this is how a lobby bot is removed), mid-game converts a **human** seat to a bot and refuses a bot-held one |
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
`phase`, `turn`, `color`, `color-taken`, `flood`, `teams` (real-teams games:
Start refused on uneven sides). A game adds its own through
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
rendered by the shell as a chip row (labelled per game — cities and
mahjong say "Re-joining", poker "Mid-game Join") and validated against
the game's `REJOIN_MODES` (default `["anyone", "rejoin"]`; offering
`"none"` requires the game's engine to speak a `concede` action — cities
opted in, mahjong never offers it because the game needs its four seats):

- **anyone** — a dark seat's bot holds it *and* any spectator may adopt
  it mid-game (`sit {seat}`, one **Sit down** toolbar pill whose popover
  lists every adoptable seat — a pill *per* seat used to shove Leave off
  the row at a 6-player table; no pill renders when none qualify, and an
  `away` seat qualifies alongside a `phantom` one, see below); the
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

Standing mid-game is a voluntary release in every mode, and for a game
with bots in live play it is **one-way**: standing drops your token and
uid, so unlike a disconnect it carries no reclaim right. At an
`"anyone"` table you can sit back down through the ordinary **Sit down**
popover (any spectator could too, so the race is real); at a `"rejoin"`
table the bot keeps the seat for the rest of the game. That asymmetry is
deliberate — the toolbar two-steps the pill because of it.

#### Away seats — a released seat with no bot to catch it

A game whose bots **never inherit a seat** (poker: bots are first-class
opponents, but only ever host-added) has nowhere to put a released seat,
so it gets a third destination between "a bot holds it" and "conceded":
the seat goes **away**. The roster keeps the seat, its name, color and **token**; the
engine stops dealing it in but the position survives intact; the same
token — or, in the worker, the same uid from any device — walks back in.

A game opts in with two spec keys naming its own engine verbs —
`awayAction` / `adoptAction` in the mock, the same pair spelled
`AWAY_ACTION` / `ADOPT_ACTION` as getters on the DO subclass:

| Key | When it fires | Poker's |
|---|---|---|
| `awayAction` | mid-game `stand` at a non-`"none"` table, instead of the bot handoff; in the worker also **grace expiry** and a dark seat at Start | `sitOut` |
| `adoptAction` | someone adopts an `away` seat (`"anyone"` tables) | `sitBack` |

If `awayAction` is absent, or the engine refuses it, the shell falls
straight through to the normal bot takeover — so cities and mahjong are
untouched. `away` rides the seat view as a public boolean (like
`conceded`), and the adoption filter treats `phantom || away` as
adoptable.

The worker half (`table-do.js`, `awaySeat(i)`) is what makes the promise
real, and three of its choices are the whole point:

- **The token and the uid stay on an away seat.** Every other exit path
  deletes both; that deletion is exactly what made leaving permanent.
  Keeping them is what lets join's reclaim — token first, then a verified
  account uid from *any* device — hand the seat and its stake back.
- **A kick still severs**, at every mode, for a game with an away action:
  parking a kicked player leaves their token on the seat, so they would
  walk straight back in and the host's only remedy would be no remedy.
  They cash out into the standings instead.
- **An away stretch is an absence, not a hand-over**, so the spans ledger
  keeps the span open. A player who takes a break must not lose
  attribution for their own session.

The table's lifetime still bounds all of it: `EXPIRE_MS` (1 h idle and
empty) evaporates the table and every parked stake with it.

The pill's wording has to change with the policy — at a `"none"` table
standing cashes you out, everywhere else it just parks you — so a game
may override it per render with the **`standCopy()`** hook, returning
`{label, hover, confirm}` (any subset; null keeps the shell's own
strings). Returning **`false`** withdraws the pill entirely, for a state
where standing is a no-op — poker returns false for a seat that is
already sitting out, whose way back is its own pill further left.

**A seat only ever loses its hand when nobody can inherit it.** A bot
takeover, an adoption, and a reclaim all keep the hand, dev cards,
buildings and color exactly as they stood, so whoever picks the seat up
starts from the real position rather than from nothing. `concede` — the
one path that returns resources to the bank — exists only in `"none"`
mode, where by construction there is no successor. This is also why a
bot-held seat cannot be kicked mid-game: the kick would delete a live
hand with no one to hand it to.

The host's chosen policy is remembered client-side
(`deets-games-rejoin`, deliberately shared across games) and applied once
to the next table they create.

**Stats rule (for phase-2 results):** a table where any seat changed
hands mid-game (adoption) is unrated — its results attach to no one.

### Hidden information

`viewFor(token)` is computed **per connection**. Anything a seat shouldn't
see rides only that connection's `you`, and `maskEvent(e, seat)` scrubs
events before delivery. Mahjong is the strict case (hands, the drawn tile,
per-seat claim options) — see [mahjong.md](mahjong.md)'s hidden-info list
before widening any broadcast field. A team game's `you` may be per TEAM
(ships: teammates share everything) — `viewGame(view, token, seat)` already
has what it needs to build that; nothing in the base assumes per-seat.

### Teams

**Every seat always has a team.** For cities and mahjong teams are *of
one* — `teamOf(i) === i`, seat views carry an additive `team` field, and
nothing else about their model, wire, or UX changes. A game with **real
teams** (DeetsShips) declares a count — `get TEAMS() { return 2; }` on the
DO subclass, `teams: 2` in the mock spec and the shell config — and that
one flag gates everything below. Built for ships
([ships.md](ships.md)); any future team game inherits it.

- **Sides are structural in the lobby**: the first `capacity/TEAMS` seat
  indices are team 0, the next team 1. The shell renders one seat column
  per side (`.gt-lobby__team`, header via `cfg.teamName(k)`), every empty
  seat gets a *Sit here* affordance (`S.sitHereButton`), and switching
  sides is just standing and sitting in the other column.
- **Start refuses uneven sides** (`teams` code) and **stamps** `s.team`
  onto each seat before compaction, so `teamOf` reads the stamp from then
  on and engine player index runs team 0 first. The shell disables Start
  and shows `S.teamsUnevenHint` for the same condition, so the refusal
  never actually reaches a player.
- **One color per side** (`t.teamColors`) replaces per-seat colors: every
  seat *view*'s `color` — empty seats included, which is why 8-seat tables
  never index past the six presets — resolves through its team, so
  `applySeatColors`, `seatAccent` and the whole `--gseat` contract are
  untouched. `recolor` keeps its wire shape; the base maps the seat to its
  team, requires the **captain** (or the host covering a bot captain), and
  clashes against the other sides' colors only.
- **Captains ride the public view** (`captains: [seat, ...]`): per team,
  the host idiom — lowest-indexed connected human, else lowest-indexed
  live seat. A bot captain is a real state, not an error. The shell shows
  `S.captainBadge` on the captain's lobby row and gives them the picker.
- **Results carry `team`** on each per-seat row when teams are real
  ([stats.md](stats.md)) — the team outcome hangs on it.
- **Per-phase clocks:** the readouts read one budget; a game whose budget
  varies by phase supplies `cfg.timerBudget()` (seconds) and the ring and
  text follow. Games with one `settings.timerSec` change nothing.

### Bots

**A bot's brain lives in that game's `engine.js`, never in the mock and
never in the worker's `src/index.js`.** Cities and mahjong each carried
two hand-ported copies — an ES5 `phantomOne` in the mock and an ES6 one
in the worker — so every tuning pass had to be written twice and kept
byte-parallel by hand. `engine.js` is vendored VERBATIM into the worker
repo, which is exactly the property a bot needs, for the same reason the
rules need it.

The engine exports two functions and one list:

```js
botAct(game, isBot, opts, ctx) → action | null   // ONE action, or null
botPending(game, isBot)        → bool            // cheap: does anyone owe?
BOT_TIER_LIST                  → ["easy", ...]   // the difficulty vocabulary
```

- **One action per call.** The drive loop calls again `BOT_STEP` (700 ms)
  later, which is what makes a bot watchable rather than a flood.
- **`isBot(seat)` and the tier lookup are the TABLE's.** The table owns
  who is a bot and how hard each plays; the engine owns what one does
  about it. `table-do.js` hands over `botAt()` / `tierOf()`, and
  `table-mock.js` the same two through `HELPERS` — both drive hooks
  (`needsPhantom`, `phantomOne`) receive them.
- **`opts.tier` is a name or a seat → name function**, because a table
  can mix tiers and *which* seat acts is decided inside `botAct`, not by
  the caller. `opts.acts` carries a per-turn budget the caller counts,
  where a game has one (cities' build budget).
- **Hidden information is fine here.** The bot reads `game` directly,
  hands and all. That is correct precisely because it runs only inside
  the worker (and the mock, which *is* the worker) — never call `botAct`
  from page code. What it returns is always a public act anyway.

> **Naming trap.** The DO base has had `botAt(i) → bool` since it
> existed. The function-form lookups are **`botFn()` / `tierFn()`** —
> don't merge the names, a JS class body silently keeps only the last
> definition of a name.

**Difficulty is a name, not a number.** `BOT_TIER_LIST` is the engine's
vocabulary; the foundation only validates against it and the shell only
renders it (`cfg.botTiers`, labels `S.botTier_<name>`). A game that
declares no tiers gets no picker and changes nothing else — which is
what ships does today. **An unknown or missing tier falls back to the
middle of the list**, so a seat converted mid-game (grace expiry, a
kick, a lobby seat that went dark) plays the default rather than
inheriting whatever the host last typed. The tier rides every seat view:
difficulty is public, because you should know what you're sitting
across from.

**Tuning is measured, not guessed** — all-bot tables, tiers rotated
through seats, driven to completion. Three findings that cost real time:
difficulty belongs in *judgement*, not in refusing to play (the first
`easy` ran **23,583 turns without a winner**); pick the metric before
the tier (mahjong's hand-win rate ranks the tiers **backwards**); and
**pick the estimator too** — rotating one bot through the seats folds
positional advantage into the error bar, which poker's variance makes
fatal (±79 bb/100 at 160,000 hands, ranking nothing).

**A bot may read hidden information only where its ACTION doesn't leak
the read.** A mahjong discard is public the instant it applies; a poker
fold is a decision derived from whatever was looked at. Poker's bot is
therefore blinded to everything but its own cards and the board, and a
self-check enforces it — copy that test into any future betting game.

**→ [bots.md](bots.md)** is the deep dive: each game's decision order and
scoring, the full tier tables, the measurement method and numbers, and
the findings in full. Read it before tuning anything.

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

### What a repaint must not destroy

Every game rebuilds its tiles wholesale (`textContent = ""`) on every
broadcast. That is what keeps the render loop simple enough to trust,
and it's non-negotiable — but it means anything the **browser** was
holding rather than the model dies with the old nodes. At a twelve-seat
poker table someone acts every second or two, so this reads as the page
fighting the user: scroll the roster and it snaps back, start typing a
chip value and the caret vanishes, arm a two-step Confirm and it silently
disarms before you can click it.

`render()` therefore photographs and restores two things around the
rebuild — **scroll offsets** (`snapScroll` / `restoreScroll`) and the
**focused field plus its caret** (`snapFocus` / `restoreFocus`). Both
match nodes by class list + ordinal rather than by identity: nothing here
has a stable id, and giving everything one would be a bigger change than
the bug is worth. A node that moved or was renamed simply doesn't
restore.

Anything else that must survive a repaint is **state, and belongs in
`ui`** — never on a DOM node. `ui.raiseDraft`, `ui.settingsPinned`, and
`ui.showToPick` are the pattern. The two-step pills follow the same rule
through **`TBL.confirmPill(key, label, confirmLabel, onGo)`**, which
holds the armed flag (as its own disarm timer) in the shell, keyed by
name. Before that it lived on the button as `b._armed`, and the button
you clicked Confirm on was two renders younger than the one you armed.

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
`fitLog`, `mySeat`, `seatName`, `seatedCount`, `seatDot`, `seatAccent`,
`timerRing`, `timerText`, `timerLeftMs`, `fmtClock`, `pill`, `chip`,
`setRow`, `choiceRow`, `toast`, `pop`, `skew`, `graceSecs`, `logLines`, `ui`,
`code()`, `boot()`, and the utilities (`el`, `load`, `save`, `fmt`,
`slugify`, `reduceMotion`).

### Seat colors — who gets which

`games/colors.js` is the contract (vendored verbatim into every worker).
Six `PRESETS`, mutually ~100+ redmean units apart; `clash()` refuses
anything within `MIN_DIST` (60) of a seat already taken. That is the only
validation — proximity to a game's own board or felt is deliberately
unchecked (his call).

Auto-assign is **`freeColor(taken, rand)`**, not `freePreset`. It hands
out an unused preset while one exists, so a ≤6-seat table behaves exactly
as before; past that it GENERATES one:

- in a **safe band** — HSL at fixed mid saturation and lightness, never a
  flat 24-bit random. A random hex is near-black, near-white or mud about
  a third of the time, and a seat dot has to read on a light theme, a
  dark one, and against a felt. Fixing S and L is also what lets hue
  distance stand in for perceived distance;
- placed by **widest gap on the hue circle**, jittered inside it, with
  the lightness stepped either side of centre on alternating picks
  (past six seats the gaps subdivide, and two hues 20° apart clear the
  distance test while still reading as one color).

Gap placement rather than roll-until-it-clears because retrying degrades
exactly where it matters: the twelfth seat has the least room, so it is
the one whose random tries all fail. `freePreset` — which fell back to
preset 0 — is why every seat past the sixth at a poker table used to
arrive wearing the identical red.

Callers: `sit` and `addBot` in both `table-mock.js` and `table-do.js`,
and poker's `randColor` for the mid-game sit-in. A game's page should
never roll its own hex; poker.js's `seedDistinctColor` (the one case the
table can't foresee — a profile color landing on someone) calls the same
generator.

### Seat accent — `--gseat`

`--gseat-0..5` are the six palette slots. `--gseat` (no index) is the same
contract one step down: *whichever seat this element belongs to*. A game
never writes the token by hand — it calls `TBL.seatAccent(node, seat)` and
reads `var(--gseat, <fallback>)` in its own CSS:

```js
TBL.seatAccent(strip, i);                                 // in the game's JS
```
```css
.cities-pstrip { border-left: 3px solid var(--gseat, var(--border)); }
```

**Always give the `var()` a fallback** — the accent is unset on nodes that
belong to no seat. Cities and mahjong each invented this privately
(`--cstrip` / `--mjstrip`) before it was promoted; a third name is a bug.

### Turn timer

**The clock is not a game's to build.** Three layers own three things:

| Layer | Owns |
| ----- | ---- |
| `games/table-do.js` | The clock itself — arms `turnEndsAt` for whatever obligation is outstanding, fires `timerExpire` on its own alarm |
| `games/table.js` | Both readouts, self-ticking at 250 ms |
| the game | Only whether the clock runs (`settings.timerSec`) and where the readouts hang |

```js
head.appendChild(active && timed ? TBL.timerRing(i) : TBL.seatDot(i));
TBL.timerText(el("div", "cities-timer"));    // a text node showing M:SS
```

`timerRing(seat)` returns a seat dot wearing a radial countdown; it drains
in that seat's accent and turns `--stop` for the last ten seconds.
`timerText(node)` drives a text node. Both stop on their own when their node
leaves the DOM, and both read only public broadcast fields, so **spectators
see exactly what players see** — don't reimplement either from `you`.

Each readout keeps its tick handle **on its own node**, so any number run at
once. That matters: mahjong's claim window waits on several seats
simultaneously, and the per-game versions this replaced shared one module
global, so every ring but the last silently froze.

A game that wants no timer simply never offers `timerSec` — nothing else to
turn off.

### "Your turn" title flash

A hidden tab is the one place a turn can pass unnoticed, and with the
timer armed an unnoticed turn is a folded hand. `games/table.js`
alternates the document title with the game's own `S.yourTurnToast`
whenever it is your turn **and** `document.hidden` — the tab strip being
the only surface we own when nobody is looking at the page.

There is no new copy and no new hook: a game **opts in by having
`yourTurnToast`**, which cities, mahjong and poker all already did for
the on-page toast. Turn detection is the shared `model.turn.seat`
convention the DO's own `dlSig`/`armAlarm` already run on, so nothing is
per-game. Under `prefers-reduced-motion` the alert is set once and left
up — the information survives, the blinking doesn't.

Two things are load-bearing if this is ever touched:

- The base title is captured **only when not already flashing**. A
  second start would otherwise capture its own alert text and "restore"
  the page to it permanently.
- The interval tracks its phase in a **closure**, not by comparing
  `document.title` — a game whose title happened to equal the alert
  string would stick.

### Fly-ins: `games/flights.js`

**A game does not write a flight loop.** Cities grew one, mahjong copied
it (with a fix cities never got back — the two-pass frame), and poker
would have been the third. The shared layer owns four things a game must
not re-decide:

| Layer | Owns |
| ----- | ---- |
| `games/flights.js` | The overlay, the rAF loop, the ease-out cubic, the born/caught scale curve, the launch jitter, `push`/`flush`/`clear` |
| the game | Which events fly, what a chip node looks like, and where a point is on ITS screen |

```js
var FLY = GameFlights.create({
  section: "section.pk", layerClass: "pk-flylayer",
  alive: function () { return !!model; },
  catchClass: "pk-catch"          // optional — the destination acknowledges
});
FLY.push(function () { FLY.launch(chipNode(), fromFn, toFn, i * FLY.STEP); });
```

- **Collect during event replay, `flush()` in `postRender`.** A flight
  launched mid-replay measures a DOM that hasn't caught up with the
  broadcast, so its target is the *old* layout or nothing at all.
- **A target is a FUNCTION, never a point.** The loop re-queries it every
  frame, so a panel that re-renders, scrolls or reflows mid-flight is
  tracked rather than missed.
- **The layer is parented inside the game's `<section>`.** Every game
  palette is scoped there; a body-parented layer resolves each chip's
  colour to nothing.
- **`reduceMotion()` gates the game's `collectFlight`, not the engine.**
  Motion is decoration over a state the DOM already carries, so dropping
  every flight has to cost nothing but the theater.
- `onAbort` / `onLand` exist for a count that lags its chip (cities holds
  an inbound resource out of the hand until it lands, so the landing bump
  and the increment are one beat). A chip that never launches has to give
  the held count back — that is what `onAbort` is for.

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
`needsPhantom()`, `phantomOne()`, and — since results — `gameName()`.
Both drive hooks should delegate to the engine's `botPending` / `botAct`
via the base's `botAt()` and `tierOf()` (see "Bots"); a worker that still
carries its own copy of a brain is a bug waiting to drift.
A real-teams game also overrides `TEAMS` (see "Teams").

**Optional:** `EXTRA_STATE` (extra persisted keys as `{key: () => initial}`),
`capacity()` (default: the `capacity` setting; a fixed-size table returns a
constant), `maskEvent`, `compactSeatsAtStart`, `onStart`, `onGameOver`,
`onRematch` (drop any per-game state the discarded game owned; neither game
needs it yet), `onJoined`, `extraCommand` (a verb the engine doesn't own —
cities' `bet`), `deadlineBonusMs()` (see "The one alarm"), and the results hooks `seatStats(i)`, `seatCounters(i)`,
`resultDetail()` ([stats.md](stats.md)).

**The base records a finished game itself.** `onGameOver()` is the game's own
settle-up, not the reporting hook — the base calls `reportResults()` after it
resolves either way, so no game can forget to record itself and a new game
gets results for free. A game that supplies no counter hooks still lands its
standings, its settings and its occupancy ledger.

### The one alarm

A single storage alarm multiplexes four deadlines, nearest wins:

1. **disconnect grace** — `seat.graceUntil`, 30 s, then the seat becomes a bot
2. **the table deadline** — `deadlineFor()` ms, re-armed only when `dlSig()`
   changes, so unrelated broadcasts don't reset a running countdown. Only a
   **connected human's** clock runs: a disconnected player is the grace
   window's business, a bot's is the drive cadence's. `deadlineBonusMs()`
   (optional, default 0) is the one way to move a *live* deadline: the base
   reads it as a running total and pushes `turnEndsAt` out by however much it
   grew, so a game can lengthen a countdown mid-obligation without restarting
   it (cities' trade bonus). Re-arming under a new `dlSig` would hand back the
   seconds already spent — that is why the bonus is a total, not an event
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

## Change radius — read this before you edit

Most mistakes here are not bad code; they are **code in the wrong file**.
A fix written one level too low gets duplicated into the next game; one
level too high changes a game nobody asked you to touch. Find the row that
matches what you're changing, and check the blast radius before you start.

| I want to change… | Edit | Radius | Also required |
| --- | --- | --- | --- |
| One game's board, art, layout, copy | `<game>/<game>.{js,css}`, `<game>/strings.js` | That game only | — |
| One game's rules | `<game>/engine.js` | That game only | **Re-vendor** into `../Deets<Game>/src/`, redeploy |
| **How that game's bot plays, or its difficulty tiers** | `<game>/engine.js` (`botAct`, `BOT_TIERS`) | That game only | **Re-vendor**, redeploy — see "Bots" |
| The tier's wire field, validation, and the lobby picker | `games/table-do.js` + `table-mock.js` + `table.js` | **Every game** | **Re-vendor** the base into every game worker, redeploy |
| The table shell's chrome (gate, lobby, seats, toolbar) | `games/table.js` + `styles/table.css` | **Every game** | — (browser-only) |
| Seat colours / the accent contract | `games/colors.js` | **Every game + `/profile/`** | **Re-vendor** into all three worker repos |
| The turn timer, grace window, rejoin, bots, reconnect, teams | `games/table-do.js` | **Every game** | **Re-vendor** into every game worker, redeploy |
| Away seats (`awayAction`/`adoptAction`), the `standCopy()` wording hook | `games/table.js` + `table-mock.js` + `table-do.js` | **Every game** (no-op without the spec keys) | **Re-vendor** all three workers |
| The spans ledger, the event archive, the results POST | `games/table-do.js` | **Every game** | **Re-vendor**, redeploy; see [stats.md](stats.md) |
| What a game records about a finished game | that worker's `src/index.js` (`seatCounters` et al.) | That game only | Redeploy · `node scripts/check.mjs` · maybe an `ALTER TABLE` in `../DeetsAccounts` |
| Site header, nav, settings menu, toasts, `.page-bar`, `.sotd__bar`, the `tb-` kit | `styles/chrome.css` | **Every page on the site** | — |
| A non-game tab's own styles | `styles/main.css` | That tab only | — |
| Tokens (a colour role, a shape/motion value) | `themes.css` / `skin.css` | **Everything, all 30 combos** | — |

Three rules that follow from the table:

1. **Vendored files are contracts.** `games/table-do.js`, `games/colors.js`,
   `cities/engine.js` + `board-data.js`, and `mahjong/engine.js` are copied
   **byte-identically** into the sibling worker repos. Editing one here and
   not re-vendoring means the mock and production run different code — the
   worst class of bug this repo can produce, because it only shows up live.
   Verify with a plain `diff` before you consider the change done.
2. **A game page does not load `styles/main.css`.** It loads
   `chrome.css` → `table.css` → `<game>.css`. If a game needs a rule that
   lives in `main.css`, the rule is in the wrong file — promote it to
   `chrome.css` rather than copying it.
3. **When two games need the same thing, promote it — don't copy it.** The
   promotion path is: game → `table.js`/`table.css` (if it's table shell) or
   → `chrome.css` (if it's site chrome). The turn timer and `--gseat` are
   both examples of a promotion that should have happened at the second
   game and didn't; the duplication survived two games and a bug rode along
   in it. If you find yourself pasting from cities into mahjong, stop.

### Build style, precedent, and taste → design-language.md

**[design-language.md](design-language.md)** carries the precedent half
of building a game: the design questionnaire, why each bento surface
exists, the pattern index (game concept → the sibling that already built
it), the decision trees (bots/rejoin, settings, seat colors vs.
carve-out, `[ph]` exemptions), the jitter techniques by name, the
mock-first build order, and the build-style rules that used to live in
this section. Read it before *designing* anything; read this file before
*wiring* anything. One rule stays here because it is law, not taste:

- **The universal layout rule: no piece may resize another.** Anything
  that appears and disappears (a raise tray, a hover hint, a state chip
  row, a popover) either lives in an absolute overlay or holds its space
  when empty (`visibility: hidden` ghosts, fixed-height reserved rows,
  min-heights). Cities wrote the rule; every game inherits it —
  design-language.md names the enforcement techniques.

### Known duplication, not yet promoted

Honest list, so the next session doesn't rediscover it:

- **The players tile.** `.cities-pstrip`, `.mj-pstrip`, and now
  `.pk-pstrip` have identical anatomy — same flex geometry, padding,
  border, accent edge, radius, `.is-active` and `.is-away` states. A
  `gt-pstrip` primitive is the obvious next promotion; it was left alone
  because it means renaming classes in the games' JS and CSS, which is a
  refactor rather than a move.
- **The board-popover kit.** `cities.js` and `poker.js` each carry the
  hover-preview / click-pin / grace-timer popover machinery and the
  `.cities-bpop` / `.pk-bpop` panel geometry. Third game that wants a
  board popover promotes it into `table.js` + `table.css` instead.
- **The log list's dress.** `.cities-log__list/__line` and
  `.pk-log__list/__line` are the same rules (0.82rem, 2px gap, thin
  scrollbars, last line in `--title`); mahjong's differs only in detail.
  Rides along with whichever of the above gets promoted first.
- **The panel material** (`--menu-surface` + backdrop-filter + border +
  `--radius-panel` + `--shadow-panel`) is written out six times across
  `chrome.css` and `table.css`. A `.panel` primitive would collapse them,
  but it touches `.page-bar`, `.sotd-toolbar`, `.tb-pop`, `.menu` and
  `.gt-gate` at once — see [css-split.md](css-split.md).
- **The text-field recipe** (`--surface` + border + `--radius-control`)
  appears seven times across `chrome.css` and `table.css`.

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
  `table.js` overrides each slot with the seat's actual pick. Paint a
  game-owned node with `TBL.seatAccent(node, seat)` and read `--gseat`;
  never invent a per-game accent token.
- **The turn timer is the shell's.** Offer `timerSec` in settings and hang
  `TBL.timerRing(seat)` / `TBL.timerText(node)` where you want them. Don't
  write a countdown.
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

0. **Design it first** — [design-language.md](design-language.md): the
   questionnaire, the precedents, and the decision trees that turn a
   design chat with Aditya into a dated decisions list. The doc lands as
   step 7's opening section.
1. `<game>/engine.js` — rules, `createGame(opts, ctx)` /
   `applyAction(game, action, ctx)` → `{game, events}` or `err(code)`,
   `ctx = {rand, now}`, plus self-checks.
2. `<game>/strings.js` — every string, `[ph]`-prefixed until Aditya writes it.
3. `<game>/index.html` — copy a sibling's; swap the prefixes and the scripts.
4. `<game>/<game>.js` — `DeetsTable.create({...})` + the board UI.
5. `<game>/<game>.css` — the game's art and bento, its own stylesheet
   ([css-split.md](css-split.md)). The page links, in order:
   `styles/chrome.css` → `styles/table.css` → `<game>/<game>.css`. A game
   page does **not** link `styles/main.css`; if you find yourself wanting a
   rule from it, that rule belongs in `chrome.css` instead.
6. `../Deets<Game>/` — worker repo: `GameTable` subclass, `wrangler.jsonc`,
   `scripts/vendor.mjs`, then `npx wrangler deploy`.
7. `docs/<game>.md` — the rules, the game's own view fields, its art plan.
8. Link the tab from the nav in every game page and the home page.

What you should NOT have to write: identity, recents, the code combobox, the
gate, join/leave, reconnect, version resync, the lobby, bots, seat colors,
the seat accent, the turn timer and its readouts, kick, host fallback, the
toolbar, grace countdowns, the alarm, the fuse, or any of their CSS.

If you catch yourself writing one of those, the answer is already in
`games/table.js`, `games/table-do.js` or `styles/table.css` — go find it
rather than write a second copy. See "Change radius" above.
