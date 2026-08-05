# DeetsTanks — top-down tank arena, PvE campaign + PvP mode

A Wii-Play-Tanks-style game: top-down, real-time, slow ricocheting shells,
small grid arenas, hand-designed levels. Built on the **real-time**
foundation ([realtime.md](realtime.md) — read that first; it owns the
tick, the authority model, the Durable Object posture and the cost
model), which is itself a sibling of the turn-based one
([games.md](games.md)).

**Nothing is built.** No branch, no files, no worker, no sprites. This
document is the design record from chats on **2026-08-05**, written to be
buildable from cold — file layout, module boundaries, API surfaces, the
level format, the art pipeline. Two things are still Aditya's to invent
and they block the engine: **the terrain vocabulary** and **the enemy
tank types**. Everything is shaped to receive them.

---

## Decisions already made

His calls, chat 2026-08-05, unless marked.

1. **PvP is a separate mode, not a table setting.** It changes the win
   condition, and by the settings filter
   ([design-language.md](design-language.md)) that makes it rules, not a
   toggle. **PvE is the default.**
2. **PvE is a campaign**: numbered levels, **3 lives**, enemy tanks that
   grow harder as levels climb, and **terrain that changes per level**.
3. **Aditya designs the levels.** This is why `tanks/designer.html`
   exists, and why the level format is a first-class design problem
   rather than an implementation detail.
4. **Hull moves on WASD, so it has exactly 8 facings** (45° steps).
   Turret aims at the mouse and **rotates freely**.
5. **Art is hand-drawn high-resolution raster, not pixel art.** He is not
   attached to the pixel look — it was chosen because MS Paint makes it
   easy. Drawing large and displaying small is easier *and* removes every
   rotation artifact. See "Art".
6. **Floor art may stay chunky/pixel-ish** — it never moves or rotates,
   so it pays none of pixel art's costs. Subject to the one-apparent-
   pixel-size rule below. Deliberately left swappable.
7. **Layered renderer**, his structure: floor beneath, hulls and
   obstacles above, turrets above those. Refined here into a
   static-vs-dynamic split (see "Renderer").
8. Inherited from [realtime.md](realtime.md): server-authoritative sim in
   a non-hibernating DO, 60 Hz sim / 20 Hz broadcast, deterministic
   projectiles as one event each, all rendering client-side, mock-first
   with injected latency.
9. **Campaign only for the MVP** (second pass, 2026-08-05). No mode
   chips in the lobby; PvP is deferred wholesale, not stubbed.
10. **Table settings are exactly three: lives, aim-lines, friendly
    fire** — plus the usual color picker and participants table every
    game carries. Aim-lines and friendly fire thereby move from "still
    to design" to settings; UI text is minimized everywhere — icons
    over words wherever a sibling precedent allows.
11. **Bento mapping, pinned against siblings**: the controls live where
    poker's hand panel sits (the role tile); the campaign counter takes
    the slot mahjong's tile-count panel occupies; lives and kills ride
    the **participants table** itself. **No log** — Tanks ships without
    a kill feed.
12. **Level 0 is the tutorial**: an open arena, no interior terrain,
    one stationary enemy diagonally opposite whose turret slowly
    rotates to track the player and fires rarely. **Level 1 introduces
    wall terrain.** The campaign is 0-indexed.
13. **Player fire rate is capped at 2 shells/second.**
14. **Wii Play is the foundation wherever a number or rule is needed**
    (2026-08-05): shells bounce once and die on the second wall hit; at
    most 5 live shells per tank; **mines are in** (2 per tank, space to
    lay, arm delay, proximity + shell-triggered); dying costs a heart
    and restarts the level; all hearts gone → campaign over, back to
    level 0.

**Simplification, recorded:** the hull snaps instantly to its new facing
rather than turning at a rate. Snapping is more responsive, matches Wii
Play's feel, and keeps the hull at 8 discrete cached frames. A turn rate
would sweep through intermediate angles and drag free rotation back into
the hull. Revisit only with hands on it.

---

## File layout

