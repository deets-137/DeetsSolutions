# DeetsTanks — top-down tank arena, PvE campaign + PvP mode

A Wii-Play-Tanks-style game: top-down, real-time, slow ricocheting shells,
small grid arenas, hand-designed levels. Built on the **real-time**
foundation ([realtime.md](realtime.md) — read that first; it owns the
tick, the authority model, the Durable Object posture and the cost
model), which is itself a sibling of the turn-based one
([games.md](games.md)).

**Built and playable on branch `DeetsTanks`** — the game, the level
designer, the terrain vocabulary and the full enemy cast all landed
**2026-08-05**. No worker and no sprites yet. Read "State of the tab"
at the bottom for the honest ledger of what exists; the sections
between are the design record from that day's chats, kept because they
carry the reasoning rather than just the outcome.

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
assets/sprites/tanks/<theme>/  per-level terrain tiles (cork, snow shipped)
scripts/build-tanks-art.py  chroma-key → trim → recolor → downsample; emits templates
scripts/build-tanks-levels.py  validates every level, emits tanks/levels.js
scripts/build-tanks-tiles.py   seeds a theme's terrain tiles from tanks.css

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
name   Crossfire
tier   3

legend
  .  floor
  #  wall, indestructible — stops tanks AND shells (ricochet)
  =  block, destructible — a shell opens it
  o  hole — stops tanks, shells fly OVER it
  P  player spawn
  1..n  enemy spawn, digit = tank type

tune
  bulletSpeed 7
  player.mines 4
  enemy6.bounceDepth 3

grid
  ####################
  #..P.......=......1#
  #....====..=..###..#
  #....=...oo...###..#
  #2.........=......P#
  ####################
