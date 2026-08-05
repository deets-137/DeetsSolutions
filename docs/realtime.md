# Real-time games — the framework

The third doc in the games set, and the newest. [games.md](games.md) is
the **contract** for turn-based tables; [design-language.md](design-language.md)
is the **precedent** distilled from the three games built on it. This file
is neither yet — it is the **design record** for a foundation that does
not exist, written from an exploratory chat with Aditya on 2026-08-05
about two candidate games (DeetsDoom, DeetsTanks).

**Nothing here is built.** No code, no worker, no branch. Read "State of
the framework" at the bottom before assuming otherwise.

The one-line summary: real-time is not a setting on the turn-based
foundation, it is a **sibling** to it, and the seam falls in exactly one
place — WebSocket hibernation.

---

## Why the turn-based foundation does not stretch

`games/table-do.js` is built on the **WebSocket Hibernation API**. The
runtime holds each socket, the Durable Object is evicted from memory
between messages, and every deadline becomes a persisted alarm. Three
lines carry the whole posture:

| Where | What |
| --- | --- |
| [table-do.js:1108](../games/table-do.js) | `ctx.acceptWebSocket(pair[1])` — the runtime holds the socket |
| [table-do.js:1113](../games/table-do.js) | `async webSocketMessage(ws, msg)` — a handler method; no closure survives eviction |
| [table-do.js:356](../games/table-do.js) | `ctx.getWebSockets()` + `serializeAttachment` — per-socket state rides the socket, because memory does not |

That is exactly right for a mahjong table: a dozen billable requests per
game, near-zero duration, and a player who walks away for ten minutes
costs nothing. `armAlarm()` is the other half — a hibernated object
cannot run a timer, so the turn deadline, the disconnect grace, the bot
cadence and the idle fuse all multiplex onto one persisted alarm.

**Hibernation trades duration for requests: each inbound message is
billed as a request.** A real-time table at 20 Hz × 2 clients is 40
messages a second, which exhausts the free plan's 100,000 requests/day in
roughly **42 minutes**. Worse, a ticking object holds a `setInterval`,
which pins it in memory so hibernation never engages — you would pay
per-message *and* full duration. Worst of both.

So a real-time table inverts all three lines: plain `server.accept()`,
ordinary event listeners, ordinary in-memory state, `setInterval` instead
of alarms. The base class's core assumption is the thing being negated,
which is why this is a **sibling class, not a subclass**. What the two
share (join handshake, identity, seat roster, host fallback, the idle
fuse) is extracted, not inherited.

Alarms are not an option for the tick, incidentally: a 15 Hz alarm would
be 1.3 million alarm invocations a day. `setInterval` inside a
non-hibernated object is the only shape that works.

---

## Decisions already made

From the chat of 2026-08-05. Aditya's calls unless marked.

1. **Two candidate games**, and they are deliberately different: a
   two-room first-person **DeetsDoom** (PvE, no audio, desktop-only) and
   a Wii-Play-style top-down **DeetsTanks** (PvE with optional PvP).
   Doom was proposed as the "hello world"; see "Build order" for the
   counter-recommendation.
2. **Co-op from the jump.** Two players, entering the same table through
   the shell's existing code combobox and lobby. The participants panel
   is the co-op roster — no new surface.
3. **No audio, desktop-only** for the first game. Pointer lock has no
   mobile story and audio is ground no game on the site has touched.
   Both are scope cuts, not architecture.
4. **All rendering is client-side.** The server never knows what a pixel
   is. This is what makes the foundation reusable for a game that looks
   nothing like either of these.
5. **A framework, not two one-offs** — his explicit ask. See "The
   promotion question" for the one place I would soften that.
6. **Hosting is Cloudflare Pages + Workers, free plan** (confirmed by
   him, 2026-08-05). The cost model below assumes it.

---

## The engine contract — the real-time variant

The framework asks for almost nothing new, because [games.md](games.md)
already enforces the two properties that make real-time netcode possible:

> Every `engine.js` is pure and DOM-free
> Vendored **VERBATIM** into each worker repo

Client-side prediction is only possible if the client can run the
server's exact simulation locally. The vendoring rule already guarantees
byte-identical engine code on both sides; the purity rule already forbids
the hidden state that breaks re-running. **The real-time engine contract
is the existing one with `resolve(action)` swapped for `step(inputs)`.**