```
tanks/index.html            the page (bar + bento) — links chrome.css, table.css, tanks.css
tanks/strings.js            ALL user-facing copy ([ph] convention)
tanks/engine.js             the sim: pure, DOM-free, deterministic, self-tested   ~1100
tanks/tanks.js              shell hooks, bento/HUD, mode + campaign flow           ~500
tanks/render.js             the layered canvas renderer                            ~400
tanks/net.js                prediction, reconciliation, snapshot interpolation     ~350
tanks/art.js                sprite load, probe-once fallback, hull pre-rotation    ~200
tanks/input.js              WASD bitmask + pointer angle → input struct            ~100
tanks/transport-mock.js     the mock's game half (a spec on table-mock.js)         ~300
tanks/tanks.css             the game's own art + layout                            ~400
tanks/designer.html         the level designer — unlisted, self-contained          ~600
tanks/levels.js             GENERATED: every level inlined as a string
tanks/levels/*.txt          the campaign, one plain-text grid per level (source)

assets/sprites/tanks/       built sprites + README
art-src/tanks/*.png         his MS Paint originals (512px, magenta background)
scripts/build-tanks-art.py  chroma-key → trim → recolor → downsample; emits templates
scripts/build-tanks-levels.py  validates every level, emits tanks/levels.js

../DeetsTanks/              phase 4; does not exist yet
  src/index.js              TanksTable extends RealtimeTable
  src/rt-do.js              VENDORED VERBATIM
  src/engine.js             VENDORED VERBATIM from tanks/engine.js
  src/colors.js             VENDORED VERBATIM
→ tanks-api.deets.solutions
```

`node tanks/engine.js` runs the self-checks.
`node scripts/build-tanks-levels.py` fails loudly on an invalid level.

**Deviation, recorded:** siblings put the whole client in one
`<game>.js`. Tanks splits into five. A real-time game has genuinely
separable concerns (sim-adjacent netcode, a canvas renderer, an art
pipeline, an input mapper) that a turn-based one does not, and three of
those five are the promotion candidates for `games/rt-*.js`
([realtime.md](realtime.md), "The promotion question"). Keeping them
separate from the start is what makes that promotion an afternoon.

---

## The engine

Pure, DOM-free, dual-export, deterministic. No `Math.random()` — the PRNG
is state, seeded by the server at `init`. No `Date.now()` — the tick
number is the only clock.

```js
TICK_HZ                                  // 60
parseLevel(src)        -> level          // throws on malformed
validateLevel(level)   -> problems[]     // [] when good
init({level, seats, mode, seed}) -> state
step(state, inputs)    -> events[]       // advances EXACTLY one tick
snapshot(state)        -> plain          // wire-safe, JSON-able
restore(snap)          -> state
aimSolve(state, from, target, bounces) -> angle | null   // shared by AI and the aim hint
```

`inputs` is `{ [seat]: {drive, aim, fire, mine, seq} }` — `drive` 0–8
(0 = still, 1–8 = facing), `aim` a quantized angle, `seq` the client's
input sequence number for reconciliation.

### State shape

```
state = {
  tick, prng, mode, phase,          // phase: playing | cleared | dead | over
  level,                            // parsed, immutable
  blocks: Uint8Array,               // destructible state, parallel to the grid
  tanks:   [{ seat, type, x, y, hull, turret, alive, lives, cooldown, shells, mines }],
  bullets: [{ id, owner, x, y, vx, vy, bounces, bornTick }],
  mines:   [{ id, owner, x, y, armedAt }],
}
```

### Bullets are events, not streams

A shell is fully determined by `{id, owner, tick, x, y, angle, speed,
maxBounces}`. The server broadcasts that **once**; every client simulates
the whole flight locally. Zero further bandwidth, perfectly smooth, no
interpolation artifacts. The server runs the same bullet and remains the
**sole authority on deaths**.

Bullets still appear in `snapshot()` so a late joiner or a resync sees
mid-flight shells — but that path is the exception, not the per-tick
norm.

Ricochet is a reflection off the grid; `maxBounces` per shell type, and
the shell dies on expiry.

### Enemy AI

Lives in `engine.js`, per house rule ([games.md](games.md)) — never in a
mock, never in a worker, so the two cannot drift.

**Difficulty is not `BOT_TIER_LIST`.** That contract assumes a bot
occupies a *seat*; Tanks enemies are world state. Difficulty rides the
**enemy type**, and the level chooses which types it spawns. Recorded
here because [design-language.md](design-language.md)'s decision tree
does not cover it.

Per-type behaviour parameters, all engine constants:

| Parameter | What it tunes |
| --- | --- |
| `speed`, `turnRate` | how fast it repositions |
| `bounceDepth` | how many ricochets `aimSolve` will plan through — **the main difficulty dial** |
| `reactionMs`, `aimError` | how quickly and how accurately it acquires |
| `cooldown`, `maxShells` | rate of fire |
| `mines` | whether it lays them |
| `evade` | whether it dodges incoming shells |

`aimSolve` — reflecting the shot path off walls to find an angle that
reaches the target within N bounces — is the same routine the AI uses and
(optionally) the player's aim hint. Writing it once is what makes a
bank-shot enemy cheap.

---

## The level format

