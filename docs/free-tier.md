# Free-tier costs, across the account — and the case for retiring the League crawler

> **Written 2026-09-19, from DeetsMusic.** The numbers below were re-read from Cloudflare's own
> docs that day while designing DeetsMusic Friends (`../DeetsMusic/docs/integrations/FRIENDS.md` §13–§15).
> Two of them correct claims already written in this repo.
>
> **Nothing here is decided. This doc is for evaluation.** §6 is the only proposal, and §7 is the
> honest argument against it.

---

## 1. Why this doc exists

DeetsMusic is about to add a feature (Friends) whose cost grows with how much a person listens, not
with how often they launch the app. Before adding a tenant to the Cloudflare account, I measured what
the existing tenants cost. Two findings turned out to matter beyond DeetsMusic, so they are written
here instead of there.

---

## 2. The limits, verified 2026-09-19

Read from developers.cloudflare.com (Durable Objects pricing, Workers platform limits).

| Free plan | Value |
|---|---|
| Worker requests | **100,000 / day**, reset 00:00 UTC |
| Durable Object duration | 13,000 GB-s / day |
| DO SQLite **rows written** | 100,000 / day |
| DO SQLite rows read | 5,000,000 / day |
| DO stored data | 5 GB |
| D1 rows written | 100,000 / day (a **separate** meter from DO rows) |
| KV writes | 1,000 / day |

Four details that are easy to get wrong:

1. **The request limit is per ACCOUNT, not per Worker.** Cloudflare's words: *"Accounts on the Workers
   Free plan have a daily request limit of 100,000 requests, resetting at midnight UTC."* Every worker
   on the account shares one bucket. **Splitting a feature into a second worker therefore costs
   nothing extra, and merging two workers saves nothing.**
2. **Incoming WebSocket messages are billed at 20:1.** *"a 20:1 ratio is applied to incoming WebSocket
   messages to factor in smaller messages for real-time communication."* And: *"There is no charge for
   outgoing WebSocket messages, nor for incoming WebSocket protocol pings."* **Broadcasts out are
   free.** This is the single most useful fact on this page.
3. **A Durable Object's key-value calls are SQLite rows.** `get()`, `put()`, `delete()` and `list()`
   run against a hidden SQLite table. `setAlarm()` is billed as one row written. `delete()` counts as
   a write, so cleaning up at the end is not free. SQLite storage billing went live in January 2026.
4. **`serializeAttachment()` does not touch SQLite**, is not billed as rows, and its cap is
   **16,384 bytes** per socket — not 2 KB. It dies with the socket: *"If either side closes the
   connection, attachments are lost."*

---

## 3. Two corrections to docs already in this repo

### 3.1 `realtime.md:40` is 20× pessimistic

It says each inbound WebSocket message is billed as a request, and concludes that a real-time table at
20 Hz × 2 clients *"exhausts the free plan's 100,000 requests/day in roughly 42 minutes."*

With the real 20:1 ratio, 40 messages a second is **2 billable requests a second**, so the true figure
is about **14 hours**, not 42 minutes.

**This does not reverse the decision made there.** 172,800 requests a day still blows the free tier,
and the other reason given — a `setInterval` pins the object in memory, so hibernation never engages
and you pay duration as well — is unaffected. It is a wrong number inside a sound conclusion. Worth
fixing so the next reader does not plan around 42 minutes.

### 3.2 `rooms-status.md:146` will go stale on purpose

It cites about 200 rooms a day, from `../DeetsMusic/docs/integrations/ROOMS.md` §3.2, which is right today: rows
written is what a room runs out of first. `../DeetsMusic/docs/integrations/ROOMS.md` **§20** (designed 2026-09-19,
not built) moves a room's live state out of storage and into socket attachments and drops the per-song
alarm, which takes a room from about 450 row writes to about zero and moves the ceiling to **about
5,000 rooms a day**, bounded by requests instead. If §20 is ever built, that line needs a new number.

---

## 4. Who spends the account's requests today

| Tenant | Shape | Rough requests / day |
|---|---|---|
| `deetsmusic-rooms` | DO per room, sockets at 20:1 | ~20 per room; 0 when nobody is in one |
| `deets-support` | Mint, update checks, bug reports | ~5 per DeetsMusic install per day, nearly all of it the 6-hour update check |
| `deets-accounts` | Sign-in | Per sign-in only |
| Game tables (`table-do.js`, realtime) | Sockets | Per game played |
| **`deetsleague` (`api.deets.solutions`)** | HTTP + **a `*/30` cron** | Page visits, **plus 48 cron ticks a day whether or not anyone visits** |

