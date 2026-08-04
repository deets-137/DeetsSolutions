# CLAUDE.md

Personal static site (deets.solutions). No build step — plain HTML/CSS/JS
served flat.

## Never

- **Never add a dependency.** No npm, bundlers, frameworks, or CDN scripts.
- **Never write a hex code or hardcoded geometry into a site rule.** Use the
  semantic tokens from `themes.css` (color) and `skin.css` (shape/type/motion).
  If the value has no token, add a role to the right tier. Every component
  must survive all 30 theme×skin combos. Game art carve-outs are the only
  exception (`--pk*`, `--mj*`, cities' fixed board palette).
- **Never edit a string that lacks a `[ph]` prefix.** Those are Aditya's
  words. See "Copy" below.
- **Never hand-edit `sotd/songs.json` or `movies/movies.json`.** Generated in
  the sibling [DeetsOTD](https://github.com/deets-137/DeetsOTD) repo — regenerate instead (docs/data.md).
- **Never reword `resume/index.html`.** It mirrors his master resume
  word-for-word, plain hyphens (no em dashes). Phone and email stay off the
  site. After any edit: `powershell -File scripts/build-resume-pdf.ps1`,
  commit both.
- **Never edit a vendored file without re-vendoring.** See "Games" below.

## Docs map

Start at [README.md](README.md). Then:

| Topic | Doc |
| --- | --- |
| Site structure, tokens, chrome | [architecture.md](docs/architecture.md), [ui.md](docs/ui.md), [css-split.md](docs/css-split.md) |
| **Anything game-related — read FIRST** | **[games.md](docs/games.md)** |
| **Designing a NEW game** | **[design-language.md](docs/design-language.md)** — the precedents, decision trees, and questionnaire |
| Per-game | [cities.md](docs/cities.md), [mahjong.md](docs/mahjong.md), [poker.md](docs/poker.md) |
| Bot brains + difficulty tiers | [bots.md](docs/bots.md) |
| Other tabs | [league.md](docs/league.md), [radio.md](docs/radio.md), [data.md](docs/data.md) |
| Accounts + game stats | [accounts.md](docs/accounts.md), [stats.md](docs/stats.md) |

## CSS

Split by audience ([css-split.md](docs/css-split.md)). Put a new rule in the
narrowest file that needs it.

- `styles/chrome.css` — loaded FIRST by every page; carries the token
  `@import`s plus everything shared (frame, header/nav, settings menu,
  `.page-bar`, `.sotd__bar`, the `tb-` toolbar kit, toasts, focus ring,
  `.account-btn`, `.prose`).
- `styles/main.css` — one section per non-game tab. **No imports of its own**
  — never link it without chrome.
- Games never link `main.css`: `chrome.css` → `table.css` → `<game>/<game>.css`.
- `.page-bar` (Home, Resume, Cool Stuff) mirrors the journals' `.sotd__bar`
  geometry — keep the two in sync.

## Duplication: deliberate in journals, forbidden in games

- **Journals each carry their own toolbar/popover kit** — `sotd.js`,
  `movies.js`, `league/league.js`, `radio/radio.js`. That keeps them
  self-contained, so a fix to that machinery in one **must be mirrored in the
  others**.
- **Games share `games/table.js`** and must not start another copy.
- `js/toast.js` is shared chrome like `controls.js` — one copy per page
  ([ui.md](docs/ui.md), "Toasts").

## Games

**Read the "Change radius" table in [games.md](docs/games.md) before editing
anything game-related.** Most mistakes here are correct code in the wrong
file: one level too low and it duplicates into the next game, one too high
and it changes a game nobody asked you to touch. When two games need the same
thing, **promote it, don't copy it** — the turn timer and the `--gseat`
accent were each written twice before being promoted, and a bug rode along in
the duplication.

- **Shared:** `games/table.js` (browser shell), `games/table-do.js` (the
  Durable Object base), `games/transport.js`, `games/colors.js`,
  `styles/table.css`.
- **Vendored VERBATIM** into each worker repo: `table-do.js`, `colors.js`, and
  that game's `engine.js` (+ `cities/board-data.js`). The mock and the worker
  must run byte-identical copies.
- Every `engine.js` is pure and DOM-free; `node <game>/engine.js` runs its
  self-checks.
- Shell-rendered nodes use the `gt-` prefix; a game's CSS must never restyle
  them. Seat colors are the shared `--gseat-0..5` contract, **not** part of a
  game's art carve-out.
- **A bot's brain lives in that game's `engine.js`** — never in a mock, never
  in a worker's `src/index.js`, so the two cannot drift. Difficulty is a
  per-bot **tier** from the engine's `BOT_TIER_LIST`, set by the host on
  `addBot`. Read [bots.md](docs/bots.md) before tuning anything.
- **Mocks do NOT model disconnects** (no grace window, no bot takeover, no
  reconnect), so rejoin behavior can only be tested live.

Per-game invariants worth knowing before you touch them:

- **Poker** (live on `../DeetsPoker`; the mock is `?mock` like every other
  game): money is integer
  cents, and every bet must split into the table's chip ladder (full all-ins
  excepted). Hole cards and the actor's options ride only `you`. No bots in
  live play, ever — the three `rejoin` modes decide what *leaving* costs, not
  who inherits the seat. See [poker.md](docs/poker.md), "Stepping away".
- **Mahjong**: hidden info — hands, the drawn tile, and per-seat claim options
  ride only each connection's `you`. Tile art is per-VIEWER (localStorage,
  never on the wire); templates come from `scripts/build-mahjong-tiles.py`.