The canonical level is a **plain-text file**, one per level, in
`tanks/levels/`. Not JSON, not a JS array, not the designer's private
format.

A level *is* a grid, and a monospace text file already is one: it diffs
legibly in git, it can be hand-edited without launching anything, and a
corrupt one is obvious at a glance.

```
name   [ph] Crossfire
tier   3

legend
  .  floor
  #  wall, indestructible
  =  block, destructible
  P  player spawn
  1..n  enemy spawn, digit = tank type

grid
  ####################
  #..P.......=......1#
  #....====..=..###..#
  #....=........###..#
  #2.........=......P#
  ####################
```

Position and type ride the **same character** — the retro trick, and it
keeps the grid readable as a picture of the level.

- **`engine.js` owns the parser** (`parseLevel`), covered by self-checks,
  so the designer, the mock and the worker cannot disagree about what a
  level means.
- **The designer reads and writes this and nothing else.** A level typed
  in Notepad must open in the designer, and vice versa.
- `name` is user-facing copy and arrives `[ph]`-prefixed until his pass.
- **`scripts/build-tanks-levels.py` validates every level and inlines
  them all into `tanks/levels.js`** as strings. A static site has no
  directory listing, so a manifest is needed anyway; inlining also means
  zero fetches at runtime and validation that runs at build time, not
  only in the designer. Thirty levels is ~15 KB.

`validateLevel` checks: grid rectangular, exactly one player spawn per
supported seat, no spawn inside a wall, every enemy reachable from a
player spawn (flood fill), legend covers every character used.

**Blocked on him:** the legend above is a placeholder. The real terrain
vocabulary — destructible blocks, holes that stop tanks but not shells,
teleporters, whatever else — is a set of mechanics, and mechanics are his
to invent.

## The level designer

`tanks/designer.html` — an unlisted dev page, not in the nav, in the
spirit of the existing untracked `design-matrix.html`. No build step, no
dependency, no server: one page that reads and writes text.

- **Paint terrain** from a tile palette; drag to fill, right-click to erase.
- **Place spawns** — player start and each enemy, picking the type as it drops.
- **Import** by paste or drop; **export** by clipboard copy or download.
  He saves into `tanks/levels/`. That is the whole round trip.
- **Validate** inline via `engine.validateLevel`, with failures shown
  against the grid.
- **Play-test in place** — a button that boots the in-page mock on
  whatever is currently on screen. Near-free, since the mock already runs
  the full sim in the browser, and it is the feature that makes the
  designer worth building instead of editing text by hand.

The rule that keeps it honest: **the designer imports `render.js` and the
real sprite art.** Not an approximation. WYSIWYG then becomes structural
rather than a maintenance chore, and the editor cannot drift from the
game — the failure that kills most homemade level editors inside a month.

**Scheduling note:** the designer needs only the parser, the validator
and the *static* renderer. It does not need netcode, prediction, or the
worker. So it can land very early and unblock his level design while the
netcode is still being built. See "Build order".

---

## Art

### Draw big, display small

The whole rotation problem is an artifact of too few source pixels.
Drawing large and downsampling turns resampling into **supersampling**,
and every artifact — crawl, jaggies, mushy diagonals — disappears.

| Stage | Size |
| --- | --- |
| His MS Paint original | **512×512**, subject centred on its rotation pivot |
| Stored sprite (built) | ~3× display, e.g. **168px** for a 56px tank |
| On screen | ~56px tank on a 64px tile |

Drawing at 512 is also just easier with a mouse than drawing at 32, and
the downsample quietly cleans up wobbly edges for free.

### What he actually draws

- **`hull.png`** — one drawing. Facing "up".
- **`turret.png`** — one drawing, centred on the pivot where it meets the hull.
- One `tile-<name>.png` per terrain type.
- `bullet.png`, `mine.png`, an explosion strip.

**Two drawings cover the entire tank cast.** Enemy variants are recolours
generated by the build script from a per-type colour map, not redraws —
which is why the source art should use a **small set of flat fills**, so
the recolour is exact-match rather than fuzzy. Flat fills are what MS
Paint's bucket produces anyway.

The 8 hull facings are generated **at load** by rotating the sprite into
an offscreen canvas array. 90° rotations are lossless; the 45° set is
resampled once and cached, so it never crawls. The turret is drawn
free-rotated per frame from the 3× sprite — small, mostly barrel, and
oversampled enough to stay clean.

### The pipeline

Paint's transparency handling is unreliable across versions, so don't
fight it — **chroma key**. He draws on solid magenta (`#FF00FF`), which
never occurs in real art, and `scripts/build-tanks-art.py` keys it out,
trims to a consistent box, applies the per-type colour maps, downsamples,
and writes `assets/sprites/tanks/`.

