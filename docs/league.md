# League tab

The `league/` tab shows League of Legends stats for anyone who's been
looked up — champion aggregates, Arena augment winrates, mastery, rank,
and expandable match scoreboards. Unlike SOTD/Movies (static JSONs), this
tab talks to the **[DeetsLeague](../../DeetsLeague) Cloudflare Worker** at
runtime: the worker holds the Riot API key, stores trimmed match rows in
D1, and backfills each player's history in the background.

**Status**: worker deployed and crawling at `api.deets.solutions`; the
page works locally but isn't committed/published yet.

## Constraints that drive the design

- **Rate limit**: personal API key = 20 req/s and **100 req / 2 min**,
  shared across everything. The key lives as a Worker secret
  (`wrangler secret put RIOT_API_KEY`), never in the browser or git.
- **Matchlist depth**: match-v5 only *lists* a player's most recent ~1,000
  match IDs **or ~2 years, whichever is smaller** (measured July 2026:
  D33TS's list ends at 309 ids, oldest dated Aug 2024, `start=310` → `[]`
  despite thousands of older games). Match *detail* by ID stays fetchable
  beyond that — IDs already crawled into our DB never expire, but
  undiscovered history slides away permanently. Backfill early; our D1 is
  the only long-term memory. (Recovering pre-window games would take match
  IDs from elsewhere, e.g. a Riot personal-data request.)
- **PUUID-only world**: since June 2025 all summonerId/accountId endpoints
  are gone. PUUIDs are permanent and global — store them. Riot IDs
  (`Name#TAG`) are **mutable**: lookups are case-insensitive, responses
  return canonical casing (store what Riot returns), and the
  riot-id→puuid mapping is re-verified weekly.

## Riot API map

| API | Routing | Use |
|---|---|---|
| account-v1 by-riot-id | `americas` | Riot ID → PUUID, once per player |
| summoner-v4 by-puuid | `na1` | profile icon, level |
| league-v4 entries by-puuid | `na1` | rank/LP — **often `[]` (unranked); the UI handles that** |
| champion-mastery-v4 by-puuid | `na1` | lifetime per-champ points |
| match-v5 ids / match / timeline | `americas` | match history |
| Data Dragon | CDN | champion/profile art — no key, fetched by the browser |
| Community Dragon | CDN | **Arena augment** names/icons (not in Data Dragon): `raw.communitydragon.org/latest/cdragon/arena/en_us.json` |

The tagline doesn't encode platform (transfers keep it), so `players`
stores platform per person; v1 defaults everyone to `na1`.

## Observed payloads (July 2026, patch 16.13)

