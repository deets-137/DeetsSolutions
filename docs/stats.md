# Game stats — the accounts phase-2 design

**Status: designed, not built.** Nothing in this document exists yet except
the three engine fixes noted under "Data caveats". It is the plan for
attributing finished games to accounts and showing them back on `/profile/`.

> "Phase 2" is overloaded in this repo. This is **accounts phase 2** — phase 1
> was sign-in plus the profile page, both live since 2026-07-27
> ([accounts.md](accounts.md)). The *CSS split's* phase 2
> ([css-split.md](css-split.md)) and cities' long-finished "phase 2 (the
> worker)" are unrelated.

Read [games.md](games.md) first — especially **"Change radius"**, because this
feature touches vendored contract code in three repos.

---

## The organizing principle

**Write facts. Decide policy at read time.**

Almost every judgement call this feature invites — what counts as rated, does a
conceder place last, is a 2-human/4-bot game real, how do you show a tie — is a
*policy* question, and none of them need answering before the schema exists.

`unrated: 0|1` is a verdict baked into a row on the day you happened to have an
opinion. `conceded`, `humans`, `bots`, `exit`, `via` are facts. From facts you
can compute any verdict, and change your mind next month with a `WHERE` clause
instead of a backfill. The same instinct already appears in the awards section
below ("store the counters, compute superlatives at read time"); this document
applies it everywhere.

The one thing *not* recoverable later is data never written down. So the bias
runs the other way on capture: store the whole event stream, store every seat
including bots, store the settings the game was played under, and keep it all
forever. Storage is the cheap half.

---

## Decisions already made

From [accounts.md](accounts.md), "Beyond phase 1", plus the design pass of
2026-07-28. Not up for relitigation:

- **Results POST over a service binding** — worker→worker, not public HTTP.
- **Idempotency key `game:tableId:rematchIndex`.**
- **No email, ever.** The users table holds an opaque `google_sub`, a name and
  a colour. Stats must not widen that.
- **Ties use competition ranking** — `1, 2, 2, 4`, shared ranks flagged, shown
  as `T-2nd`.
- **A conceded seat keeps the standing its VP earned.** Reaching 8 VP and
  leaving for the evening is a result, not a forfeit.
- **Elo is per game**, never site-wide, and is a *derived cache* recomputed
  from the results table — never the source of truth.
- **Placement is stored raw.** Normalising 3rd-of-6 against 3rd-of-3 into a
  percentile or a 4.0 scale is a rendering choice, deferred to whenever the
  stats view gets built.
- **Counters get columns, not a JSON bag** — see "Storage", including why the
  verbatim JSON is *also* kept.

And from phase 1's plumbing: the verified per-seat `uid` is the hook results
hang on. It is set at the WebSocket upgrade from the `ds_sess` cookie, is
never client-supplied, and **never rides a view**.

---

## The uid is destroyed the moment a player leaves

This is the trap this whole design is shaped around, and it is not visible
from reading the pipeline.

`games/table-do.js` deletes `uid` from the seat on **every** departure path:

- `concedeSeat()` — `delete s.token; delete s.uid;`
- the host-kick branch — the seat converts to a bot, `delete t.seats[s].uid`
- the `stand` branch — same

So "read `seat.uid` at `onGameOver()`" silently fails for exactly the players
we most want to credit: the one who conceded at 8 VP, the one who stood up,
the one who got kicked. It fails *quietly* — you get a plausible row with
`uid: null` and never notice the attribution went missing.

**The fix is not to stop deleting the uid.** The delete is correct: a vacated
seat must not keep an identity claim on it. The fix is to record attribution
**when it happens** rather than reading it at the end:

```js
// t.spans — append-only, one entry per occupancy of a seat
{ seat, span, uid, name, kind, via, exit,
  joinedAt, leftAt, joinedTurn, leftTurn }
```

Written on join / adopt / reclaim / takeover, closed out on
concede / stand / kick / grace-expiry, and closed out for everyone still
seated at game over. The payload builder reads this ledger, never the live
seats.

This one structure carries a lot: it is the attribution fix, it is the
leaver/joiner history, and it makes "a seat changed hands" a *derived* fact
(`COUNT(*) > 1` for that seat) rather than a boolean somebody had to remember
to set.

---

## What the engines already give us