```
TICK_HZ                              sim rate (60), independent of broadcast rate
init(cfg, seed) -> state             seeded PRNG lives IN state, never Math.random()
step(state, inputsBySeat) -> events  pure, deterministic, re-runnable
snapshot(state) / restore(snap)      the reconciliation primitive
```

Same `node <game>/engine.js` self-checks, same dual-export, same
vendoring. Determinism has two hard rules: **no `Math.random()`** (the
PRNG is state, seeded by the server at `init`) and **no `Date.now()`**
(the tick number is the only clock).

**Simplification, recorded:** because reconciliation replays against
**state snapshots** rather than lockstep-replaying inputs from t=0,
cross-browser float drift is self-correcting — the next snapshot
overwrites it. The bar is "deterministic enough for 200 ms", not
bit-exact. This is far below what a lockstep RTS needs, and it is why
plain JS floats are fine.

---

## Authority — and why Tanks decides it

The trusted-peer shortcut is tempting for co-op PvE: let each client own
its own position, let the shooter call its own hits, and prediction never
has to exist. That shortcut is viable for Doom alone.

**It dies the moment PvP is on the table.** If your bullet can kill me, I
do not get to be the authority on whether it did. So the framework is
server-authoritative, and Doom's PvE trust becomes a *policy flag*, not a
second codebase:

- The DO runs the authoritative sim and is the sole judge of damage,
  death, pickups and scoring.
- Each client **predicts its own entity** from local input immediately —
  zero-latency movement — and reconciles when the next snapshot disagrees.
- Every other entity is **interpolated** roughly two broadcast ticks
  behind server time, so there are always two snapshots to lerp between.

The useful irony, worth keeping in mind before optimizing the wrong
thing: **Tanks is the PvP game and the *easier* netcode.** Its bullets
travel slowly and ricochet, so nobody perceives 80 ms of latency on a
projectile that takes two seconds to arrive. Doom's hitscan is the
unforgiving case — instant, and it would demand real lag compensation.
That is a standing argument for keeping Doom PvE.

---

## The tick — two rates, never conflated

**Sim rate ≠ broadcast rate.** Run the engine at 60 Hz on both ends;
broadcast snapshots at 15–20 Hz.

The sim rate is chosen for physics fidelity (Tanks needs it for
bullet/wall collision; Doom does not care). The broadcast rate is chosen
for smoothness under interpolation. Neither is chosen for cost —
duration billing is wall-clock, so a 30 Hz table costs exactly what a
5 Hz one does.

Conflating the two is the mistake that makes Tanks feel wrong later, once
the tick rate is load-bearing in a dozen places.

## Deterministic projectiles — events, not state

A ricocheting bullet is fully determined by
`{spawnTick, x, y, angle, owner}`. Broadcast that **once** and every
client simulates the entire flight locally: zero further bandwidth,
perfectly smooth, no interpolation artifacts. The server simulates the
same bullet and stays the sole authority on **deaths**.

Two hundred live bullets therefore cost two hundred small events, not a
per-tick stream of two hundred positions. This is the single best idea
for Tanks; Doom's projectiles, if it has any, get it for free.

It is the real-time cousin of a rule the turn-based games already
follow — **derive, never accumulate** ([design-language.md](design-language.md),
pattern index).

---

## What is shared, what each game authors

| Shared | Per-game |
| --- | --- |
| `rt-do.js` — non-hibernating DO base: tick loop, snapshot versioning, join/leave, idle fuse | `engine.js` — rules, entities, collision |
| `rt-loop.js` — client accumulator, input ring, prediction, reconciliation, snapshot interpolation | `render()` — raycaster vs. top-down canvas |
| grid level format + its build script | the input struct and its encoding |
| | the **render surface itself** — see the note below |
| | HUD/bento wiring, `strings.js`, CSS |
| **unchanged:** `table.js` (lobby, gate, code combobox, seat colors, participants panel), `transport.js`, `colors.js` | |

Both games are **grid worlds** — Doom's two rooms and a Tanks arena are
the same tile map behind different renderers. One level format and one
build script serves both. That is load-bearing, not a coincidence to be
discovered twice.

**The render surface is NOT shared, and this was a real correction
(2026-08-05).** An earlier draft listed a `pixels.js` — a low-resolution
integer-upscaled pixel buffer — as shared foundation. Tanks then settled
on hand-drawn high-resolution raster on a native-resolution layered
canvas ([tanks.md](tanks.md)), which wants none of it. Doom's raycaster
still does: a low internal resolution is how it stays fast, and the
chunky grid is the look.

