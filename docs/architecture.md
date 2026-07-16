# Architecture

Technical companion to the [README](../README.md). The README says what the
site is; this file says how it works. No build step, no framework, no
dependencies — every page is plain HTML that loads `styles/main.css`,
`js/controls.js`, `js/toast.js` (the shared toast host — see
[ui.md](ui.md), "Toasts"), and (for the home hub and the journal pages)
one page-local script.

## Appearance system: theme × skin

Two orthogonal axes, ported from the DeetsMusic app:

- **Theme = color only**, set as `data-theme` on `<html>`: Fairy, Glade,
  Sepia, Moonlight, Hornet, Viper.
- **Skin = everything that isn't color** (type, shape, material, motion),
  set as `data-skin`: Vanilla, Desk, Ocean, Glass, CyberStorm.

Any theme pairs with any skin — 6 × 5 = 30 combos, all of which every
component must survive. That works because tokens cascade in strict tiers:

```
styles/palette.css   Tier 1  raw --paint-* hexes (the only hex codes anywhere)
styles/themes.css    Tier 2  color roles (--canvas, --title, --text, --card,
                             --surface, --border …) per [data-theme]
styles/skin.css      Tier 3  non-color tokens (--font-title, --radius-card,
                             --shadow-card, --dur-fast, --hover-lift …)
                             per [data-skin]
styles/main.css      Tier 4  site rules, referencing ONLY tier 2/3 tokens
```

**Token discipline:** `main.css` never hardcodes a color or a geometry value.
If a rule needs a value that doesn't exist as a token, the fix is a new role
in tier 2/3, not a literal in tier 4. `themes.css` and `skin.css` open with
banners documenting every role.

`js/controls.js` renders the Vibe settings menu (its structure, state, and
known constraints are documented in [ui.md](ui.md)), persists both choices
in `localStorage` (`deets-theme` / `deets-skin`), and injects two inert
decorative SVG layers that individual skins opt into via a display token:
the **storm** (CyberStorm's lightning bolts) and the **ocean** (Ocean's
three rolling wave trains — seamless sine-period `<pattern>` tiles, each an
opaque fill under a hairline crest so nearer swells occlude farther ones).
In both cases the geometry lives in `controls.js`, the ink is a theme role,
and the motion is skin tokens.

Each page resolves both axes inline in `<head>`, before CSS paints, so
there's no flash of the wrong look. A saved choice wins; otherwise the theme
follows the OS light/dark preference (**Fairy** light / **Moonlight** dark)
and the skin defaults to **CyberStorm** on desktop, **Ocean** on mobile
(≤ 41rem). That default logic lives in two places on purpose — the pre-paint head script on every
page and the AXES table in `controls.js` — and they must be kept in sync.

## Sprite walkers

A third decorative layer: Deets and Happy — the pixel-art characters from
the DeetsLife game — strolling across the bottom of the viewport.
`js/walkers.js` (pages opt in by including it; every page but Resume does)
spawns one walker soon after load and then keeps the gap between strolls
under 30 seconds: Deets alone, Happy alone (who may pause for a sit), or
the pair with Happy trailing. On skins with a ride, some strolls become the
pair riding it instead — Ocean's rowboat along the bottom, Glass's hot-air
balloon drifting across at altitude. The character art is the game's own
4-frame side-walk strips in `assets/sprites/`, played by a CSS `steps(4)`
animation at the game's 7 fps (the "Sprite walkers" section of `main.css`);
the travel is a Web Animations API animation so the sit break can pause it.
Walkers are `aria-hidden`, `pointer-events: none`, sit above `.site-main`
but below the header's menus, and are never spawned under
`prefers-reduced-motion`. `DeetsWalkers.spawn("deets" | "happy" | "pair" |
"boat" | "balloon")` in the console summons one on demand.

Art contracts: the character sprites are copied from the game repo
(`../DeetsLife/game/assets/sprites/`) — if the game art is redrawn, re-copy
the strips. The rides in `assets/sprites/vehicles/` are single-frame
composites (both characters drawn aboard), **graybox placeholders awaiting
Aditya's art**: `boat.png` 96×72, `balloon.png` 64×96, side view facing
LEFT (walkers.js mirrors for rightward travel), rendered at 2×. Same
filename + size = drop-in, zero code changes; a new ride is one `SPRITES`
entry in walkers.js plus a `.walker__sprite--<name>` block in main.css.