The honest inventory. "Free" means the number already exists at
`phase === "over"`; "new" means engine instrumentation, which is **vendored
contract code** — see the cost section.

### Cities

| Wanted | Status | Where |
| --- | --- | --- |
| Final VP per seat | free | `Engine.totalVP(g, i)` — settlements + cities×2 + longest-road 2 + largest-army 2 + hidden `vpCards` |
| Winner | free | `g.winner` |
| **Placement (1st/2nd/…)** | **new** | Computed nowhere. See "Standings". |
| Resources gained | free | `stats.seats[i].gained.{rolls,steals,trades,dev}`, each a full 5-resource hand |
| Steals / stolen-from | free | `stats.seats[i].robber.{stolen,victimized}` |
| Robber moves | free | `robber.moved` — timer-forced moves now included |
| Pieces built | free | `pieces.{roads,settlements,cities,devBought,devPlayed,knights}` |
| Biggest single haul | free | `biggestHaul` |
| Dice history | free | `rolls.{count,hist}` per seat, `stats.dice` table-wide; auto-rolls now included |
| Losses | partial | `lost.{discards,spent}` — **scalars, not per-resource** |
| **Player-to-player trades** | **new** | Not counted. See below. |
| Turns played | free | `stats.turns` |
| Longest Road / Largest Army held | free-ish | `g.awards.{longestRoad,largestArmy}` (seat index or null) — but see the awards note below |

**The new player-to-player trade counters.** `gained.trades` counts
bank/harbour trades only, so a heavy trader's numbers understate them badly.
Three counters, decided 2026-07-28:

```js
ptp: { trades, given, received }   // count, gross cards out, gross cards in
```

Incremented at the trade-close site, which already holds both bundles (the
`{ t: "trade", from, to, give, get }` event carries them). Deliberately *not*
per-resource — ten more columns for a precision this feature does not want.

### Mahjong

| Wanted | Status | Where |
| --- | --- | --- |
| Final score per seat | free | `players[i].score` (signed, zero-sum) |
| Match winner | free | `g.winner` |
| **Placement** | **new** | Computed nowhere. |
| **Hand wins** | free | `players[i].stats.wins` |
| Self-draws | free | `players[i].stats.selfDraws` (a subset of `wins`) |
| Deal-ins | free | `players[i].stats.dealIns` |
| **Kongs** | free | `players[i].stats.kongs` (covers claimed, added and concealed) |
| **Pungs** | **new** | No counter exists. |
| **Chows (chews)** | **new** | No counter exists. |
| Best hand (faan) | free | `players[i].stats.bestFaan` — **only recorded on a win** |
| Hands played | free | `g.stats.hands` |
| Per-hand history | free | `g.results[]` — rich, and currently thrown away at game over |

**Why pungs and chows are "new" and not "derivable".** Melds live on
`players[i].melds`, but `deal()` resets every player's melds at the start of
each hand, and only the *winner's* melds are snapshotted into `results[]`.
Losers' melds are destroyed. So the history cannot be reconstructed after the
fact — the counters have to be incremented as the melds are claimed.

Two counters, incremented beside the existing `kongs`:

```js
stats: { wins, selfDraws, dealIns, kongs, pungs, chows, bestFaan }
```

`pungs` at the pung claim; `chows` at the chow claim. An added kong (`kongA`)
upgrades a pung already counted and **does not decrement `pungs`** — it was a
pung, and the kong is counted separately.

---

## The awards are not what they look like

This is the part most likely to cause a wrong build, so it is worth being
blunt.

**The "four end-of-game awards" in each game are not engine data.** They are
*client-side superlatives*, computed at render time from the stats blob:

| Cities (`cities.js`) | Mahjong (`mahjong.js`) |
| --- | --- |
| Most resources — `sum(gained)` | Most wins — `stats.wins` |
| Biggest single haul — `biggestHaul` | Biggest hand — `stats.bestFaan` |
| Most knights — `pieces.knights` | Most kongs — `stats.kongs` |
| Most robbed — `robber.victimized` | Most deal-ins — `stats.dealIns` |

They have no engine representation, no persistence, and no tie-breaking
beyond stable seat order.

Separately, cities' engine has an `awards` object — but that is **two**
gameplay awards (Longest Road, Largest Army) worth +2 VP each, not four
accolades. Don't conflate them.

