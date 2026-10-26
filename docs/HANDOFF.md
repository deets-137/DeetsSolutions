---
status: sop
sources: []
updated: 2026-10-24
---
# Deets.Solutions — Handoff / Status

> Cold-start guide — read first. A hand-built static site on Cloudflare Pages (no build
> step, no dependencies) plus a ring of sibling Cloudflare Worker repos: journals, Radio,
> League, four live games, accounts, and the DeetsMusic support page.
>
> **Where things stand (2026-09-15):** the DeetsMusic UI port (steps 1–4, 6, 8), the
> DeetsMusic page, and **board threads — all four steps — are LIVE and visual-passed.**
> Threads are closed out bar a live test he runs at release. **2026-09-16 (branch
> `Musical-Perfection`, merged + LIVE, his copy and visual pass done):** DeetsMusic is its
> own nav tab left of Blog; its release notes are two-pane (headliners left, notes right),
> the newest release collapsible and remembered, earlier ones a row of cards; Home leads
> with a DeetsMusic card (icon, version, date). Design in [support.md](support.md),
> "The page". **2026-10-23:** why `_headers` never showed is found (a zone setting, his to
> flip), and the PageSpeed + readability work waits on branch `site-quality` — top of
> [Next up](#next-up).

**What a "what's next?" should answer from:** the [Next up](#next-up) list below, top
down. When a session plans, finishes, or parks something, it updates this file in the same
commit. Designs live in the topic docs; this file only points at them.

Rules of the house: [CLAUDE.md](../CLAUDE.md) (the Never list, copy, CSS, games). Structure:
[README.md](../README.md). Deeper docs, by area:
[architecture.md](architecture.md) · [ui.md](ui.md) · [css-split.md](css-split.md) ·
[ui-direction.md](ui-direction.md) (the DeetsMusic UI port) · [support.md](support.md)
(DeetsMusic page + DeetsSupport worker) · [accounts.md](accounts.md) · [stats.md](stats.md) ·
[data.md](data.md) · [league.md](league.md) · [radio.md](radio.md) · [youtube.md](youtube.md).
Games — **read [games.md](games.md) first**: [design-language.md](design-language.md) ·
[bots.md](bots.md) · [realtime.md](realtime.md) · [cities.md](cities.md) ·
[mahjong.md](mahjong.md) · [poker.md](poker.md) · [tanks.md](tanks.md).

---

## Run it

```bash
python -m http.server 8787
```

- `.claude/launch.json` has `deets-site` (8787) plus `-alt` (8788) and `-alt2` (8789).
  Several Deets apps run on this PC at once, so take a free one rather than failing on a
  busy port.
- **Live mode against production workers only works from 8787 or 8788** — those are the
  dev origins in the workers' `ALLOWED_ORIGINS`. 8789 is fine for `?mock`.
- `?mock` on every game, Radio and `/deetsmusic/` runs the page against an in-page mock
  that speaks the worker's exact wire shapes.
- `node <game>/engine.js` runs a game engine's self-checks.
- Visual verification is Aditya's: check console + DOM counts, then hand off.

## Ship it

- **Site:** push to `master`; Cloudflare Pages deploys. `_headers` keeps CSS/JS at
  `max-age=0` (CLAUDE.md "CSS").
- **Workers:** `npx wrangler deploy` in the sibling repo. Deploys need his explicit ask.
  After any DeetsSupport deploy, smoke every mint-host route (support.md, "Decisions
  already made").
- **Resume:** `powershell -File scripts/build-resume-pdf.ps1`, commit both files.
- **Journals:** the `journal-refresh` skill; never hand-edit the JSONs.

---

## Next up

Newest plan first. Each entry: status, the doc that holds the design, the first step.

**2026-10-24 — Phone + half-width pass, round 1: SHIPPED.** No page scrolls sideways at
375–1440px now (headless audit, every page). Fixed: the About Me menu hanging past the window
from 56rem to ~70rem (right-anchored there, `chrome.css`); page titles wrap below 41rem; the
desktop sign-in pill leaking into the narrow header (a later base rule out-ranked the hide);
phone gutters 2rem → 1rem; Movies fits three posters at 41–56rem. Desktop screenshots at
1100/1280/1440 unchanged.

**2026-10-24 — Mobile nav carries every tab, grouped like desktop: SHIPPED.**
`buildNavMenu()` in `controls.js` (ui.md, "The mobile nav menu"). DeetsRadio and League stay
desktop-only (`data-nav-desktop`): he is retiring both and not maintaining them.
Resume fixed for phones the same day (role rows wrap, dates drop under the role; CSS only, so
no PDF rebuild). **Next:** a real phone play-through of the three games (only their lobbies
were seen); `npm run dev` now works on the Mac (wrangler installed locally, gitignored).

**2026-10-23 — New first-visit looks: Lilac × Press (light), Black & Red × Ocean (dark).**
His call; SHIPPED with the two entries below (branch `site-quality` merged to `master` and
pushed the same day). The pre-paint script on all 19 pages, `LOOK_PAIRS` in `controls.js` and
the CSP hash in `_headers` all changed together.

**2026-10-23 — DeetsTanks hidden; the first-run walk off (his calls).** DeetsTanks is out of
every page's Games menu and the sitemap; `/tanks/` still loads by URL, and Cool Stuff's tanks
card still has its "Play ↗" link. To bring it back, restore the menu line on each page (git
history of this commit). The walk is off until his revamp the following week: its two hooks are
out of the working tree, `js/walk.js` stays on disk, and [onboarding.md](onboarding.md) has the
lines to put back.

**2026-10-23 — PageSpeed fixes and DeetsMusic's readability + cover wave: SHIPPED** (branch
`site-quality`, merged to `master` and pushed on his ask the same day). From his desktop PageSpeed run (Performance
91, Accessibility 96, Best Practices 96, SEO 92). Built:
- **Readability:** the app's 2026-10-14 text paints (Lilac, Green, Sepia, Moonlight inks; Black-Red's
  siren `#FF4D45`) in `palette.css` / `themes.css`. The flagged `--subtext` chips now read 5.4–9.3:1.
- **Covers:** `js/covers.js` (new shared chrome): covers fetched at the size drawn, as WebP
  (`srcset`; home, SOTD, Movies), and the app's hold-then-diagonal-wave reveal (cap 1.5 s,
  `--reveal-cap` / `--reveal-span` in `skin.css`) on the home strips, the calendar and both
  journal grids. The home hero never waits (it is the page's largest picture) and is fetched
  first; `songs.json` is preloaded in the home `<head>`.
- **Layout shift (0.112 → 0 locally):** each home strip holds an invisible ghost card from the first paint.
- **Stylesheets:** every head preloads `chrome.css`'s four imports (same `?v=`), so they no
  longer download one after another. All CSS/JS stamps went to 2026-10-23.
- **SEO:** `robots.txt`, `sitemap.xml`, and a real `404.html` (all `[ph]` copy) — before it,
  every unknown path, `robots.txt` included, served the home page with a 200.
- **`_headers`: the cause found** (zone Browser Cache TTL at 4 h; see its comment), the
  songs.json double header fixed, and security headers added: HSTS, X-Frame-Options, nosniff,
  COOP, and a **report-only** CSP (clean on every page locally).
- **A11y:** the strip's "GitHub ↗" links are named with their project (aria-labelledby, no new words).
- **Walkers:** the frame cycle is a transform now (GPU), not a background-position repaint.
- **DeetsAccounts:** `GET /me` answers a signed-out visitor `200 null`, not 401 (the console
  error). Deployed 2026-10-23 (below).

DeetsAccounts 479562a is pushed and DEPLOYED (version b0a16ad5, 2026-10-23); `/me` answers
signed-out visitors `200 null`, checked live. **Left, his:** set the zone's Browser Cache TTL to
"Respect Existing Headers" (dashboard) so CSS/JS get `max-age=0`; the 404 page's three `[ph]`
lines. **Before the CSP can be enforced:** Cloudflare's bot-detection script is injected inline
into every page with per-request values, so it will report on every load. Enforcing needs that
detection off for the zone, or a nonce. Not run: the resume PDF rebuild (only its `<head>` changed).

**2026-10-20 — Metal, the sixth skin: SHIPPED** (his OK, with DeetsMusic 0.31.0). Ported from the
app: the paints (`palette.css`), the light and shade roles and each theme's metal and floor
(`themes.css`, "Metal"; Sepia turns brass), and `[data-skin="metal"]` in `skin.css` (the app draws
its grain in a canvas; here a static SVG noise, white and black streaks over the theme's metal).
Picker row and Bahnschrift warm-up in `controls.js`. The CSS/JS `?v=` stamps went to 2026-10-20 on
every page but the resume (its PDF rule). 6 × 6 = 36 combos now. Left: the DeetsMusic page's
feature card still says "6 themes × 4 skins / 24 looks" (his words, no `[ph]`).

**2026-10-14 — DeetsMusic admin page: LIVE.** `deetsmusic/admin/`, owner only (gated on
`GET /admin/me`, `noindex`): DeetsMusic's anonymous usage counts (installs per day / week /
month, the version mix, setting shares, a two-setting cross-check, every health metric). Owner
mode on `/deetsmusic/` shows an **Admin** button in the page bar; moderation stays inline. His
strings (approved 2026-10-14). The worker routes and the D1 tables went live the same day
(DeetsSupport `src/usage.js`). The numbers fill once an app release that sends them ships.
[support.md](support.md) › "The admin page". Note: 18 pages now carry the pre-paint script, and
CLAUDE.md and architecture.md still say 15.

**2026-10-14 — DeetsMusic Rooms replaces the Radio tab: DESIGNED, his calls made, site page
not built.** The Radio tab becomes the DeetsMusic app's own cards in a browser, on the
DeetsMusicRooms worker, so a friend on a Mac can join an app room. YouTube, the Match Desk and
the crew panel go; the site-shell stays; the name is "DeetsMusic Rooms". The app side is built
in the DeetsMusic repo (`docs/features/WebRooms.md` §10). Design for this repo:
**[rooms-web.md](rooms-web.md)**. **First step:** his two forks (§4: how the two looks share one
page; his entry field). This replaces the 2026-09-16 "PARKED" entry below.

**2026-10-12 — Link previews on every section.** DeetsMusic + its demo SHIPPED first (his
copy, LinkedIn Post Inspector confirmed by him). Then home, Cool Stuff, resume, Movies, League,
Radio and the four games got the same set: description, Open Graph/Twitter tags, and a
1200×630 `summary_large_image` card in `assets/og/`. All cards come from one builder,
`scripts/build-og-cards.py` (screenshot window + emblem tile + Deets and Happy + a pixel
flourish); `node scripts/capture-og-shots.js` re-shoots the pages from production in headless
Edge, playing the games on `?mock` with bots. SOTD keeps its own nightly `build-sotd-og.py`.
After rebuilding a card, bump its `?v=`. Profile and the two privacy pages have no card (not
worth sharing). If he hands over his own DeetsMusic screenshot, add it as that card's `shot`.

**2026-10-11 — Ocean's album light on the site: PUSHED (855f413); his visual pass done.** The app's neon crests
+ stronger glow, a Settings › Album light slider (default 80), and Ocean's edges now default
Soft. [deetsmusic-page-pass.md](deetsmusic-page-pass.md) §7f. Owed: the weak-machine
check and the slider hint's `[ph]`. **Then the same day:** Settings › Card opacity (the
app's row, default 60%), pushed (d13a3ff); his visual pass owed (the nested home-card tiles
stack a touch darker).

