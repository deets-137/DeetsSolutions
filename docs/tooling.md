---
status: sop
sources: [scripts/dev.js, scripts/dev-driver.js, scripts/dev-driver-server.js, scripts/copy-edit.js, games/table-mock.js]
updated: 2026-10-25
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

`scripts/dev-driver.js` (page) + `scripts/dev-driver-server.js` (server).
Each page holds an EventSource to the side port. A curl to `/__dev/<cmd>` on
the main port goes to one tab, and the tab's answer is the HTTP response
(JSON, `{ ok, tab, result | error }`). Both ports bind 127.0.0.1 and check
Host/Origin.

Why it exists (2026-10-25): driving the mock through the Chrome tool's
JavaScript call meant re-pasting a harness after every reload. Gate and
Add Bot clicks were flaky, and any wait past about 45 s killed the call.

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
| `table?code=&name=&bots=N&tier=&set=k:v,k:v&spectate=1&start=1` | joins `code` (random if omitted) through the shell's real gate. Then it stands up if `spectate`, adds N bots to open seats, applies settings and starts. It sends the same `stand` / `addBot` / `setSettings` / `start` messages the shell's buttons send, so there's no confirm step to click |
| `wait?phase=a,b` · `handOver=1\|0` · `wallBelow=N` · `until=<js>` | polls **from the server** every `every=` ms (default 400) until true, then returns the state; 408 with the last state on timeout. Outlasts any browser-tool call, and survives the tab reloading |
| `eval` | runs JS in the page. An expression or a body with `return`, awaited, and the result made JSON-safe (elements become `<tag#id.class>`) |
| `reload` | reloads and returns once the tab is back with the **same id** |
| `pace?ms=` | sets the mock's live bot step (`phantomStep`), returning the previous one |
| `look?skin=&theme=` | through the settings menu's own chips (look-change cover and all). It waits until the attribute lands and returns `prev` (values plus the stored keys) |
| `look/restore` | puts back the tab's first `prev`: attributes, and localStorage keys set or removed |
| `anims/catch?sel=` | a MutationObserver pauses every `document.getAnimations()` entry whose target matches (or sits inside) `sel` the moment it starts |
| `anims/list` | the caught animations: name, target, currentTime, duration |
| `anims/seek?ms=` | every caught animation to that local time, still paused |
| `anims/finish` (`?play=1`) | jumps them to the end (or plays them on) and stops watching |

```bash
B=localhost:8787/__dev
curl -s $B/tabs
curl -s "$B/table?tab=t-4f2a&code=drv1&bots=4&spectate=1&start=1"
curl -s "$B/wait?tab=t-4f2a&handOver=1&timeout=300000"
curl -s -X POST "$B/eval?tab=t-4f2a" -d 'document.querySelectorAll(".gt-seat").length'
curl -s "$B/anims/catch?tab=t-4f2a&sel=.mj-tile"
curl -s "$B/anims/seek?tab=t-4f2a&ms=120"
curl -s "$B/anims/finish?tab=t-4f2a"
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

## 4. Game mocks — `?mock`

`games/table-mock.js` + each game's `transport-mock.js`, selected by `?mock`.
Tables live in localStorage (`deets-<game>-mock-v1`). Mocks don't model
disconnects ([games.md](games.md)).

| Control | Does |
| --- | --- |
| `?mock&mockpace=N` | divides the 650 ms bot step by N, for that page load |
| `<Game>Transport.phantomStep = ms` | the same, live (what the driver's `pace` sets) |
| `<Game>Transport.wipe()` | drops every mock table, including its storage key |
| `<Game>Transport.tables()` | the live table objects |

**Restore what you change.** A test leaves behind `deets-<game>-mock-v1`,
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

## 6. Recipe — debugging a game UI against the mock

1. Start the server, and open `http://localhost:<port>/<game>/?mock&mockpace=10`
   in the Chrome tool. Read the tab id off its title.
2. Snapshot the keys: `curl -s -X POST "$B/eval?tab=…" -d 'Object.keys(localStorage)'`.
3. `table?…&bots=4&spectate=1&start=1` for a bot-only table, or `bots=3`
   to play seat 0 yourself.
4. `wait` for the moment you care about. For an animation, call
   `anims/catch?sel=…` first, then `anims/seek` through it and screenshot
   each step.
5. After editing JS/CSS, `reload`. It's never stale, and the id holds.
6. Restore: `look/restore`, and remove the mock keys from step 2.
