# Support — status, installs, releases and boards for every Deets app

One public home per Deets app where a person can download it, see whether
it is up, read what changed, ask for a thing, or report a fault. The page
lives on this site; the data comes from a sibling worker, with a row of
data per app rather than a copy of the system per app.

**Scoped 2026-09-11. Worker built and deployed the same day**, and grown
since: the hosted sign-in page (DeetsMusic 0.4.0) and the updater route
(0.4.3) now ride the mint host too. Replies on a ticket, `/config`,
`/status` and the cron are all live; only the mint and this site have a
health URL. **The page is drafted, not merged** (2026-09-14, branch
`DeetsMusicSupport`; see "The draft" under "The page"). This doc is the
design and the build order. The page itself — layout, copy, and the exact fields a
report carries — is **Aditya's, and he leads its design** ("The page"
below).

First two tenants: **deetsmusic** (a Windows desktop app, the reason
this exists) and **deets.solutions** (this site). Build it music-first;
generalise by adding a row, never by rewriting.

---

## The shape

```
deets.solutions/deetsmusic/      the site tab — DeetsSolutions/deetsmusic/ (nav entry)
  status        up / degraded / down, plus recent history
  install       the current installer, straight from the update route
  releases      release notes, newest first
  suggestions   anonymous post, interest count
  issues        moderated list, with a state

DeetsSupport (worker)            sibling repo, one D1, one R2 bucket, no Durable Objects

  music-api.deets.solutions      the app's host — compiled into every install
    GET  /token                  the shared developer token + remote config
    GET  /health                 signs a throwaway token; proves the key
    GET  /signin, /signin/*      the hosted sign-in page
    GET  /update/<channel>[/…]   signed installers from R2; answers BEFORE KILL

  support.deets.solutions        the boards' API (JSON only, no page)
    GET  /status?app=            board data
    GET  /posts?app=&kind=       public posts only
    POST /posts                  intake — web page or app, both anonymous
    GET  /t/<code>               one ticket + its replies, by its unguessable code
    POST /t/<code>/replies       the reporter's reply on their own thread
    POST /interest               +1 on a suggestion
    GET  /config?app=&v=         remote config + notice   (see "Remote config")
    cron */5                     ping each health_url, write status_checks
```

The page is Pages, the data is the worker, the same split as
[radio](radio.md) and [league](league.md): the page at
`deets.solutions/<app>/`, the API on its own subdomain. **The page cannot
live on `support.deets.solutions`** — that hostname is a custom-domain
route of the worker. `ALLOWED_ORIGINS` in `wrangler.jsonc` already lists
`deets.solutions`, `www.` and the dev ports 8787/8788.

No build step, no dependency, plain `src/index.js` — the house rules for
a worker repo hold here too.

---

## Decisions already made

**One worker, two custom-domain routes** (2026-09-11). `DeetsSupport`
answers on `support.deets.solutions` *and* on
`music-api.deets.solutions`, where DeetsMusic fetches its developer
token, its sign-in page and its updates.

The earlier plan split the mint into its own worker on availability
grounds. It was merged because, with a 60-day token and a 15-day
refresh margin, a mint outage was invisible to any recent install.
**That reasoning no longer holds** (revised 2026-09-14). Since the D.7
hardening (DeetsMusic RELEASE.md §7, 2026-09-13) the token lives 14 days
with a 3-day margin, so a mint outage longer than about three days
reaches every install. And the mint host now also carries `/signin` and
`/update/`, so one bad deploy can take token, sign-in and updates down
together. The merge stands — one repo is still easier to hold, and the
guardrails below keep a later split a route move — but the blast radius
is real now, and the deploy check is what contains it:

- **The app compiles in `music-api.deets.solutions`, not the support
  host.** The URL inside a shipped binary is the one thing that cannot
  be changed without a release, so splitting the mint out later must
  stay a route move. Never point the app at `support.…`.
- **The mint-host routes never wait on D1.** `/token`, `/health` and
  `/signin` return before any D1 call (the mint counter writes after the
  response, with `waitUntil`); `/update/` reads R2, never D1. A D1 fault
  cannot reach app startup.
- **`/update/` answers before `KILL`**, behind its own `KILL_UPDATE`. A
  bad release must stay fixable by an update.
- **Smoke every mint-host route after every deploy**, not just `/token`:
  `/token` (with `User-Agent: DeetsMusic/<v>`) → 200, `/health` → 200,
  `/signin` → 200, `/update/deetsmusic?v=0.0.1` → 200 or 204. A board
  deploy that breaks the script is then caught in seconds.

**No sign-in** (2026-09-11). [DeetsAccounts](accounts.md) exists and its
cookie would reach this host, but a DeetsMusic listener is not a site
visitor and will not make a web account to report a bug. Designing
around sign-in would build two support experiences. So **every post is
anonymous**, from the page and from inside an app alike — one intake
path, two sources, tagged.

Two consequences fall straight out of that, and neither is optional:

- **Moderation is mandatory.** An open, anonymous write endpoint feeding
  a public board becomes a spam wall. Issues are private until Aditya
  marks them public. Suggestions (2026-09-14, his call) go up on send and
  stay up unless he strikes them (`public = 0`). Every title (bug or
  suggestion) is capped at 10 words, on the page and in the worker.
- **A vote cannot be honest.** See "Interest, not votes".

This is about *reporters*. An owner-only moderation view behind
Aditya's own DeetsAccounts cookie would not contradict it — see "Open".
Neither do signed-in **comments** on a thread (planned 2026-09-15, see
"Threads"): posting, ▲ and the poster's own replies stay anonymous; only
joining someone else's thread needs an account.

**Ticket code only, no contact details** (2026-09-11). A report gets an
unguessable code, and the code is the URL. Threads, replies and states
are all managed from that page.

**A nav tab, one per app** (2026-09-14). `deets.solutions/deetsmusic/`
takes a nav entry: DeetsMusic launches publicly (the Apple Music
subreddit), and the page is its front door, not a footer link.

---

## What we store

```sql
CREATE TABLE apps (
  id           TEXT PRIMARY KEY,      -- 'deetsmusic', 'deets.solutions'
  label        TEXT NOT NULL,         -- shown on the board
  health_url   TEXT,                  -- NULL = nothing to probe
  sort         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE posts (
  code         TEXT PRIMARY KEY,      -- random, 16 chars — this IS the URL
  app          TEXT NOT NULL REFERENCES apps(id),
  kind         TEXT NOT NULL,         -- 'issue' | 'suggestion'
  state        TEXT NOT NULL,         -- 'new' | 'open' | 'planned' | 'fixed' | 'wontfix' | 'closed'
  public       INTEGER NOT NULL DEFAULT 0,
  source       TEXT NOT NULL,         -- 'web' | 'app'
  title        TEXT NOT NULL,
  body         TEXT NOT NULL,
  meta         TEXT,                  -- JSON: app version, OS build, log tail
  interest     INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);

CREATE TABLE replies (
  id           INTEGER PRIMARY KEY,
  code         TEXT NOT NULL REFERENCES posts(code),
  author       TEXT NOT NULL,         -- 'owner' | 'reporter'
  body         TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE TABLE status_checks (
  app          TEXT NOT NULL REFERENCES apps(id),
  checked_at   INTEGER NOT NULL,
  ok           INTEGER NOT NULL,
  ms           INTEGER,
  note         TEXT,
  PRIMARY KEY (app, checked_at)
);

CREATE TABLE config (
  app          TEXT NOT NULL REFERENCES apps(id),
  key          TEXT NOT NULL,
  value        TEXT NOT NULL,         -- JSON
  PRIMARY KEY (app, key)
);

-- mint_counts (day, served, limited) — the mint's daily counter, no IP,
-- token or UA. Owned by DeetsMusic RELEASE.md §7.
```