So the two games' renderers have **nothing in common but a canvas**, and
the foundation should not pretend otherwise. Recorded because it is
exactly the failure the promotion rule exists to prevent — an abstraction
designed for one caller, extracted before a second one asked for it.

---

## Client-side rendering

All of it, in the browser, at 60 fps, with the server uninvolved.

Budget for a Doom raycaster at 480×270 internal resolution: ~0.5 ms for
480 DDA wall rays, ~1 ms to blit textured wall columns, ~free for flat
floor/ceiling, ~0.5 ms for z-buffered sprites. **Roughly 2–4 ms against a
16.6 ms frame.** The raycaster is not the risk. Textured floors are the
one thing that would eat the budget (per-pixel divides across the whole
buffer, +2–4 ms) — skip them; flat floors are also truer to the look.

The actual traps are integration, and every one of them has bitten a
canvas game somewhere:

1. **The shell repaints on every state message.** [table.js:393](../games/table.js)
   routes `state` → `render()` → a full `cfg.render()` DOM rebuild. At
   20 Hz that is twenty DOM teardowns a second fighting the frame loop.
   **Sim snapshots must bypass the shell's paint path entirely** — two
   channels: lobby/roster/participants traffic through `paint()`, tick
   traffic straight into the interpolation buffer. HUD panels update
   on-change or at ≤10 Hz, never per frame.
2. **Zero allocation in the frame loop.** One `Uint32Array` view over
   `ImageData.data`, one `putImageData`, preallocated entity arrays. An
   object literal per entity per frame is GC sawtooth you will see as
   stutter.
3. **Integer upscale only.** Fixed low-res backing store,
   `image-rendering: pixelated`, letterbox inside the big tile. Fractional
   scaling shimmers — the lesson [design-language.md](design-language.md)
   already records from mahjong and poker, in a new place.
4. **Fixed-timestep sim with an accumulator, decoupled from render.**
   Non-negotiable for determinism and for making reconciliation sane.
5. Pointer lock plus a key bitmask; input is read by the sim step, never
   handled inside the render loop.

The bento maps onto both games without invention
([design-language.md](design-language.md), "form follows information"):
big tile = viewport, right rail = the public per-seat numbers
(health/armor/ammo; lives/kills), role tile = your own state and
controls, log = the kill feed from typed events.

---

## Cost model — Pages + Workers free

Pages is irrelevant: flat files, no build step, effectively unmetered.
The whole question is Workers/DO.

- Duration is the meter that matters: ~13,000 GB-s/day, and a DO is
  128 MB, so **≈ 29 DO-hours/day** account-wide.
- The five existing workers hibernate and contribute ~nothing. Real-time
  tables would be the only duration burners.
- **Tick rate is free.** Duration is wall-clock; 30 Hz costs what 5 Hz
  costs. Pick both rates for feel.
- **An idle open table costs exactly what a firefight costs.** This is
  the highest-leverage cost rule in the document: no sockets for ~60 s →
  tear the object down. A tab left open overnight is the only realistic
  way to blow the budget.
- Bandwidth is a rounding error — 2 players plus ~20 entities is ~1 KB
  per tick, ~20 KB/s per client, and Cloudflare egress is free. JSON is
  fine; a binary encoding is a later optimization, not a starting
  requirement.
- Free plan CPU is 10 ms per invocation. A tick is microseconds — but a
  60 Hz Tanks tick with 200 live bullets is worth profiling once rather
  than assuming.

**To verify before building:** DO-on-free requires the SQLite storage
backend (`new_sqlite_classes`). The five live DO workers are presumably
already there, but a new worker should not inherit the assumption. These
limits also move; re-check them.

---

## Where the server lives

Same shape as every other game, one line different:

```
../DeetsTanks/                 sibling worker repo (private, like poker)
  src/index.js                 TanksTable extends RealtimeTable
  src/rt-do.js                 VENDORED VERBATIM from games/rt-do.js
  src/engine.js                VENDORED VERBATIM from tanks/engine.js
  src/colors.js                VENDORED VERBATIM from games/colors.js
→ tanks-api.deets.solutions    one Durable Object per table
```

One DO per table code, exactly like `cities-api` / `mahjong-api` /
`poker-api`. The client reaches it through the unmodified
[transport.js](../games/transport.js) — same envelope, same reconnect
backoff, same version-gap resync; only the API host differs.