**Design consequence — facts on the wire, opinions in the client.** "Seat 2
finished with 9 VP, rank 2, tied" is a fact the server owns. "Most Knights" is
a curatorial choice about which counter is fun this month. So:

- Superlatives are **never stored** and **never transmitted**. They stay
  client-side, computed from counters at render time.
- A new superlative is a site edit, not a schema migration plus two worker
  deploys, and old rows never disagree with new ones about what it counted.
- Durable award history is still available: "how often did I have the most
  knights at the table" is a per-game comparison across the stored seat rows,
  which is exactly why **bot and guest seats are stored too**. You cannot ask
  "did I lead the field" without the field.

Only `rank` / `tied` moves server-ward, and only because the ingest payload
genuinely needs it.

---

## Standings

Placement does not exist anywhere today — not in either engine, the DO, or
the clients. Both clients merely `.sort()` a reveal array at render time and
highlight the winner; no index is ever emitted.

**Put it in the engines**, as a pure function beside the existing exports:

```js
Engine.standings(game) → [ { seat, rank, score, tied } ]
```

Reasons: each engine already knows what "score" means (cities = `totalVP`
including hidden VP cards; mahjong = cumulative `score`), it is DOM-free and
self-testable like the rest of the engine, and it keeps `table-do.js`
game-agnostic. The clients then drop their local sorts and render `rank`
directly — one behaviour, one place.

This is also the line that decides where *anything* in this feature lives:

> **Shared with the browser → the engine** (vendored, re-vendor cost).
> **Server-only → the worker's `src/index.js`** (cheap redeploy).

`standings()` is browser-shared and pays the toll. The payload builder and the
engine-stats→column mapping are read only by the ingest path, so they live in
each game worker's `src/index.js` and never touch the engine contract.

### Ties

Today's tie handling is incidental rather than designed:

- Mahjong's `finishGame()` picks the highest score with `>`, so **a tie
  silently resolves to the lowest seat index**. Seat order deciding a match is
  not a rule anyone agreed to.
- Cities can't tie on a normal win (a seat crosses the threshold on its own
  turn) but *can* tie via `concede()`'s best-VP fallback.

**Competition ranking**, applied in `standings()` for both games: equal scores
share the best rank and the next rank skips (`1, 2, 2, 4`), with `tied: true`
on shared ranks, rendered `T-2nd`. Two tied 3rds are both 3rd and the tie is
visible. `winner` stays whatever the engine already decided, so nothing about
gameplay changes; only the reported standing does.

Placement distributions therefore sum to more than games played whenever a tie
happened. That is correct, and nobody will notice.

### Conceded seats keep their standing

`concede()` returns the hand to the bank but leaves **buildings, roads, and any
held award on the board** — the engine's own self-checks assert it. So
`totalVP` for a conceded seat is intact and meaningful at game over, and "I got
to 8 VP and had to go" records as 8 VP with an `exit` marker beside it.

No engine change is needed for this. A reader forms their own opinion about a
seat that left; we don't form it for them.

---

## Data caveats that lifetime aggregates will amplify

Each of these is harmless in a single game-over screen and misleading once
summed over hundreds of games.

**Cities — fixed 2026-07-28** (site repo only; see the drift note in "Cost"):

- ~~The timer's auto-roll increments the table-wide dice histogram but **not**
  the per-seat `rolls.count`.~~ **Fixed** — an auto-roll now counts on the
  acting seat, histogram included.
- ~~The timer's forced robber move does **not** increment `robber.moved`.~~
  **Fixed** — a forced move counts like a manual one.
- ~~`lost.robbed` and `robber.victimized` are redundant — both +1 at the same
  site.~~ **Fixed** — `lost.robbed` removed, `robber.victimized` kept (the
  "Most robbed" card reads it).

**Cities — accepted, by decision**

- **Monopoly proceeds land in `gained.steals`**, so "steals" mixes robber
  steals and monopolies. *Decided: leave it.* Splitting the bucket changes
  what the existing end-screen card counts, for a distinction nobody watching
  the game makes.
- `lost` is scalar-only: cards lost to a monopoly, given in a bank trade, or
  given in a player trade are counted nowhere. **"Net resources" is not
  computable from the counters** — but it *is* computable from the event log
  (see "Three grains"), which is one of the reasons the log is worth keeping.

