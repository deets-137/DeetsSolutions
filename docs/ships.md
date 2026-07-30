# DeetsShips — design notes + build log

> **The shared half lives in [games.md](games.md)** — the wire protocol,
> the table shell (`games/table.js`), the Durable Object base
> (`games/table-do.js`), seat colors, and the conventions every game
> inherits. This document covers only what makes DeetsShips itself.

**Status: BUILD IN PROGRESS — see "Build log" at the bottom for what
exists so far.** The rules are closed and the table's face is drawn. As of pass ten, every question about *how the game
plays* has an answer: simultaneous commit, the turn frame (draft as
turn 0), first-thing-hit, the hull blocking its own fire, no friendly
fire, the depth layer, destination-only collisions, 8 tiles as the
single reveal threshold, the intel language. Pass eleven settled the
UI/UX on top of it: the bento mapping, the ready/commit staging model,
simultaneous playback, desktop-only, and the last marks (see "The table
layout — the bento"). Exactly one rules question remains — whether
disarming takes the cruiser's second move. Everything else outstanding
(see "Open questions, collected") is shell plumbing, the
shared-foundation work that teams require, or scope deliberately
deferred past v1. This file stays the running record of Aditya's
narration plus the questions that narration raised.

Branch `DeetsShips` also carries a second, separate workstream:
**parameterized bots** (difficulty as a knob rather than one hard-coded
phantom per game) and, downstream of that, an **Elo system** on top of
the accounts stats pipeline ([stats.md](stats.md)). That work is not
ships-specific and is not described here yet.

---

## The pitch

Battleship's hiding-and-deception, but nobody is calling out grid
coordinates at a static fleet. **One shared ocean**, both sides on it at
once, ships **moving** under fog and firing from concealed weapon
mounts. You don't guess where the enemy is; you hunt them, and every
shot you take tells them something about where *you* are.

Low player counts play tight and strategic; high player counts play
loud and chaotic. Same board, same rules — the difference is how many
hands are on it.

---

## Table shape

Two sides, **1–4 players per team**, always even. Confirmed.

| Table | Seats | Ships per team | Ships per player |
|---|---|---|---|
| 1v1 | 2 | 3 | 3 |
| 2v2 | 4 | 4 | 2 |
| 3v3 | 6 | 3 | 1 |
| 4v4 | 8 | 4 | 1 |

Every seat always drives at least one ship. Bots fill any unfilled seat,
as in both existing games — the host adds them in the lobby, and
grace-expiry converts a dark seat mid-game.

### The foundation investment: teams

**Colors no longer need to grow to eight.** Ships colors by **team, not
by seat** — two colors on a table, each chosen by that team's captain —
so the six existing presets are plenty and `games/colors.js` keeps its
current shape. That removes the widest-radius edit that was on the table.

**The reserved red band is ships-local, and `colors.js` is untouched.**
An earlier pass claimed the shared validator needed an excluded-hue-band
parameter, on the reasoning that the server has to reject a red pick and
the server's validator is `colors.js`. That was wrong. The base's
`recolor` handler validates through **`this.Colors`, a subclass-provided
getter** (`games/table-do.js:72`, used at :797–799) — so the server's
validator is whatever the game hands over. Ships provides its own
`Colors`: a thin wrapper around `DeetsColors` whose `norm()` refuses hex
in the red band (the existing `errTo(ws, "color")` path already carries
it) and whose `PRESETS` omit red. Shared `colors.js` needs no change, no
re-vendoring, and cities and mahjong are not involved at all.

One concrete trap in that wrapper, worth writing down before it bites:
the base renders empty seats with `Colors.PRESETS[i]`, indexed by **seat
number** (`games/table-do.js:429`). Ships has **8 seats** at 4v4 and
`PRESETS` has 6 entries, so seats 6 and 7 read `undefined`. Either ships'
`PRESETS` covers eight, or the empty-seat path resolves through team —
and the latter is the more honest fix, since ships colors by team anyway.

**The shell learns about teams.** A real capability in
`games/table-do.js` + `games/table.js`, not a ships-local derivation —
Aditya's call, on the reasoning that a second team-based game (or teams
in DeetsCities, hypothetically) shouldn't have to re-derive any of it:

- **Every seat always has a team** — cities and mahjong become
  **teams of one**, rather than carrying a null-teams branch. Aditya's
  call, and it's the better shape: one data path instead of two, so
  view-building, results and color resolution never ask "does this game
  have teams." Ships is simply the case where several seats share a team.
  The hard constraint is that **the UX for the existing games must not
  change at all** — so a game still declares whether its teams are
  *real*, and that one flag gates the affordances: no team-switch control,
  no group-by-side roster, no uneven-teams gate, and team color reads back
  as today's seat color when every team holds one seat. The saving is in
  the model, not in the UI, which is where the duplication actually hurt.
- **Seats carry `team`** on the public view, so the lobby roster groups
  by side, the players tile bands by side, and the log can say which
  side did a thing.
- **Players move themselves between teams in the lobby** — self-serve,
  not host-assigned. **The affordance is two columns of seats**: sitting in
  column 1 puts you on team 1, column 2 on team 2, so joining a team and
  taking a seat are the same gesture and there is no separate "switch team"
  control to design. Moving sides is just standing and sitting again. The
  shell also owns the "teams are uneven" gate under Start (the existing
  `startNeedsHint` seam).
  - For games whose teams aren't real (cities, mahjong as teams of one) the
    lobby stays a single column exactly as it is today — the two-column
    layout is part of what the real-teams flag gates.
- **Team color replaces seat color** when a game declares teams: one
  color per side, set by the captain, and `TBL.seatAccent(node, seat)`
  resolves through the seat's team. The `--gseat` contract itself is
  untouched — only what feeds it changes — so no game-side CSS moves.
- **Results record the team outcome** alongside the per-seat rows
  ([stats.md](stats.md)) — exactly what a team Elo needs, so this
  investment and the Elo workstream on this branch meet here. Expect an
  `ALTER TABLE` in `../DeetsAccounts`.

**Friendly hulls carry their owner's name underneath**, which is how you
tell your ship from a teammate's when the whole side shares one color.
Enemy hulls are never drawn at all — only intel marks — so the label has
no equivalent on the other side and leaks nothing.

Cost, stated plainly: `table-do.js` is vendored into **both** existing
worker repos, so this change means re-vendoring and redeploying cities
and mahjong even though neither uses it. That is the price of doing it
once instead of twice.

---

## The ocean

- **20 × 20 grid**, one shared board, no per-player boards.
- Split into four vertical bands of five columns. Teams start in the
  **outer bands**: West in columns 0–4, East in columns 15–19. The
  middle ten columns are open water nobody starts in.
- **v1 is an open board.** No islands, no shoals, no obstacles. Aditya
  adds terrain later; the engine should keep the board a data structure
  that can grow a per-tile terrain field rather than assuming open water
  everywhere.
