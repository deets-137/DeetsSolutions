# CLAUDE.md

Personal static site (deets.solutions). Start with [README.md](README.md);
deep dives in [docs/architecture.md](docs/architecture.md),
[docs/ui.md](docs/ui.md) (the appearance picker + interactive chrome),
[docs/data.md](docs/data.md), [docs/league.md](docs/league.md) (the
League tab + its Cloudflare Worker backend),
[docs/radio.md](docs/radio.md) (DeetsRadio — shared listening rooms:
protocol, sync design, build phases), and
[docs/cities.md](docs/cities.md) (DeetsCities — the hex board game:
rules engine, wire protocol, bento layout; Phase 1 mock-playable, worker
is Phase 2).

## Working conventions

- **No build step, no frameworks, no dependencies.** Plain HTML/CSS/JS,
  served flat. Don't introduce npm, bundlers, or CDN scripts.
- **Token discipline.** `styles/main.css` references only the semantic
  tokens from `themes.css` (color roles) and `skin.css` (shape/type/motion).
  Never write a hex code or hardcoded geometry into a site rule — if the
  value doesn't exist as a token, add a role to the right tier instead.
  Every component must survive all 30 theme×skin combos.
- **Generated JSONs are read-only.** `sotd/songs.json` and
  `movies/movies.json` come from generators in the sibling
  [DeetsOTD](https://github.com/deets-137/DeetsOTD) repo — regenerate (see docs/data.md), never
  hand-edit.
- **Resume text is verbatim.** `resume/index.html` mirrors Aditya's
  master resume word-for-word: original punctuation (plain hyphens — no
  em dashes), month names, capitalization. Never reword it; phone and
  email stay off the site. After any resume edit, rebuild the PDF with
  `powershell -File scripts/build-resume-pdf.ps1` and commit both.
- **The page-bar is shared.** Home, Resume, and Cool Stuff open with
  `.page-bar`, which mirrors the journals' `.sotd__bar` panel geometry —
  keep the two visually in sync if either changes.
- **sotd.js, movies.js, league/league.js, radio/radio.js, and
  cities/cities.js deliberately duplicate the toolbar/popover kit** (pills,
  facets, state persistence) to keep each page self-contained (cities is
  the fifth copy). A fix to that machinery in one file must be mirrored in
  the others. The toast host (`js/toast.js`) is the
  exception by design: shared chrome like `controls.js`, one copy on
  every page ([docs/ui.md](docs/ui.md), "Toasts").
- **DeetsRadio copy is handwritten.** Every user-facing string on the
  radio page lives in `radio/strings.js`; Aditya writes them. Claude may
  only add `[ph]`-prefixed placeholders there and must never edit an
  entry without the prefix or put copy inline in `radio/radio.js`. The
  blank album cover is his hand-drawn sprite at
  `assets/sprites/radio/cover-blank.svg` — keep the path, never redraw it.
- **DeetsCities copy is `[ph]`-convention too** — every user-facing string
  lives in `cities/strings.js`; Claude adds only `[ph]`-prefixed
  placeholders, never inline copy in `cities.js`. `strings.js` is still
  fully scaffolded — every entry carries `[ph]`, awaiting Aditya's copy
  pass. **The rules engine is contract:** `cities/engine.js` is a pure, DOM-free module and
  `cities/board-data.js` its data; the Phase-2 worker (sibling repo
  `../DeetsCities`, `cities-api.deets.solutions`) will vendor both
  **verbatim**, exactly like the radio protocol — the mock and worker must
  run byte-identical copies. The board + card art is a token carve-out
  (fixed game palette, ignores theme/skin); everything else survives all
  30 combos. Art ships as geometric placeholders until Aditya draws it,
  swappable under `assets/sprites/cities/` ([docs/cities.md](docs/cities.md)).
- **Two tabs have runtime backends, each a sibling Cloudflare Worker repo
  deployed with `npx wrangler deploy`.** League:
  [DeetsLeague](https://github.com/deets-137/DeetsLeague) (`api.deets.solutions`) proxies Riot
  behind a 100-req/2-min key — all Riot traffic must flow through the
  worker's `riotFetch` (call ledger + guardrails); never call Riot or
  spend key budget from the browser; champion/augment art comes from Data
  Dragon / Community Dragon CDNs directly
  ([docs/league.md](docs/league.md)). DeetsRadio:
  [DeetsRadio](https://github.com/deets-137/DeetsRadio) (`radio-api.deets.solutions`) holds a
  Durable Object per listening room; the wire protocol is contract —
  `radio/transport.js`, the in-page mock (`radio/transport-mock.js`,
  selected with `?mock`), and the worker must keep speaking it verbatim
  ([docs/radio.md](docs/radio.md)).
- **Visual verification is the user's.** After UI changes, make sure the
  page loads cleanly (console, DOM counts), then hand off — Aditya prefers
  to test look-and-feel himself in his own browser at http://localhost:8787
  (`.claude/launch.json` → `deets-site`). Don't drive extended click-through
  sessions in the preview unless asked; if you do interact, restore any
  localStorage state you changed (view/sort/filter) before handing off.