**Cities — still open**

- Player-to-player trades are uncounted until the `ptp` counters above ship.

**Mahjong**

- `bestFaan` only updates on a **win**. A huge hand you never completed is
  never recorded, so "biggest hand" means "biggest *winning* hand".
- `selfDraws` is a subset of `wins`, not disjoint — don't add them.
- The match winner is decided on cumulative score, so **the seat with the most
  hand wins can lose the match**. Track and present them as two different
  things.

---

## The pipeline

```
engine reaches phase "over"
  └─ table-do.js applyEngine() → onGameOver()          [the existing hook]
       └─ build the payload from t.spans + Engine.standings() + stats
            └─ POST over the service binding → DeetsAccounts
                 └─ idempotent batch upsert into D1
                      └─ /profile/ reads aggregates
```

### `onGameOver()` — the gaps to close first

1. **It is synchronous** and its return value is discarded, called from a sync
   path. A POST needs `ctx.waitUntil` inside the override, or the call site
   made async.
2. **`rematchIndex` does not exist.** The agreed idempotency key references a
   counter never built — `rematch()` nulls the game and increments nothing.
   Add a monotonic per-table counter, bumped on rematch, persisted with the
   table.
3. **The spans ledger does not exist** — see "The uid is destroyed" above.
   This is the load-bearing one.
4. **Neither game worker makes any outbound request today**, and neither has a
   `services` binding. This is the first.

Note that cities already overrides `onGameOver()` (to settle the betting
book), so its override grows rather than appears; mahjong gains one.

### Delivery

`waitUntil` is fire-and-forget: if the accounts worker is mid-deploy, that
game silently never happened.

**First pass:** write the payload to DO storage under `pending:<key>` *before*
POSTing, and delete it on a 2xx. Nothing reads it back yet.

**Second pass:** the existing alarm (already multiplexing turn deadlines,
grace expiries and the idle fuse) sweeps leftover `pending:` keys and retries.
Roughly fifteen lines — and games lost during the gap are still sitting in DO
storage waiting to be drained, which is the entire reason the first pass
writes a key it doesn't yet read.

### Payload

Built in the DO, where the spans ledger lives — the only place uid is
readable, and it deliberately isn't in any view.

```jsonc
{
  "key":      "cities:ABCD:0",       // game:tableId:rematchIndex
  "game":     "cities",
  "tableId":  "ABCD",
  "rematchIndex": 0,
  "started":  1753900000000,
  "ended":    1753903600000,
  "settings": { "vpTarget": 10, "frame": "classic" },
  "humans":   3,
  "bots":     1,
  "seats": [
    { "seat": 0, "rank": 1, "tied": false, "score": 10,
      "stats": { /* that game's per-seat blob, verbatim */ } }
  ],
  "spans": [
    { "seat": 0, "span": 0, "uid": "u_…", "name": "Deets", "kind": "user",
      "via": "lobby", "exit": null,
      "joinedAt": 1753900000000, "leftAt": null,
      "joinedTurn": 0, "leftTurn": null },
    { "seat": 2, "span": 0, "uid": "u_…", "name": "Sam", "kind": "user",
      "via": "join", "exit": "stand", "leftTurn": 31 },
    { "seat": 2, "span": 1, "uid": null, "name": "Rook", "kind": "bot",
      "via": "takeover", "exit": null, "joinedTurn": 31 }
  ],
  "log": [ /* the full event stream */ ]
}
```

**Seats carry the outcome; spans carry the occupancy.** A seat with one span
was played by one person start to finish. Two spans means it changed hands,
and both occupants are named.

---

## Storage

All of it in the existing `deets-accounts` D1. No new database, no KV, no
Durable Object storage beyond the outbox. Only DeetsAccounts binds D1 — the
game workers POST and never learn SQL, which keeps schema ownership in one
repo.

### Three grains of history

Each answers a different question and carries a different cost:

| Grain | Answers | Size | Shape |
| --- | --- | --- | --- |
| **Scoreboard** | who played, what they scored, where they placed | tiny | queryable columns |
| **Occupancy** | who hopped in, who hopped out, when | ~4–8 rows/game | queryable columns |
| **Event stream** | trades, rivalries, comebacks, replays | 50–500 KB/game | one opaque blob |

