# Support — status, installs, releases and boards for every Deets app

One public home per Deets app where a person can download it, see whether
it is up, read what changed, ask for a thing, or report a fault. The page
lives on this site; the data comes from a sibling worker, with a row of
data per app rather than a copy of the system per app.

**Scoped 2026-09-11. Worker built and deployed the same day**, and grown
since: the hosted sign-in page (DeetsMusic 0.4.0) and the updater route
(0.4.3) now ride the mint host too. Replies on a ticket, `/config`,
`/status` and the cron are all live; only the mint and this site have a
health URL. **The page is not built.** This doc is the design and the
build order. The page itself — layout, copy, and the exact fields a
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

- **The moderation queue is mandatory.** An open, anonymous write
  endpoint feeding a public board becomes a spam wall. Nothing is public
  until Aditya marks it public.
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
  state        TEXT NOT NULL,         -- 'new' | 'open' | 'planned' | 'fixed' | 'wontfix'
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
  (decided 2026-09-14, not built; shape in DeetsMusic RELEASE.md §6.2).
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

---

## Open

- **Apple in status.** The cron could mint its own token and send one
  cheap catalog request to `api.music.apple.com`. That is a use of the
  developer token beyond serving installs — Aditya's read under the D.7
  terms first.
- **Owner moderation view.** Moderation, owner replies and state changes
  are `wrangler d1 execute` today. An owner-only view gated on his
  DeetsAccounts session is what makes the boards sustainable after a
  public launch.
- **`KILL_BOARDS`.** Shut intake and boards without shutting the mint.
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
5. **The worker's releases route** (`/update/deetsmusic/releases`) with
   DeetsMusic's `publish-update.mjs` additions (`--history`, `--reason`,
   `--notes-only`), backfill 0.1.3–0.4.1, then **the page**, Aditya
   leading.
6. **DeetsMusic**: the redactor, the report form, and **My reports** in
   Settings (the rolling log file is done, LOGGING.md). The README's
   privacy section changes with this step.

## Cost

D1 free tier, one worker, a five-minute cron. Reads are small and writes
are human-paced. R2 storage is free to 10 GB and egress is free, so every
installer is kept. Nothing here approaches a paid tier at this traffic.
The one thing that could is an intake flood, which is what the rate
limit, the body cap and `KILL` are for.
