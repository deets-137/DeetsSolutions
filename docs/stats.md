# Game stats — the accounts phase-2 design

**Status: designed, not built.** Nothing in this document exists yet. It is
the plan for attributing finished games to accounts and showing them back on
`/profile/`.

> "Phase 2" is overloaded in this repo. This is **accounts phase 2** — phase 1
> was sign-in plus the profile page, both live since 2026-07-27
> ([accounts.md](accounts.md)). The *CSS split's* phase 2
> ([css-split.md](css-split.md)) and cities' long-finished "phase 2 (the
> worker)" are unrelated.

Read [games.md](games.md) first — especially **"Change radius"**, because this
feature touches vendored contract code in three repos.

---

## Decisions already made

From [accounts.md](accounts.md), "Beyond phase 1". Not up for relitigation:

- **Results POST over a service binding** — worker→worker, not public HTTP.
- **Idempotency key `game:tableId:rematchIndex`.**
- **A table where any seat changed hands mid-game is unrated** — its results
  attach to no one.
- **No email, ever.** The users table holds an opaque `google_sub`, a name and
  a colour. Stats must not widen that.

And from phase 1's plumbing: the verified per-seat `uid` is the hook results
hang on. It is set at the WebSocket upgrade from the `ds_sess` cookie, is
never client-supplied, and **never rides a view**.

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
| Robber moves | free | `robber.moved` |
| Pieces built | free | `pieces.{roads,settlements,cities,devBought,devPlayed,knights}` |
| Biggest single haul | free | `biggestHaul` |
| Dice history | free | `rolls.{count,hist}` per seat, `stats.dice` table-wide |
| Losses | partial | `lost.{discards,robbed,spent}` — **scalars, not per-resource** |
| Turns played | free | `stats.turns` |
| Longest Road / Largest Army held | free-ish | `g.awards.{longestRoad,largestArmy}` (seat index or null) — but see the awards note below |

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
upgrades a pung already counted — decide whether that decrements `pungs`
(recommendation: **no**; it was a pung, and the kong is counted separately).

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

**Design consequence: do not store superlatives.** They are pure functions of
counters we are already storing. Store the counters; compute superlatives at
read time. Otherwise every new superlative is a schema migration and a
backfill, and old rows disagree with new ones about what "Most resources"
counted.

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
game-agnostic. The clients can then drop their local sorts and render
`rank` directly — one behaviour, one place.

### Ties need an explicit policy

Today's tie handling is incidental rather than designed:

- Mahjong's `finishGame()` picks the highest score with `>`, so **a tie
  silently resolves to the lowest seat index**. Seat order deciding a match is
  not a rule anyone agreed to.
- Cities can't tie on a normal win (a seat crosses the threshold on its own
  turn) but *can* tie via `concede()`'s best-VP fallback.

Recommended policy, applied in `standings()` for both games: **competition
ranking** — equal scores share the best rank and the next rank skips
(1, 2, 2, 4) — with `tied: true` on shared ranks. `winner` stays whatever the
engine already decided, so nothing about gameplay changes; only the reported
standing does.

**Open question for Aditya:** does a **conceded** cities seat take last place
regardless of VP, or keep its VP standing? Conceding is currently a way to
leave, not a resignation with a scoring meaning.

---

## Data caveats that lifetime aggregates will amplify

Each of these is harmless in a single game-over screen and misleading once
summed over hundreds of games. Fix or document before ingesting, not after.

**Cities**

- The timer's auto-roll increments the table-wide dice histogram but **not**
  the per-seat `rolls.count` — so a player who times out often shows fewer
  rolls than turns.
- The timer's forced robber move does **not** increment `robber.moved`.
- `gained.trades` counts **bank/harbour trades only**. Player-to-player trades
  are never recorded — a heavy trader's "resources gained" understates them.
- Monopoly proceeds land in `gained.steals`, so "steals" mixes two mechanics.
- `lost.robbed` and `robber.victimized` are redundant — both +1 at the same
  site. Store one.
- `lost` is scalar-only: cards lost to a monopoly, given in a bank trade, or
  given in a player trade are counted nowhere. "Net resources" is not
  computable from this data.

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
       └─ build the result payload (seat → uid, standings, stats)
            └─ POST over the service binding → DeetsAccounts
                 └─ idempotent upsert into D1
                      └─ /profile/ reads aggregates