The middle grain is the one most easily lost by accident. Burying the
occupancy timeline inside a JSON blob would make "who left mid-game" a thing
you can only answer by parsing every row in JavaScript — so it gets its own
table.

### Schema

```sql
-- one row per finished game
CREATE TABLE results (
  key           TEXT PRIMARY KEY,     -- "cities:ABCD:0", the idempotency key
  game          TEXT NOT NULL,
  table_id      TEXT NOT NULL,        -- split out so rematch chains group
  rematch_index INTEGER NOT NULL,
  started_at    INTEGER NOT NULL,
  ended_at      INTEGER NOT NULL,
  seats         INTEGER NOT NULL,
  humans        INTEGER NOT NULL,     -- facts, not a rated/unrated verdict
  bots          INTEGER NOT NULL,
  settings      TEXT NOT NULL         -- JSON: VP target, frame, winds, minFaan…
);

-- the outcome, one row per seat. THIS is the uid join.
CREATE TABLE result_seats (
  key       TEXT NOT NULL REFERENCES results(key) ON DELETE CASCADE,
  seat      INTEGER NOT NULL,
  uid       TEXT,                     -- final occupant; NULL for bot/guest
  rank      INTEGER NOT NULL,
  tied      INTEGER NOT NULL DEFAULT 0,
  score     INTEGER NOT NULL,
  stats     TEXT NOT NULL,            -- the game's blob, verbatim (the archive)

  -- denormalised from results; rows are write-once, so there is no update
  -- anomaly, and the profile's hot query stays single-table
  game      TEXT NOT NULL,
  ended_at  INTEGER NOT NULL,
  seats     INTEGER NOT NULL,

  PRIMARY KEY (key, seat)
);
CREATE INDEX result_seats_uid      ON result_seats (uid, ended_at DESC);
CREATE INDEX result_seats_uid_game ON result_seats (uid, game);

-- the occupancy, one row per person-in-a-seat
CREATE TABLE result_seat_spans (
  key         TEXT NOT NULL REFERENCES results(key) ON DELETE CASCADE,
  seat        INTEGER NOT NULL,
  span        INTEGER NOT NULL,       -- 0,1,2… successive occupants of one seat
  uid         TEXT,                   -- NULL for bots and guests
  name        TEXT NOT NULL,          -- stored for bots and guests; live for users
  kind        TEXT NOT NULL,          -- 'user' | 'guest' | 'bot'
  via         TEXT NOT NULL,          -- 'lobby'|'join'|'adopt'|'reclaim'|'takeover'
  exit        TEXT,                   -- NULL = played to the end;
                                      -- 'concede'|'stand'|'kick'|'grace'
  joined_at   INTEGER, left_at   INTEGER,
  joined_turn INTEGER, left_turn INTEGER,
  PRIMARY KEY (key, seat, span)
);
CREATE INDEX result_spans_uid ON result_seat_spans (uid, key);

-- the counters, one table per game, one column per counter
CREATE TABLE cities_seats (
  key TEXT NOT NULL, seat INTEGER NOT NULL,
  vp INTEGER, roads INTEGER, settlements INTEGER, cities INTEGER,
  dev_bought INTEGER, dev_played INTEGER, knights INTEGER,
  gained_rolls INTEGER, gained_steals INTEGER, gained_trades INTEGER, gained_dev INTEGER,
  ptp_trades INTEGER, ptp_given INTEGER, ptp_received INTEGER,
  biggest_haul INTEGER, steals INTEGER, victimized INTEGER, robber_moved INTEGER,
  rolls INTEGER, discards INTEGER, spent INTEGER,
  longest_road INTEGER, largest_army INTEGER,
  PRIMARY KEY (key, seat)
);

CREATE TABLE mahjong_seats (
  key TEXT NOT NULL, seat INTEGER NOT NULL,
  score INTEGER, wins INTEGER, self_draws INTEGER, deal_ins INTEGER,
  kongs INTEGER, pungs INTEGER, chows INTEGER, best_faan INTEGER,
  PRIMARY KEY (key, seat)
);

-- the event stream, alone so a careless SELECT * never drags it
CREATE TABLE result_logs (
  key    TEXT PRIMARY KEY REFERENCES results(key) ON DELETE CASCADE,
  detail TEXT,                        -- mahjong's per-hand g.results[] summaries
  log    TEXT NOT NULL                -- the full event stream, JSON
);
```