The same script **emits blank templates** — correct canvas size, the tile
circle drawn as a guide, the pivot marked — so he is never guessing at
framing. Same house pattern as `build-mahjong-tiles.py` and
`build-poker-chips.py`. Art ships by landing a file: the game probes once
per stable filename and falls back to a geometric placeholder, so the
game is playable before a single sprite exists, and a README sits in the
sprites folder.

### Floor art and the one rule

The floor never moves and never rotates, so it pays none of pixel art's
costs and may stay chunky if he likes it.

**The rule: one apparent pixel size across the frame.** A 4px-chunk floor
under smooth-edged tanks reads as stickers pasted onto the world —
different apparent resolution reads as different media, and the eye
catches it instantly.

The easy way to satisfy it: **do not upscale the floor.** Draw tiles at
roughly display size (64×64 for a 64px tile) rather than 16×16 blown up
4×. Then "pixel art floor" just means "hand-textured floor" and coexists
with downsampled tanks without any clash.

Tile seams are on-style here, incidentally — Wii Play Tanks is played on
a cork board with a visible grid.

If he *does* want deliberately chunky ground under smooth actors, that is
a legitimate look, but it is an eyes-on call. The layer split below makes
it reversible without touching a line of tank code.

---

## Renderer

His three layers, refined: the division that earns its keep is **what
changes and what doesn't**, not floor vs obstacles.

```
static     floor + indestructible walls    → rendered ONCE at level load
dynamic    destructible blocks, mines, tank hulls
turrets    above hulls — a barrel overhanging a neighbour reads right
bullets    above tanks — the lethal object must always stay legible
effects    explosions, muzzle flash, smoke
overlays   nameplates, aim line
```

Indestructible walls belong with the floor because they never change.
That lets the entire background render into **one offscreen canvas at
level load** and blit with a single `drawImage` per frame — most of the
render cost, gone. It also makes scorch marks and bullet holes nearly
free: stamp them permanently onto that same canvas.

Destructible blocks span both. Keep them dynamic; if it ever matters,
re-render the static layer on destruction, which happens a handful of
times per level.

**One visible `<canvas>` plus one offscreen static canvas**, not stacked
DOM canvases — simpler, and no compositing cost. Stacked canvases are the
fallback only if the static layer ever needs its own CSS filter.

Native resolution, not a low-res upscaled buffer (that is Doom's need,
not this one). The arena is small and fits whole — **no camera scrolling
in v1**. Prefer an integer scale factor if the floor ends up chunky.

Render loop is `requestAnimationFrame`; the sim runs on a fixed-timestep
accumulator, entirely decoupled ([realtime.md](realtime.md)).

---

## Netcode

Per [realtime.md](realtime.md), nothing game-specific:

- The DO is authoritative and the sole judge of damage, death, pickups
  and scoring.
- Each client **predicts its own tank** from local input immediately —
  zero-latency movement — and reconciles against the next snapshot.
- Every other entity is **interpolated** ~2 broadcast ticks behind server
  time, so there are always two snapshots to lerp between.
- Bullets are predicted from their spawn event, as above.

### Wire

Client → server: `input`, ~20 Hz, carrying the **last N ticks** of input
rather than one, so a dropped packet costs nothing.

Server → client: `tick` (snapshot, 20 Hz) and `ev` (typed events: fire,
hit, death, block destroyed, level cleared).

**`games/transport.js` needs no changes.** Its `onmessage` special-cases
only `pong`, `error`, `kicked`/`closed`, `snapshot` and `state`;
everything else is delivered untouched. Naming the real-time messages
`tick` and `ev` keeps them clear of the `v`-gap resync logic, which
exists for turn-based deltas and would force a pointless reconnect on
every dropped tick.

**And the sim channel must bypass the shell's paint path.**
[table.js:393](../games/table.js) turns `state` into a full `cfg.render()`
DOM rebuild; at 20 Hz that is twenty DOM teardowns a second under the
frame loop. Lobby/roster/participants traffic goes through `paint()`;
`tick` and `ev` go straight into the interpolation buffer. HUD panels
update on-change or at ≤10 Hz, never per frame.

---

## Page layout