| Payload | Size |
|---|---|
| SR match detail (10 players) | ~68 KB |
| Arena match detail (18 players — 2026 Arena is 6 trios; it's been 8 duos before, so nothing assumes a group size) | ~137 KB |
| SR timeline (17 min) | ~300 KB |
| Arena timeline (24 min) | **~1.3 MB** |
| Trimmed participation row | ~250 bytes |

Timelines are never crawled — fetched lazily only if a view ever needs
one, cached 7 days in KV.

### Free-tier ceilings (reset 00:00 UTC)

The whole backend runs on Cloudflare's free plan, so these are the hard
walls, in the order we bump into them:

| Resource | Free limit | What spends it |
|---|---|---|
| **D1 rows written / day** | **100,000** | `ingestMatch` — the real constraint (see below) |
| KV writes / day | 1,000 | `profile:`/`tl:` puts (was raw blobs — that's what we hit) |
| D1 rows read / day | 5,000,000 | stats/aggregates, the crawler's known-checks, `/budget` polls |
| D1 storage | 5 GB total | all tables + indexes |
| Worker external subrequests / invocation | 50 | Riot `fetch`es → **implicitly caps `CRAWL_BUDGET` at ~48** |
| Worker subrequests to CF services / invocation | 1,000 | D1/KV calls (plenty of headroom) |
| Worker requests / day | 100,000 | every fetch + every cron tick |

D1 counts index maintenance as extra writes: a `participations` insert
touches two indexes (`+2`), a `matches` insert one (`+1`). A Classic match
costs ~32 write-units. Arena *used* to cost ~215 because each pick was its
own `participation_augments` row (`~80/match`, ~80 % of all writes); those
now ride the participation row as a JSON `augments` column, so an Arena
match is ~56 — the packing cut a full-DB rebuild ~93k → ~38k write-units.
Backfill writes, not the Riot key, still gate how many players we can
track. `/budget` reports `kvWrites`; a D1 gauge is a to-do.

## Worker architecture

```
browser ──> api.deets.solutions (CF Worker, secret: RIOT_API_KEY)
              ├─ D1: players/queue, matches, participations, augments, rate + KV-write ledgers
              ├─ KV: profile snapshots (10 min), timelines (7d, lazy)
              ├─ cron (*/30): budgeted backfill crawler, no-op when queue empty
              └──> na1 / americas .api.riotgames.com
browser ──> ddragon.leagueoflegends.com + communitydragon.org (art, direct)
```

Routes (all GET, JSON, CORS locked to deets.solutions + localhost):

| Route | Returns |
|---|---|
| `/player/:name/:tag` | profile + rank + mastery merged; **enqueues new players** for backfill (open enrollment, soft cap 300). **Temporarily gated by `PLAYER_ALLOWLIST`** (see below) — a non-listed lookup is refused `403` before any Riot call |
| `/players` | tracked players — feeds the combo box |
| `/stats/:puuid?queue=&mode=&patch=` | per-champion aggregates from D1, zero Riot calls |
| `/augments/:puuid?champion=` | Arena augment win% / avg placement |
| `/matches/:puuid?count=&champion=` | recent matches from D1 (all-time when champion-filtered); on visit, tops up everything since the last visit (pages until a known game, capped at `TOPUP_MAX`) |
| `/match/:id` | raw match JSON, re-fetched live from Riot + ingested to D1 (not cached); debug/self-heal path, off the hot path |
| `/scoreboard/:id` | full scoreboard from D1 — no Riot call; self-heals pre-name matches once on first open |
| `/timeline/:id` | raw timeline JSON, KV-first, lazy |
| `/budget` | `{used, live, limit, backfilling, kvWrites, kvWriteLimit}` — the shared-budget readout |

## Rate-limit guardrails

All Riot traffic flows through one `riotFetch`, which writes to a
**call ledger** (`rate_buckets`: one D1 row per 10s bucket, live vs cron).
The rolling 2-minute sum drives three protections:

1. **Hard stop** — live calls are refused (clean 429, no Riot call) once
   the window hits 95, so we never actually trip Riot's limiter.
2. **Yielding crawler** — each cron slice skips entirely if there was
   meaningful live traffic in the last 2 minutes, and otherwise sizes
   itself to `min(40, what's left − 10)`. Backfill is the lowest-priority
   tenant of the key.
3. **`/budget` + the bar readout** — `Refresh | 43/100 · 2 in queue`,
   tinted `--go`/`--pause`/`--stop` at 50/80, so friends can see when to
   let the key breathe. The refresh pill self-disables for 30s per click.

Reads degrade rather than fail: a rate-limited top-up falls back to
D1-only data and the page still renders.

**Temporary lookup allowlist (`PLAYER_ALLOWLIST`).** A stopgap while the
free-tier strain is being sorted before publish: a comma-separated,
case-insensitive list of Riot IDs in `wrangler.jsonc` `vars`. `lookupAllowed`
is checked in the router *before* `handlePlayer`, so a non-listed `/player`
lookup is refused `403` (the page says so) and spends **zero** Riot calls and
enqueues nobody — it caps enrollment, the only path that triggers a full
backfill crawl. Currently `D33TS#NA1,blobbombs#NA1,Bishop217#NA1,Darkhawk67#NA1`
(the three tracked players + one). **Leave the var empty to restore open
enrollment** — that's the only change needed to lift the gate. (The puuid
endpoints `/stats`,`/augments`,`/matches` aren't gated, but a puuid is only
obtainable via a `/player` lookup, so they're not an enrollment vector.)

## Data model (D1)

`players` (doubles as the crawl queue: status `queued → backfilling →
live`, `backfill_cursor`, `matches_crawled`, `crawl_complete`),
`matches` (queue, mode, patch, duration, `is_remake` — remakes are stored
but excluded from every aggregate), `participations` (one row per
participant per match — all 10/16/18, which is what makes duo/"games with
friends" queries *and* the D1-served scoreboard possible, and is why a
newly-added friend's shared games light up with no re-fetch). Each row
carries the participant's `riot_id_game_name` (for the scoreboard) and, on
Arena, an `augments` JSON array (packed in-row — no side table). Arena rows
carry `placement`/`subteam_id`; `win` is stored exactly as Riot reports it
(in Arena it means "top half" and Riot knows each format's cutoff — never
derive it from placement). Full DDL in
[DeetsLeague/schema.sql](../../DeetsLeague/schema.sql).

**Not in D1**: raw match JSON (never persisted — the normalized rows hold
everything every endpoint serves, scoreboard included), timelines and
profile snapshots (KV, short TTL). The raw blob used to sit in KV too, but
caching one per crawled match blew the free tier's 1,000-writes/day cap;
`/budget` now reports `kvWrites` against `kvWriteLimit`.

**Scoreboard self-heal (decaying cost).** `/scoreboard/:id` serves from D1,
but matches ingested before `riot_id_game_name` existed have no stored
names. On first open of such a match the worker re-fetches + re-ingests it
once (writing the names), so every later open is a pure D1 read. No bulk
re-backfill was run — the cost is one Riot call + one re-ingest per *old*
match, only when someone actually opens it, and it decays to zero as the
back catalogue gets viewed. New matches store names from ingest and never
self-heal.

## The crawler

Cron every 30 minutes, and **only for first-time backfill**: pick the
neediest player still in the queue (`queued` beats `backfilling`), page
their matchlist backwards from `backfill_cursor`, ingest unknown matches
(known IDs cost a local lookup, not a Riot call), advance the cursor.
Resumable by construction; when the matchlist runs dry the player flips to
`crawl_complete`/`live` and the cron ignores them from then on. If nobody
is mid-backfill the slice no-ops, so an idle site spends nothing.

**Steady state lives on the page, not the cron.** Loading `/matches`
tops up everything played since the last visit — it pages the matchlist
newest-first and stops at the first already-ingested game (`TOPUP_MAX`
caps the catch-up so one lookup stays under the free plan's 50 external
subrequests). So new games appear when someone actually opens the tab,
and the backend does no background work when the site is idle.

## The page (`league/index.html` + `league/league.js`)

Follows the sotd.js/movies.js convention — the toolbar/popover kit is
deliberately duplicated (fix a bug there, mirror it here), tokens only,
all 30 theme×skin combos.

- **The bar**: where the journals put an `<h1>`, a combo-box input styled
  in the title tokens (dashed hem = "editable") that flexes into all the
  width the pills don't take. Its popover lists recent lookups +
  everyone on record (`/players`). Right side: Queue pill (All / Arena /
  ARAM / Rift, via `game_mode` — auto-set on each player load to the
  mode dominating their last 3 games, ties to the newest; manual picks
  stick for the rest of the visit), View pill (Champions / Augments /
  Matches — the selected view's pane leads the page), Refresh pill, and
  the budget readout behind a hairline divider. Both pills wear their
  pick: "Queue | Arena ▾". The View popover also carries a **layout
  rail** (vertical hairline, square vs divided-square icons): split
  puts the two tail panes side by side, selected pane left, matches
  paired with whichever table View names (champs/augments paired with
  the match list). Desktop-only — on mobile the rail is hidden and a
  persisted split is inert (the panes just stack).
- **Player head**: profile card (icon, level chip, rank line or
  "Unranked", crawl progress) left; **top-8 mastery grid (2×4,
  right-aligned)** right. Each mastery chip is a toggle that narrows the
  whole page — stats, augments, matches — to that champion (matches come
  champion-filtered from D1 all-time, not just recent).
- **Stats panel**: champion/augment tables sit on the resume sheet's card
  material so they read over every skin. **Column headers click to
  sort** (sensible default direction per column, click again to flip,
  persisted per table; missing values sink). **Champion rows click to
  toggle the champ filter**, same as the mastery chips. In split
  layout the champion table drops its per-minute columns (Gold/m,
  Dmg/m) — the 7-column minimum outgrows a half pane.
- **Matches**: one row per game — champ, queue, K/D/A/cs/damage, result
  badge (`W`/`L`, or `#place` in Arena, colored by Riot's win flag via
  `--go`/`--stop`), duration and age. Click toggles the full scoreboard
  from `/scoreboard/:id` (served from D1, no Riot call): Rift splits the
  two sides by win; **Arena stacks as a bracket** — top half of the lobby
  on row one, bottom half on row two (#1–3/#4–6 trios, #1–4/#5–8 duos).

Champion art falls back to a themed monogram tile (same contract as
album art). API base is `https://api.deets.solutions`; flip the constant
at the top of league.js to `http://localhost:8788` to test worker changes
against `wrangler dev`.

## Open items

- Publish the tab (commit site changes; Pages deploys on push).
- Timeline data is collected lazily but unused — gold graphs / item
  timing in the expand view remain undesigned.
- Pre-Aug-2024 history: only reachable if a Riot personal-data request
  yields old match IDs; an importer would feed them through the same
  ingest pipeline.
