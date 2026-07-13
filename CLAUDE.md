# CLAUDE.md

Personal static site (deets.solutions). Start with [README.md](README.md);
deep dives in [docs/architecture.md](docs/architecture.md),
[docs/ui.md](docs/ui.md) (the appearance picker + interactive chrome),
[docs/data.md](docs/data.md), [docs/league.md](docs/league.md) (the
League tab + its Cloudflare Worker backend), and
[docs/radio.md](docs/radio.md) (DeetsRadio — shared listening rooms:
protocol, sync design, build phases).

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
  [DeetsOTD](../DeetsOTD) repo — regenerate (see docs/data.md), never
  hand-edit.
- **Resume text is verbatim.** `resume/index.html` mirrors Aditya's
  master resume word-for-word: original punctuation (plain hyphens — no
  em dashes), month names, capitalization. Never reword it; phone and
  email stay off the site. After any resume edit, rebuild the PDF with
  `powershell -File scripts/build-resume-pdf.ps1` and commit both.
- **The page-bar is shared.** Home, Resume, and Cool Stuff open with
  `.page-bar`, which mirrors the journals' `.sotd__bar` panel geometry —
  keep the two visually in sync if either changes.
- **sotd.js, movies.js, league/league.js, and radio/radio.js deliberately
  duplicate the toolbar/popover kit** (pills, facets, state persistence)
  to keep each page self-contained. A fix to that machinery in one file
  must be mirrored in the others.
- **DeetsRadio copy is handwritten.** Every user-facing string on the
  radio page lives in `radio/strings.js`; Aditya writes them. Claude may
  only add `[ph]`-prefixed placeholders there and must never edit an
  entry without the prefix or put copy inline in `radio/radio.js`. The
  blank album cover is his hand-drawn sprite at
  `assets/sprites/radio/cover-blank.svg` — keep the path, never redraw it.
- **The League tab is the one runtime-API page.** Its backend is the
  sibling [DeetsLeague](../DeetsLeague) repo — a Cloudflare Worker
  (`api.deets.solutions`, deployed via `npx wrangler deploy`) that proxies
  Riot behind a 100-req/2-min key. All Riot traffic must flow through the
  worker's `riotFetch` (call ledger + guardrails); never call Riot or
  spend key budget from the browser. Champion/augment art comes from Data
  Dragon / Community Dragon CDNs directly. See [docs/league.md](docs/league.md).
- **Visual verification is the user's.** After UI changes, make sure the
  page loads cleanly (console, DOM counts), then hand off — Aditya prefers
  to test look-and-feel himself in his own browser at http://localhost:8787
  (`.claude/launch.json` → `deets-site`). Don't drive extended click-through
  sessions in the preview unless asked; if you do interact, restore any
  localStorage state you changed (view/sort/filter) before handing off.