### Why this shape

- **`INSERT OR IGNORE` is the whole idempotency story.** A retried POST is a
  no-op — no read-modify-write, no race. Every statement goes in one
  `env.DB.batch([...])`, which D1 runs as a transaction, so a partial ingest
  cannot happen.
- **Counters get columns, one table per game.** SQL-native `SUM`/`AVG`/`MAX`
  with no parse loop, and the table is legible in the D1 console. Mahjong's
  columns never pollute cities' rows, and a new counter is
  `ALTER TABLE … ADD COLUMN` on one game only — which SQLite does as a
  metadata-only operation: instant, no table rewrite.
- **The verbatim `stats` JSON is kept anyway.** Not redundancy for its own
  sake: when a column is added six months from now, the JSON is the only thing
  that lets it be backfilled into old rows. Without it, every new counter
  starts at zero on the day it was thought of.
- **`uid` has no foreign key to `users`.** A `CASCADE` on account deletion
  would blow holes in *other people's* games ("2nd of 4" quietly becoming
  "2nd of 3"). An orphan uid resolves to no name, exactly like a bot.
- **`kind` is a column, not a name suffix.** `WHERE kind = 'bot'` is what a
  reader wants; `WHERE name LIKE '%_bot'` breaks the day someone types
  `Chad_bot` at a gate, and it produces a wrong chart nobody catches.
- **Names are stored only for bots and guests.** Account names resolve at read
  time through `users`, so a rename retroactively fixes every past game and
  the "no PII, ever" rule stays intact.
- **Settings ride on `results`.** A 1-wind mahjong match and a 4-wind match
  are wildly different lengths; an 8-VP cities game is not a 10-VP game.
  Without this, lifetime averages blend them and there is no way to segment
  after the fact.
- **Everything is kept forever.** No rollups. This is what makes Elo
  replayable — change the K-factor, switch to a multiplayer variant, decide
  bot-heavy games count for half, and just recompute the ladder in `ended_at`
  order. Rollups would foreclose all of it permanently.

### Two seats, one account

It is possible, and it is easy: sign in on a laptop, join as "Deets"; then on
a phone (the `ds_sess` cookie is scoped to `.deets.solutions`, so it rides
along) join as "Deets Phone". Reclaim-by-uid only targets a **dark** seat, so
the laptop's live seat isn't pulled; the join falls through to a fresh seat
carrying the same uid. Only the name-clash check stands in the way, and a
different name walks past it.

**Tainted, not blocked.** A guard would be two lines, but it would also stop
two browsers being opened to test a table — which happens often. The spans
ledger makes it visible (`COUNT(DISTINCT uid) < COUNT(*)` over a game's
spans), and read-time policy can exclude those games from win rate and Elo.

### A known limitation: guests

A guest has no uid, so a guest is identifiable *within* a match but not
*across* matches. Two sessions by the same person are two unrelated rows, and
the only thread between them is a name they retyped. There is no fixing that
without giving guests an identifier, which is how you build accounts by
accident. The limitation is accepted.

### The event log needs building — and the existing cap is load-bearing

**The DO already keeps a log, but a truncated one.** `applyEngine()` pushes
every engine event onto `t.log` and then trims it:

```js
(res.events || []).forEach((e) => this.t.log.push(e));
if (this.t.log.length > LOG_MAX) this.t.log.splice(0, this.t.log.length - LOG_MAX);
```

`LOG_MAX = 240`, FIFO. A cities game runs roughly 900 events and a 4-wind
mahjong match several thousand, so **the surviving log is the tail, not the
game**. It is reset with the game (`t.log = []`), so it is already correctly
scoped to one entry in a rematch chain.

**Do not simply raise `LOG_MAX`.** The cap protects the persist path:
`persist()` serialises the *entire* table record — `log` included — and
`broadcast()` calls `persist()` on every single state change. Log length
therefore multiplies every write for the rest of the game. Uncapped, a
~900-event cities game would write on the order of **tens of megabytes** of
re-serialised log across its life instead of a few hundred kilobytes, and
every one of those writes is metered (each counts toward the Durable Object's
rows-written budget).