**2026-10-06 — The DeetsMusic page's product pass, and the site's Ocean: SHIPPED (pushed to master).**
Two reviews by another AI agent (a page review and a market read) were checked against the app;
the verdicts, his decisions and the forks he settled (§2a) are in
**[deetsmusic-page-pass.md](deetsmusic-page-pass.md)**. **Pass 1:** a tagline under the bar, a
Features box (six tiles 3 + 3, then the "Only in DeetsMusic" pair centered, all one size), Demos
(three screenshots that follow the visitor's own theme × skin: 72 WebPs in
`assets/deetsmusic/shots/`, four skins, Vanilla shows Press), and a Requirements and trust box
(no VirusTotal), all before Release notes. His desk test and copy pass done the same day, alt
texts included: zero `[ph]` on the page. Re-shoot the pictures when the app's look changes
(§3c, "Re-shooting"). **The Ocean:** the app's swell plus a glow from today's SOTD cover,
stronger than the app's (§7e). Every page's `chrome.css` / `controls.js` went to
`?v=2026-10-06b` (`_headers` still doesn't apply). **Open:** a radio-shell and weak-machine check of
the sea (§7e). **Also his:** no Microsoft Store; a tip jar before the
Reddit launch post, not now (§6.9); the page is partly a portfolio piece but the product leads.

**2026-09-24 — A first-visit onboarding flow for recruiters and new visitors: the home WALK is BUILT, the rest is an idea.**
**Built the same day, HELD BACK from the 2026-10-06 push:** that commit carried the walk's
inert pieces (its CSS and tokens, the walkers' pause guard, the settings panel's `action` row
kind and the Tips strings) but **not `js/walk.js`, its `<script>` tag in `index.html`, or the
Tips section in `controls.js`'s settings panel** — they sit uncommitted in the working tree,
because the walk starts on its own for every first visitor and its copy is all `[ph]`. Ship
those three together after his passes. Deets and Happy walk a first visitor round the home page
(hello → DeetsMusic → Cool Stuff → Resume → Vibe → send-off), ported from DeetsMusic's walk.
`deets.solutions/?tour` always starts it, which makes it the URL for applications. Design and
testing: **[onboarding.md](onboarding.md)**. **Left:** his visual pass, then his copy pass (every
string is `[ph]`: the `W` table in `js/walk.js` and `S.tourHint` in `controls.js`), then commit.
The open questions below are still open. Aditya is linking the site from job applications (Website, Portfolio and Other URL fields), and a
cold visitor doesn't get what he's built. The home page opens on SOTD, Movies and a nav of 20+
entries, and the pages render with JavaScript, so a link preview or a quick look shows little.
While choosing between `/deetsmusic/` and `/deetsmusic/demo/` for an application, neither felt
self-explanatory: the demo drops you into a player with no framing, and the product page doesn't
lead with "what this is, what I built, why it's impressive." **Goal:** someone arriving from a
resume link understands the headline projects (DeetsMusic, the agent harness, MCP server, games)
and where to click within about 30 seconds. **Open questions:** a "Start here" / recruiter path
on the home page vs. a dedicated landing URL to put on applications; a short framing header on
`/deetsmusic/demo/`; whether `cool-stuff/` should become the portfolio front door. **First step:**
walk the site cold from each URL he's used on applications and list where a visitor gets lost.
All copy is his words, so draft structure with `[ph]` strings only.

**2026-09-21 — The DeetsMusic web demo (`/deetsmusic/demo/`): BUILT on branch `demo-time`.**
The real DeetsMusic UI in an iframe with mock songs; the design and the build live in the
DeetsMusic repo (`docs/features/WEB-DEMO.md`). Here: `deetsmusic/demo/` (page, `demo.js`,
`strings.js` — all his words, zero `[ph]`), `app/` (the build — never hand-edit; the DeetsMusic
repo's `npm run demo:publish` replaces it), and one `.dmd-*` block in `main.css`. The app's look
reaches its own box only. **Left:** merge `demo-time` into `master` to go live, and a link to
the demo from the DeetsMusic page if he wants one.

**2026-09-17 — A Status row for DeetsMusic's rooms worker: site side BUILT, one gate left.**
The worker is live (`rooms.deets.solutions`, its own private repo DeetsMusicRooms). The page now
carries the third row: markup under the installer row, a mock branch that serves it healthy in
every mode but `empty`, and `statusSubject_rooms` in his words (zero `[ph]`). Design:
**[rooms-status.md](rooms-status.md)**. **Left:** the D1 insert in §2a against `deets-support` —
until it runs the row reads "Not monitored". After it, the row appears on the next five-minute
tick and fills its strip over six hours.

**2026-09-16 — DeetsRadio moves onto the DeetsMusic rooms worker: PARKED, and not by this repo.**
DeetsMusic built the rooms worker on 2026-09-17 and decided the same day that **the site is out
of scope** for it (`../DeetsMusic/docs/integrations/ROOMS.md` §13): the Radio tab keeps its own worker and its
own name, and the app owes it no protocol compatibility. If this site ever wants the Radio tab on
that worker, it starts from ROOMS.md as it stands and is this repo's session to run — the five
old differences (rooms that live on when empty, free-form names, preview listeners, YouTube
entries, a browser host) are all still open, and the first two are settled the other way in the
app's design.

**2026-10-23: CAUSE FOUND** — the file does apply; the zone's Browser Cache TTL (4 h) raises
every CSS/JS Cache-Control to 14400, and the songs.json double header is two of the file's own
rules joining. The fix is a dashboard setting (entry above; the `_headers` comment has it all).
The history below is kept for the record.

**⚠ 2026-09-15 — `_headers` has never applied: ON THE DOCKET, first thing next session.**
Found while checking the board-threads deploy, and it is a site-wide bug, not a DeetsMusic
one. Every stylesheet and script on deets.solutions serves Pages' `max-age=14400`, not the
`max-age=0` that file specifies — so **a returning visitor can hold four-hour-old CSS/JS,
and the 2026-08-08 theme-rename class of breakage can still happen.** Apparently true since
the file was written, which means that August fix never took.

The full evidence and the checklist live in the **`_headers` comment itself**; the short
version:
- The original `/*.css` and `/*.js` rules ARE invalid syntax (a Pages pattern takes a
  trailing splat), but rewriting them per directory changed nothing.
- A probe settled it: a custom header added beside the Cache-Control on `/js/*` never
  reached `/js/controls.js` either, so the rules **are not applied at all**, rather than
  applied and overridden on Cache-Control alone.
- One reading does not fit and is the thread to pull first: `/sotd/songs.json` DOES come
  back with the rule, while `/sotd/sotd.js` beside it does not.

**First step:** check the Pages project's build-output directory in the dashboard. If it is
not the repo root, `_headers` is never picked up, which fits every observation. Then a
zone-level Cache Rule. To see the result at all — a rule that never matches is silent:

```bash
curl -sI https://deets.solutions/styles/main.css | grep -i cache-control
```

`max-age=0` is it working; `max-age=14400` is it still being ignored. Until then, assume a
deploy reaches returning visitors up to four hours late, and if a change would BREAK against
the old pair, stamp that page's assets `?v=<date>` by hand — `deetsmusic/index.html` does,
and is deliberately the only page that does.

**2026-09-15 — DeetsMusic board threads: LIVE (all four steps), visual-passed.**
Design: **[support.md "Threads"](support.md)**. Clicking a Suggestions or Known issues card
opens `#p=<pid>`, a read-only thread; signed-in accounts comment on it under their profile
name and colour; the owner's right-click menu moderates a row. Commits: this repo `a9252cd`,
`3b3f6d5`, `a6cfe59`, `f9773fd`; `../DeetsSupport` `c30c52a`, `dd1128c`, `5a32a35`,
`1df8c86`. Both repos pushed; worker version `024addde`; both migrations run.

Both questions the plan left open were settled by what the code already said, and both are
written up in support.md: the commenter's **name rides the request** (DeetsAccounts' session
payload is `{u, e, iat}` — no name — and it proves nothing either way), and a comment is a
**widened `replies` row**, not a new table (one thread, one chronology, one hidden flag, and
the intake breaker already counts `replies`).

**Copy pass DONE 2026-09-15** (support.md, "Threads" → "Copy"): 17 strings, zero `[ph]`.
Four of the drafts were his own lines said twice, and were collapsed into the originals.

**Visual pass DONE 2026-09-15** — his, in chat: "looks fine".

**What is left: one live test, parked until he releases.** Real sign-in, a real comment and
real moderation have only ever run against the mock, because the `ds_sess` cookie never
reaches localhost. **He runs it himself in the coming days, if and when he officially
releases the page** — not a task to pick up unasked.

Rerunning the visual pass at http://localhost:8787/deetsmusic/?mock: you are signed in AND
the owner there; **signing out in the page** is the one local way to see what a stranger is
sent (no hidden rows, no comment box). The six public posts seed one case each:

   | Card | What it is for |
   |---|---|
   | A lyrics card | a short thread with one row hidden |
   | Last.fm scrobbling | members, then his answer last |
   | A mini player | the long one: eight rows, a **blocked** account, a name and a comment that wrap |
   | The queue forgets its order | the only public thread with a **reporter** row — the one place "Poster" shows |
   | Library sync stalls | a single comment |
   | HomePod volume jumps | **nothing** — where "No replies yet" shows |

The two private posts still open by code (`#t=`), so both views sit side by side.

**Shipped 2026-09-15, in this order:** both migrations (`pid` backfilled onto 3 posts, the
`replies` columns and `blocked` added), `npx wrangler deploy`, the mint-host smoke (every
`music-api` route 200, `/token` still 403 without the UA), then the site. Verified live:
`GET /posts` carries `pid` and **no `code`**, a hidden post's pid 404s exactly as a
nonsense one does, `/p/<pid>` leaks no `code`/`meta`/`source`, a comment without a cookie
is 401 and without an Origin 403, both `/admin/` routes 403 to a stranger, and a vote by
`pid` round-tripped +1/−1 back to 0.

✅ **The `code` leak is closed.** Every code that sat on a public board between 2026-09-11
and today should still be treated as known.

**Then — the next step for threads, proposed not built:** a **thread's size on its card**.
A board card gives no sign a thread exists, so every click is a gamble. Written up in
[support.md "Next step"](support.md), with the thing that has to change alongside it: none
of the three reply paths drops the board's 60 s edge cache today, which only becomes a bug
once a card carries a count. His call on whether it earns the space.

**2026-09-16 — POLLS: LIVE.** Design (and what the
build added to it): **[support.md "Polls"](support.md)**. Worker routes, the page, the
mock and `migrations/2026-09-15-polls.sql` are all written and check out — the mock's
poll routes pass 29 assertions and every worker SQL statement was run against real
SQLite. Shipped in the documented order on 2026-09-16: the migration on the remote D1 (three
tables, four indexes), then `npx wrangler deploy` (version `42d0c431`), with the site
already pushed. **What has NOT happened is a real poll** — nobody has cast a vote on the
live boards yet, and a signed-in vote can only be tested live, like comments before it. **His visual and copy passes are DONE** (2026-09-15: cards instead of bars, four
in view then a sideways scroll, most votes first, a Vote button so picking is local,
the controls grouped vote / contribute / manage, one control scale — and every
string approved, zero `[ph]`). Both repos are committed and pushed.

The design this was built from:
**[support.md "Polls"](support.md)**. A commenter puts a poll under their comment or
instead of one; people add options and vote; bars animate; a board card shows a thread HAS
one, beside the comment count. A poll hangs off a comment rather than being its own kind of
row, so it inherits the identity, the moderation and the hidden flag threads already
settled — and because a vote carries a uid, **a poll can be an honest ballot where ▲
deliberately is not**. The comment count on a card is still unbuilt; the poll's own flag is, and it
is deliberately a flag and not a tally, which is what keeps votes out of the board cache.
**The five questions it opened are settled and built** (2026-09-15, that doc's "Settled"): anyone may
add an option, counts show before you vote, one-or-several is chosen at creation, and a
poll closes when its thread reaches `fixed` / `wontfix` / `closed` — no cron. Open options
buy a new obligation: a hidden flag per option and an owner-only route to set it, built
with the feature rather than after it.

**2026-09-15 — site UI port: steps 5 and 7 open.** Design: **[ui-direction.md](ui-direction.md)**.
- Step 5, the look schedule: he chose **one shared synchronous `js/prepaint.js`** over the
  inline pre-paint head scripts. Mind the `RETIRED` / `R` map rule in CLAUDE.md.
- Step 7, the arrow-key pass.
- Three `[ph]` strings in the `S` table of `js/controls.js` await his wording: the sun/moon
  labels and the "Animate look changes" hint.

**DeetsMusic page — follow-ons** ([support.md "Open"](support.md)):
- Apple in status: needs his read of the D.7 terms.
- Help before "report".
- Health routes on the other workers (only the mint and this site have one).
- `POST_RL` is shared by posts, replies, votes and closes; split it if the boards get busy.
- The in-app report form, redactor and My reports are DeetsMusic-repo work (its HANDOFF).

---

## Parked and unmerged

Last recorded state, from session memory — **verify against git before acting.**

| Item | State | Doc / where |
|---|---|---|
| **DeetsShips** | Built + worker deployed (private repo). Site branch `DeetsShips` unmerged, last commit 2026-08-01. His copy pass owed (`ships/strings.js` all `[ph]`). Merge is his call. | `docs/ships.md` on the branch |
| **King of the Coop** | Scaffold on branch `King-Of-The-Coop` (2026-07-22). Waiting on his hand-edit of `docs/coop-mechanics.csv` and his answers on the Farmer, techs and objectives. Never invent mechanics. | `docs/coop.md` on the branch; prototype in `../KingOfTheCoop` |
| **`deets-imperium` branch** | Last commit 2026-08-21 (a SOTD refresh). Purpose unrecorded — ask him. | — |
| **Radio seek armor r3** | Unverified since 2026-07-16; his two-browser test is the gate. YouTube Data API key parked (null). | [youtube.md "Sync armor"](youtube.md) |
| **Cities** | Disconnect-rejoin not verified live; robber-UI chat queued. | [cities.md](cities.md) |
| **Poker** | Top-up rebuy not built. | [poker.md](poker.md) |
| **Accounts stats** | Outbox sweep and Elo not built; bot tier isn't on results rows yet (goes with Elo). | [stats.md](stats.md) |
| **Tanks** | Campaign live on master; worker, PvP and stats unbuilt. Doom is design-only. | [tanks.md](tanks.md), [realtime.md](realtime.md) |
| **Mahjong** | Bots draw ~51% of hands (needs real shanten counting). | [bots.md](bots.md) |

---

## Known gotchas

- **Registry writes from a Claude desktop session are not real.** The app is an MSIX
  package, so `HKCU\Software\Classes` writes from its shells land in a private hive
  (DeetsMusic HANDOFF, 2026-09-13). Anything that must reach the real registry runs from
  his own terminal.
- **Two sessions push in parallel.** Fetch and check each repo against origin before
  building, especially the worker repos.
- **The `ds_sess` cookie never reaches localhost.** Owner and signed-in paths are only
  real on deets.solutions; `?mock` fakes them.
- **Mocks don't model disconnects** — rejoin behavior is only testable live.
- **A same-document hash navigation doesn't reload.** Use `location.reload()` when testing
  a page in the browser pane.
- **CSS/JS reach returning visitors up to four hours late** until the zone's Browser Cache
  TTL is "Respect Existing Headers" (found 2026-10-23: that setting, at 4 h, raises
  `_headers`' `max-age=0`). Until then, **bump the `?v=` stamps** on whatever you change:
  the page's own CSS/JS link, and for a token sheet, `chrome.css`'s `@import` AND the
  matching preload in every head (architecture.md, "Token stamps").
- **A URL matching two `_headers` rules gets both rules' headers, joined.** To replace
  one, detach it first with `! Header-Name` (the feeds do).
- **A re-vendor can strip live features.** Check what the deployed workers carry before
  re-vendoring `games/table-do.js` while a games branch sits unmerged.