**But in phase 1 there is no server at all.** Mock-first is doctrine
([design-language.md](design-language.md), "Build order"), and it applies
unchanged: the sim runs in-page on `table-mock.js` behind
`mockDefault: true`, and the whole tab ships with no worker repo in
existence. The mock spec **is** the DO subclass, written hook-for-hook
for later vendoring.

One addition to the doctrine, and it is not optional:

> **The real-time mock injects artificial latency from day one** —
> configurable 50 / 150 / 300 ms plus jitter, on a view setting.

A zero-latency mock passes every prediction and interpolation bug
straight through to production, where they are near-impossible to
reproduce. This is the highest-value thing to build early, before the
renderer.

**Server placement, live:** a Durable Object is created near whoever
creates the table, and the second player eats the RTT. Two friends in one
region is ~20–40 ms and invisible; cross-continent is ~150 ms and the
remote tank feels floaty. `locationHint` exists if it ever matters.

---

## Build order

Doom was proposed as the hello world. **My recommendation is Tanks
first**, and the reasoning is worth recording even if he overrules it:

1. **Tanks** is the harsher test of the framework and the cheaper build.
   PvP forces server authority, projectiles force the sim/broadcast
   split, and a top-down 2D renderer is a fraction of a raycaster's work.
   The framework gets validated in weeks rather than months.
2. **Doom** second, as the proof it generalizes — swap the renderer, keep
   everything else. Whatever Doom has to change is precisely what was
   secretly Tanks-specific.
3. Within either: **engine + self-checks → latency-injecting mock →
   netcode → renderer → art.** Motion and polish last, as always.

Doom is the more exciting one. Tanks is the better first one. His call.

## The promotion question

His ask was a framework from the jump. The one place I would soften that:
`rt-do.js` and `rt-loop.js` should be **written inside the
first game's folder, with the seams cut cleanly, and promoted to
`games/` when the second game arrives**.

The house rule already says the second user promotes ([games.md](games.md),
"Known duplication"; the bpop kit is still waiting on its third). It
exists because an interface designed for one caller is a guess. Promoting
later costs an afternoon; a wrong shared abstraction costs every game
after it. The framework arrives either way — proven instead of predicted.

---

## Open questions

Nothing below is decided.

- **Doom:** does a table survive one player leaving — solo continues, or
  the run ends? Two rooms means no level tooling in v1; what is the win
  condition at all?
- **Tanks** has its own doc now — [tanks.md](tanks.md). PvP is a separate
  mode, PvE is a 3-lives campaign of hand-designed levels, and the
  remaining Tanks questions moved there.
- **The lobby phase in a viewport game.** Every sibling's lobby fills a
  board-shaped tile at in-game size. What does the big tile hold before a
  real-time game starts — a frozen frame, a static render, a menu over
  black? Genuinely new; no precedent to copy.
- **Bots.** [design-language.md](design-language.md)'s decision tree
  assumes a bot takes a *seat*. In a real-time PvE game the enemies are
  not seated players — they are world state. Tanks answers this for
  itself (difficulty rides the level, not `BOT_TIER_LIST` —
  [tanks.md](tanks.md)); whether that generalizes is open.
- **Stats.** Do real-time games report to the accounts D1
  ([stats.md](stats.md))? Kills, deaths, best time?
- **Disconnect presentation.** Turn-based hides a three-second blip;
  real-time shows a frozen teammate mid-corridor. The transport's
  `onStatus("down"|"up")` is the hook, but what the player *sees* is
  undesigned.

## State of the framework

**Tanks' phase 1 is BUILT (2026-08-05, branch `DeetsTanks`)** — see
[tanks.md](tanks.md), "State of the tab". What that proved out for the
framework:

- The engine contract above holds as written: `step(inputs)`, seeded
  PRNG in state, tick-as-clock, snapshot-replay reconciliation.
- **`games/table.js` grew its one real-time seam: `onRaw`.** A game
  claims sim-channel messages before the shell's model/paint path sees
  them; every turn-based game is untouched. `transport.js` needed no
  changes, as predicted.
- The two-channel split works on the mock: versioned broadcasts carry
  state-changing events (HUD repaints), `tick` messages carry poses +
  flavor at 20 Hz outside the version counter.
- **`rt-do.js` / `rt-loop.js` still do not exist** — per "The promotion
  question", their seeds live inside the first game as
  `tanks/transport-mock.js` (the DO shape: sim loop, channel split,
  idle stop) and `tanks/net.js` (the client loop: accumulator,
  prediction, interpolation). Extraction happens when the worker (or
  the second game) arrives.

Doom remains design-only; its questionnaire has not been run.