The cron is the only thing on the account that spends requests **when no human is present**. That is
what makes it worth looking at, not its size.

---

## 5. What the League crawler really costs (measured from the code, 2026-09-19)

`DeetsLeague/wrangler.jsonc:26` → `"crons": ["*/30 * * * *"]` → `scheduled()` → `crawl(env)`.

**Per tick, when nobody is queued** (`index.js:418–432`):
1. `ledgerUsed(env)` — a D1 read.
2. An early return if live traffic is busy (`live > 8`) or the Riot window is nearly spent.
3. Otherwise `DELETE FROM rate_buckets WHERE bucket < ?` — a D1 statement that usually matches
   nothing, so usually no rows written.
4. One `SELECT` for a queued player, then `if (!player) return`.

**So an idle tick costs 1 Worker request and 3 D1 queries, and writes ~0 rows.** 48 ticks a day is
**48 requests out of 100,000 — about 0.05% of the account's daily budget.**

**Per tick, when a player IS backfilling:** up to `CRAWL_BUDGET` (~40) Riot calls, and D1 writes at
about 32 write-units per Classic match and about 56 per Arena match (`league.md`, after the augment
packing). A full rebuild was measured there at about 38,000 write-units. That is the real spend, and
it only happens **while a new player's history is being filled**.

**The honest summary: the crawler is cheap when idle and expensive only when doing the one job it
exists for.** On Cloudflare cost alone, there is no case to retire it.

---

## 6. The proposal: retire the cron, keep the data

If the crawler goes, these are the options, and none of them delete a single row of D1 history.

| | Option | What happens | What is lost |
|---|---|---|---|
| **A** ⭐ | **Delete the `crons` trigger; keep every route.** Backfill happens when someone opens the tab, through the top-up path that already exists. | `league.md` already says *"Steady state lives on the page, not the cron"* and `/matches` pages back until it hits a known game, capped by `TOPUP_MAX`. | **Unattended first backfill.** A newly enrolled player's history fills a page at a time, only while someone browses, instead of finishing overnight. For a player with ~300 matchlist ids, that is several visits. |
| B | **Slow it down** — `0 */6 * * *` instead of `*/30`. | 4 ticks a day instead of 48. Unattended backfill survives, 12× slower. | Nearly nothing, and it saves nearly nothing. |
| C | **Retire the whole League tab and worker.** | The `league/` page is *"not committed/published yet"* (`league.md` status). Nothing on the live site would notice. | The D1 history, if the worker is deleted — and that history **cannot be rebuilt**: match-v5 only lists ~1,000 ids or ~2 years, whichever is smaller. Everything older than the window exists **only** in our D1. |
| D | **Keep it as it is.** | 48 requests a day. | Nothing. |

**Recommendation: A, and only if you want fewer moving parts.** The cost saving is 0.05% of the
account, so this is a maintenance decision, not a money one. The argument for A that actually holds:
the cron is the one thing on the account that **wakes up and touches a secret-bearing external API
with no human present**, and the Riot key is a personal key shared by everything. Fewer unattended
callers is worth something on its own.

**If C is ever chosen, export D1 first.** The pre-window history is irreplaceable — `league.md` is
explicit that undiscovered history *"slides away permanently"* and our D1 is the only long-term memory.
Retiring the tab must not mean dropping the database.

---

## 7. The argument against retiring it at all

1. **It is not what costs you anything.** 48 requests a day. If the account ever gets close to 100,000,
   it will be a real-time table or a busy room, not this.
2. **It already yields.** `crawl()` skips its whole slice when a human is browsing (`live > 8`), sizes
   itself to what the Riot window has left, and no-ops when the queue is empty. It is the
   lowest-priority tenant of the key by construction, and it was built that way on purpose.
3. **Backfill without a cron is worse for the person waiting**, and Riot's matchlist window means a
   slow backfill can lose history that a fast one would have caught.

**The one thing I would change either way:** `league.md` says *"an idle site spends nothing"*. It
spends 48 requests and ~144 D1 reads a day. Small, but not nothing, and the sentence is what made this
worth checking.

---

## 8. What to decide

1. Crawler: **A, B, C or D** (§6).
2. Fix `realtime.md:40`'s 42-minute figure to ~14 hours, keeping its conclusion? (§3.1)
3. Leave `rooms-status.md`'s 200-rooms line until DeetsMusic ROOMS §20 is built, or footnote it now?
   (§3.2)
