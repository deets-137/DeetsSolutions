---
status: sop
sources: [scripts/dev.js, scripts/dev-driver/core.js, scripts/dev-driver/mock.js, scripts/dev-driver/clock.js, scripts/dev-driver/games/mahjong.js, scripts/dev-driver-server.js, scripts/dev-headless.js, scripts/lib/cdp.js, scripts/lib/dev-client.js, scripts/dev-run.js, scripts/copy-edit.js, games/table-mock.js]
updated: 2026-10-27
---
# Tooling and debugging

What exists for running, driving, checking and debugging the site locally.
Started 2026-10-25 with the dev driver. Deploy, caching and `_headers` stay
in [architecture.md](architecture.md), "Local dev & deploy".

## 1. The dev server — `scripts/dev.js`

`npm run dev`, or `.claude/launch.json` → `deets-site`. It runs `wrangler pages
dev .` behind a thin Node proxy. All three ports are probed free at launch,
because several Deets* apps often run at once:

| Port | What |
| --- | --- |
| first free from 8787 (or `node scripts/dev.js 8800`) | the proxy — open this one |
| next free | wrangler itself |
| next free | the dev driver's side channel (§3) |

The startup line names all three:
`deets-site → http://localhost:8787  (wrangler on 8788, dev driver on 8789)`.
A worktree has no `node_modules` of its own. Link the main checkout's copy
(`cmd /c mklink /J node_modules ..\..\..\node_modules`), then remove that
link with `rmdir`, never `rm -rf`.

What the proxy changes **locally only** (none of it reaches Pages):

- It injects `/__copy/edit.js` (the copy editor, §2) and `/__dev/driver.js`
  (§3) before `</body>` on every HTML page.
- It sends JS and CSS as `cache-control: no-store`, without an ETag, so a
  reload always runs the file on disk. Before this, a cached `mahjong.js`
  silently ran stale code. `_headers` is untouched.