- **No two ships may overlap** *on the same layer* — a submerged
  submarine and a surface ship may share tiles (see "The submarine's
  depth layer"). Collision is prevented by validation
  rather than modeled as an event: an illegal move commit is rejected.
  Validation can only see what the mover knows — the client prevents
  known-geometry conflicts up front, and the server catches hidden ones
  at resolve time (see "Collisions"; destination-only, settled in pass
  eight).

## The fleet

Five classic hulls, all straight-line footprints:

| Class | Length | Move | Turning |
|---|---|---|---|
| Aircraft carrier | 5 | 5 | turn **or** move |
| Battleship | 4 | 5 | turn **or** move |
| Destroyer | 3 | 5 | turn **or** move |
| Submarine | 3 | 7 | turn **and** move (a turn costs 1 movement) |
| Cruiser | 2 | 7 | turn **and** move (a turn costs 1 movement) |

The big three are the ones that commit: spend your turn changing
heading, or spend it going somewhere. Sub and cruiser are the nimble
pair — faster, and able to do both in one phase.

**Turning is 90°, about a pivot tile you choose.** The pivot may be
either end of the hull, or — on an odd-length ship (carrier 5,
destroyer 3, submarine 3) — the center tile. The rest of the hull swings
around that fixed point. An even-length ship (battleship 4, cruiser 2)
therefore has exactly two pivot choices, an odd-length one has three.
The pivot choice is the whole tactical texture of turning: a carrier
pivoting on its bow sweeps four tiles of ocean behind it, and every one
of them has to be empty.

**Ships may move backwards.** Movement is along the hull's axis in
either direction; there is no bow-only constraint.

---

## The resolution model — simultaneous commit

**This is the spine of the whole game, so it goes first.** Turns are
**simultaneous**, not alternating. Within a phase, players plan freely
client-side — dragging ships, aiming, previewing — and nothing is
authoritative until the team **commits**. The server then resolves both
teams' commits together and broadcasts the outcome.

```
round N:  MOVE   plan (client) → commit → server resolves → broadcast
          ACTION plan (client) → commit → server resolves → broadcast
```

Two consequences that shape everything downstream:

- **Actions target post-move positions.** Move resolves fully before the
  action phase opens, so you are shooting at where ships ended up, not
  where they started.
- **Both sides fire at once.** A ship sunk in the action phase still got
  its own shot off in that same phase — mutual destruction is possible
  and is a real tactical outcome, not an edge case to suppress.

The client's affordances stay **cosmetic**, the house rule from both
existing engines: the browser dims illegal moves and greys unaffordable
actions, and the server re-validates every commit from scratch.

### Collisions

Both cases run through the same mechanism — **the server catches the
conflict at resolve time and returns the move invalid**, which the
client surfaces as "Invalid move occurred."

- **Against known geometry** (your own team's ships, the board edge,
  later terrain) the client also prevents it up front, so a rejection
  here should never actually reach a player.
- **Against hidden enemy ships** the client cannot know, so the
  rejection is the only signal. Two ships commit into the same tile;
  neither move stands.

Simple to implement, and it is — the resolver compares committed final
footprints **within a layer** and rejects overlaps, no ramming rules, no
initiative table, no combat resolution. Two riders worth recording,
because they are consequences of the choice rather than objections to it:

- **A rejection is itself information** — about surface ships only, since
  a submerged submarine never triggers one. If my move is refused and I
  know my own fleet didn't cause it, I have learned an enemy ship's
  footprint intersects a specific tile. That is fine — arguably good,
  it's the ocean pushing back — but it does mean a player can *probe*
  by committing exploratory moves. The cost of probing is losing that
  ship's whole move for the round, which is probably self-limiting.
- **No re-submit, and only the involved ships are rejected.** A conflict
  holds the two colliding ships where they were and lets every other
  committed move on both sides stand; the phase does not re-open. So a
  probe costs exactly that one ship's movement for the round, which is a
  real price without letting one blind collision cost a whole fleet its
  turn — and there's no way to stall a round by committing garbage
  repeatedly.
- **Only final footprints matter — destination-only.** This is about
  *movement*, not firing: two ships that end on overlapping tiles conflict
  and both hold, but tiles merely *traversed* on the way there are never
  checked, so ships slide through each other mid-move. Two enemy ships can
  even swap ends of a line and neither is stopped. Checking paths instead
  would mean inventing a temporal model for simultaneous movement (whose
  tick first, at 5 move versus 7, and what a pivot's swept arc counts as),
  and it would reject far more often — every crossing rather than every
  shared destination — which under fog means many more free position
  leaks. Destination-only is both the smaller resolver and the tighter
  one on hidden information.
- **Within your own team, the client prevents pass-through anyway.** Your
  own geometry is known, so the browser disallows it up front — which is
  the existing split (client prevents known-geometry collisions, server
  catches hidden ones). Net effect: you never *see* a pass-through,
  because the only ones the rules permit involve a hull you can't see.

### Commit mechanics — the captain

Each team has a **designated captain**, and the captain commits the
team's phase. At a 1v1 table that's trivially the only player; at
2v2/4v4 the teammates coordinate and the captain locks it in.

**How a team's plan reaches the server — settled, pass eleven:**

- **Coordination happens on voice, not in the UI.** Aditya's call: the
  game builds no shared plan-preview — teammates talk. Each seat plans
  its own ships client-side, and what teammates see of each other's
  intentions is whatever gets said out loud.
- **Ready stages, commit closes.** A seat presses **Ready**, which sends
  that seat's planned moves to the server as the staged plan for its
  ships; the players tile marks who's ready. Un-readying retracts the
  stage. The captain's **commit** closes the phase over whatever is
  staged — a ship with nothing staged holds still (move phase) or
  passes (action phase).
- **Uncommitting is allowed** while the enemy hasn't committed — once
  both teams are in, resolution fires instantly and there is nothing
  left to retract. A **lobby settings toggle** makes commits binding
  for tables that want the pressure.
- **Readiness is public.** The enemy sees the ready marks and the
  committed state — pacing information, not position information;
  hiding it just makes people wait blind.
- **Timer expiry auto-commits the staged set** — exactly what a manual
  commit at that moment would have taken.

*(open: **how is the captain chosen** — host assigns, first-seated on
each side, or the team picks? And can it be handed over mid-game?)*

*(open: **what happens when the captain goes dark?** The shell already
has this exact problem solved for the host — creator's token while
connected, longest-seated fallback while away — so the captain should
almost certainly reuse that idiom, falling back to the longest-seated
live seat on that team. Worth being explicit that a **bot captain**
committing on behalf of live humans is a state that will occur, and
needs to either work or be prevented by the fallback.)*

**The timer is per phase, and each phase has its own setting**: draft,
move and action are three separate clocks in table settings, not one
number applied three times. Draft defaults to untimed. That fits the
shell's existing turn timer with no changes beyond the extra settings —
the timer measures a phase instead of a turn.

---

## Turn structure

Rounds are numbered from 1, and **the draft is turn 0** — a round of its
own that contains no movement and no firing. **Turn 1 opens with move,
then action.** So nobody shoots on the round they place, and the first
shots in the game are fired at post-move positions like every other round.

### Turn 0 — draft phase

- **Each team picks its ships** from the five classes, up to its
  allotment (3 or 4 by table size). **No duplicates within a team** —
  a side may not field two destroyers. The two teams may of course
  overlap with each other.
- Each ship designates one hull tile as its **weapon section** — the
  mount its shots originate from and the tile its special actions center
  on. **Hidden from the enemy, visible to teammates.** End tile or
  interior tile is the live decision here — see "Where the gun sits."
- Each ship takes **up to 2 modifiers**: weapon effect/style changes,
  special actions (sonar, recon, …), and "perhaps a bit of magic."
  **Aditya designs the catalogue after the core game works.** The engine
  carries the slot and the validation from day one and ships with an
  empty or near-empty list, so adding modifiers later is data, not
  surgery.
- **Placement happens in the draft**, once ships are chosen:
  player-selected (not random), inside the team's home band, and
  **secret** from the enemy.
- *(open: are the ship **classes** a team picked public or secret? Aditya
  is leaning public but wants private buildable. Recommendation: make it
  a **table setting** — the engine gates one broadcast field on it,
  which costs nearly nothing now and is expensive to retrofit. Note it
  interacts with no-duplicates: a public fleet list plus the
  no-duplicates rule tells you a lot about what you're facing.)*
- **The draft is untimed by default.** Turn 0 waits for both teams, however
  long they take. If a table *does* set a draft timer, expiry **auto-picks**
  — it cannot simply commit "whatever is planned" the way move and action
  do, because an unplanned draft is not a slow fleet, it's no fleet at all.
- *(open: is the draft one phase or two — pick, then place? And with
  1 player driving 3 ships solo vs 4 players driving 1 each, is there a
  per-team pick order, or does a 4-player team just race for hulls?)*

### Every turn, phase 1 — move

Each ship moves up to its allowance, subject to the turning rules above.
The whole team plans together, then commits; the server resolves both
teams' movement simultaneously.

### Every turn, phase 2 — action

Each ship may either **fire its weapon**, take a **special action**, or
**pass**. Passing is a legal, ordinary choice — not just what a timer does
to you — and it is often the right one, since firing is the main way you
give your own position away.

**Sonar** (submarine): sweeps a 5 × 5 area centered on the sub's weapon
section.

- Results are revealed to the **whole sweeping team**.
- A detected ship leaves a **phantom mark the full size of that ship** —
  so a sweep tells you hull length (and therefore class, given
  no-duplicates), not just "something is here."
- **Subs see pings.** If an enemy submarine is inside the swept area, it
  learns it was swept *and* the sweeping sub is marked for it. Sonar is
  mutual between submarines — a genuinely nasty risk/reward, and the
  best thing in the design so far.
- A phantom mark **persists for one turn** in the tiles where it
  occurred, then clears from the live board. It is not lost, though —
  it lives on in the log (see "The log is a calendar" below).

**Firing** reveals *you*, and **8 tiles is the one threshold**:

- **within 8 tiles**, the exact tile the shot came from is revealed — the
  back tile of a carrier, say;
- **beyond 8**, only a **directional indicator**: the bearing the shot
  came from, running off into fog, with no distance along it.

Measured from the **target's nearest hull tile** to the firing tile — not
from either ship's weapon section, since measuring from a mount would leak
where that mount is, and the mount stays secret all game.

This replaces an earlier three-rung version (exact inside 5, trail
pointing home inside 8, fog beyond). One threshold is cleaner and the
range ladder still does its work: a cruiser firing at its max range of 5
is always inside 8, so it always gives up its exact tile — the knife has
to be held close. A destroyer at 10 or a battleship at 15 stays outside
and leaks only a bearing. And choosing to shoot from closer than you have
to is choosing to be pinpointed.

**Firing reveals you whether or not you hit.** The reveal is about the
shot leaving your hull, not about it connecting — so a miss is intel for
both sides at once: your team gets a cleared lane, the enemy gets your
tile or your bearing.

### Base attacks by class

Aditya's, dictated in chat. All attacks fire **vertically or
horizontally only** (no diagonals), originating from the ship's
**weapon section**.

| Class | Attack |
|---|---|
| **Carrier** | Launches a **plane** along a vertical or horizontal line from the weapon section, **unlimited range** (to the board edge). The player selects a **4 × 3 rectangle** anywhere along that line as the strike zone — 4 tiles along the line of flight, 3 across it. **It hits everything inside**, and it is meant to be devastating. The plane is **revealed at the zone it struck**, giving away roughly where the carrier might be. |
| **Battleship** | Hits a **straight line, range 15**, vertical or horizontal from the weapon section. The heavy artillery piece — enormous reach. |
| **Destroyer** | Fires a **guided missile**, straight line, **range 10**. It may **deviate one row or column** to land a hit, and the deviation **favors end tiles** (see "Where the gun sits" below). Among equally-ranked candidates it's a **50/50** — the guided-missile feel. |
| **Submarine** | Fires a destroyer-style guided missile **underwater**, which hits **other submarines only**. It may **surface** for the action phase to hit above-water ships instead. |
| **Cruiser** | Hits a **straight line, 5 tiles**, vertical or horizontal. Its **special action is a second move** — so a cruiser can cover up to 14 tiles in a round if it forgoes attacking. |

The range ladder reads well against the reveal rules: the battleship's
15 tiles vastly outrange the 8-tile trajectory cutoff, so it can shell
from a distance that leaves the enemy only a bearing into fog. The
cruiser's 5-tile line is a knife — it has to be close, and close is
exactly where firing reveals your exact tile.

The carrier is the odd one out on reveals: instead of a trail from the
firing point, the **plane** is what's seen, at the target end. That
tells the enemy a carrier is somewhere along that row or column without
telling them how far — a softer, wider reveal than everyone else's.

**Special actions:** submarine = sonar, cruiser = second move, and
**that's all of them**. Carrier, battleship and destroyer have no base
special — their slot stays empty until the modifier catalogue fills it.
Two of five holding a special reads as identity, not as an unfinished
table.

### How attacks resolve — settled

**A line attack hits the first thing it meets**, not every tile it
crosses. Range is reach, not a swath: a battleship's 15 means it can
*touch* something 15 tiles away, and lands exactly one hit when it does.
Axis-alignment is dangerous but not instant death, and every range number
in the table above should be read as "how far away I can be while still
landing one hit."

- Aditya is considering a **draft-phase modifier that changes this** —
  penetrating or full-line shots as a purchased option rather than the
  default. Tabled for now; the engine should therefore keep "how far does
  this shot keep travelling once it connects" as a **parameter of the
  shot**, not a hard-coded `break` in the resolver.
- **The carrier is the exception.** Its plane is an *area* attack, not a
  line one: everything inside the selected 4 × 3 rectangle is hit,
  including multiple tiles of the same ship. A carrier caught lying along
  the long side of that box takes 4 hits at once and is all but dead; a
  battleship takes 4 and is dead. That is the intended devastation, and
  it is what the plane's soft reveal, its unlimited range, and the
  carrier's own 5-move/turn-**or**-move sluggishness are paying for.

**No friendly fire, by default.** The resolver skips friendly tiles
rather than damaging them. As with line penetration, Aditya expects a
**table rule modifier** to switch it on for groups that want coordination
to carry that weight — so friendly-fire-on wants to be a flag the
resolver consults, not a rule the resolver lacks.

**A teammate's hull does not block the shot either.** Friendly tiles are
transparent: the line passes over them and hits the first *enemy* it
meets. "No friendly fire" therefore means no friendly obstruction — a
teammate is never a wall you have to shoot around. The own-hull rule
below is deliberately the opposite, because that one is a choice you made
at draft rather than a position your teammate happened to take.

### Where the gun sits — the hull blocks its own fire

**A ship's own hull blocks its line of fire.** This is what turns the
weapon-section pick into a real draft decision instead of a cosmetic one:

- An **end tile** (bow or stern) may fire **horizontally or vertically** —
  open water on three sides gives it the along-axis direction pointing
  away from the hull, plus both perpendiculars.
- An **interior tile** cannot fire along its own axis in either direction
  — the hull is in the way both ways — so it is locked to the
  **perpendicular** orientation only.

| Class | Hull | End tiles | Interior tiles |
|---|---|---|---|
| Carrier | 5 | 2 | 3 |
| Battleship | 4 | 2 | 2 |
| Destroyer | 3 | 2 | 1 |
| Submarine | 3 | 2 | 1 |
| Cruiser | 2 | 2 | 0 |

A cruiser's mount is therefore always an end tile and always has the
choice; a carrier has three interior tiles that trade firing flexibility
for concealment. And **heading now constrains firing** — not as a
separate rule, but because turning rotates which lines the hull blocks.
An interior-mounted ship has to turn to change its firing orientation,
which is exactly the cost that "turn **or** move" looked like it should
carry.

**Missiles favor end tiles.** Because an end mount is the more powerful
choice, the destroyer's (and submarine's) guided missile **biases its
deviation toward an end tile** when it has a choice of targets one row or
column off-centre; the 50/50 applies only among candidates of equal rank.
That's the counterweight — put your gun where it can shoot both ways and
missiles come looking for it. It compounds with the pivot rule, too: end
tiles are also pivot tiles, so an end-tile hit costs firing arc *and*
turning options at once.

### The submarine's depth layer — settled

The ocean has **two layers**, and submarines live on the lower one.
**Submerged is the default state, not an action:** a sub sits underwater
for the whole game. Depth is only ever in question during the **action
phase**, when the sub may choose to **surface in order to attack
above-water ships** instead of firing its underwater missile at other
subs.

- **Only other submarines can hit a submerged sub.** Surface weapons
  cannot reach it. The sonar-versus-sonar duel is the counter-play, and
  yes, that makes subs strong — deliberately.
- **Surfacing can fail, and failure wastes the phase.** If **anything
  sits above any tile of the sub**, the sub cannot surface and **the
  action fails outright**. A surface ship parked over a sub is a cork in
  the bottle — and since surface ships can't see submerged subs, corking
  one is either luck or earned intel.
- **Depth is part of the occupancy check.** A submerged sub and a surface
  ship may share tiles; two submerged subs may not. So the collision
  resolver compares committed footprints **within a layer**, not across
  the whole board.
- **Submerged subs block nothing.** Surface lines pass over them, and
  they are not blockers for the carrier's plane either.
- A consequence worth stating because it's a real advantage:
  **the probe-by-rejection leak doesn't touch subs.** A surface ship
  moving onto a sub's tiles is legal, so no rejection fires and nothing is
  revealed. Subs are invisible to the one information channel the fog
  can't suppress.

**Surfacing exposes the sub for that whole phase.** A sub that surfaces
counts as a surface ship for the entire resolution of that action phase —
so anything that could hit a destroyer can hit it — and then re-submerges
when the phase closes. Since both sides fire at once, a sub cannot
surface, shoot, and duck back down inside the window; committing to a
surface attack is committing to being shootable, and that is the risk
that pays for being untouchable the rest of the time.

Two riders the resolver has to get right. A surfaced sub **does** block
surface lines of fire for that phase, where a submerged one never does.
And "surfaced" must not become a *dodge*: a surfaced sub is hittable by
surface weapons **and** still hittable by another sub's underwater
missile, because a sub that could escape torpedoes by surfacing would
make the sub-versus-sub duel — the only counter-play the design has
against submarines — optional. Exposure only ever adds attackers.

**Surfacing exists only to attack surface ships** — settled. It is never
combined with anything else: a sub that surfaces is attacking, full stop.
So **sonar is always swept submerged**, and there is no surface-and-sweep
phase to reason about. The sub's action phase is a three-way choice —
underwater missile at another sub, surface to shoot a surface ship, or
sweep — and only the middle one exposes it.

**Sonar captures both layers.** A sweep detects surface ships *and*
submerged submarines, which is both the counter-play that keeps subs
beatable and most of what a sub is worth to its team. Depth hides you from
weapons, never from sonar.

### Damage and defeat

- **Hits are tile-specific.** You damage the tile you struck, not the
  next one off the end. Tiles come off one at a time until the ship
  sinks — Battleship attrition on a ship that is moving and shooting
  back.
- **Destroying the weapon section disarms the ship.** It stays afloat,
  it still moves, it still blocks tiles and soaks hits — but it cannot
  fire, and (presumably) cannot take the special action that centers on
  that same tile. This is the payoff for the secret mount: the enemy
  wants *position data*, not just hits, because knowing where the gun
  sits turns any hit into a called shot.
- **Win condition: sink the enemy fleet.** Other modes (holding
  territory) are under consideration; the v1 engine keeps the victory
  check in one replaceable function so a mode can be added without
  reopening the rules.

**What a hit tells the shooter** — confirmed, and generous:

- the **exact tile** of the enemy ship they struck;
- a **3 × 3 reveal centered on that tile**, so the hull tiles adjacent
  to the hit light up and the ship's **orientation** is legible — but
  not necessarily its full **size**, since a 5-long carrier extends past
  the 3 × 3 window.
- **The whole shooting team sees it.** Intel is team property, the same
  as sonar.

That's a clean escalation ladder: a trajectory trail gives you a
bearing, sonar gives you a footprint, and a hit gives you orientation
plus a place to aim next. Each rung costs more to obtain.

**A miss is reported as a dotted line** along the lane the shot travelled
— Aditya's call, and it's the right shape, because under first-thing-hit a
miss is real intel: the whole lane is empty of enemies. A battleship's
miss clears 15 tiles. So the dotted line isn't a consolation message, it's
a **cleared lane**, and it earns a third entry in the intel language
alongside the phantom fill and the ✕.

Like the other marks it lives one turn on the live board and then passes
into the calendar — which is where it does its real work, since a stack of
old cleared lanes is a map of where the enemy *isn't*.

**Damaged tiles are marked, not removed.** A ship's footprint never
changes shape: a 3-long destroyer with a destroyed middle is still a
3-long destroyer, drawn normally with the middle tile **grayed and
smoldering — never red** (pass eleven). Red belongs to enemy intel
exclusively, and every hull that gets drawn is friendly, so the two
treatments never meet on one ship. It still
occupies all three tiles, still blocks them, still collides with them.
The ship sinks when every tile is marked. This is the whole board
representation — a ship is a hull of fixed length with a per-tile
damaged flag — and it makes the geometry questions disappear.

**Damage cripples movement: −2 tiles of movement per hit.**

| Class | Hull | Move | After 1 hit | 2 | 3 | 4 |
|---|---|---|---|---|---|---|
| Carrier | 5 | 5 | 3 | 1 | 0 | 0 |
| Battleship | 4 | 5 | 3 | 1 | 0 | — |
| Destroyer | 3 | 5 | 3 | 1 | — | — |
| Submarine | 3 | 7 | 5 | 3 | — | — |
| Cruiser | 2 | 7 | 5 | — | — | — |

A heavily damaged ship struggles to move at all — thematically right,
and it means a wounded carrier is a liability its team has to decide
whether to screen or abandon.

**A destroyed tile can no longer serve as a pivot.** Turning is defined
by pivot tiles (either end, or the center on an odd hull), so damage
takes those options away one at a time: a carrier whose bow is holed
can't pivot on its bow. Losing the last live pivot means the ship can't
turn at all.

**Move speed clamps at 0**, and the flat −2 stays. Deliberate, and the
reason is pace: a fleet that gets slower as it takes damage is a fleet
that cannot kite the endgame out forever, and Aditya wants the ladder to
be the thing that stops games dragging. So a three-hit carrier with two
live tiles is genuinely immobile — a wreck that can neither flee nor
reposition its gun, only turn. That is the intended severity, not an
oversight, and it is why the balance note below is recorded as a note
rather than a problem.

*(balance note, not an objection: big ships lose mobility much faster
relative to their health than small ones. A cruiser takes one hit and
still moves 5 of its 7; a carrier takes three — with 2 of 5 tiles still
live — and moves 0. Fine if that's the intent, but a flat −2 hits the
5-move classes hardest, and they're already the ones that can only turn
**or** move.)*

---

## The log is a calendar

**The log is a game mechanic here, not a transcript.** In cities and
mahjong the log is a scrolling list of what happened; in ships it is the
team's **intel record**, and reading it well is part of playing well.

- **Marks live one turn on the live board**, then clear. Phantom reveals
  and ✕ hits both.
- **The log keeps them forever.** Clicking a prior turn in the log
  replays that turn's board state for your team: where your own ships
  were, what you detected, what hits landed.
- So the fog is about **attention, not amnesia**. You are never denied
  information you earned — you just can't have all of it on screen at
  once, and correlating turn 4's sonar footprint with turn 7's hit is
  work the player does, not the UI.

That reframes the tile, and pass eleven fixed its shape: the log slot
becomes a **grid of turns** — one cell per turn, and clicking a cell
swaps the board into a read-only historical view of that turn. Not a
scrolling list with a scrubber bolted on; the grid *is* the tile.

**This changes where history lives.** Cities' since-your-last-turn
ledger is client-only memory that a refresh wipes — an acceptable
tradeoff there because it's a convenience. Here it would be a disaster:
refreshing mid-game would destroy a core mechanic. So **per-turn team
snapshots are server-side**, stored in the DO and delivered in the
team's `you`. The payload is small (3–4 ships of ≤5 tiles, plus that
turn's marks — not a 400-tile board), so even a long game is cheap, but
it does mean the DO stores a growing per-team history and the hidden-info
rules apply to every entry of it.

Open questions this raises:

- *(open: what exactly does a historical entry contain? Your own ship
  positions and the marks you held — but also hits **taken**, enemy
  fire trails, and near-misses? The richer it is, the more it becomes
  the primary play surface.)*
- *(open: is the calendar per **team** or per **player**? Team, almost
  certainly — intel is team property everywhere else in this design —
  but "see their own positioning" could read either way.)*
- *(open: does scrubbing history stay available during a live phase, or
  does opening the calendar block committing? It shouldn't block, but a
  player mid-scrub when the timer expires needs to not lose their turn.)*
- *(open: does the calendar survive into game-over as a replay? It would
  be the best possible after-action review, and it's nearly free once
  the snapshots exist.)*

---

## What the foundation already gives us

Worth stating so the build doesn't re-solve any of it: identity and
reconnect, the peek gate, the code combobox, the lobby with seats/bots/
seat colors, kick and host fallback, the toolbar, the 30 s disconnect
grace and bot takeover, the re-join policy, the turn timer and both its
readouts, the single alarm, the idle fuse, personalized per-connection
views with `maskEvent`, the rematch, and the results POST into the
accounts stats pipeline. See [games.md](games.md), "Adding a game."

Ships supplies: `ships/engine.js` (pure, DOM-free, dual-export,
self-tested), `ships/strings.js` (all copy, `[ph]` convention —
Aditya writes the real strings), `ships/index.html`, `ships/ships.js`,
`ships/transport-mock.js`, `ships/ships.css`, and a sibling worker repo
`../DeetsShips` at `ships-api.deets.solutions` vendoring `engine.js`,
`table-do.js` and `colors.js` verbatim.

### Hidden information — the invariant list (draft)

Mahjong is the precedent: anything a seat shouldn't see rides only that
connection's `you`, never a broadcast field.

Note that `you` is now **per team**, not per seat — teammates share
everything. That is a first for this codebase (mahjong's `you` is
strictly per seat), and it means `viewFor(token)` resolves the
connection's seat to a team and builds the team's view.

- **Ship positions** ride only the owning team's `you`. The enemy sees
  intel marks — nothing else.
- **Weapon sections** ride only the owning team's `you`, even for a ship
  the enemy has already located. Explicitly confirmed: visible to
  teammates, hidden from the enemy.
- **Modifiers** ride only the owning team's `you` until their effect is
  observed. *(open: are modifiers revealed on use?)*
- **Sonar results** ride only the sweeping team's `you` — and the
  swept-submarine's counter-detection rides only *that* sub's team.
- **The trajectory trail** is the deliberate leak — exactly what the
  enemy is *meant* to learn, broadcast to whoever the reveal rule says
  can see it and only to them.
- **Draft picks and placements** stay in the team's `you` until the
  draft closes; placements stay there permanently.
- **Plans ride only the team's staging.** A seat's plans reach the
  server when that seat readies (pass eleven — see "Commit mechanics");
  staged plans live in team-scoped state, are never broadcast, and the
  enemy sees only the readiness bits — pacing, not position. A
  disconnect after readying keeps the seat's staged plans; before
  readying, it loses them — the right failure, since a plan the server
  never saw is a plan it cannot leak.

The mahjong test applies to every count: a public "ships alive" tally is
fine, but a public per-ship hull-tile count leaks how much of a specific
hidden ship remains, and a public move-distance event leaks speed class.

### Spectators

**Spectators see both fleets.** Aditya's call, and the right one for
watchability — cities' answer (public state only) would degenerate here
into watching two blank oceans. Ships is therefore the first game on the
site where the spectator view is strictly *more* informed than any
player's.

The accepted cost, recorded so it isn't a surprise later: a seated player
who opens the table as a spectator on a second device sees everything.
Nothing in the rules can prevent that — it's a table-trust matter, the same
as two people playing in one room — but it's worth checking whether the
shell lets a token spectate a table it holds a seat at, since refusing
*that* is cheap and closes the lazy version of the exploit.

Anything that leaks position through a *count* (a public "ships alive"
tally, a public move-length event) needs the mahjong test applied before
it ships: could a careful client mine it for a position?

### The table layout — the bento

Pass eleven, all Aditya's calls. **Desktop-only: ships does not target
mobile at all** — the first page on the site allowed to say that, and
the 20 × 20 board is why. The page is cities' bento (big tile +
dice/players/log right column + role tile), every slot repurposed:

| Slot | Cities / mahjong | Ships |
|---|---|---|
| Dice tile | dice tumble | **Phase banner** — round number, MOVE / ACTION, the phase timer |
| Players tile | seat strip | **Readiness board** — seats banded by team, a ready mark per seat, a captain marker |
| Log tile | scrolling event log | **The calendar** — a grid of turn cells (see "The log is a calendar") |
| Big tile | hex board / walls | Clean **20 × 20 ocean grid** |
| Role tile | hand / rack | **The planning surface** — left half picks one of your ships, right half picks that ship's action |

- **The planning loop is select → select → target.** Pick a ship (left
  half of the role tile), pick an action (right half), and the board
  lights **every valid tile** for it — destinations for a move, pivot
  handles for a turn, lanes for a shot, strike zones for the plane.
  Illegal tiles stay dark. The affordance is cosmetic, as always: the
  server re-validates every commit from scratch.
- **Resolution plays back simultaneously** — both teams' moves and
  shots animate at once, smooth and elegant, not sequenced into a
  cinematic. One renderer should serve both jobs: live playback and the
  calendar's historical views are the same code path over different
  data.
- **The beyond-8 bearing is a compass glyph** — an arrow at the
  revealed point aimed in one of eight directions (N/S/E/W and the
  diagonals; missile deviation and nearest-tile measurement mean the
  firing tile need not share the target's row or column).
- **The weapon section is a colored circle** over its hull tile —
  drawn on the teammate view only, riding the team's `you` like
  everything else about the mount.
- **Ally damage grays and smolders** — see "Damage and defeat." Red
  never appears on a friendly hull.

### Board art and the intel language

Same carve-out shape as cities and mahjong: the ocean, the ship
silhouettes, the intel marks and the trajectory trails are a fixed
palette scoped to the game's root class and do not follow theme/skin.
Everything else — bar, tiles, pills, popovers, toasts — rides the
semantic tokens and must survive all 30 combos. Art ships as geometric
placeholders under `assets/sprites/ships/` until Aditya draws it.

**The intel language is one color, two marks** (Aditya's call):

| Mark | Means |
|---|---|
| **Phantom red fill** over revealed tiles | something was detected here — sonar sweeps, hit-adjacent 3 × 3 reveals, firing-point reveals |
| **Red ✕** on a tile | a confirmed hit landed here |
| **Dotted red line** along a lane | a shot travelled here and found nothing — the lane is clear |

One color for all enemy information is the right instinct: intel isn't
attributable to a *seat*, so painting it in seat colors would imply an
ownership it doesn't have. Phantom vs ✕ is then the only distinction the
eye has to make — suspicion vs certainty.

**Red/scarlet is reserved.** Team colors come from the six presets minus
a carved-out red band, and custom hex picks in that band are refused —
enforced in `games/colors.js` so the server rejects them too, not just
the picker. That's what keeps a team from fielding ships that read as
enemy intel. Red is also `--stop` in the token system, but these are
carve-out literals scoped to the board, so there's no conflict — just
don't let the board's red leak into the surrounding chrome.

**Both marks persist one turn**, then clear from the live board and pass
into the log's calendar (see "The log is a calendar"). Nothing
accumulates on the live ocean.

---

## Open questions, collected

Resolved across passes two and three: player counts; colors and teams as
foundation work; simultaneous commit/resolve; open board; collision by
rejected commit; turning geometry and reverse movement; no-duplicate
fleets; teammate-visible weapon sections; secret player-chosen placement
in the draft; sonar's audience and sub-vs-sub mutual detection; the hard
8-tile trail cutoff; tile-specific attrition; disarming via the weapon
section; the hit's 3 × 3 orientation reveal; team captains; fleet
elimination as the win condition; and the red phantom/✕ intel language.

Pass four resolved: team colors instead of seat colors (so `colors.js`
stays at six presets), the reserved red band, self-serve team switching,
one-turn mark persistence with permanent history in the calendar log,
damaged-but-not-removed hull tiles, −2 movement per hit, and destroyed
tiles losing their pivot.

Pass five resolved: owner names under friendly hulls, and the five base
attacks.

Pass six resolved the whole attack-resolution core: **first thing hit**
for line attacks (with penetration parked as a possible draft modifier),
the carrier's **4 × 3, unlimited-range, hits-everything** strike zone,
**no friendly fire by default** (a table modifier can turn it on), the
hull **blocking its own fire** — which makes end tiles the flexible mount,
gives heading a real firing cost, and earns the **missile bias toward end
tiles** — and the submarine's depth layer: **submerged by default**,
**sub-only targetability**, **per-layer occupancy**, and **surfacing that
fails outright if anything sits above the hull**.

Then the two riders those answers created, immediately: **a teammate's
hull is transparent** (no friendly fire means no friendly obstruction),
and **surfacing exposes the sub for that whole phase** — shootable by
surface weapons and by other subs both, then back under.

With that, **every rule that decides what the game *is* is settled.**
What remains is either a number to pick or a piece of scaffolding, and
none of it changes the shape of the engine.

Pass seven settled: **move clamps at 0** with the flat −2 (pace is the
point), **surfacing is purely an attack** so sonar is always swept
submerged, **no draw rule or round cap in v1** (play it out first, then
tune), the **red band moves into a ships-local `Colors` subclass** so
shared `colors.js` and both live workers are untouched, and **teams of
one** for cities and mahjong instead of a null-teams branch, with their
UX explicitly unchanged.

Pass eight settled: **destination-only movement collisions** (with the
client preventing intra-team pass-through), **misses reported as dotted
cleared lanes** — a third mark in the intel language, **sonar detecting
both layers**, and **no base specials** for carrier, battleship or
destroyer.

Pass nine closed the engine's rule set: **8 tiles as the single reveal
threshold** (exact tile inside, bearing only beyond), **firing reveals you
on a miss too**, **only the colliding ships are rejected**, and the
**missile ranking confirmed as written**.

Pass ten settled the turn frame and the last of the UX questions: **the
draft is turn 0** (turn 1 opens with move, then action, so nobody fires on
the round they place), **the draft is untimed by default** with auto-pick
if a table sets a clock, **each phase has its own timer setting**, **ships
may pass**, **spectators see both fleets**, **teams are two columns of
seats** in the lobby, and **no terrain in v1**.

Pass eleven settled the table's face, all Aditya's calls:
**desktop-only** (ships does not target mobile); the **bento mapping**
(dice slot → phase banner, players tile → readiness + team bands +
captain marker, log tile → the calendar's grid of turns, big tile → the
20 × 20 ocean, role tile → ships left / actions right, with the board
lighting every valid tile for the selected action); **planning
coordination on VC** with per-seat **Ready** staging and the captain's
commit closing the phase over whatever is staged; **uncommit allowed**
until the enemy commits, with a lobby toggle to lock it;
**simultaneous, smooth playback** rather than a sequenced cinematic;
the beyond-8 bearing as an **8-direction compass glyph**; ally damage
**grayed and smoldering, never red**; and the weapon section as a
**colored circle** on the teammate view.

**One rules question left:** whether disarming takes the cruiser's second
move (above — recommend it survives).

**Plumbing, decidable at build time:**

1. **Captain selection and captain-goes-dark fallback**, including whether
   a bot may captain live humans. (The shell's host idiom — creator's
   token while connected, longest-seated fallback — is the obvious model.)
2. **What a calendar entry contains**, and whether it's per team or per
   player. (Per team, almost certainly.) Plus the UI rider: scrubbing
   history must not block committing, and a player mid-scrub when the
   timer expires must not lose the phase.
3. **Draft ordering** within a multi-player team, and whether the draft is
   one phase or two (pick, then place).
4. **Public or secret fleet lists** (recommend: a table setting).
5. **Are modifiers revealed on use?** Moot until the catalogue exists.
6. **Audit `viewFor` in the base** — ships needs `you` to be per *team*,
   a first here (mahjong's is strictly per seat). If the base bakes in a
   per-seat assumption, that's a foundation change, not a ships override.
7. **The 8-seat `PRESETS` trap** — see "The foundation investment."
8. **Whether the shell lets a seated token spectate its own table** — worth
   refusing now that the spectator view is omniscient.
9. **The ships bot.** Not a question so much as unscoped work: planning
   under fog, holding intel state, possibly captaining live humans. Harder
   than either existing game's bot, and it collides with the
   parameterized-bots workstream already on this branch.

**Deferred past v1, on purpose:**

10. **Whether the calendar becomes a post-game replay** (nearly free once
    the snapshots exist).
11. The **modifier catalogue** — the slot and its validation ship empty.
    Includes the tabled **line-penetration modifier** and the
    **friendly-fire table rule**, which is why shot travel and friendly
    tiles are both resolver parameters rather than hard-coded behavior.
12. **Terrain** — confirmed out of v1. The board stays a data structure
    that can grow a per-tile field.
13. **A draw rule and round cap**, if playtesting says games need them.

### Gaps the narration missed, and where they landed

Found while writing pass six down: places where a resolver has to do
*something* and the doc said nothing. Some are now settled, some are still
waiting on Aditya — marked either way.

- **How does the guided missile pick its target?** **The missile resolves
  itself** — settled. The player picks a direction, nothing else; the
  deviation is not aimed. The ranking, confirmed:

  The missile advances one tile at a time to its range limit. At each
  distance it considers a **3-tile cross-section** — the tile on the line
  plus the one tile to either side of it (the legal "one row or column"
  deviation). At the **first distance where that cross-section contains
  any targetable enemy tile**, the missile hits, choosing among the
  candidates in this order:

  1. **Live tiles beat destroyed tiles.** Guidance never wastes itself on
     a hole if a whole tile is available in the same cross-section.
  2. **End tiles beat interior tiles.** This is the bias — strong enough
     to make the missile deviate *off* an interior tile to reach a bow or
     stern beside it.
  3. **On-line beats deviated.** All else equal it flies straight.
  4. **Remaining ties are a 50/50**, server-rolled.

  Three notes on why it's shaped this way. The bias is toward **end
  tiles, not the weapon section** — homing on the mount would both leak
  hidden information and be far too strong. Rule 1 means a **wreck
  screens its team**: a destroyed tile still blocks, so firing into one is
  wasted, but the deviation gives the missile an out when a live tile sits
  beside the hole. And friendly tiles and submerged subs are neither
  candidates nor blockers, so they never appear in a cross-section at all.
- **No draw rule and no round cap in v1** — deliberate. Aditya wants to
  play games out and see how long they actually run before adding a
  clock to them. Recorded so the consequence isn't a surprise: with
  movement clamping at 0, two crippled fleets can end up unable to reach
  each other, and "sink the enemy fleet" never resolves. Note the idle
  fuse does **not** rescue that case — players committing empty phases
  reads as activity — so the practical outcome is a table nobody can
  finish and nobody can lose. Cheap insurance if it shows up in
  playtesting: a mutual-destruction draw (simultaneous fire makes it
  reachable on its own) plus a cap, both one-line additions to the
  victory check that already lives in a single replaceable function.
- **What shape is round 1?** **Settled (pass ten):** the draft is
  turn 0, a round of its own with no movement and no firing — nobody
  shoots on the round they place.
- **Does the draft have a timer, and what does expiry pick?** **Settled
  (pass ten):** untimed by default; if a table sets a draft clock,
  expiry auto-picks, since an unplanned draft is no fleet at all.
- **Does disarming take the cruiser's second move?** *(open — the last
  rules question.)* Destroying a ship's weapon section disarms it: no
  firing, and no special action that *centres on that tile*. That second
  clause covers the submarine and the carrier cleanly, because sonar sweeps
  a box centred on the mount and the plane launches from it — kill the
  mount and both specials die with it. But **the cruiser's second move
  centres on nothing at all**, so as the rule is written a disarmed cruiser
  loses its gun and keeps its 14 tiles of movement. That makes the cruiser
  the only class whose special survives being disarmed.

  Recommend **letting it survive.** Its engines aren't its gun, and the
  cruiser is a 2-tile hull — its weapon section is one of only two tiles,
  so being disarmed already means it is one hit from sinking. What it
  becomes is a fast, unarmed scout its team has to decide whether to spend,
  which is a more interesting wreck than an immobile one. If instead
  disarming should kill *every* special, that's a one-word change — the
  rule becomes "no firing and no special action," full stop.
- **Phase timer lengths** — and whether MOVE and ACTION get the same
  clock. The shell's timer already exists; only the numbers are missing.
- **May a ship decline to act?** **Settled (pass ten):** yes — passing
  is a legal, ordinary choice, and often the right one.

Aditya's to write, not Claude's to invent: the per-class attack designs,
the modifier catalogue, and every user-facing string.

---

## Build log

Running record so an interrupted session can pick up mid-stream. Each
entry says what landed and what it still needs.

- **Teams foundation — LANDED (site copy), pending re-vendor.**
  `games/table-do.js` (the `TEAMS` getter, `teamOf`/`captainSeat`/
  `teamColor`, team-resolved seat colors incl. empty seats, the captain
  recolor rule, the `teams` Start refusal + stamping, `teamColors` in
  state, per-seat `team` on results), `games/table-mock.js` (all of it,
  byte-parallel), `games/table.js` (two-column lobby + Sit here +
  captain badge + captain-gated picker + uneven-Start gate +
  `cfg.timerBudget()` for per-phase clocks), `styles/table.css`
  (`.gt-lobby__teams/__team/__teamhead`). Documented in
  [games.md](games.md), "Teams". Cities/mahjong behavior unchanged by
  design (teams of one); needs: browser load check of both games,
  re-vendor `table-do.js` into `../DeetsCities` + `../DeetsMahjong`,
  redeploy both.
- **Build-time decisions taken** (were "plumbing, decidable at build
  time"): captain = host idiom per team (lowest-indexed connected human,
  else lowest live seat — a bot captain can occur and must work);
  captain also owns the team color; per-seat **Ready** stages plans,
  captain commits (pass eleven). Shell strings a real-teams game must
  supply: `captainBadge`, `sitHereButton`, `teamsUnevenHint`.
- **`ships/engine.js` — LANDED.** Pure, DOM-free, dual-export;
  `node ships/engine.js` runs 170 self-checks. Implements the whole
  closed rule set: draft as turn 0 (no dupes, home bands, auto-pick on
  expiry), per-seat stage/ready + captain commit/uncommit (+ the
  `lockCommit` table setting), destination-only per-layer collisions as
  a revert-to-origin fixpoint, first-thing-hit lines, the carrier's
  4×3 zone, the missile's four-rung ranking, the depth layer (cork-fail
  surfacing, surfaced-for-the-phase exposure), mutual sonar, the 8-tile
  reveal threshold (Chebyshev; bearing = 8-way compass), −2 move per
  hit clamped at 0, pivot loss, disarm (cruiser's second move
  survives — the recommended call, now implemented), per-turn team
  history for the calendar, per-seat shot/hit/sunk counters, and
  `checkVictory` as the one replaceable function. The engine also owns
  the view builders (`teamYou`/`spectatorYou`/`publicView`/
  `maskEventFor`) so worker and mock scrub hidden info identically.
  Build decisions worth flagging: **sunk ships stop blocking** and
  their wrecks are public; **mutual total destruction ends the game as
  a shared rank-1 tie** (the state leaves no alternative — the doc's
  own insurance note); **the cruiser's second move resolves after
  fire** (you can be hit where you stood); **pivot sweeps are not
  collision-checked** (destination-only supersedes the earlier
  swept-arc language); private engine events ride ONE `news` envelope
  per team so the enemy can't even count them. Engine error codes for
  `errExtra`: `plan`, `dupe`, `band`, `move`, `aim`, `turn`,
  `disarmed`, `locked`. The engine also owns `makeColors(base)` — the
  ships-local red-band Colors wrapper (PRESETS without red, `norm()`
  refusing the red hue band) — so browser and worker build it from the
  same vendored code.
- **The client — LANDED.** `ships/index.html` (bento; nav on all 10
  pages links the tab), `ships/strings.js` (all `[ph]`, awaiting
  Aditya's pass), `ships/ships.css` (bento + the board carve-out:
  `--sh-*` literals, red = intel only, gray smolder for own damage),
  `ships/transport-mock.js` (mock spec: captain-gated commit via
  extraCommand, anchor bot, engine view builders), and `ships/ships.js`
  (the planning surface: select ship → select action → the board lights
  valid tiles; per-phase planning state; ghosts for staged plans; the
  phase banner in the dice slot with per-side committed rows; the
  readiness board; the calendar as a grid of turns with read-only
  history views; the Guide popover bottom-left of the board — four
  tabs, class table; the over screen with per-seat shots/hits/sunk and
  Rematch). **Verified headlessly** (jsdom, `?mock`): a scripted
  end-to-end game — lobby → add bot → start → full draft → move →
  fire → round 2 → calendar scrub → guide — passes 34 UI assertions
  with a clean console. Look-and-feel review is Aditya's, in his
  browser at http://localhost:8787/ships/?mock.
- **Draft-UI shape (build decision):** slots on the left; a slot walks
  class → placement (rotate chip, anchors lit in the band) → mount
  (hull tiles lit). Teammates' picks aren't previewed (VC rule), so a
  duplicate class surfaces as the `dupe` refusal at Ready — the toast
  says whose problem it is.
- **The worker — LANDED, DEPLOYED, PRIVATE REPO.** `../DeetsShips`
  (github.com/deets-137/DeetsShips, private), live at
  `ships-api.deets.solutions` (peek answers). `ShipsTable extends
  GameTable` with `TEAMS = 2`; `GAME_VERBS = {stage, unstage}`;
  commit/uncommit run through `extraCommand` because captaincy is a
  connectivity fact the engine can't see; per-phase `deadlineFor`;
  the anchor bot in `needsPhantom`/`phantomOne`. Vendors `table-do.js`,
  `colors.js`, `engine.js` verbatim (`scripts/vendor.mjs --check`);
  `scripts/check.mjs` (47 checks) guards the results payload.
  ⚠ **Aditya's two steps remain:** `npx wrangler secret put
  SESSION_SECRET` and `... INGEST_SECRET` in `../DeetsShips`, same
  values as DeetsAccounts — until then, seats are guests and finished
  games wait in the DO outbox (both working degraded modes).
- **Stats — LANDED + LIVE.** DeetsAccounts: `ships` counter whitelist
  (`shots`, `hits`, `ships_sunk`), `ships_seats` table, and
  `result_seats.team` (nullable — the predicted ALTER TABLE) applied to
  the live D1 and deployed (repo pushed, its check suite at 56 green).
  Site: profile page shows a DeetsShips box (labels are inline in
  `profile.js` following that file's existing convention — flagging for
  Aditya's review: "Shots fired", "Hits landed", "Ships sunk").
- **Docs + nav:** all 10 pages' Games menus link `/ships/`; README,
  CLAUDE.md, [games.md](games.md) ("Teams"), and [stats.md](stats.md)
  (ships column mappings, `team`) updated.
- **Still open after this build:** Aditya's copy pass over
  `ships/strings.js` (everything is `[ph]`); the two worker secrets
  (above); his look-and-feel pass at `http://localhost:8787/ships/?mock`
  (headless checks passed, but visuals are his call); art (geometric
  placeholders ship; sprites land under `assets/sprites/ships/`);
  rejoin/disconnect behavior can only be tested live (the mock doesn't
  model it — same caveat as both other games); the modifier catalogue,
  terrain, draw rule — all still deferred per the design; and the
  parameterized-bots/Elo workstream (the anchor bot is deliberately
  minimal).
