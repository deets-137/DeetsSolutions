# Support — status, suggestions and issues for every Deets app

One place where a person who uses something of yours can see whether it
is up, ask for a thing, or report a fault. `support.deets.solutions`,
fed by a sibling worker, with a row of data per app rather than a copy
of the system per app.

**Scoped 2026-09-11. Worker built and deployed the same day** (build
order steps 1–3; the cron and `/status` exist but only the mint and this
site have a health URL). **The page is not built.** This doc is the design
and the build order. The page itself — layout, copy, and the exact fields a report
carries — is **Aditya's hand pass** and is deliberately not specified
here ("The page" below).

First two tenants: **deetsmusic** (a Windows desktop app, the reason
this exists) and **deets.solutions** (this site). Build it music-first;
generalise by adding a row, never by rewriting.

---

## The shape

```
support.deets.solutions          the site tab — DeetsSolutions/support/
  status        per app: up / degraded / down, plus recent history
  suggestions   anonymous post, interest count
  issues        moderated list, per app, with a state

DeetsSupport (worker)            sibling repo, one D1, no Durable Objects
  GET  /status?app=              board data
  GET  /posts?app=&kind=         public posts only
  POST /posts                    intake — web page or app, both anonymous
  GET  /t/<code>                 one ticket, by its unguessable code
  POST /interest                 +1 on a suggestion
  GET  /config?app=&v=           remote config + notice   (see "Remote config")
  GET  /token                    the DeetsMusic developer-token mint
  cron */5                       ping each backend, write status_checks
```

The page is Pages, the data is the worker, the same split as
[radio](radio.md) and [league](league.md). No build step, no
dependency, plain `src/index.js` — the house rules for a worker repo
hold here too.

---

## Decisions already made

**One worker, two custom-domain routes** (2026-09-11). `DeetsSupport`
answers on `support.deets.solutions` *and* on
`music-api.deets.solutions`, where DeetsMusic fetches its developer
token.

The earlier plan split the mint into its own worker on availability
grounds. That argument turned out to be weak: DeetsMusic caches a
60-day token and refreshes inside a 15-day margin, so a mint outage is
invisible to any install launched in the last 45 days. Only a first run
or a 60-day-dormant install ever feels it. A shared blast radius costs
little, and one repo is easier to hold.

Two guardrails keep the merge safe, and both are cheap:

- **The app compiles in `music-api.deets.solutions/token`, not the
  support host.** The URL inside a shipped binary is the one thing that
  cannot be changed without a release, so splitting the mint out later
  must stay a route move. Never point the app at `support.…`.
- **`/token` returns before any D1 call**, and a `curl` smoke check on
  it is part of the deploy step. A board deploy that breaks the script
  is then caught in seconds, and a D1 fault cannot reach the mint at
  all.

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

**Ticket code only, no contact details** (2026-09-11). A report gets an
unguessable code, and the code is the URL. Threads, replies and states
are all managed from that page.

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
  code         TEXT PRIMARY KEY,      -- random, 12+ chars — this IS the URL
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

D1 only. **No R2** until someone genuinely needs to attach a file — a
log tail belongs inside `meta`, capped.

---

## Intake

One route, `POST /posts`, for both sources. It is open, unauthenticated
and unattestable, exactly like the mint, and for the same reason: a
public binary can prove nothing about itself.

What holds it together instead:

| Control | Value |
|---|---|
| Rate limit (`ratelimits` binding, keyed by IP) | **5 per 60 s**, fail OPEN if the binding is absent. Measured: trips only on a reused connection (per-isolate counters) — see DeetsMusic RELEASE.md §7 |
| Body cap | a few KB, enforced before parse |
| `public` default | `0` — nothing reaches a board unmoderated |
| Stored as text, rendered as text | never as HTML |
| `KILL` var | intake off without touching the boards or the mint |

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
up / degraded / down from the recent window. A hand-flipped status board
is stale within a week — it is only ever correct when the person who
flips it is already busy with an outage.

**Prerequisite:** most existing workers have no health route. Each one
needs a cheap `GET /health` that touches nothing expensive. Until an app
has one, its `health_url` is `NULL` and the board shows it as
unmonitored rather than guessing.

A desktop app cannot be probed. `deetsmusic` therefore shows the status
of **what it depends on** — the mint route — plus whatever notice is set
by hand. Say that on the board so the distinction is not implied away.

---

## Remote config — and the hotfix question

`GET /config?app=&v=` returns feature flags, tunable numbers, a notice
string, and a minimum supported version. For DeetsMusic it **rides the
startup token fetch as extra fields on the same response**, so it costs
zero extra requests.

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
WebCrypto from a `.p8` held as a worker secret, a 60-day token, open by
design, 30 requests per 60 s per IP, `KILL` var.

Privacy, restated for the public page: sign-in to Apple Music stays on
the machine and **the music-user token never leaves it**. The worker
sees no user data **unless a person presses Send on a report**, and then
it sees only what the app showed them first.

---

## The page

`DeetsSolutions/support/`, a normal site tab: `chrome.css` →
`main.css`, tokens for every colour and every measurement, strings in
`support/strings.js`, and all 30 theme×skin combos must survive.

**Layout, structure and every user-facing string are Aditya's hand
pass**, as is the exact list of fields a report carries. Claude adds
`[ph]`-prefixed placeholders only, per the repo copy rule, and must not
write the report form's wording. Open and undecided: whether `support/`
takes a nav entry or stays a footer link.

---

## Build order

1. **Worker repo `DeetsSupport`**, schema applied, both custom-domain
   routes bound. Move `/token` over first and prove it with `curl`
   before anything else exists — it is the only route with a shipped
   client.
2. **Intake and tickets**: `POST /posts`, `GET /t/<code>`, replies,
   moderation by hand in D1 until a board exists.
3. **`GET /config`**, folded into the token response for deetsmusic.
   Add the client flag reader in the app.
4. **Health routes** on the existing workers, then the cron and
   `/status`.
5. **The page**, Aditya's pass.
6. **DeetsMusic**: the rolling log file, the redactor, the report form,
   and **My reports** in Settings.

## Cost

D1 free tier, one worker, a five-minute cron. Reads are small and writes
are human-paced. Nothing here approaches a paid tier at this traffic.
The one thing that could is an intake flood, which is what the rate
limit, the body cap and `KILL` are for.