- **Cities**: art ships as geometric placeholders under
  `assets/sprites/cities/` until he draws it.

## Copy

Every user-facing string lives in that page's `strings.js` — never inline in
the page's JS. **Claude may only add `[ph]`-prefixed placeholders.** An
un-prefixed entry is Aditya's and is off-limits; section comments mark lines
he dictated in chat.

| Page | State of his pass |
| --- | --- |
| Radio | Done — handwritten throughout |
| Mahjong | Done, but strings added *since* carry `[ph]` and still await him |
| Cities | Underway |
| Poker | Done — two passes (2026-08-03, 2026-08-04); zero `[ph]` left |

The blank album cover (`assets/sprites/radio/cover-blank.svg`) is his
hand-drawn sprite: keep the path, never redraw it.

## Backends

Sibling Cloudflare Worker repos, each deployed with `npx wrangler deploy`.

| Worker | Host | Notes |
| --- | --- | --- |
| [DeetsLeague](https://github.com/deets-137/DeetsLeague) | `api.deets.solutions` | Riot proxy behind a 100-req/2-min key |
| [DeetsRadio](https://github.com/deets-137/DeetsRadio) | `radio-api.deets.solutions` | one DO per listening room |
| DeetsCities | `cities-api.deets.solutions` | |
| DeetsMahjong | `mahjong-api.deets.solutions` | |
| DeetsAccounts | `id.deets.solutions` | private repo; sole owner of the D1 |
| DeetsPoker | `poker-api.deets.solutions` | private repo; **secrets not set yet** (guests only, results in the outbox) |

- **All Riot traffic must flow through the worker's `riotFetch`** (call ledger
  + guardrails). Never call Riot or spend key budget from the browser.
  Champion/augment art comes from Data Dragon / Community Dragon directly.
- Wire protocols are contract: the live transport, the in-page mock, and the
  worker must keep speaking them verbatim.

## Workflow

**Visual verification is Aditya's.** After UI changes, confirm the page loads
cleanly (console, DOM counts), then hand off — he tests look-and-feel himself
at http://localhost:8787 (`.claude/launch.json` → `deets-site`). Don't drive
extended click-through sessions unless asked; if you do interact, restore any
localStorage state you changed (view/sort/filter) first.