Four choices worth keeping:

- **`app` is a column on everything, from the first migration.** A new
  tenant is an `INSERT`, and every board is already sortable and
  filterable by it. This is the whole "build music-first, generalise by
  data" promise, and it is one word per table.
- **`code` is the primary key, not a serial id.** A sequential id can be
  walked, and a thread can hold detail the reporter did not mean to
  publish. Generate it from `crypto.getRandomValues`, never from a
  counter or a timestamp.
- **`public` is separate from `state`.** Triage and publication are
  different acts. A fixed fault can stay private; a new one can be shown
  the day it lands.
- **`meta` is JSON, not columns.** What a Windows desktop app usefully
  reports is not what a web page reports, and the shape will move. It is
  read by a human, not queried.

D1 for the boards. **R2 holds signed installers only** (the update
route, DeetsMusic RELEASE.md §6) — never report attachments. A log tail
belongs inside `meta`, capped at 8 KB.

---

## Intake

One route, `POST /posts`, for both sources. It is open, unauthenticated
and unattestable, exactly like the mint, and for the same reason: a
public binary can prove nothing about itself.

What holds it together instead:

| Control | Value |
|---|---|
| Rate limit (`ratelimits` binding, keyed by IP) | **5 per 60 s**, shared by posts, replies and interest; fail OPEN if the binding is absent. Measured: trips only on a reused connection (per-isolate counters) — see DeetsMusic RELEASE.md §7 |
| Body cap | 16 KB request, enforced before parse; title 120, body 4000, meta 8 KB |
| `public` default | `0` — nothing reaches a board unmoderated |
| Stored as text, rendered as text | never as HTML |
| `KILL` var | intake off, and the boards and the mint with it — everything except `/update/` |

`KILL` is coarser than this table once implied: it stops every route
but the updater. A launch-day intake flood that needs only the boards
shut is today a code change, not a var. Worth a `KILL_BOARDS` before
launch (see "Open").

**The redactor runs in the app, not here.** The user sees the exact
payload before it sends. The worker adds a second net: **reject any body
that matches a JWT shape** (`eyJ…`). DeetsMusic holds two bearer
credentials — the music-user token and the developer token — and a
mistake in a client-side redactor must not be able to land one in D1.

Because there is no contact address, the app **keeps its own list of the
codes it submitted**, in app data, and surfaces them in Settings as
links. Without that, a lost code is a lost thread with no recovery path.
This is the piece that makes "no contact details" workable rather than
merely private, and it belongs in the app, not here.

**Until the in-app report form exists, the web form is the only intake,
and it carries no log.** DeetsMusic's log is already scrubbed at the
write boundary and records catalog ids, not titles (DeetsMusic
LOGGING.md), so pointing a web reporter at Settings › Bugs › App log to
paste a tail is safe — but it runs into the body cap fast.

---

## Interest, not votes

With no identity there is no honest ballot. A random client id in
`localStorage` (web) or app data (app) stops a double-click and an
accidental reload; anyone who wants to stuff it, can. That is acceptable
at this scale, but the label must not overclaim: the number is
**interest**, a signal, never a vote count that a decision leans on.

The two alternatives were weighed and dropped: an IP hash lumps a
household or an office into one vote and stores a derived identifier;
dropping the count entirely leaves recency plus pinning, which loses the
one thing a suggestion board is for.