Standard bento ([design-language.md](design-language.md), "form follows
information"), nothing invented:

- **Big tile** — the arena. Fixed `clamp()` height, letterboxed to the
  grid's aspect.
- **Participants table** — carries lives and kills per seat, alongside
  the usual color picker. No separate stats rail.
- **Campaign counter** — takes the slot mahjong's tile-count panel
  occupies: level number + enemies remaining.
- **Role tile** — the controls, sitting where poker's hand panel sits.
  A tank has no hidden state, so this is a controls strip plus the
  shell/cooldown readout, not a sibling-sized panel.
- **No log.** Tanks ships without a kill feed (his call, 2026-08-05).
- **Between levels** — the interstitial precedent is mahjong's `handOver`
  settlement card: auto-advancing, over the big tile, never a new layout.
- **Lobby phase** — Tanks has an answer Doom does not: render the chosen
  level static, as its own preview.

**No mode selection in the MVP** — campaign only. When PvP arrives it
is a mode chosen once in the lobby, *not* a table setting (it changes
the win condition), and it carries its own settings.

---

## Build order

1. **Engine + self-checks, no UI.** Grid, movement, ricochet, collision,
   `parseLevel`/`validateLevel`, `aimSolve`, enemy behaviour. `node
   tanks/engine.js` is the whole test surface. Needs the terrain
   vocabulary and enemy types first.
2. **Static renderer + the designer.** Only needs the parser, the
   validator and layer one. **This unblocks his level design while
   everything else is still being built** — the highest-value early
   deliverable.
3. **The mock, with latency injection from day one** — configurable
   50/150/300 ms plus jitter, on a view setting. A zero-latency mock
   passes every prediction and interpolation bug straight through to
   production, where they are near-impossible to reproduce. Non-optional.
4. **Netcode against the mock**: prediction, reconciliation,
   interpolation, bullet events.
5. **Campaign flow** — lives, level advance, the interstitial, game over.
6. **Art pass** (his), against templates the script already emits.
7. **PvP mode.**
8. **The worker** — `../DeetsTanks`, vendoring `rt-do.js`, `engine.js`
   and `colors.js` byte-identically, porting the mock spec hook for hook.
   The mock is the reference implementation; where they disagree, the
   mock is right.

Phases 1–5 ship with **no worker repo in existence**, behind
`mockDefault: true`, exactly as poker did.

---

## Still to design

- **Terrain vocabulary.** Blocks the legend and the engine. His to invent.
- **Enemy tank types.** What distinguishes them, and whether "harder"
  means better types, more of them, or both. Blocks the AI table above.
- **Co-op lives.** The lives *count* is now a table setting; whether
  the pool is per-player or shared is still open, as is whether a dead
  player respawns next level or sits out.
- **Campaign progress.** Lose all lives — restart the level or the
  campaign? Does furthest-level-reached persist to the accounts D1
  ([stats.md](stats.md))? "Start at level N, once earned" is a plausible
  table setting; "skip to any level" is not.
- **PvP's own shape.** Arena choice, round structure, score to win — a
  separate mode means a separate design pass, deferred.

## State of the tab

**MVP BUILT, 2026-08-05** — branch `DeetsTanks`, mock-first
(`mockDefault: true`), playable at `/tanks/` on localhost. Honest
ledger:

- **Built:** `engine.js` (42 self-checks green), levels 0–1 +
  `scripts/build-tanks-levels.py` + generated `levels.js`,
  `transport-mock.js` (the 60 Hz sim loop, the 20 Hz tick channel, the
  `setLag` injector, the toolbar Lag pill), `net.js` (prediction /
  interpolation / local shell flight), `render.js` (static offscreen
  layer + dynamic, geometric placeholders), `input.js`, `art.js`
  (probe-once), `tanks.js`, `tanks.css`, `index.html`, the sprites
  README, nav links on every page. Verified headless: engine
  self-checks + a full wire-verb smoke of the mock stack (lobby →
  settings → start → ticks → input → fire → mine → cleared →
  auto-advance). **His visual pass is the open gate.**
- **One shell change, recorded:** `games/table.js` grew the `onRaw`
  hook — a game may claim a message (returns true) before the shell's
  model/paint path sees it. No-op for every existing game; it is how
  `tick` traffic bypasses the 20 Hz repaint trap.
- **Prediction simplification, recorded:** own-tank correction is a
  smooth blend toward the latest snapshot (snap past 0.6 tiles), not a
  seq-replay of unacked inputs. Revisit only if live latency makes the
  blend visible.
- **Not built:** `tanks/designer.html`, `build-tanks-art.py` (waits on
  the art pass), the `../DeetsTanks` worker (phase 4 — `rt-do.js` gets
  extracted from `transport-mock.js` then, per the promotion rule),
  PvP, stats reporting.
- **Copy: DONE.** He approved the whole of `strings.js` — and the level
  names — in one pass, chat 2026-08-05, the same day it was built. Zero
  `[ph]` left; new strings still arrive prefixed.