## Page bar

Every page opens with the same header panel: `.page-bar` — title left,
optional action pills (`.home__cta`) right — with the `.page-meta` dim
line under it (journal counts, the resume's updated-on date, home's
tagline). Home, Resume, and Cool Stuff use `.page-bar` directly; SOTD and
Movies keep their own `.sotd__bar` because it pins (sticky) and carries
the toolbar. `.page-bar` deliberately mirrors `.sotd__bar`'s desktop
material and geometry (menu surface + backdrop, panel radius/border/
shadow, same padding), so the title sits in the same place in the same
dress on every tab — a geometry change to one should visit the other.

## The pages

### Home (`index.html`)

The hub. A `.page-bar` (name + Resume / GitHub / LinkedIn pills), the
tagline, then three `.home-card` links — Cool Stuff leads full-width,
SOTD and Movies split the row (single column under 41rem). `js/home.js`
fetches the two journal JSONs and fills each card's `[data-live]` line
with a count and the latest entry (latest by `date` for songs; latest
watched, `status: "watched"` only, for films); if JS or a fetch fails,
the static fallback copy simply stays. The head carries the site's only
meta description + Open Graph tags — the home page is the recruiter
landing page, so it's the one that must index well.

### SOTD (`sotd/`)

A Song-of-the-Day journal scraped from a Discord channel by
[DeetsOTD](https://github.com/deets-137/DeetsOTD) (separate repo), whose `scan.py --web` exports
`songs.json` — display data only, no private Discord ids — which is committed
here and served flat. `sotd.js` fetches it and builds the card grid.

Controls (all client-side over the loaded array, persisted in
`localStorage` under `deets-sotd-state`):

- **Sort** — added date · release date · artist · uploader · length, with a
  direction toggle. Missing values sink to the bottom in either direction.
- **View** — Full · Small · Line (see "Card anatomy" below).
- **Filter** — a soft "password" gate (locked = only Deets' picks; the word
  unlocks everyone), then Uploader / Genre / Month facets: OR within a facet,
  an AND/OR toggle across facets. Long facets get a sift box.
- **Search** — live substring over title / artist / album / genre / uploader.

### Movies (`movies/`)

A Letterboxd film log in the same shape. `movies.json` is generated from a
Letterboxd data export by `letterboxd_web.py` (also in the DeetsOTD repo) —
see [data.md](data.md) for the pipeline, poster lookup, and refresh commands.

`movies.js` reuses the `.song__*` card classes and the whole toolbar kit, so
the three views and all 30 theme×skin combos come from `main.css` for free;
movie-only styles live in one small `.movie__*` section there. Its state key
is `deets-movies-state`. Differences from SOTD:

- Sorts: watched date · rating · release year · name · rewatch count.
- Facets: rating (half-star values present in the data) · decade · extras
  (liked / rewatched / reviewed) · status (watched / watchlist). No gate.
- The View popover has a **Grouped / Every watch** toggle: one card per film
  (default), or one per diary sitting. Expanded cards are shallow clones of
  the film wearing that watch's own date, rating, review, and a
  "↻ Watch n of m" chip; the whole filter/sort/search pipeline runs on
  whichever list is active. The Rewatched facet matches on the *film's*
  rewatch status so first watches stay visible in Every-watch mode.
- Cards with a TMDB poster (`movie--poster`) show it at 2:3; films TMDB
  doesn't know keep the themed monogram tile, shrunk to a 21:9 banner in
  full view.

### DeetsRadio (`radio/`)

Shared listening rooms — everyone in a room hears the same music on one
synchronized clock. Full design in [radio.md](radio.md) (room protocol,
countdown-synced starts, Apple/Spotify plans); currently **phase 1**: the
whole UI runs against an in-page mock transport (`radio/transport-mock.js`,
real protocol + transport rules, fake catalog, no audio). Three cards —
Search · Queue · History — under a now-playing transport strip; the bar
carries a League-style station combobox. Two page-specific rules: **all
user-facing copy lives in `radio/strings.js`** and is handwritten by Aditya
(`[ph]`-prefixed entries are unshipped placeholders — never write copy
inline), and the blank album cover is the hand-drawn sprite at
`assets/sprites/radio/cover-blank.svg` (keep the path, replace the art).

### Cool Stuff I Did (`cool-stuff/`)

The project portfolio. **No data pipeline** — unlike the journal tabs, the
cards are hand-written `<article class="project">` blocks directly in
`cool-stuff/index.html`, grouped under `cool__section` headings. To add a
project, copy an existing card block and edit it. Styles are the
`.cool__*` / `.project__*` sections at the bottom of `main.css`.

### Resume (`resume/`)

The resume in the site's type system, and the source of truth for the
downloadable PDF (see [data.md](data.md) for the rebuild pipeline).

- **The text is verbatim** from Aditya's master resume — original
  punctuation (plain hyphens, no em dashes), month names, capitalization
  after semicolons. Don't reword it. The one deliberate difference: the
  master's phone + email stay off the site; public contact is the
  LinkedIn pill in the page bar, plus the updated-on `.page-meta` line
  (restamped by the rebuild script).
- The body sits on `.resume__sheet` — the skin's card material — so busy
  canvases (CyberStorm's grid, Glass's aurora) stay behind a plate.
  Vanilla's card is flush with the canvas by design.
- Entry heads mirror the source PDF: a bold company + location
  `.resume__row`, then an italic role + dates row. Rows don't wrap — the
  left text flexes and wraps internally while the right column holds the
  first line — so dates stay right-aligned in every skin, including the
  wide-set CyberStorm faces. One company with several roles nests
  `.resume__role-group`s under a single company row.
- The in-page `media="print"` stylesheet **is** the PDF layout, and is
  deliberately theme-exempt (paper, not a theme surface): it collapses
  every role to black-on-white, pins both fonts to the source's serif,
  centers the uppercase name, swaps the screen meta line for a
  print-only contact line, and shrinks the print root `font-size` — the
  page is sized in rem throughout, so that one knob scales type and
  spacing together until the document lands on one page.

## Card anatomy and the three views

A journal card is built once as one DOM shape (`.song` → `.song__cover` +
`.song__body`, the body holding head / tags / foot / links) and never
re-rendered on view change. The grid's `data-view` attribute switches
layout purely in CSS:

- **full** — vertical card, cover on top (base rules).
- **small** — horizontal card, square cover left, one-line clamps on the
  text (full text via `title` attr tooltips).
- **line** — one row per card; `.song__body`, `.song__tags`, and
  `.song__foot` become `display: contents` so their children flatten into
  fixed-width, ellipsised columns that align down the list. Elements that
  don't fit the column grid are `display: none`d.

## Toolbar / popover kit

The control bar is built from "pills" (`makePill`) that each anchor one
popover: option lists (`optButton`, radio semantics), facet checkbox groups
(`facetGroup`, with optional sift box), worded toggle footers (the AND/OR
combine, Movies' Grouped / Every watch), icon rails (`.tb-pop__rail` — a
vertical hairline column of icon toggles: the Sort popovers' ↑/↓
direction arrows, League's single/split layout squares), and the search
box. Opening one closes another; Escape closes and refocuses;
outside-click closes. State persists per page in `localStorage`. A pill
can also wear its current pick inline ("Queue | Arena ▾",
`.tb-pill__value`).

**Deliberate duplication:** this kit is copy-pasted between `sotd.js`,
`movies.js`, `league.js`, and `radio/radio.js` (pills + popover open/close;
the journals also share the facet/search popovers) rather than extracted
into a shared module, keeping each page self-contained. The cost: a fix to
the toolbar machinery in one file must be mirrored in the others. Each file
header carries this warning.

## Local dev & deploy

- `.claude/launch.json` defines `deets-site` (port 8787) — or any static
  server from the repo root works: `python -m http.server 8787`.
- Hosted on Cloudflare Pages; push to the connected branch and it deploys.
  The generated JSONs are committed, so a data refresh is: regenerate,
  commit, push. `scripts/healthcheck.sh` sanity-checks DNS/hosting.
- After editing resume content, `powershell -File
  scripts/build-resume-pdf.ps1` restamps the updated-on date and reprints
  the downloadable PDF; commit the page and PDF together.
- Posters are hotlinked from TMDB's CDN — the repo stores only URLs
  (~120 KB of JSON), nowhere near Cloudflare's 25 MB per-file cap.
