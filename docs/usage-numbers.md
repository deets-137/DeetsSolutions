# Usage numbers for the resume

**Why:** a resume review (YC's AI tool, 2026-10-01) asked for proof that the
Deets.Solutions projects are used by real people, not just weekend toys. The
ask: a few honest, real counts to put on the resume's Personal Projects lines.
Small numbers are fine as long as they're true. If a number is tiny, it just
stays off the resume.

The resume lives in `iCloudDrive/Resume/9_22_2026/`. The pieces are in
`_tools/resume-tracks.md`, and a Claude session in that folder will add the
numbers once they're in hand.

**All of this is read-only.** Run `SELECT`s only. The accounts DB holds
`google_sub` (see [stats.md](stats.md), "Export, and NOT a SQL console").
Report counts only, never names or ids.

---

## The numbers wanted, best first

### 1. Accounts: the headline "users" number
D1 `deets-accounts`, `users` table ([accounts.md](accounts.md)). Cities,
Mahjong and Poker all sign in through it.

```sql
SELECT COUNT(*) AS accounts FROM users;
-- active in the last 30 days
SELECT COUNT(*) FROM users WHERE last_seen_at > (strftime('%s','now') - 30*86400) * 1000;
```
Check whether `created_at` and `last_seen_at` are in ms or seconds before you
trust the 30-day count. Leave out your own account(s) and any test accounts.

### 2. Games played
D1 `deets-accounts`, `results` + `result_seats` ([stats.md](stats.md)).
Results only started being written on 2026-07-29, so say "since late July".

```sql
SELECT game, COUNT(*) AS games, SUM(humans) AS human_seats
FROM results GROUP BY game;
-- games with at least one human who isn't you
SELECT COUNT(DISTINCT r.key) FROM results r JOIN result_seats s ON s.key = r.key
WHERE s.uid IS NOT NULL AND s.uid NOT IN ('<your uid>');
SELECT COUNT(DISTINCT uid) AS distinct_players FROM result_seats WHERE uid IS NOT NULL;
```

### 3. DeetsMusic installs / active installs
No table counts installs today ([support.md](support.md)). Options, cheapest
first:
- **Workers analytics** on `music-api.deets.solutions`: requests to
  `GET /update/<channel>` over 30 days. Every install checks for updates, so
  the distinct-client count (or the request count divided by checks per day)
  gives a rough number of active installs. The dashboard or the GraphQL
  analytics API both work.
- **R2 `deetsmusic-releases`:** R2 doesn't count downloads. If the dashboard
  shows per-object Class B ops for the installer, that's a rough "downloads".
- If none of that is clean: say "N signed releases" (already on the resume as
  26) and skip installs.

### 4. Support boards
D1 `deets-support`: reports from people who aren't you are a good sign of
real users.

```sql
SELECT app, source, COUNT(*) FROM posts GROUP BY app, source;
SELECT COUNT(*) FROM posts WHERE source = 'app';   -- filed from inside the app
```

### 5. Radio matches (optional)
D1 `deets-radio-matches`: run `.tables` first, then count rows in the match
registry.

---

## Running them

These repos use Wrangler (no `cf` on the Windows PC as of 2026-10-01):

```
npx wrangler d1 execute deets-accounts --remote --command "SELECT COUNT(*) FROM users"
```

## What to hand back

One line per number, like this:

```
accounts: 37 total, 12 active in 30d (excl. me)
games: cities 140, mahjong 52, poker 31 since 2026-07-29; 18 distinct players
deetsmusic: ~25 active installs (update checks, 30d)
support: 9 reports, 6 from the app
```

Then paste it into a Resume-folder session. The resume lines it would feed:
the multiplayer platform bullet (accounts and games) and the DeetsMusic bullet
(installs).