```

### `onGameOver()` — four gaps to close first

1. **It is synchronous** and its return value is discarded, called from a sync
   path. A POST needs `ctx.waitUntil` inside the override, or the call site
   made async.
2. **`rematchIndex` does not exist.** The agreed idempotency key references a
   counter never built — `rematch()` nulls the game and increments nothing.
   Add a monotonic per-table counter, bumped on rematch, persisted with the
   table.
3. **No `unrated` bit.** The `adopted` event fires but nothing persists it.
   Set `t.unrated = true` when a seat changes hands. **Decide the full trigger
   list:** adoption certainly; what about mid-game `stand`, a host kicking a
   human to a bot, and `concede`? Each changes who owns the outcome.
4. **Neither game worker makes any outbound request today**, and neither has a
   `services` binding. This is the first.

Note that cities already overrides `onGameOver()` (to settle the betting
book), so its override grows rather than appears; mahjong gains one.

### Payload

Built in the DO, where `seat.uid` is readable — it is the only place uid
lives, and it deliberately isn't in any view.

```jsonc
{
  "key":     "cities:ABCD:0",       // game:tableId:rematchIndex
  "game":    "cities",
  "started": 1753900000000,
  "ended":   1753903600000,
  "unrated": false,
  "seats": [
    { "seat": 0, "uid": "u_…", "rank": 1, "tied": false,
      "score": 10, "bot": false, "conceded": false,
      "stats": { /* that game's per-seat blob, verbatim */ } }
  ]
}
```

Bot and guest seats ride along with `uid: null` — they are needed for context
("2nd of 4") but attribute to no account.

### Storage

Two tables in the existing `deets-accounts` D1. No new database.

```sql
CREATE TABLE results (
  key        TEXT PRIMARY KEY,      -- game:tableId:rematchIndex, the idempotency key
  game       TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at   INTEGER NOT NULL,
  seats      INTEGER NOT NULL,
  unrated    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE result_seats (
  key      TEXT NOT NULL REFERENCES results(key) ON DELETE CASCADE,
  seat     INTEGER NOT NULL,
  uid      TEXT,                    -- NULL for bots and signed-out players
  rank     INTEGER NOT NULL,
  tied     INTEGER NOT NULL DEFAULT 0,
  score    INTEGER NOT NULL,
  stats    TEXT NOT NULL,           -- JSON, the game's own per-seat blob
  PRIMARY KEY (key, seat)
);
CREATE INDEX result_seats_uid ON result_seats(uid, key);
```

Why this shape:

- **`INSERT OR IGNORE` on the primary key is the whole idempotency story** —
  a retried POST is a no-op, no read-modify-write, no race.
- **Per-seat stats stay JSON.** They are game-specific and will grow; a column
  per counter means a migration every time a game learns to count something.
  Aggregates are computed on read, and the volume is a personal site's.
- **`unrated` rows are stored, not dropped.** They still show in "games
  played"; they just don't feed win rates. Dropping them loses the ability to
  change our mind later.
- **No opponent names are stored** — only uids and seat indices. Names resolve
  at read time from `users`, and non-account seats have no name at all. This
  keeps the "no PII, ever" rule intact.

### Reading

One new route, `GET /me/stats`, returning aggregates for the signed-in user
plus enough per-game detail for the profile boxes. `/me` stays
`{id, name, color}` — widening it would make every page's sign-in check pay
for stats it doesn't render.

---

## The profile boxes

The bento grid was left "deliberately roomy" for exactly this
([accounts.md](accounts.md)); stats land as new boxes, not a redesign.

- **Overall** — games played, wins, win rate, a placement distribution
  (1st/2nd/3rd/…), rated vs unrated split.
- **Per game** — one box each. Cities: VP totals, resources gained by bucket,
  steals and stolen-from, pieces built, biggest haul. Mahjong: match wins
  *and* hand wins as separate numbers, self-draws, deal-ins, pungs/chows/kongs,
  best faan.
- **Superlatives**, computed at read time from stored counters, phrased as
  lifetime versions of the four each game already shows.

Copy convention: the accounts pages write copy **inline**, not through a
`strings.js` — that precedent is already set by phase 1 and the profile page,
unlike the games' `[ph]` convention.

---

## Cost and blast radius

| Change | File | Re-vendor / deploy |
| --- | --- | --- |
| `standings()` | `cities/engine.js`, `mahjong/engine.js` | **Both game worker repos, redeploy** |
| Pung/chow counters | `mahjong/engine.js` | **DeetsMahjong, redeploy** |
| `rematchIndex`, `unrated`, async `onGameOver` | `games/table-do.js` | **Both game worker repos, redeploy** |
| The POST + payload | each worker's `src/index.js` | Redeploy (not vendored) |
| Ingest route + schema | `../DeetsAccounts` | Deploy + `wrangler d1 execute` |
| Service bindings | both games' `wrangler.jsonc` | Redeploy |
| Profile boxes | `profile/`, `styles/main.css` | Site only |
| Client `rank` rendering | `cities/cities.js`, `mahjong/mahjong.js` | Site only |

**Deploy the accounts worker before the game workers** — the same ordering
phase 1 used, so an ingest POST never arrives at a worker that would 404 it.

**This is deploy-to-verify.** Neither `?mock` path exercises the real session
cookie, so the uid→seat attribution cannot be tested locally at all — the same
caveat that applies to disconnect and rejoin behaviour. Expect to verify live,
and prefer landing the engine/DO changes (which the mocks *do* exercise)
separately from the POST.

---

## Open questions for Aditya

1. **Conceded seats** — last place, or their VP standing? (See "Standings".)
2. **What makes a table unrated** — adoption only, or also mid-game `stand`,
   host kick-to-bot, and concede?
3. **Bot-heavy tables** — does a 2-human, 4-bot cities game count toward win
   rate, or is there a minimum-humans bar for a rated game?
4. **Do the caveats get fixed or documented?** Making cities count
   player-to-player trades and timer-forced actions is an engine change with
   the full re-vendor cost; leaving them means lifetime numbers carry a known
   lean.
5. **Retention** — keep every game forever, or roll old rows into per-user
   totals? (A personal site will not hit a limit; the question is whether you
   want the history at all.)