**Store the archive separately from the table record.** Append-only chunks
under their own storage keys, each written once and never rewritten, flushed
every `ARC_CHUNK` events. `persist()` keeps writing a small record, writes stay
linear in the number of events, and the payload builder concatenates the chunks
at game over. `t.log` stays exactly as it is, capped at 240, because it serves a
different purpose: the live client's scrollback.

```js
export const ARC_CHUNK = 100;   // events per archive chunk

// applyEngine() — alongside the existing t.log push
(res.events || []).forEach((e) => { this.t.log.push(e); this.t.arcBuf.push(e); });

// broadcast() — see "the flush seam" below
async flushArc() {
  if (this.t.arcBuf.length < ARC_CHUNK) return;
  await this.ctx.storage.put("arc:" + String(this.t.arcN).padStart(6, "0"), this.t.arcBuf);
  this.t.arcN++; this.t.arcBuf = [];
}

// payload time — flushed chunks, then whatever hasn't been flushed yet
async readArchive() {
  const m = await this.ctx.storage.list({ prefix: "arc:" });
  return [...m.values()].flat().concat(this.t.arcBuf);
}
```

`arcN` and `arcBuf` join the `load()` key list and the `persist()` record, which
is what makes the whole thing safe:

**The un-flushed buffer is durable, so flush timing cannot lose data.** A
hibernation, eviction or crash between flushes loses nothing — `arcBuf` comes
back with the table. Flushing is therefore a write-volume optimisation, not a
correctness mechanism. It also costs less than what the record already carries:
`t.log` is up to 240 events (~36 KB) on every persist; a 100-event buffer is
~15 KB.

**The flush seam is `broadcast()`, not `applyEngine()`** — `applyEngine()` is
synchronous (the same constraint that forces `onGameOver()` to be reworked for
the POST), and every mutation path funnels through `broadcast()` anyway.

Two failure modes worth naming, because both hide until late:

- **Pad the chunk index.** `storage.list()` sorts keys lexicographically, so
  `arc:10` sorts before `arc:2` and the log silently reassembles out of order —
  only in games long enough to pass ten chunks, which is to say never during
  testing. Hence `padStart(6, "0")`.
- **Reset the archive wherever `t.log = []` happens.** The scrollback resets on
  a new game but the `arc:*` keys would survive, and the next game's
  `arc:000000` would collide with the previous game's. Delete the old keys and
  zero `arcN` alongside. `wipe()` needs nothing — `deleteAll()` already covers
  them.

The mocks need no equivalent: they neither persist nor POST, so the archive is
a server-only concern.

**Decided: retain the full stream until the table closes.** A table is bounded
by its idle fuse, and the stream is the only grain that can ever answer
questions the counters weren't designed for (net resources, comebacks, who
trades with whom).

**One caveat about what the log contains.** `t.log` holds the **unmasked**
engine events — `broadcast()` applies `maskEvent()` on the way out, not on the
way in. For mahjong that means the archive includes hidden information: draws,
discards in context, and what each seat was holding. That is normal for a
finished game (a chess PGN reveals everything too), but it means the log is a
**post-game reveal** and must never be served for a table still in progress —
and any export of it discloses every past hand.

---

## Reading

One new route, `GET /me/stats`, returning aggregates for the signed-in user
plus enough per-game detail for the profile boxes. `/me` stays
`{id, name, color}` — widening it would make every page's sign-in check pay
for stats it doesn't render.