- It widens the HTML's CSP: the driver's port is added to `connect-src`, and
  `'unsafe-eval'` to `script-src` (for the driver's `eval`). So a local run
  can't catch an `eval` CSP violation; prod still would.

## 2. Copy editor — `scripts/copy-edit.js`

An "Edit copy" pill (bottom left, or Alt+E) for Aditya to type his own copy
in place. Full behavior: [architecture.md](architecture.md), "Local dev &
deploy". It is not a way around the Copy rule for Claude.

## 3. Dev driver — drive a real tab with curl

`scripts/dev-driver/` (page) + `scripts/dev-driver-server.js` (server).
Each page holds an EventSource to the side port. A curl to `/__dev/<cmd>` on
the main port goes to one tab, and the tab's answer is the HTTP response
(JSON, `{ ok, tab, result | error }`). Both ports bind 127.0.0.1 and check
Host/Origin.

Why it exists (2026-10-25): driving the mock through the Chrome tool's
JavaScript call meant re-pasting a harness after every reload. Gate and
Add Bot clicks were flaky, and any wait past about 45 s killed the call.

**Drive a headless tab first** (§3a). A tab in your own Chrome counts as
hidden whenever its window is covered, and a hidden tab runs no animation
frames and slows its timers to about one a minute. On 2026-10-26 that turned
a flight capture into an hour of stalls; headless, the same capture is one
12 s command.

### The page half is parts

The server joins `scripts/dev-driver/*.js` into one script per request (no
restart for a page-half edit, just a reload), in `PARTS` order inside one
function scope: `core.js` (the tab's id, `info`, helpers, the command table
`C`, the `GAMES` registry), `mock.js` (tables, `pace`, `freeze`, `table`,
`turn`, `idle`), `look.js`, `anims.js`, `clock.js` (the stepped clock,
`fly/log`, `trap`), every `games/*.js`, then `wire.js` (the stream; joined
last, because connecting starts it all). A new command goes in the part it
belongs to.

**What a game knows goes in `games/<ns>.js`**, never in the generic parts:
`GAMES.<ns> = { mock, rolls, waitsOnMe, myTurn, claimWaits, pass, idle }`,
every hook optional (core.js lists what each means). `table`'s `autoroll`,
`turn` and `idle` ask the hooks; a game without them gets a clear error, not
mahjong's rules. Only mahjong has hooks so far.

### Tabs

- Each tab gets an id like `t-4f2a`, kept in `sessionStorage` so it survives
  reloads. A duplicated tab copies that storage, so when it reconnects with a
  live id the server gives it a fresh one.
- The id is prefixed to the title — `[t-4f2a] DeetsMahjong — Deets` — so the
  Chrome tool's tab list can be matched to it.
- `GET /__dev/tabs` lists id, url, title, table code, phase, skin, theme,
  connected, focused, lastSeen and lastActive. A closed tab drops off after 2 min.
- Every command takes `?tab=`. Without it, the server picks the only connected
  tab, else the only focused one, else the most recently focused one by a
  clear margin (>2 s). Otherwise it refuses with **409** and the list. With no
  tab at all it answers **503** at once, so it never hangs.

### Commands

GET with a query, or POST a JSON body (`eval` also takes a bare body as its
JS). Default timeout 30 s, override with `timeout=` (cap 590 s, inside one
Bash call's 600 s).

| Command | Does |
| --- | --- |
| `tabs` | the tab list (no tab needed) |
| `info` | url, title, code, phase, skin, theme, focus |
| `state` | the mock table: phase, mySeat, settings, seats (name, bot, tier), spectators, wallLeft, round, turn, handOver, botStep |
| `table?code=&name=&bots=N&tier=&set=k:v,k:v&spectate=1&start=1&autoroll=1` | joins `code` (random if omitted) the way a person would: the gate's first pill, or the open button where a game has one (mahjong; `name` is saved as the game's name first). `rejoin` takes the same way in. Then it stands up if `spectate`, adds N bots to open seats, applies settings and starts. It sends the same `stand` / `addBot` / `setSettings` / `start` messages the shell's buttons send, so there's no confirm step to click. `autoroll=1` then rolls for your seat (`rolls=`, default the game hook's, each sent only while the hook says the game waits on you for it) and returns once a turn exists |
| `turn?timeout=&pass=1&hold=1` | lets the bots play until **your seat must act and the page has caught up** (no tile still flying), passing any claim window on the way (`pass=0` stops at it: `claim: true`), then parks the bots. The way to "my move, on screen" |
| `idle?timeout=` | until the game hook says the page shows the table as it stands |
| `errors` (`clear=1`) | the page's own uncaught errors and rejections since load, newest last |
| `wait?phase=a,b` · `handOver=1\|0` · `wallBelow=N` · `until=<js>` | polls **from the server** every `every=` ms (default 400) until true, then returns the state; 408 with the last state on timeout. Outlasts any browser-tool call, and survives the tab reloading |
| `eval` | runs JS in the page. An expression or a body with `return`, awaited, and the result made JSON-safe (elements become `<tag#id.class>`) |
| `reload` (`?rejoin=1`) | reloads and returns once the tab is back with the **same id**; `rejoin=1` then takes the gate back into the hash's table (`rejoin`) |
| `rejoin` | clicks the gate's pill (Rejoin / Sit down / Spectate) for the hash's table, and returns once joined |
| `pace?ms=` · `hold=1` · `resume=1` | sets the mock's live bot step and **re-arms a step already waiting** (`repace`), returning the previous one. Before 2026-10-25 a long pace stalled the bots until the old step ran out. `hold=1` parks the bots (1 h step); `resume=1` puts back the pace from before the hold |
| `freeze` / `thaw` | `freeze` holds every message to this tab, so the view stays put while the bots play on; `thaw` delivers the held messages in order. Holding, not dropping, matters: a game waiting on your seat sends nothing more, so dropped messages leave the page stale for good |
| `look?skin=&theme=` | through the settings menu's own chips (look-change cover and all). It waits until the attribute lands and returns `prev` (values plus the stored keys) |
| `look/restore` | puts back the tab's first `prev`: attributes, and localStorage keys set or removed |
| `anims/catch?sel=` | a MutationObserver pauses every `document.getAnimations()` entry whose target matches (or sits inside) `sel` the moment it starts |
| `anims/until?sel=&until=<js>&do=<js>&freeze=1` | catches a moment in one call: arms `anims/catch`, starts `do` (not awaited, so it may loop), polls `until` **in the page** every 10 ms, and the instant it's true freezes the view (if asked) and seeks to 0. Returns `hit`, `frozen`, `caught`, `doError`. The server's `wait` polls every 400 ms, too late for a 1 s transition |
| `anims/list` | the caught animations: name, target, `detached` (a re-render replaced the node, so nobody will ever see it play), currentTime, duration |
| `anims/seek?ms=` (`&list=1`) | every caught animation to that local time, still paused. Returns once a frame has painted; `painted: false` means a background tab, where a screenshot may lag the seek (seen 2026-10-25) |
| `anims/sample?at=0,250,500&sel=&box=&each=1` | seeks to each time and reads **computed style**: how many `sel` matches are hidden (opacity < 0.05) or moving (`translate`/`scale` not at rest), and which scroll boxes inside `box` overflow (a flashing scrollbar). Trust this over a background tab's screenshot |
| `anims/finish` (`?play=1`) | jumps them to the end (or plays them on) and stops watching |
| `clock/freeze` (`animsel=`, `anims=0`) | **the stepped clock.** Swaps `requestAnimationFrame` and `performance.now` for a clock that moves only on `clock/step`, takes over rAF callbacks already queued, and catches every animation (or `animsel` matches) so they follow the same clock. This is what reaches rAF loops like `games/flights.js`' chips, which `anims/*` alone can't |
| `clock/step?ms=&by=10` | advances in `by`-ms slices: runs the rAF queue and sets each caught animation's time every slice, and samples the flight log. An animation stepped past its end **finishes** (its `finished` promise fires, so mahjong's tile flights land), where before 2026-10-26 it sat paused at its end forever. Returns `t`, `painted` and the last log row |
| `clock/thaw` · `clock/now` | real time again (queued frames run, caught animations play on) · where the clock stands |
| `trap?sel=&when=<js>&do=<js>&hold=1&freeze=1` | catches frame 0: the instant a node matching `sel` joins the page (and `when` is true), it freezes the stepped clock, holds the bots (`hold`, default on) and optionally this tab's messages (`freeze=1`). `do` starts the action that causes it. Synchronous on the insertion, unlike `anims/until`'s 10 ms poll |
| `fly/log?sel=` | records each `sel` match's viewport centre, size, transform and opacity on every clock step (clears the old log); without `sel` it returns the log, `stop=1` ends recording. Plot from this rather than from screenshots |
| `rect?sel=&shotw=&pad=` | viewport rects of the matches (first 20). With `shotw` (the Chrome tool's screenshot frame width) they come back converted, ready for a `zoom` region. `info` reports `viewport` and `dpr` |
| `mock/drop?code=` | removes one mock table (its timers, its stored copy) and its code from the recents |
| `endhand?as=` | ends the hand in play on this tab's mock table through the game's `ends` hook (mahjong: `draw`, `win`), via the mock's `rig`. Also two **End hand** pills beside Edit copy on any `?mock` page whose game has the hook |

The dev server's console logs one line per command:
`[dev] t-4f2a anims/seek 14ms ok` (or `FAIL` and the error).

```bash
B=localhost:8787/__dev
curl -s $B/tabs
curl -s "$B/table?tab=t-4f2a&code=drv1&bots=4&spectate=1&start=1"
curl -s "$B/wait?tab=t-4f2a&handOver=1&timeout=300000"
curl -s -X POST "$B/eval?tab=t-4f2a" -d 'document.querySelectorAll(".gt-seat").length'
curl -s "$B/anims/catch?tab=t-4f2a&sel=.mj-tile"
curl -s "$B/anims/seek?tab=t-4f2a&ms=120"
curl -s "$B/anims/finish?tab=t-4f2a"
# catch a transition the moment it lands, view frozen, then read it
curl -s -X POST "$B/anims/until?tab=t-4f2a" -d '{"sel":".mj-bento","freeze":"1",
  "do":"document.querySelector(\".mj-seating__roll\").click()",
  "until":"document.querySelector(\"[data-mj-table]\").dataset.phase===\"play\""}'
curl -s "$B/anims/sample?tab=t-4f2a&at=0,300,600,1000&sel=.mj-bento%20*"
curl -s "$B/thaw?tab=t-4f2a"
# a tile flight frame by frame: seated table to play in one call, trap your
# discard's first frame, step the clock, read the numbers, clean up
curl -s "$B/table?tab=t-4f2a&code=fly1&bots=3&start=1&autoroll=1"
curl -s "$B/fly/log?tab=t-4f2a&sel=.mj-flychip"
curl -s -X POST "$B/trap?tab=t-4f2a" -d '{"sel":".mj-flychip",
  "when":"!!document.querySelector(\".mj-racktile--drawn\")",
  "do":"document.querySelector(\".mj-racktile--drawn\").click()"}'
curl -s "$B/rect?tab=t-4f2a&sel=.mj-board&shotw=1293"   # the zoom region
curl -s "$B/clock/step?tab=t-4f2a&ms=80"                 # screenshot, repeat
curl -s "$B/fly/log?tab=t-4f2a"
curl -s "$B/clock/thaw?tab=t-4f2a"; curl -s "$B/pace?tab=t-4f2a&resume=1"
curl -s "$B/mock/drop?tab=t-4f2a&code=fly1"
```

### Limits

- `table`, `state` and `pace` work on **mock** tables only (`?mock`); the
  live transport has no table object to read. `eval`, `look`, `reload` and
  `anims` work on any page.
- Not built: starting a table at a given phase. At `mockpace=10` a bot-only
  mahjong hand still took about 52 s, so the bot step isn't what sets a
  hand's length.
- Not tested live: a duplicated tab getting a fresh id, and the 409 for
  several equally recent tabs.
- A freeze holds only this tab's view. The mock keeps playing, so the moment
  after a thaw is wherever the bots got to, not the next step. To catch a
  later moment (the deal at the break, say), arm `anims/until` while it is
  still ahead.
- The stepped clock covers rAF, `performance.now` and animations only.
  `setTimeout` and `Date.now` stay real, so the mock's bots and the shell's
  timers keep going: hold them with `pace?hold=1` (`trap` does by default).
  A claim window waiting on your seat also stops the bots. `trap`'s `when`
  must allow for it, or the trap waits out its timeout.
- In your own Chrome, keep the tab visible while driving flights. A hidden
  tab never runs rAF, so a game's frame loop stalls before any freeze (chips
  pile up unmoved), and `painted` comes back `false`. A headless tab (§3a)
  has no such state.
- A page's own time-based work still runs in real time while animations are
  paused (mahjong's wave ends its scroll locks on a timer), so a `sample`
  taken long after the catch can show what a viewer never would.

### 3a. Headless — `scripts/dev-headless.js`, `scripts/lib/cdp.js`

`open` starts one headless Edge (Windows ships it; `DEETS_BROWSER` names
another Chromium) on the first call, with a throwaway profile, and every
headless tab after shares it; it dies with the dev server. A headless tab
runs the same injected driver, so it is an ordinary tab to every command
above (`tabs` marks it `headless: true`), always visible, always focused,
with timers and frames at full speed. Its look is the site default (a fresh
profile has no stored skin), and nothing it does touches your browser's
storage. Not a dependency: it speaks the DevTools protocol through Node's
own `fetch` and `WebSocket` (`scripts/lib/cdp.js`, which
`scripts/capture-og-shots.js` shares).

| Command | Does |
| --- | --- |
| `open?url=/mahjong/?mock&w=1440&h=1000` | a new headless tab at that path on this server; returns its driver `tab` id |
| `shot?tab=&sel=&pad=&out=` | a PNG of the viewport, or of `sel`'s box (`pad` px around it, past the viewport's edge if need be), written to `out` or to `<tmp>/deets-dev-shots/`; returns `file` |
| `slow?tab=&rate=0.1` | every CSS and Web Animation plays at `rate` (DeetsMusic's `shots.mjs --slow`) |
| `perf?tab=&js=&ms=1500&budget=12` | traces the main thread while `js` runs and `ms` more pass: frames drawn, every task over `budget` ms with what filled it (script, style, layout, paint), and the totals (after DeetsMusic's `frame-why.mjs`). Flights run on the compositor, so a slow task is a render to explain |
| `resize?tab=&w=&h=` · `close?tab=` · `headless/quit` | the tab's viewport · close it · close the browser |

These are the server's own commands, so they need a headless tab's id;
`perf`, `slow` and `shot` don't work on a tab in your Chrome.

### 3b. Recipes — `node scripts/dev-run.js <recipe> [k=v …]`

A whole flow in one call, on a fresh headless tab (or `tab=` to drive one
you have), printing one JSON result; progress goes to stderr, files to a
fresh `<tmp>/deets-<recipe>-*` folder. `node scripts/dev-run.js` lists them
with their args. Common args: `port=` (default: the first dev server from
8787 up), `keep=1` (leave the headless tab open). A recipe is
`scripts/recipes/<name>.js` exporting `{ about, args, url, run(ctx) }`, and
`scripts/lib/dev-client.js` is the client it gets (`tab.cmd(name, args)`).

| Recipe | Does | Took (2026-10-26) |
| --- | --- | --- |
| `turn` | a seated mock table played to your turn, with a screenshot | 4–7 s |
| `flight` | your discard and the next draw, frame by frame (`every=40` ms), with the flight log and a contact sheet (`sheet.html`) | 12 s |
| `soak` | real-time play at the live 700 ms bot pace for `secs=`, discarding the drawn tile and a hand tile in turn, passing claims; the board is checked against the table whenever the page is idle. A mismatch counts only if it holds across back-to-back idle samples for `grace=` ms (400): the page is a broadcast (~110 ms) behind the mock, so a one-off miss is the probe racing the wire | `secs` |
| `smooth` | traces the main thread through one turn (`perf`) | 8 s |

## 4. Game mocks — `?mock`

`games/table-mock.js` + each game's `transport-mock.js`, selected by `?mock`.
Tables live in localStorage (`deets-<game>-mock-v1`). Mocks don't model
disconnects ([games.md](games.md)).

| Control | Does |
| --- | --- |
| `?mock&mockpace=N` | divides the 650 ms bot step by N, for that page load |
| `<Game>Transport.phantomStep = ms` | the same, live, from the next bot step on |
| `<Game>Transport.repace(ms)` | sets it and re-arms a bot step already waiting (what the driver's `pace` calls) |
| `<Game>Transport.wipe()` | drops every mock table, including its storage key |
| `<Game>Transport.drop(code)` | drops one table (what the driver's `mock/drop` calls) |
| `<Game>Transport.rig(code, prep)` | dev only: `prep(game)` readies the game in place and returns the actions to apply (an entry may be a function of the game as it then stands, returning an action or null); one broadcast carries their events. What `endhand` calls |
| `<Game>Transport.tables()` | the live table objects |

A reloaded page picks a running table up where it stood: since 2026-10-26
`boot()` re-arms its bots' next step and its deadline (a claim window has none since 2026-10-27),
which were timers and died with the old page. Before, a reloaded table sat
still until someone acted.

**Restore what you change** (a headless tab has its own throwaway storage,
so this is for your own Chrome). A test leaves behind `deets-<game>-mock-v1`,
`-token` and `-recents`, and possibly `deets-skin` / `deets-theme`. Note
those keys before driving, and remove or restore them after (`look/restore`
covers the look).

## 5. Checks you can run

| Command | Checks |
| --- | --- |
| `node scripts/docs-check.js` | the docs: links resolve, front matter is valid, code comments cite real docs (facts, exit 1), plus "stale?" and missing-mention warnings |
| `node <game>/engine.js` | that engine's self-checks (every engine is pure, DOM-free) |
| `node scripts/poker-bot-duel.js` | poker bot tiers against each other ([bots.md](bots.md), "Measurement") |
| `powershell -File scripts/prod-status.ps1` | the journal JSONs: prod vs origin/master vs local HEAD |
| `bash scripts/healthcheck.sh` | DNS/hosting: Cloudflare, not Squarespace |
| `curl -sI localhost:<port>/styles/main.css` | the cache headers. Locally that's `no-store` (§1); prod's come from `_headers` |

The `build-*.py` / `.ps1` scripts generate art and data. Each one names its
owning doc in its first line.

## 5a. Cloudflare from the shell — the `cf` CLI

[`cf`](https://developers.cloudflare.com/cf/) (Homebrew, `/opt/homebrew/bin/cf`,
v0.15.0 as of 2026-10-27) is installed and **logged in to his account** (OAuth,
`~/Library/Preferences/cloudflare/config/default.json`). Claude may use it. `cf auth
whoami` confirms the login.

- **Read and inspect: yes.** For example `cf workers list` (every `deets-*` worker),
  `cf workers deployments list`, `cf workers versions`, `cf workers secrets`, and
  zone analytics. These need no project config. Anything that changes live
  resources (secrets, routes, deletes) is still his call, just like a deploy.
- **Deploy: no, not yet.** `cf deploy` builds through a project-local wrangler and
  wants a `cloudflare.config.ts`. Every worker repo uses `wrangler.jsonc`, and
  Cloudflare's conversion path (`cf migrate`) isn't in v0.15.0. Converting a live
  worker's config is its own decision, not a side effect of a deploy.
- **Deploys stay `npx wrangler deploy`** in the sibling repo, and wrangler keeps its
  **own** login. It does not read `cf`'s, so a "not authenticated" error from it
  means he runs `npx wrangler login` in a terminal (it opens a browser).

## 6. Recipe — debugging a game UI against the mock

0. Reach for `node scripts/dev-run.js` first (§3b): `turn`, `flight`,
   `soak` and `smooth` cover most of what follows, headless, in one call.
   The steps below are for a case they don't.
1. Start the server, and `open` a headless tab (§3a) at
   `/<game>/?mock&mockpace=10` (or use the Chrome tool, and read the tab id
   off its title).
2. Snapshot the keys: `curl -s -X POST "$B/eval?tab=…" -d 'Object.keys(localStorage)'`.
3. `table?…&bots=4&spectate=1&start=1` for a bot-only table, or `bots=3`
   to play seat 0 yourself.
4. `wait` for the moment you care about. For an animation, catch it with
   `anims/until?…&freeze=1` (or `anims/catch` armed first), then
   `anims/seek` through it and screenshot each step, and `anims/sample`
   for the numbers. `thaw` (or `reload?rejoin=1`) to go on.
5. After editing JS/CSS, `reload?rejoin=1`. It's never stale, and the id holds.
6. Restore: `look/restore`, and remove the mock keys from step 2.
