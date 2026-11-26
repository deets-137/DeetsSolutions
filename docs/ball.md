---
status: built
sources: [ball/index.html, ball/ball.js, ball/strings.js, ball/snapshot.json, ball/draft/index.html, ball/draft/room/index.html, ball/draft-common.js, ball/draft-host.js, ball/draft-gm.js, _redirects]
updated: 2026-11-25
---
# DeetsBall pages (`/ball/`) — a demo

> **These pages are a demo, not the product.** DeetsBall (a free fantasy NBA app, sibling repo
> `../DeetsBall`) has no real backend yet. The owner, 2026-11-25: "this is for a quick and
> dirty demo, we can break rules for speed here for the prototype". The product's decisions
> and open items live in DeetsBall's `docs/DESIGN.md`. The draft demo's worker and its rules
> are DeetsBall's `docs/features/draft-demo.md`.

Both pages carry `noindex`, and neither is in the sitemap: DeetsBall's D20 says the demo is
open to anyone with the link, not advertised. The nav does list it (a **DeetsBall** group,
after DeetsMusic, with one item: Demo), at his request.

**Copy.** `ball/strings.js` holds every string, with no `[ph]` (his call, 2026-11-25).

## 1. `/ball/` — a team's players
- **Data:** `ball/snapshot.json`, a byte-for-byte copy of DeetsBall's
  `snapshots/deetsball-dev-<date>.json` (its D1 tables `Core_Teams` and `Core_Player_Bios`).
  Never hand-edit it: export a new snapshot in DeetsBall and copy it over. The page never
  talks to D1. A browser cannot reach D1 without an API token in the page, so the owner chose
  the snapshot.
- **One panel:** a full-width Team control (a fixed "Team" label, then a pill that opens the 30
  teams; only the pill hovers and opens), over that team's players, name and positions. The
  last team picked is remembered (`deets-ball-team`).
- **Draft** in the page bar leads to `/ball/draft/`.

## 2. `/ball/draft/` — the draft demo
The Shotgun draft for 4 teams: the owner and 3 friends, or bots. The worker is
`https://ball-api.deets.solutions` (DeetsBall's `worker/`). On localhost, `?api=<url>` points
the pages at a local worker (`npm run worker:dev` in DeetsBall), and the page remembers it in
localStorage (`deets-ball-api`).

- **The host screen, `/ball/draft/`** (`draft-host.js`), for a laptop or a TV. With no hash it
  lists the open rooms and has **New draft**. `#CODE` shows that room's board: the join
  address, then the latest round's 4 ballots, then one column per team (status, roster out of
  15), then every round. The browser that made the room keeps its host token
  (`deets-ball-host-<code>`) and gets the buttons: Add bot, Remove, Start draft. Anyone else
  can watch.
- **The reveal.** When a round closes while the board is open, its 4 ballots show with no
  results, then one rank at a time each vote turns: green won, red tie, gray when it no longer
  mattered (the player went at a higher rank, or the roster was full). A player joins his
  roster when his rank turns. Green and red are `--status-ok` / `--status-fail`, the same on
  every theme. None of this with reduced motion.
- **The GM page, `/ball/draft/<code>`** (`draft-gm.js`), for a phone. `_redirects` serves every
  code from `ball/draft/room/` (a rewrite), so its asset paths are absolute. A GM types a team
  name to take a seat (`deets-ball-gm-<code>` keeps it). The ballot (5 ranks, ↑ ↓ ✕, a search
  that folds accents) sits beside the roster from 48rem up, above it on a phone. The ballot in
  progress is kept per room and round (`deets-ball-picks-<code>-<round>`). Moving a slot
  slides it (the pill motion).
- **A room closes an hour after it was made** (the worker's alarm). Both pages then say so and
  stop reconnecting.
- `draft-common.js` is what both share: the API host, the socket with reconnect, the player
  lookup.

## 3. Checks
- The worker's rules: `npm run worker:check` in DeetsBall.
- A whole draft, by hand: DeetsBall's `docs/features/draft-demo.md` §3.