```

**The hole is the terrain decision** (his call, 2026-08-05). It is the
only cell that makes "where can I drive" and "where can I shoot"
different questions — every other cell answers both the same way, which
is why a grid of walls alone can only ever be a maze. It costs one
extra solidity test: `solid()` governs tanks, `solidShell()` governs
shells and line-of-sight, and an enemy can therefore shoot you across a
gap it cannot cross. Holes block flood-fill reachability exactly like
walls.

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

`validateLevel` checks: grid rectangular, border fully walled, no spawn
inside terrain, every enemy reachable from a player spawn (flood fill),
every enemy digit present in `ENEMY_TYPES`, and every `tune` key present
in `TUNE_SPEC`.

---

## Tuning

A level may override physics in a `tune` block. Added 2026-08-05 on his
ask — "so I can modify as I get more of a feel for the game".

**It lives in the level file, and that is not a stylistic choice.** The
worker vendors `engine.js` byte-identically and receives only the level;
the client predicts against that same copy. Physics that are not *in the
level text* cannot survive the trip to the server, so a designer-local
tuning store would desync the moment the game left the mock. Putting it
in the file also means tuning needs no wire change at all.

```
scope.key value          # bulletSpeed 7 / player.mines 4 / enemy6.bounceDepth 3
```

- **`TUNE_SPEC` in `engine.js` is the single source of truth** —
  `[default, min, max, unit, scope]` per key. The parser validates
  against it, the build script reads it, and `designer.html` **builds
  its entire panel from it**. Adding a knob is one edit.
- **Values are in human units** — tiles/second, shells/second, seconds —
  because the file is hand-written. `resolveTune` converts once at parse
  time into the per-tick values the hot paths read, so `step()` never
  does a string lookup.
- **Precedence: spec default < global < enemy type < scoped.** The type
  is more specific than a level-wide override; the explicit scope beats
  everything.
- Scopes are `` (global), `player`, `enemy1`..`enemy9`. AI-only keys
  (`bounceDepth`, `evade`, `turnRate`, `aimErr`) refuse a `player`
  scope; global-only keys (`tankR`, the mine geometry) refuse any scope.

**The clamps are load-bearing, not politeness.** `stepBullet` advances a
shell one position per tick and tests the tile it lands in, so a shell
faster than ~0.5 tiles/tick passes straight **through** a one-tile wall.
`bulletSpeed`'s ceiling is that tunnelling threshold with headroom, and
raising it requires sub-stepping `stepBullet` first. The engine
self-checks assert the ceiling stays below the threshold.

### Shells are per-actor, not global

`bulletSpeed` and `bounces` resolve per tank, so the Lancer's flat rocket
and the Banker's slow two-bounce shell are tuning, not new code. Two
consequences that were latent bugs:

- **The shell carries its own bounce budget** (`mb`), stamped at fire
  time and **carried on the `fire` event**, because clients fly shells
  locally from that one event — a client that fell back to a global
  constant would kill the shell a bounce early and diverge.
- `bounceDepth` (how many ricochets the AI *plans* through) and
  `bounces` (how many the shell *survives*) are different numbers. A
  type with `bounceDepth: 2` and a one-bounce shell would calmly plan
  shots its own ammunition cannot complete.

## The pipeline — run this after editing levels

**Aditya designs levels in the designer, saves the `.txt` into
`tanks/levels/`, and then this has to run.** Nothing picks up a new or
edited level until it does: `levels.js` is generated, and a static site
has no directory listing, so the file on disk is invisible to the game
until it is inlined.

```
python scripts/build-tanks-levels.py
```

That validates every level and rewrites `tanks/levels.js`. It **fails
loudly** — a ragged grid, an open border, a spawn inside terrain, an
unreachable enemy, an enemy digit with no `ENEMY_TYPES` entry, or a
`tune` key that is not in `TUNE_SPEC` all stop the build with the file
and the reason named. A clean run prints one `ok` line per level.

Then confirm the sim still agrees with itself:

```
node tanks/engine.js
```

**If a future session is asked to "run the level pipeline", that is the
whole of it** — the two commands above, in that order, then report what
the validator said. Nothing else regenerates from a level edit; art and
tiles are a separate, deliberately manual path (see "The tile pack").

---

## The level designer

`tanks/designer.html` — an unlisted dev page, not in the nav, in the
spirit of the existing untracked `design-matrix.html`. No build step, no
dependency, no server: one page that reads and writes text.

- **Paint terrain** from a tile palette; drag to fill, right-click to erase.
- **Place spawns** — player start and each enemy, picking the type as it drops.
- **Open any campaign level** from a picker fed by the generated
  `levels.js`, or start the next one with "+ new level N".
- **Import** by paste or drop; **export** by clipboard copy or download.
  He saves into `tanks/levels/`. That is the whole round trip.

### The number is the filename

`levels.js` is generated from `tanks/levels/*.txt` in sorted order, so
**the slot a level occupies and the file it lives in are the same
fact**. A `number` field inside the file would be a second source of
truth for one thing, and the two would disagree the first time one was
renamed. So the designer's `#` box drives the download filename
(`07` → `07.txt`) and the `name` line is the title — nothing else is
stored.

A browser cannot write into the repo, so the round trip closes by hand
and the page says so, with the exact path and command:

```
save  ->  tanks/levels/NN.txt  ->  python scripts/build-tanks-levels.py
```

The slot is compared against the committed source, so it reads
**saved / edited / new**, and `revert` restores a campaign level. That
comparison is normalised for BOM and CRLF — and the build script now
reads levels as `utf-8-sig`, because Notepad and the designer's own
download both happily write a BOM, and one riding into `levels.js` is
an invisible stray character at the head of the first `name` line.

### Appearance

The page is **pinned to Moonlight + Ocean** (his call) rather than
reading the site's saved axes: it is a private tool with one intended
look. It can pin them statically because `controls.js` only *applies*
an axis from inside `buildMenu()`, which no-ops without a
`[data-settings]` mount — so the script is loaded purely for the
injected ocean layer, whose wave geometry lives in it and must not be
copied here. Content sits at `z-index: 1` above the fixed layer.
Moonlight's status lights are monochrome by design, so validation
severity carries a glyph (`✕ ! ✓`) rather than riding colour alone.
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

### What he actually draws — WIRED, 2026-08-05

`scripts/build-tanks-art.py` emits the templates and **`drawTank` now
consults them**. That second half is the part that was missing: the
probe had existed since the MVP but the renderer only ever drew
geometry, so a hull.png dropped in would have loaded and been ignored.

| file | who uses it |
| --- | --- |
| `hull.png`, `turret.png` | the neutral master — **tinted** to the seat colour |
| `hull-p1`, `turret-p1` | seat 0, blue — used **verbatim** |
| `hull-p2`, `turret-p2` | seat 1, red — used verbatim |
| `hull-eN`, `turret-eN` | one pair per `ENEMY_TYPES` entry, in that type's `art` |
| `bullet.png`, `mine.png` | shells and mines |

- **Every sprite FACES UP.** Both hull and turret rotate by
  (angle + 90°). 192px, three times a 64px tile, drawn into a one-tile
  box — draw big, display small.
- **The fallback is per tank, not per game**, exactly like terrain
  tiles: a half-drawn cast renders half-drawn rather than all-or-
  nothing. Delete any file and that actor returns to primitives.
- **No pre-rotated facing cache**, and the earlier plan for one was
  wrong about why. The hull's 8 headings are *discrete*, so a given
  facing resamples to identical pixels every frame and cannot crawl;
  crawl comes from angles that shift slightly frame to frame, which is
  the turret, and the turret is oversampled 3× for exactly that reason.
  A cache would buy a little CPU on a canvas drawing at most 8 tanks.

**The seat-colour trade, his call 2026-08-05.** He asked for a blue
player 1 and a red player 2. Seat colour is the cross-game `--gseat`
contract and players pick it in the lobby, so a per-seat file cannot
also follow the picker. The resolution: **a per-seat file is used
verbatim and that seat stops following its colour picker; the neutral
master is tinted and does.** Both paths ship, it is opt-in per file,
and deleting `hull-p1.png` hands seat 0 back to the picker. Worth
knowing that `--gseat-0` is red and `--gseat-1` is blue, so the p1/p2
templates deliberately invert the default order.

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

### Per-level art

A level names a look with a `theme` header line (`theme snow`), and it
resolves in **two layers, deliberately split by what each is good at**:

| | where | adding one |
| --- | --- | --- |
| colours | `tanks.css`, `.tk[data-tk-theme="…"]` | copy a block, change the hexes |
| tiles | `assets/sprites/tanks/<theme>/*.png` | drop PNGs in a folder |

Colours stay in CSS because that is already where the game's art
carve-out lives — canvas cannot use `var()`, but `getComputedStyle`
can, so `render.js` stamps `data-tk-theme` on the `.tk` root and
re-reads the palette. The alternative, a JS theme registry, would be a
second place to hold the same facts and would need keeping in sync with
the CSS forever.

**The fallback chain has three rungs and every rung is playable:**

```
<theme>/tile-wall.png  →  the theme's CSS colours  →  cork
```

So a theme can be pure colour (one CSS block, no files), pure art, or a
mix where only the floor is drawn. Nothing has to be finished for
anything to work, and neither half requires a code change.

- **`theme` is carried by the engine, never interpreted.** All
  rendering is client-side and the server does not know what a pixel
  is; the engine's only job is to keep the name attached to its level.
- **An unknown theme is not a validation error.** It falls back to cork
  at draw time. A cosmetic name must never be able to fail a level that
  plays perfectly well, and the build script does not police it either.
- **Floor variants**: `tile-floor-1..3.png` are picked per cell by a
  hash of its coordinates — texture without randomness, so every client
  draws the identical floor and nothing rides the wire. Only probed if
  the base floor tile actually loaded, so a colour-only theme costs no
  extra 404s.
- Probing is **lazy** — a theme is only requested when a level using it
  loads — and once per filename, the existing house pattern.
### The tile pack

**Cork is the reference set.** `assets/sprites/tanks/cork/` holds seven
real PNGs in the repo, generated once by
`scripts/build-tanks-tiles.py`, which reads the palette out of
`tanks.css` rather than carrying a second copy of it. `snow/`, `dusk/`
and `rust/` ship too. Adding a theme's colours is still one CSS block; seeding its art
is one command:

```
python scripts/build-tanks-tiles.py            # cork + snow
python scripts/build-tanks-tiles.py dusk rust  # any named theme
```

**The designer's `tile pack` button copies cork under the new name.**
Not a re-render — it fetches the committed PNGs and rezips them as
`<theme>-tiles.zip`, which unzips straight into
`assets/sprites/tanks/`. So a new theme begins as seven finished tiles
to paint over, byte-identical to what ships, and there is exactly one
place the shapes are authored. If cork cannot be fetched (the page
opened straight off disk) it falls back to rendering the templates from
the theme's colours with `render.js`'s own primitives; same filenames
either way, and the button says which happened.

Re-running the generator **overwrites the folder**, so never point it
at a theme whose hand art has landed unless you mean to reset that set
— the same rule `build-poker-chips.py` carries.

The archive is written by hand, **store-only, no compression**: no
dependency is allowed on this site, seven small PNGs gain nothing from
deflate, and STORE needs no deflate implementation — just CRC32 and the
header layout. Verified by writing a real archive, having Python's
`zipfile` open it and run `testzip()`, and hashing every entry against
the cork pack on disk.

- **The designer's theme dropdown reads the stylesheet.** It walks
  `document.styleSheets` for `.tk[data-tk-theme="…"]` selectors, so
  the list is whatever `tanks.css` actually defines — add a block and
  it appears, with no list to update. (There was a hardcoded one; it
  went stale immediately, which is the same duplication the enemy
  palette and the tune panel already avoid by reading their
  registries.) Themes with committed tiles are marked `· art`, a
  theme the open level names but the CSS has lost is kept and marked
  `· no css`, and `+ new theme…` names one that does not exist yet —
  the workflow being: name it, pull a tile pack, then write the CSS.

Cork, snow, dusk and rust ship as colour themes, and **all four ship
tile art** under `assets/sprites/tanks/<theme>/`.

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

Client → server: `input`, a 20 Hz heartbeat **plus an immediate send on
every press and release**, carrying `q` — the client sim step the input
belongs to.

Server → client: every tick message's per-seat entry carries `q` back,
**the last input seq folded into that pose**. This is contract, not
decoration: it is what the client's seq-replay reconciliation reads,
and a worker that omits it puts the sliding back (see "State of the
tab").

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

## The enemy cast

Approved by him 2026-08-05, **all seven built the same day**. What
separates them is *only these numbers* — the brain is one routine and
every behaviour is a tune key, so a new type is a registry entry rather
than new code, and a level can dial any of them.

| # | name | speed | bounceDepth | rate | reaction | mines | evade | what the level teaches |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Sentry | — | 0 | 0.25/s | 0.6 s | — | — | aiming |
| 2 | Rover | 1.4 | 1 | 0.5/s | 0.45 s | — | — | ricochets exist |
| 3 | Lancer | — | 0 | 1.2/s | 0.3 s | — | — | flat fast rocket; never stand in a lane |
| 4 | Sapper | 2.6 | 1 | 0.4/s | 0.4 s | ✓ | — | area denial |
| 5 | Duelist | 2.9 | 1 | 1.1/s | 0.18 s | — | ✓ | it dodges; you must lead |
| 6 | Banker | — | 2 | 0.7/s | 0.35 s | — | — | cover stops being safe |
| 7 | Marshal | 3.4 | 2 | 1.4/s | 0.12 s | ✓ | ✓ | the finale |

`bounceDepth` is the dial that decides whether cover works; `reaction`
is the one that decides whether you get time to react to *them*.

### The brain

One routine in `engine.js` (house rule — never in a mock, never in a
worker), fully deterministic: `prngNext(g)` is the only randomness and
the tick is the only clock, because the client re-runs this exact code
to predict. A self-check asserts no brain function so much as mentions
`Math.random` or `Date.now`, and that two runs on one seed are
byte-identical.

- **Aim.** Turn toward the **solved** angle, not the player. The
  original code turned toward the player and merely *gated* on
  `aimSolve`, so the first type with `bounceDepth > 0` would have lined
  up on a target behind a wall and fired straight into it. Aiming at
  the solution is also what makes a bank readable — the barrel visibly
  swings off-player before it fires.
- **Drive.** Range-keeping, not pathfinding: score the 8 facings for
  closing/backing off/strafing around a 3.6–8.0 tile band, with seeded
  jitter and hysteresis so hulls neither twitch nor march in lockstep.
  **Deliberate non-goal: no A\*.** A tank that solves the maze reads as
  a hunter, and Wii Play's do not hunt — they mill about and shoot.
- **Evade.** Project the tank onto each incoming shell's line; if it
  will pass within 0.85 tiles, sidestep perpendicular *toward the side
  it is already on* — the short way out, not a dive across the path.
- **Mines.** Dropped behind while moving, capped by the type's
  allowance.

### The solve budget

A bank search is not free, so it runs only when the tank could actually
shoot (cooldown clear, a shell spare) and at most every 12 ticks,
**staggered by the tank's own index** so a room full of Bankers never
all solve on the same tick. Measured: **0.18 ms per solve**, worst case
~0.09 ms/tick of a 16.7 ms frame with six solvers.

`aimSolve` samples headings and flies each with the **real
`stepBullet`**, which is the property that matters: the plan and the
shell are the same physics by construction, so a planned bank cannot
miss for a reason the planner never modelled. Two-phase — a 48-heading
coarse sweep scored by *closest approach* to find the corridor, then
ternary search inside it. Both halves were wrong first time and the
reasons are worth keeping:

- refining by stepping ±w and halving is a hill-climb, but the
  landscape is piecewise (one continuous corridor per bounce sequence,
  cliffs between), so it stalls on a cliff;
- refining only the single best coarse sample assumes the coarse winner
  is in the winning corridor, and a blocked direct path often scores a
  deceptively small closest approach. The best three are each refined.

**Measured against ground truth** (a 0.1° sweep over all 2398 blocked
shooter/target pairs in a test room, 2314 of which admit a one-bounce
hit): **76.9% recall, zero false positives.** Never claiming a shot it
cannot make is the property worth having; the misses are fine, and
arguably good — the tank retries five times a second against a moving
player, so the rate that matters is far higher, and a Banker that found
every bank instantly would be oppressive. Widening the search to 72
headings and 5 corridors bought 0.2% recall for 1.6× the cost, which is
why it is 48 and 3.

**Types carry difficulty, count carries tempo** — a level's tier is
roughly its worst enemy; the number of them sets how frantic it is. Six
Sentries is busy, not hard; one Banker is hard.

Enemy livery is `art` on the registry entry, read by the renderer and
the designer palette, so a new type is visible the moment it exists.
Names are **internal identifiers, not copy** — nothing in the UI shows
them. If an interstitial ever names what you just beat, they become
`strings.js` entries and arrive `[ph]`.

## Still to design

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
- **Prediction, revised 2026-08-05 (the sliding fix).** The first cut
  blended the predicted hull toward the latest snapshot every tick. It
  felt like driving on ice, and the mock's own lag knob shows why: the
  server pose is a round trip old, so the blend pulled *backwards* the
  whole time you drove and *forwards* after you let go. Measured
  against a pure local sim, the hull coasted **0.49 tiles at 110 ms
  RTT and 2.0 tiles at 600 ms** past the key release. Three changes:

  1. **Seq-replay reconciliation.** Every predicted step is stamped
     with a local seq and kept in a history ring; the input verb
     carries the seq (`q`), the tick channel acks it back per seat
     (`tanks[].q` — **wire contract**, the worker must send it), and
     the client replays its unacked inputs onto the server pose before
     comparing. Like with like, instead of pose vs. round trip.
  2. **A dead zone sized to the inputs still in flight.** Even after
     the replay the server trails by a constant phase — it ran N ticks
     to reach the input it is acking. That gap is not error and must
     not be corrected; it collapses on its own the moment you stop,
     because then both sims stop. Only the *moving* unacked inputs
     count toward the tolerance, so a standing tank has none and
     converges hard.
  3. **Press and release go out on the frame they happen**, not on the
     next 20 Hz packet. The heartbeat stays for loss.

  After: the coast is **flat at every lag** — 0.15 tiles on the first
  stop of a level (a one-time startup offset being spent) and under
  0.05 tiles, ~3 px, on every stop after that.

  The trap worth remembering: *do not correct toward a server that has
  not yet heard from you.* Before the first ack the server's pose is a
  tank nobody has told to move, and easing toward it was costing a
  whole trip time of travel off the line.
- **`tanks/designer.html` BUILT, 2026-08-05.** Unlisted dev page at
  `/tanks/designer.html`. Paint terrain and spawns, resize, import by
  paste or drop, export by copy or download, live validation off the
  engine's own `validateLevel`, a tuning panel, and a campaign picker
  that opens levels 0..N or starts the next one. Pinned to Moonlight +
  Ocean. Verified headless (34 checks under a DOM stub: registry-driven
  palette and scopes, tune round-trip through the file, clamping, scope
  rules, text-edit round-trip, campaign open / edit / revert / new
  slot, save-target naming, play-test boot).

  Three properties worth keeping:

  1. **It imports the real `engine.js` and `render.js`.** The grid you
     paint on is the game's renderer and every message is the engine's
     own. WYSIWYG is structural, so the editor cannot drift — the
     failure that kills most homemade level editors inside a month.
  2. **The palette and the tuning panel are GENERATED** from
     `ENEMY_TYPES` and `TUNE_SPEC`. Adding an enemy or a knob to the
     engine adds it to the designer with no page edit.
  3. **Play-test is a LOCAL sim, deliberately not the mock** — no
     lobby, no netcode, no latency. It is the feel-and-tune loop and
     wants zero ceremony between a keystroke and the result; **tuning
     values apply live, mid-play**, which is the whole point of the
     panel. The netcode is exercised at `/tanks/`, where it belongs.

- **Duplication removed:** `build-tanks-levels.py` used to carry a
  hardcoded `KNOWN_TYPES` with a "keep in sync" comment. It now reads
  `ENEMY_TYPES` and `TUNE_SPEC` out of `engine.js` via node, so adding
  an enemy is one edit in one file instead of two with a silent build
  failure when you forget the second.

- **The enemy cast is BUILT** (2026-08-05) — all seven types, plus
  bank-shot planning in `aimSolve`, driving, evasion and mine-laying.
  Engine self-checks 63 -> 84.

- **Per-level art themes BUILT** (2026-08-05) — `theme` on the level,
  colours as CSS blocks, tiles as per-theme sprite folders, a designer
  dropdown read from the stylesheet, and a `tile pack` button that
  copies the cork pack under a new name as a zip. Four themes shipped
  (cork, snow, dusk, rust), **all four with tile art committed** via
  `scripts/build-tanks-tiles.py`. Still **flat generated art, not
  hand-drawn** — it is the thing to paint over. Engine
  self-checks 84 -> 87; designer harness 34 -> 43, plus a separate
  pack harness that validates the archive with Python's `zipfile`.

- **Tank sprites WIRED + templates generated** (2026-08-05) —
  `build-tanks-art.py` emits 22 templates (neutral master, per-seat
  blue/red, per-enemy-type, shell, mine) and `drawTank` draws them,
  falling back per tank. Verified headless: sprites drawn when landed,
  primitives when not, per-seat/per-type selection, and the tint cache.
  Still **flat generated art, not hand-drawn.**

- **Not built:** the `art-src/` 512px chroma-key pipeline (the
  templates are edited directly at 192px instead, which skips it) (waits on the art
  pass), the `../DeetsTanks` worker (phase 4 — `rt-do.js` gets
  extracted from `transport-mock.js` then, per the promotion rule),
  PvP, stats reporting.
- **Copy: DONE.** He approved the whole of `strings.js` — and the level
  names — in one pass, chat 2026-08-05, the same day it was built. Zero
  `[ph]` left; new strings still arrive prefixed.