**Export, not a SQL console.** A shared stats page with a raw-SQL box is
explicitly *not* being built. `db.prepare(sql)` will happily run
`DELETE FROM users`, D1 exposes no per-statement read-only mode, and
regex-allowlisting `SELECT` is a guard that holds until someone gets clever —
against a database holding `google_sub`. Instead: **CSV/JSON export** of the
result set, which is what someone strong in data science actually wants
(they'd rather have it in pandas anyway), at none of the risk.

If a live console is ever wanted, the prerequisite is a **separate stats
database** holding only results/spans/counters and nothing that identifies
anyone — so the worst case of a busted guard is a leaked game table, which is
the page's whole point.

---

## The profile page

The bento grid was left "deliberately roomy" for exactly this
([accounts.md](accounts.md)); stats land as new boxes, not a redesign. Two
audiences, one page:

- **Summary** — games played (with the rated split), win rate, podium rate,
  times left mid-game. Then one box per game: Elo with its recent delta, the
  counter grid, and a raw placement distribution.
- **Match history** — League's anatomy. One row per game: game chip, placement
  (`1st`, `T-3rd`), score, the field's seat colours, relative date. Expanding
  a row shows the **whole field**, not just you — every seat's counters, plus
  `left · turn 31` / `joined · turn 31` tags rendered straight from
  `result_seat_spans`. This is the view that cannot be built if the occupancy
  timeline lives in a blob.
- **Data** — export.

Copy convention: the accounts pages write copy **inline**, not through a
`strings.js` — that precedent is already set by phase 1 and the profile page,
unlike the games' `[ph]` convention.

---

## Cost and blast radius

| Change | File | Re-vendor / deploy |
| --- | --- | --- |
| Timer stat fixes (done) | `cities/engine.js` | **DeetsCities, redeploy — pending** |
| `standings()` | `cities/engine.js`, `mahjong/engine.js` | **Both game worker repos, redeploy** |
| Pung/chow counters | `mahjong/engine.js` | **DeetsMahjong, redeploy** |
| `ptp` trade counters | `cities/engine.js` | **DeetsCities, redeploy** |
| Spans ledger, `rematchIndex`, async `onGameOver`, outbox | `games/table-do.js` | **Both game worker repos, redeploy** |
| Payload builder + stats→column mapping + the POST | each worker's `src/index.js` | Redeploy (not vendored) |
| Ingest route + schema | `../DeetsAccounts` | Deploy + `wrangler d1 execute` |
| Service bindings | both games' `wrangler.jsonc` | Redeploy |
| Profile boxes | `profile/`, `styles/main.css` | Site only |
| Client `rank` rendering | `cities/cities.js`, `mahjong/mahjong.js` | Site only |

### ⚠ Known vendoring drift

**`cities/engine.js` in the site repo is ahead of the copy deployed in
`../DeetsCities`** as of 2026-07-28 — the three timer/counter fixes above.
This is benign: the changes are counter-only, with no rule or wire-shape
change, so a `?mock` game and a prod game still play identically and merely
disagree on three stat numbers.

**Deliberately not deployed on its own.** The engine is due several more
changes (`standings()`, the `ptp` counters, and mahjong's pungs/chows), so the
drift gets cleared in **one re-vendor and redeploy of both workers once every
stat counter is in** — rather than four separate deploys of vendored contract
code. Anyone touching `cities/engine.js` before then should expect the site
copy to be the newer one.

### Ordering

**Deploy the accounts worker before the game workers** — the same ordering
phase 1 used, so an ingest POST never arrives at a worker that would 404 it.

**This is deploy-to-verify.** Neither `?mock` path exercises the real session
cookie, so the uid→seat attribution cannot be tested locally at all — the same
caveat that applies to disconnect and rejoin behaviour. Expect to verify live,
and prefer landing the engine/DO changes (which the mocks *do* exercise)
separately from the POST.

---

## Suggested landing order

1. **Engine + client.** `standings()` in both engines, mahjong's
   `pungs`/`chows`, cities' `ptp` counters, clients rendering `rank` and `T-`
   instead of local sorts. Fully testable under `?mock`.
2. **DO plumbing.** The spans ledger, `rematchIndex`, async `onGameOver`, the
   `pending:` write. Still no network. Re-vendor and redeploy both workers
   here — this is the deploy that clears the drift.
3. **Accounts schema + `POST /ingest` + `GET /me/stats`.** Deploy accounts
   *before* the game workers.
4. **Service bindings + the POST.** The live-only step.
5. **Profile boxes + export.** Site only.
6. **Outbox retry**, once results have been flowing long enough to trust.

---

## Open questions

Everything else is decided. What remains:

1. **Bot difficulty tiers tied to Elo** — parked, no rush. The schema already
   supports it: `kind = 'bot'` plus a stored `name` gives a per-bot rating
   whenever it's wanted.
2. **Placement normalisation** — percentile, a 4.0 scale, or raw only. Stored
   raw either way; deferred until the stats view exists.
3. **Chunk size for the log archive** — how many events per `log:N` write.
   Bigger chunks mean fewer metered writes and more loss if a table dies
   mid-chunk; a hundred or so is probably right, but it wants one look at real
   event rates before being fixed.
