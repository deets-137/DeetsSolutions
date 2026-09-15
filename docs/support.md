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
  A browser download carries the web mark, so SmartScreen warns (More
  info › Run anyway) — the release notes already say so. Updates after
  that install silently.
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