Known issues carry the same ▲ (2026-09-14, Aditya's call): there it
means "this affects me too", a signal of how many people a bug reaches.
Same column, same route, same caveats. A second click takes the +1 back
(`{code, undo: true}`, floored at 0).

## Filter and sort

Added 2026-09-14, for everyone. Each board carries the journals' **Filter**
and **Sort** pills ([architecture.md](architecture.md), "Toolbar / popover
kit", copied into `deetsmusic.js` the way the journals copy it). Filter:
a Status group on both boards, plus a Version group on Known issues (All,
each release a bug names, "Not given"). Sort: Votes or Date, ↑/↓. It all
runs on the list already loaded, and each board's picks persist in
`localStorage` (`deets-dm-boards`).

The version comes from `GET /posts` as a `version` field, extracted from
`meta` in SQL (`json_valid` guarded). Only that key leaves `meta` — the
rest can hold a log tail and stays on the ticket.

## Spend guards

Added 2026-09-14, to keep a free-plan worker free with nobody watching.

- **One board request.** The page loads both boards with a single
  `GET /posts?app=` (the owner's view with one `GET /admin/posts?app=`) and
  splits by kind in the browser.
- **60 s edge cache** on `GET /status` and `GET /posts`. Every request still
  runs the worker; a hit just skips D1. Board writes (post, vote, close, owner
  edit) drop the cached lists in the colo that took the write; other colos
  can serve theirs for up to a minute. The owner routes are never cached.
- **`KILL_BOARDS`** (var, deploy to flip): every public board write — posts,
  replies, votes, closes — answers 503 `off`, which the page shows as
  "This is switched off for now." Reads, the mint, updates and the owner
  routes keep working.
- **Automatic intake breaker.** 300 posts + replies for one app inside an
  hour pauses that app's posts and replies for 1 hour, then they reopen on
  their own. Sized for a launch (a subreddit post can bring ~100 in an hour,
  most of them votes, which don't count) rather than a quiet day: it exists
  to stop a scripted flood and the moderation load it lands on the boards,
  not to save money — a post is a few D1 writes against 100k free a day. The flag is a row in `switches`; the command to reopen early is in the
  worker's "spend guards" comment. It fails open, so a D1 fault never blocks
  intake.
- **Status prune** deletes per app on the `(app, checked_at)` key; the old
  app-less delete scanned the table every run (~5M rows read a day at steady
  state).

## Owner moderation

Built 2026-09-14. Signed in to deets.solutions as Aditya, the DeetsMusic
page's boards list hidden posts too (dashed, tagged Hidden), and
right-clicking a post opens a menu: **Status** (new / open / planned /
fixed / won't fix), **Hide / Show**, **Reply** (opens the post page; the
reply goes in as "Aditya") and **Delete** (two clicks; takes the replies
with it).

- **Who is the owner is the worker's call.** The page asks
  `GET /admin/me` with credentials; the worker verifies the `ds_sess`
  cookie exactly as `games/table-do.js` does (shared `SESSION_SECRET`,
  30-day expiry) and compares the account id to `OWNER_UID`. Either secret
  missing and the `/admin/` routes are closed.
- **Writes need an allowlisted Origin** on top of the cookie. `ds_sess` is
  `SameSite=Lax`, so another site's fetch never carries it anyway.
- **Closing** (2026-09-14): "Your posts" has a two-click **Close** per
  post instead of Forget. It calls `POST /t/<code>/close` — the code is the
  credential, as with replies — which sets `state = 'closed'`, then drops
  the post from the browser's list. The post stays on its board with a
  Closed tag; the owner can reopen or hide it. There is no history table:
  a closed post is just its state plus `updated_at`.
- **Local dev:** the cookie never reaches localhost, so on `?mock`
  every visitor plays the owner. The real check only runs on
  deets.solutions, in the worker.

---

## Threads — planned 2026-09-15; steps 1–4 BUILT, none deployed

Aditya's call, 2026-09-15: clicking a card on Suggestions or Known issues
opens that post's own page, and it works like a forum — signed-in people
leave thoughts under it. **Build is set for the evening of 2026-09-15.**
Layout and every string on the thread page are his; Claude adds `[ph]`
placeholders only.

### The leak this had to fix first

**Closed in code 2026-09-15 (step 1). Still live until the migration runs and
the worker is deployed** — see "Shipping step 1" below.

A post's `code` is its credential, but the public lists handed it out:
`PUBLIC_COLS` (DeetsSupport `src/index.js`) starts with `code`, and both
`GET /posts` and the mock's `pub()` return it. So anyone with devtools can,
for any **public** post:

- close it (`POST /t/<code>/close`, `handleClose`),
- reply as the reporter (`POST /t/<code>/replies`, `handleReply`),
- read its `meta` — version, log tail (`GET /t/<code>`, `handleTicket`).

The page needs *some* id per card for ▲, which is why `code` leaked. The
fix is the id split below, and the thread page needs it anyway.

### Two ids

| | `pid` (new, public) | `code` (existing, secret) |
|---|---|---|
| Who has it | everyone — it's on the board | the poster ("Your posts") |
| Grants | read the thread, ▲, comment (signed in) | all of that, plus close the post, reply as reporter, see `meta` |
| Page URL | `#p=<pid>` — safe to share | `#t=<code>` — fragment only, as now |

- `pid`: new `posts` column, random from `crypto.getRandomValues` like
  `code` (never a counter), unique index, backfilled for existing rows.
- Public lists (`GET /posts`) send `pid` and **drop `code`**. The owner's
  `/admin/posts` may keep both.
- ▲ (`POST /interest`) keys by `pid`. `deets-dm-interest` in
  `localStorage` is keyed by code today — migrate it or accept one reset.
- `GET /p/<pid>`: public posts only (404 on hidden), **no `meta`, no
  `source`**, plus its visible replies and comments.
- The page's `route()` gains a `p=` branch beside `t=`; `renderTicket`
  gets a read-only mode (no close, no reporter reply box) for `#p=`.
- A hidden post has no public page. Only its code holder and the owner
  see it.

### Comments need a DeetsAccounts sign-in

- `POST /p/<pid>/comments` verifies `ds_sess` exactly as the owner routes
  already do (shared `SESSION_SECRET`, 30-day expiry), but accepts **any**
  valid account, not just `OWNER_UID`. No cookie → 401, and the page shows
  a sign-in prompt in place of the box.
- Same guards as replies: allowlisted Origin on writes, `POST_RL`, body cap,
  JWT-shape reject, `KILL_BOARDS`, and comments count toward the intake
  breaker.
- The cookie is `SameSite=Lax` on `deets.solutions`; `support.` is the same
  site, so `credentials: "include"` carries it (the owner menu already
  relies on this). It never reaches localhost: on `?mock` everyone is
  signed in, as everyone is already the owner.
- The poster's own replies through `#t=<code>` stay anonymous.

### Names

No new name field. The profile already has one: DeetsAccounts'
`display_name` (editable on /profile/) and `color`.

- DeetsSupport has its own D1 and cannot read DeetsAccounts'. **Store the
  name and colour on the comment at post time.** **Settled 2026-09-15: the
  page sends them.** DeetsAccounts' session payload is `{u, e, iat}` — no
  name — so the claims were never an option. The page sends what
  `DeetsAccount` (its own `/me`) gave it, capped at DeetsAccounts' own 24
  characters and checked against the `#rrggbb` shape. Renaming later does
  not rewrite old comments.
- **That the name is client-supplied costs nothing real**, for the reason
  below: it proves nothing either way.
- **The name proves nothing.** Anyone can rename themselves "Aditya".
  Aditya's comments carry `author = 'owner'`, set only by the `OWNER_UID`
  check, and the page marks them from that, never from the name.

### Storage

**Settled 2026-09-15: widen `replies`.** A comment is a reply with an account
behind it, so one table gives one thread in one chronology, one `hidden` flag
the whole thread obeys, and one thing for the intake breaker to count — it
already counts `replies`. `author` takes a third value, `'member'`, and
`migrations/2026-09-15-comments.sql` adds the columns:

```sql
-- author: 'owner' | 'reporter' | 'member'   (member = signed-in account)
uid          TEXT,              -- DeetsAccounts id; NULL for reporter replies
name         TEXT,              -- snapshot at post time
color        TEXT,              -- snapshot at post time
hidden       INTEGER NOT NULL DEFAULT 0

CREATE TABLE blocked (
  uid          TEXT PRIMARY KEY,
  created_at   INTEGER NOT NULL
);
```

Store as text, render as text, like everything else here.

### Owner moderation of comments

Extends the existing right-click menu to each comment on a thread page:

- **Hide / Show** — the `hidden` flag; hidden comments stay visible to the
  owner, dashed, like hidden posts.
- **Delete** — two clicks, a real delete.
- **Block account** — inserts into `blocked`; that uid's comments are hidden
  and its new ones refused (403). Only possible because comments carry an
  identity; posts never can. **Lifting a block does NOT unhide what it hid**
  — he hides comments by hand too, and a sweep would undo that. Show is
  per-comment. Block appears only on a row that carries a `uid`, which is a
  member's comment and nothing else.

New routes under `/admin/` (cookie + `OWNER_UID` + allowlisted Origin), and
matching handlers in `mock.js` so `?mock` speaks the same shapes. `?mock`'s
owner flag now follows the SIGN-IN rather than being a constant, so signing
out in the page is the one local way to see what a stranger is sent.

### Build order

1. **The id split** — `pid` column + backfill, public lists send `pid` not
   `code`, ▲ by `pid`, mock mirrored. Ships alone: it closes the leak.
   **BUILT 2026-09-15**, not yet deployed.
2. **Thread page, read-only** — card click → `#p=<pid>`, `GET /p/<pid>`.
   **BUILT 2026-09-15**, not yet deployed. One renderer serves both views;
   `#p=` drops the privacy chip, the "keep this link" line, the reply box and
   the `remember()` call, and labels the reporter as a stranger. A card whose
   post is HIDDEN links to `#t=<code>` instead — it has no public page, and
   only the owner ever sees one on a board.
3. **Signed-in comments** — the route, the storage, name + colour snapshot,
   owner mark. **BUILT 2026-09-15**, not yet deployed. `POST /p/<pid>/comments`
   takes any valid `ds_sess` plus an allowlisted Origin; a hidden post takes no
   comments, since it has no public page. The `blocked` check ships with it, so
   a block bites the moment step 4 writes one rather than a deploy later. One
   form serves both views — the reporter's reply on `#t=`, a comment on `#p=`,
   and signed out the door to signing in stands where the box would.
4. **Moderation** — Hide / Show / Delete / Block in the right-click menu.
   **BUILT 2026-09-15**, not yet deployed. `PATCH`/`DELETE /admin/replies/<id>`
   and `POST /admin/block`. The owner's thread read is the only one that
   carries `uid` and `blocked`, because his menu is the only thing that acts
   on them. Delete and Block each take two clicks, like the post menu's.

Each worker step: deploy, then the mint-host smoke from "Decisions already
made".

### Copy

His pass, in chat 2026-09-15: 17 strings, zero `[ph]`. Four of Claude's drafts
were his own lines said twice and were **collapsed into the originals** rather
than reworded — a thread that cannot be found reuses `ticketMissing`, one that
fails to load reuses `ticketFailed`, a row he hid reuses `tagHidden`, and
`commentSignin` is BOTH the prompt under the box and the worker's 401, because
it is one sentence either way. The one genuinely new byline is `authorPoster`
("Poster"): on `#t=` that row says "You", and on `#p=` it is not you.

### Shipping step 1

Order matters, and it is the reverse of what you would guess:

1. **The migration first.** `npx wrangler d1 execute deets-support --remote
   --file=migrations/2026-09-15-pid.sql`. The deployed code inserts into `pid`
   and selects it; without the column every post and every ▲ answers 500.
2. **Then the worker** (`npx wrangler deploy`), then the mint-host smoke.
3. **Then the site**, a minute later. `GET /posts` sits in a 60 s edge cache,
   so for up to a minute after the deploy a colo can still serve the old shape
   — posts with a `code` and no `pid`. The new page would render those with
   `data-pid="undefined"` and its ▲ would 404 until the cache turned over.
   Waiting a minute costs nothing; the old page in the meantime is the page
   that is already live.

The transition is one-way on purpose. `POST /interest` still honours a body
carrying `code`, so a tab opened before the deploy keeps voting until it
reloads; nothing else does. `deets-dm-interest` in `localStorage` held codes
and now holds pids, so everyone's first ▲ after the split is free. That is the
"accept one reset" branch of the plan: the migration cannot be written, because
the page no longer learns the code of a post it did not send.

Every code that has sat on a public board since 2026-09-11 should be treated as
known. What that bought was always bounded — close the post, reply on it as its
reporter, read the `meta` its reporter sent — and whether any of it happened is
not recorded either way; the boards keep no access log.

### Next step — a thread's size on its card

**Proposed, not built. His call on whether it earns the space.**

A board card gives no sign a thread exists. You click a card to find out, and
five of the six seeded mock posts have something and one does not — live, the
ratio will be worse, and most clicks will land on nothing. A count on the card
is what turns the boards into something worth browsing.

What it takes, end to end:

- `GET /posts` returns a `comments` count per post. A correlated subquery
  (`SELECT COUNT(*) FROM replies r WHERE r.code = posts.code AND r.hidden = 0`)
  is one more column on a query that already runs behind the 60 s edge cache,
  so it costs nothing per view — but `replies_thread` is `(code, created_at)`
  and this wants `code` alone, which that index already serves as a prefix.
- The count must **exclude hidden rows**, and the owner's `/admin/posts` may as
  well send the true one. Two different numbers for the same post is fine; only
  he sees the second.
- ⚠ **None of the three write paths drops the board cache today.**
  `handleReply`, `handleComment` and the owner's `/admin/posts/<code>/replies`
  all call `tripIfFlooded` and stop there — correct as it stands, because a
  reply changes nothing on a card. The count is what makes that a bug: a new
  comment would not show for up to 60 s, and the owner's own reply would look
  lost. **Add `dropBoards(ctx, app)` to all three in the same change**, and
  note that the admin reply handler has no `app` in hand yet.
- The card shows it beside the date in `.dm-post__foot`, and a post with none
  shows nothing rather than a zero.
- `mock.js` mirrors the column, and its seed already has the spread to show it.

Two smaller ones behind it, both his call:

- **A thread's own link.** `#p=<pid>` is shareable but nothing offers it except
  the browser bar; the page has a Copy link button on `#t=` already.
- **Sort or filter by discussion.** Only worth it once the count exists, and
  only if the boards get busy enough to want it.

---

## Polls — LIVE 2026-09-16

His call, 2026-09-15: a commenter can put a **poll** on a thread, either under
their comment or instead of one. People add options, vote for what they want,
and the whole thing moves as the votes land. A board card shows
that a thread HAS a poll, beside the comment count from "Next step" above.

**LIVE 2026-09-16.** Built and committed 2026-09-15 (site `74474d4`, worker
`043b3b0`), against the five answers at the bottom; his visual pass produced the
cards, the button grouping and the control scale below, and his copy pass left
**zero `[ph]`**. Migration run on the remote D1 and the worker deployed
(version `42d0c431`), in that order, with the site already out. Smoke-tested
live: `GET /posts` carries the `polls` flag, a thread reads clean, all three
poll routes answer `signin` rather than 404, and `/admin/poll-options/` answers
`owner`. What follows is what the code does.

### Why a poll can be an honest ballot when ▲ cannot

The boards already have a counter, and it is deliberately NOT a vote:
"Interest, not votes — no identity means no honest ballot" ("Interest" above,
and the comment over `handleInterest`). The number is a signal, never a count a
decision leans on.

A poll is the opposite: it is a ballot, and it is worth having precisely
because it can be honest. **Comments already carry an identity** (step 3 of
"Threads"), so a poll built on top of them inherits one:

- **Voting needs a DeetsAccounts sign-in**, exactly as commenting does. A
  signed-out visitor sees the poll and its results, and the vote controls are
  replaced by the same sign-in prompt the comment box uses.
- **One vote per account per poll**, enforced by the primary key, not by
  `localStorage`. Changing your mind rewrites the row rather than adding one.
- A **blocked** account's votes drop out of the counts the same moment its
  comments are hidden. Only possible because a vote has a uid on it.

That difference is the whole reason this is worth building, and it is the line
to hold: ▲ stays anonymous and stays a signal; a poll is signed and counts.

### A poll hangs off a comment

Not a new kind of thread row — a poll belongs to one. That keeps everything
"Threads" already settled:

- **The comment's body is the question.** A poll "in place of a comment" is a
  row whose body is just the question. One text field, rendered as text.
- **One moderation unit.** Hide the comment and the poll goes with it; delete
  it and the poll and its votes go too. The owner's right-click menu needs
  nothing new.
- **One identity.** The poll's author is the row's `uid`, `name` and `color`,
  snapshotted at post time like any comment.
- **A reporter's reply can never carry one.** `#t=` needs no account, so there
  is no identity to hang a ballot on. Polls live on `#p=` and nowhere else.

### Storage

Three tables. `polls` is keyed by the reply it belongs to, so the join is the
one that already exists.

```sql
CREATE TABLE polls (
  id           INTEGER PRIMARY KEY,
  reply_id     INTEGER NOT NULL REFERENCES replies(id),   -- the comment it hangs off
  code         TEXT NOT NULL REFERENCES posts(code),      -- denormalised: the thread read filters by it
  multi        INTEGER NOT NULL DEFAULT 0,                -- one pick or several; set at creation, never after
  closed       INTEGER NOT NULL DEFAULT 0,                -- the author's own act; the post's state closes it too
  open_options INTEGER NOT NULL DEFAULT 1,                -- anyone signed in may add one
  created_at   INTEGER NOT NULL
);
CREATE UNIQUE INDEX polls_reply ON polls (reply_id);      -- at most one poll per comment
CREATE INDEX polls_thread ON polls (code);

CREATE TABLE poll_options (
  id           INTEGER PRIMARY KEY,
  poll_id      INTEGER NOT NULL REFERENCES polls(id),
  text         TEXT NOT NULL,
  uid          TEXT,                  -- who added it; the author's own are the poll's uid
  hidden       INTEGER NOT NULL DEFAULT 0,   -- owner moderation, exactly like a hidden comment
  created_at   INTEGER NOT NULL
);
CREATE INDEX poll_options_poll ON poll_options (poll_id, created_at);

CREATE TABLE poll_votes (
  poll_id      INTEGER NOT NULL REFERENCES polls(id),
  uid          TEXT NOT NULL,         -- DeetsAccounts id — the ballot IS the identity
  option_id    INTEGER NOT NULL REFERENCES poll_options(id),
  created_at   INTEGER NOT NULL,
  PRIMARY KEY (poll_id, uid, option_id)   -- one row per pick
);
CREATE INDEX poll_votes_option ON poll_votes (option_id);
```

**One row per pick, in both modes.** Single-choice can no longer be the primary
key, so the worker enforces it: a vote deletes that account's rows for the poll
and inserts the new set, and a single-choice ballot carrying two options is a
400. One vote per account per poll survives as a rule; it just moves from the
schema into the route.

Caps to enforce in the worker, in the shape the other caps take: 2 options
minimum at creation, 6 maximum **including the ones voters add**, and an
option's text capped like a title rather than a body. A poll on a hidden post
is unreachable, since the post has no page.

**Closed is two flags OR'd.** `closed` is the author closing it by hand. The
thread closes it too: once the post's `state` is `fixed`, `wontfix` or
`closed`, its polls stop taking votes and stand at their final counts. The
worker computes that on read — no per-poll date, and no new cron work.

### Wire

- `GET /p/<pid>` — a row that has a poll gains one:

  ```
  poll: { id, closed, closed_state, multi, open_options, yours,
          options: [ { id, text, votes } ],   // + hidden, uid for the owner
          mine: [ <option id>, … ] }         // this viewer's picks; [] if none
  ```

  `closed` is the OR'd value, so the page never has to know the post's state to
  render the poll; `closed_state` says which of the two closed it, because
  "closed by its author" and "closed because the thread is settled" are
  different sentences and only the first can be reopened. `yours` answers
  "may I close this", which the page cannot work out for itself — a member is
  never sent another row's uid. `votes` is a `GROUP BY` over `poll_votes`, minus blocked
  uids; hidden options drop out entirely. `mine` needs the session, which
  `GET /p/<pid>` does not read today — it reads the cookie only to decide
  `owner`. Extend that to "who is this", not "is this him".
- `POST /p/<pid>/comments` — accepts an optional `poll: { options: [text, …],
  multi, open_options }` beside `body`. One request, so a comment and its poll
  cannot half-land.
- `POST /poll/<id>/vote` — `{ options: [id, …] }`, the **whole ballot**,
  replacing whatever that account had; `[]` takes the vote back. The page
  sends it on Vote, not on a tick, so this is one request per mind made up.
  It answers with the fresh counts and `mine`, so it is also one request
  rather than a thread reload. Rejected if
  the poll is closed, if a single-choice poll gets more than one, or if an id
  is not this poll's. Needs `ds_sess`, an allowlisted Origin, `POST_RL`, and
  the `blocked` check; `KILL_BOARDS` covers it like every other POST.
- `POST /poll/<id>/options` — any signed-in, unblocked account, while
  `open_options` is on and the poll is open, up to the 6 cap. Adding an option
  is not a vote; you still have to pick it.
- `PATCH /poll/<id>` — `{ closed }`, the poll's author or the owner. `multi`
  and `open_options` are fixed at creation and have no route.
- `PATCH /admin/poll-options/<id>` — `{ hidden }`, **owner only**. It lives
  under `/admin/` rather than beside the other poll routes so that
  `handleAdmin`'s one owner check covers it, like every other owner route. An open option list
  is a moderation surface, and this is the row that pays for it: without it,
  anyone signed in can write text onto someone else's poll with nothing to take
  it down. It belongs in the same right-click menu as "Owner moderation of
  comments", and a hidden option's votes leave the counts with it.
- `GET /posts` — gains `polls`, a count or a flag, alongside the `comments`
  count from "Next step". Make it a **flag, not a tally**: a card says a thread
  HAS a poll and never how the vote is going. That keeps votes out of
  `dropBoards` entirely — the flag only changes when a poll is created or its
  comment is hidden, and both already drop the cache. A card's poll state
  cannot go stale because nothing a voter does can change it.
  **Do not `dropBoards` on a vote.** It is the one thing here that could
  actually cost money: a vote every few seconds keeps the 60 s cache
  permanently empty, and every board load then re-reads up to 400 post rows
  against a 5M-rows-a-day ceiling. Adding an option is a different matter
  — it is rare, and it changes nothing a card shows either, so it does not
  drop the cache.

### The page

Composing (under the comment box, on `#p=` only, signed in):

- **"Add a poll" stands beside Send** — the poll rides the comment, so the two
  buttons belong on one row — and the editor drops down under the pair: two
  empty rows to start, an add-a-row button up to the cap, and each row
  removable. **A one-or-several toggle sits in the editor**, the only place
  `multi` is ever set. Sending is still one Send (his call, 2026-09-15).
- The editor's rows appear and leave the way `animateClamp` already does it:
  height carries the motion, `--dur-med` and `--ease-ui` carry the timing, and
  `REDUCED` skips straight to the end state. Nothing new invented.

Reading and voting:

- **Options are cards side by side, not bars** (his call, 2026-09-15). Each
  carries its label, its count and its share as a percentage. **Four are in
  view; past four the row scrolls sideways** rather than shrinking every card,
  so a six-option poll reads the same as a three-option one. On a narrow
  screen the card's floor wins and the scroll does more of the work.
- **Most votes first**, and ordered ONCE, when the thread loads. A repaint
  never re-sorts: a card that reordered itself under the cursor as a vote
  landed would move the thing just clicked. A tie keeps the order the options
  were added in.
- **The counts are there from the first look** — the card shows them whether or
  not you have voted. The animation is the vote landing, not a reveal.
- **Picking is local; one Vote sends the ballot** (his call, 2026-09-15).
  A click moves the draft and nothing leaves the page; Vote posts the whole
  thing once, and is off until there is something unsent. Unpicking everything
  and pressing Vote takes the vote back. So a several-pick poll costs ONE
  write however long somebody spends making up their mind, and a dropped
  request costs the press, never half a ballot. Measured on the mock: four
  clicks, zero requests; one press, one request.
- **The share is data, not a rule.** It rides an inline custom property the
  stylesheet reads — the same trick `--dm-who` uses for a commenter's colour —
  so no geometry and no hex goes into `main.css` (CLAUDE.md, "Never"). The card
  `color-mix`es that much fill into its own surface, so a busy option reads
  hotter without drawing a second shape, and a vote settles in rather than
  sliding.
- **Three kinds of control, three places** (his call, 2026-09-15). What you do
  with the poll leads the line under the cards: **Vote**. What only its author
  and the owner may do sits at the far end of that same line: **Close**, where
  nobody reaches for it by accident. What you may ADD to the poll is a
  different act from voting on it, so the **"add an option" box** goes below a
  hairline of its own. Signed out, the sign-in prompt stands where Vote would.
- That box **stands open** rather than unfolding from a button, which would
  shove the rest of the thread down the moment somebody reached for it. At the
  six cap it stays exactly where it is, disabled. Enter sends it.
- **One control scale inside a poll** (his call, 2026-09-15). The cards and the
  fields are 0.85rem, so the buttons are too — a cta's own 1rem beside a
  0.85rem field is what made Add read a size off. The buttons take the field's
  vertical padding and share its line-height, so a button and the box beside it
  come out the same height to the pixel (38), and a width floor keeps Vote and
  Add the same size as each other (96).
- **Nothing reflows mid-use** (his call, 2026-09-15). Every space a change will
  need is reserved before the change: the pick mark is in every card from the
  start and only fades in, the count and the share have floors under them and
  tabular figures above them so 9% and 100% take the same room, the editor's
  remove-row slot is held even at the two-row minimum, and the add-a-row
  button is disabled at the cap rather than taken away. Measured: a vote, a
  change of mind and taking it back move nothing — not the poll's height, not
  the thread's, not one card's position.
- Signed out: the cards and their counts show, and the sign-in prompt stands where the
  controls would — the same one the comment box uses.
- Closed: the controls go and the cards stay. Closed by its author and closed
  because the thread was fixed are different sentences and want different
  strings — both `[ph]`.

`mock.js` mirrors all of it. Its seed carries four: a one-pick poll with a
runaway option (89 / 2 / 8, so a 90%-vs-2% split has somewhere to be looked
at), a several-pick one holding an option a member added and your own seeded
vote, one the author closed, and one closed by its thread (`closed = 0`, on a
`fixed` post). Everything on the mock is the owner, so the per-option menu and
the hidden-option case can be seen without a second account.

### What it costs

Against the free-plan ceilings ([league.md](league.md) keeps the table), polls
are cheap in the two places that usually bite and have exactly one amplifier
worth watching:

- **Worker requests (100k/day).** A vote is one POST. Even a poll that drew
  500 voters who all changed their minds twice is ~1,500 requests — 1.5% of a
  day.
- **Rows written (100k/day).** A vote is a delete plus an insert, each touching
  `poll_votes_option`, so ~4 write-units, and a several-pick ballot is that
  once per pick it lands on — **not once per click**, because the page holds
  the draft and only Vote sends it. The first build posted on every tick, and
  one person working through a 3-pick poll cost ~20 units and four requests;
  it is now ~10 and one. Thousands of ballots a day before this matters.
- **Rows read (5M/day)** is the one that scales with success. `GET /p/<pid>`
  grows by that poll's whole vote table, because the counts are a `GROUP BY`:
  a thread with 300 votes on it costs ~300 extra rows **per view**. Fine at
  a few hundred views; a thread that gets linked somewhere and takes 10,000
  is 3M rows on its own. **The lever, if a poll ever gets that big:** a
  denormalised `votes` count on `poll_options`, written by the vote route,
  which turns those 300 reads into 6. It is not worth building first — it
  costs a recount whenever an account is blocked or an option hidden — but it
  is the escape hatch, and the schema above does not have to change to take
  it.

Storage is nothing: a vote is ~40 bytes against 5 GB.

### What the build added to this design

Four things the design did not say, decided while writing it:

- **`closed_state` on the wire.** The page has to tell the two closes apart to
  say the right sentence, and to hide Reopen on a poll only the post can
  reopen.
- **`yours` on the wire**, for the same reason a member is never sent another
  row's uid.
- **The owner's hide is `PATCH /admin/poll-options/<id>`**, not a sibling of
  the other poll routes: `/admin/` is where one owner check already guards
  everything.
- **A new poll re-reads the board** from the page, because it changes the
  card's flag. A vote still does not, which was the whole point.
- **Every poll button is `.dm-textbtn`, never `.dm-link`.** `.dm-link` dresses
  an `<a>`: on a `<button>` it leaves the browser's own chrome showing, which
  is what put grey boxes down the first build's thread (caught in his pass,
  2026-09-15).

Checked before hand-off: the mock's poll routes against 29 assertions
(vote, change, take back, one-pick refusal, the 6 cap, duplicates, both
closes, the cascades), and every SQL statement in the worker against real
SQLite — the counts drop blocked accounts and hidden options, a deleted
comment takes its poll, and one comment can hold only one poll.

### Settled — his call, 2026-09-15

1. **Who adds options? Anyone.** `open_options` ships on. The cost is the
   moderation surface the first draft worried about, and it is paid for above:
   `poll_options.hidden`, an owner-only `PATCH /poll/option/<id>`, and a place
   for it in the right-click menu. That row is not optional — build it with the
   feature, not after it.
2. **Counts before voting? Yes, always visible.** Anchoring is accepted in
   exchange for a poll that reads as information to someone who is only passing
   through.
3. **One choice or several? The author picks, at creation.** A `multi` column,
   set in the compose editor and immutable after — changing it mid-poll would
   reinterpret ballots already cast.
4. **Auto-close rides the thread's `state`.** A poll on a `fixed`, `wontfix` or
   `closed` post is closed. No date, no cron, and no way for a poll to outlive
   the question it was asking.
5. **Every string is his.** Approved in chat 2026-09-15; zero `[ph]` left.

---

## Status

**Measured, not typed.** A Cron Trigger every five minutes fetches each
app's `health_url`, writes a `status_checks` row, and the board derives
up / degraded / down: three failures in a row is down, a mixed six-hour
window is degraded. Rows are kept 30 days. A hand-flipped status board
is stale within a week — it is only ever correct when the person who
flips it is already busy with an outage.

**Prerequisite:** most existing workers have no health route. Each one
needs a cheap `GET /health` that touches nothing expensive. Until an app
has one, its `health_url` is `NULL` and the board shows it as
unmonitored rather than guessing.

A desktop app cannot be probed. `deetsmusic` therefore shows the status
of **what it depends on** — today the mint's `/health` — plus whatever
notice is set by hand. Say that on the board so the distinction is not
implied away.

**The mint is not the whole dependency.** The fault a DeetsMusic user
most often sees is on Apple's side (0.3.1: "your account is fine"), and
a board that probes only the mint stays green through it. See "Open".

---

## Remote config — and the hotfix question

`GET /config?app=&v=` returns feature flags, tunable numbers, a notice
string, and a minimum supported version — the `CONFIG` var, with any D1
`config` rows layered over it. For DeetsMusic it **rides the startup
token fetch as extra fields on the same response**, so it costs zero
extra requests and no D1 read. `/status` returns the same `notice`, so
the page and the app say the same thing.

This answers "can we do client-side hotfixes" in two halves:

- **For this site: the question does not arise.** Static Pages plus
  workers; a fix is a push or a `wrangler deploy`, live in seconds.
- **For DeetsMusic: config yes, code no.** The front end is bundled into
  the binary and the Rust is compiled, so nothing ships without an
  installer. A loader that pulled JS from the worker would be a remote
  **code execution** channel into a process holding the user's Apple
  credentials — anyone taking the worker, or the DNS record, would run
  code on every install. It would also void the open-source promise,
  because what runs would no longer be what was audited.

The updater (DeetsMusic 0.4.3) does not change that answer. It is a
**file channel for signed installers**: each install verifies the
signature against a public key compiled into it, and the private key
never touches Cloudflare. Taking the worker is not enough to push code.

What config buys is most of what "hotfix" usually means:

- **Feature kill switches** — turn off AirPlay, the extension bridge or
  the agent routes for everyone, the same day, without a release. This
  is the real prize.
- **Numbers** — timeouts, batch sizes, enrich page size, the Rewind gate.
- **A notice** — "0.2.1 has an AirPlay fault, 0.2.2 is out."
- **A minimum supported version** — the app asks for an update instead
  of failing strangely.

It is a **config channel and never a code channel.** Naming it honestly
is what stops it growing into one.

---

## The mint tenant

`GET /token` is DeetsMusic's developer-token mint. Its design, its
lifetime and refresh rules, its rate limit and its privacy posture live
in **DeetsMusic `docs/RELEASE.md` §7**, which stays the source of truth
for that route. Summary only, so this doc reads on its own: ES256 via
WebCrypto from a `.p8` held as a worker secret; **one shared 14-day
token per 7-day window**, so every token in a window expires at the same
instant; the app refreshes inside a 3-day margin (about weekly); open by
design, `User-Agent: DeetsMusic/<v>` or 403, 30 requests per 60 s per
IP; a daily `mint_counts` row with no IP, token or UA; `KILL` var. The
Apple `origin` claim is built and switched off (`TOKEN_ORIGINS`).

The same host serves the **hosted sign-in page** (`/signin`, DeetsMusic
DATA-ARCHITECTURE.md §2a) and the **update route** (`/update/`,
RELEASE.md §6). Both are DeetsMusic's to document.

Privacy, restated for the public page: sign-in to Apple Music stays on
the machine and **the music-user token never leaves it**. The worker
sees no user data **unless a person presses Send on a report**, and then
it sees only what the app showed them first.

---

## The page

`DeetsSolutions/deetsmusic/`, served at `deets.solutions/deetsmusic/`,
with a nav entry. A normal site tab: `chrome.css` → `main.css`, tokens
for every colour and every measurement, strings in
`deetsmusic/strings.js`, and all 30 theme×skin combos must survive. A
new page carries the pre-paint head script, so the `R` map count in
CLAUDE.md ("all 14 pre-paint head scripts") goes up by one.

**Aditya leads the design.** Layout, structure, every user-facing string
and the exact fields a report carries are his. Claude adds
`[ph]`-prefixed placeholders only, per the repo copy rule, and does not
propose layout until asked.

What it holds (2026-09-14): **server uptime, installs, release notes,
update patches, suggestions, and bugs.** Facts the design has to work
with, not choices about it:

- **It is probably the only public download point.** The GitHub repo is
  private, and DeetsMusic RELEASE.md §6.6's lost-key runbook sends people
  to "the GitHub Release, the support page" for a hand install. The
  remote `notice` links here.
- **The installer comes straight from R2 through the worker:**
  `music-api.deets.solutions/update/deetsmusic/file/DeetsMusic_<v>_x64-setup.exe`.
  A browser download carries the web mark, so SmartScreen checks it.
  Installers up to 0.4.3 are unsigned and it warns (More info › Run
  anyway). From 0.5.0 they are Authenticode-signed by Aditya Sundaram
  (DeetsMusic RELEASE.md §6.9), so the prompt names the publisher; it still
  warns until download reputation builds. **Tested 2026-09-15 with 0.6.0:**
  Edge warns "isn't commonly downloaded" (… › Keep, then Delete ▾ › Keep
  anyway) and Windows shows no blue screen after it; Firefox warns "not
  commonly downloaded", and then Windows shows "Windows protected your PC"
  (More info › Run anyway) when the file is opened. Chrome is untested. The
  install box shows `installSigned` plus the visitor's own browser's
  `installSteps_<browser>` line (user-agent: `Edg/` → edge, `Firefox/` →
  firefox, `Chrome/` → chrome), with an "Other browsers" button for the rest;
  an unknown browser sees all three (his layout call, 2026-09-15). An ⓘ
  beside the signed line opens `installWhy` (download reputation builds per
  file in Chrome and Firefox; SmartScreen also credits the verified
  publisher across every release signed under that identity).
  Updates install silently either way.
- **The Status box has one row per checked service** (2026-09-15). Each row
  is an entry in the worker's `apps` table, loaded with its own
  `/status?app=<id>`, with its own dot, word and 6-hour strip; the remote
  notice rides the `deetsmusic` row only.
  - **DeetsMusic Gatekeeper** — app `deetsmusic`, probes
    `music-api.deets.solutions/health`: the token mint's key signs and `KILL`
    is off. A short outage stops new installs from playing; running installs
    keep their saved 14-day token (they refresh inside the last 3 days).
  - **DeetsMusic installer** — app `deetsmusic-installer`, probes
    `music-api.deets.solutions/update/deetsmusic/health` (DeetsSupport
    `src/update.js`): 200 when the newest live installer is in R2 at its
    indexed size. An R2 `head()`, so the 7 MB file is never read; it answers
    before the rate limiter, because the cron's in-process probe has no
    client IP. The row goes live with one D1 insert, after the worker deploy:
    `INSERT INTO apps (id, label, health_url, sort) VALUES ('deetsmusic-installer',
    'DeetsMusic installer', 'https://music-api.deets.solutions/update/deetsmusic/health', 1);`
  - Both probes run in-process (a Worker cannot fetch its own custom
    domain), so neither sees DNS or the edge.
- **Releases come from `GET music-api.…/update/deetsmusic/releases`**
  (built and deployed 2026-09-14; shape in DeetsMusic RELEASE.md §6.2).
  `/update/<channel>` only answers "is there something newer than `?v=`"
  and `/versions` only lists *older* versions in one group, so neither
  serves a page. The new route returns `latest` plus every row newest
  first, D1-free, before `KILL`, cached five minutes. `notes` is what
  `release:publish` wrote into the index, so the page and the app's
  update offer show one text.
  - **Full history, not launch-day history.** 0.1.3–0.4.1 predate the
    updater and have no signature; they enter the index as notes-only
    rows (`--history`) with no download.
  - **Withdrawn releases stay on the page** as notes, marked withdrawn,
    with no download and an optional `withdrawn_reason`. The lessons
    are part of the record.
  - **`notes` is markdown** (paragraphs and bold). Render that subset as
    text, never as HTML.
- **A ticket's link is a page URL, not the worker's.** `/t/<code>` is
  JSON. The code is a credential — whoever holds it reads the thread and
  replies as the reporter — so it belongs in the fragment
  (`deets.solutions/deetsmusic/#t=<code>`), which never reaches a server
  log or a `Referer`. A `?code=` would reach both.
- **Trademark notice.** "Apple Music is a trademark of Apple Inc. …
  not affiliated with, sponsored by, or endorsed by Apple" appears in
  the app and the README; a public page named for it should carry it.
- **The privacy promise** in "The mint tenant" above is what the page
  can say today. The DeetsMusic README's "never sent anywhere" line
  changes when the in-app report form ships, not before.

The second tenant (`deets.solutions` itself) gets its own page or a
section when it has something to show; the worker already serves it by
`?app=`.

### The draft (2026-09-14)

Claude's first pass, built with Aditya's go-ahead to propose a layout.
Everything in it is his to redesign. The layout, the report fields and
every string (`deetsmusic/strings.js`, all `[ph]`) are placeholders.

- **Files.** `deetsmusic/index.html` holds no copy: it is filled from
  `strings.js` through `data-s` and `data-s-ph`. `deetsmusic.js` is the
  page, `mock.js` is the in-page mock, and the styles are the DeetsMusic
  section at the bottom of `main.css` (`dm-` prefix, the profile's bento
  anatomy). The icon is `assets/deetsmusic/icon.png`, copied from
  DeetsMusic's `src-tauri/icons/icon.png`. The nav link sits under
  Utilities on all 15 pages. It has no `data-nav-core`, so it is not in
  the mobile menu yet.
- **Order.** The page bar carries a Download pill and a Report pill. Below
  it: the notice, then Install beside Status, then Release notes (full
  width), then Suggestions beside Known issues, then Your posts, then the
  privacy and trademark footer. `#t=<code>` swaps all of that for one
  ticket and its thread. `#report` and `#suggest` open the matching form.
- **Status** shows the worker's six-hour window as a strip of 72 checks.
  The worker exposes nothing older, so there is no 30-day history.
- **Report fields** match what the worker already takes: title, details,
  and, on a bug only, an optional app version sent as `meta.version`.
- **Your posts** is this browser's list of codes, sent or opened, kept in
  `localStorage` (`deets-dm-mine`). Interest de-duplication is
  `deets-dm-interest`, because the worker counts every +1.
- **`?mock`** answers with the worker's exact response shapes, so every
  state can be judged while the boards are still empty and the status is
  whatever it happens to be. It uses the real release-note text; every post and the withdrawn 0.2.2 row are
  invented and marked `[mock]`. The modes are `?mock`, `?mock=up`,
  `?mock=down` (with a notice) and `?mock=empty` (the releases route
  returns 404). A seeded private ticket with replies lives at
  `#t=mockticket000001`.
- **Live mode** calls production from localhost. That works only on port
  8787 or 8788, the two dev ports in the worker's `ALLOWED_ORIGINS`.

---

## Open

- **Public lists leak each post's `code`** (found 2026-09-15). Fixed in code
  the same day (step 1 of "Threads"); **live until the migration runs and the
  worker is deployed** — "Shipping step 1".
- **Apple in status.** The cron could mint its own token and send one
  cheap catalog request to `api.music.apple.com`. That is a use of the
  developer token beyond serving installs — Aditya's read under the D.7
  terms first.
- ~~**Owner moderation view.**~~ Built 2026-09-14 — see "Owner
  moderation" below.
- ~~**`KILL_BOARDS`.**~~ Built 2026-09-14 — see "Spend guards" below.
- **Help before "report".** No user guide exists. DeetsMusic
  AGENT-SETUP.md §5 and the release notes' Installing sections already
  answer the commonest faults. Whether their wording is reused is his
  call under the copy rule.

---

## Build order

1. ~~**Worker repo `DeetsSupport`**, schema applied, both custom-domain
   routes bound, `/token` moved over and proven with `curl`.~~ Done
   2026-09-11.
2. ~~**Intake and tickets**: `POST /posts`, `GET /t/<code>`, replies.~~
   Done; moderation is by hand in D1.
3. ~~**`GET /config`**, folded into the token response for deetsmusic.~~
   Done in the worker. The client flag reader in the app: see DeetsMusic.
4. **Health routes** on the existing workers. The cron and `/status` are
   done; only the mint and this site have a `health_url` so far.
5. ~~**The worker's releases route** (`/update/deetsmusic/releases`) with
   DeetsMusic's `publish-update.mjs` additions (`--history`, `--reason`,
   `--notes-only`), backfill 0.1.3–0.4.1.~~ Done 2026-09-14. Then **the
   page**, Aditya leading.
6. **DeetsMusic**: the redactor, the report form, and **My reports** in
   Settings (the rolling log file is done, LOGGING.md). The README's
   privacy section changes with this step.

## Cost

D1 free tier, one worker, a five-minute cron. Reads are small and writes
are human-paced. R2 storage is free to 10 GB and egress is free, so every
installer is kept. Nothing here approaches a paid tier at this traffic.
The one thing that could is an intake flood, which is what the rate
limit, the body cap and `KILL` are for.
