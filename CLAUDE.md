# CLAUDE.md

Personal static site (deets.solutions). Start with [README.md](README.md);
deep dives in [docs/architecture.md](docs/architecture.md) and
[docs/data.md](docs/data.md).

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
- **sotd.js and movies.js deliberately duplicate the toolbar/popover kit**
  (pills, facets, state persistence) to keep each page self-contained.
  A fix to that machinery in one file must be mirrored in the other.
- **Visual verification is the user's.** After UI changes, make sure the
  page loads cleanly (console, DOM counts), then hand off — Aditya prefers
  to test look-and-feel himself in his own browser at http://localhost:8787
  (`.claude/launch.json` → `deets-site`). Don't drive extended click-through
  sessions in the preview unless asked; if you do interact, restore any
  localStorage state you changed (view/sort/filter) before handing off.
