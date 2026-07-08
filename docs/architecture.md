# Architecture

Technical companion to the [README](../README.md). The README says what the
site is; this file says how it works. No build step, no framework, no
dependencies — every page is plain HTML that loads `styles/main.css`,
`js/controls.js`, and (for the journal pages) one page-local script.

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

`js/controls.js` renders the ◑ settings menu, persists both choices in
`localStorage` (`deets-theme` / `deets-skin`), and injects two inert
decorative SVG layers that individual skins opt into via a display token:
the **storm** (CyberStorm's lightning bolts) and the **ocean** (Ocean's
three rolling wave trains — seamless sine-period `<pattern>` tiles, each an
opaque fill under a hairline crest so nearer swells occlude farther ones).
In both cases the geometry lives in `controls.js`, the ink is a theme role,
and the motion is skin tokens. Each page also sets the saved attributes
inline in `<head>`, before CSS loads, so there's no flash of the defaults.

## The three tabs

### SOTD (`sotd/`)

A Song-of-the-Day journal scraped from a Discord channel by
[DeetsOTD](../../DeetsOTD) (separate repo), whose `scan.py --web` exports
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

### Cool Stuff I Did (`cool-stuff/`)

The project portfolio. **No data pipeline** — unlike the journal tabs, the
cards are hand-written `<article class="project">` blocks directly in
`cool-stuff/index.html`, grouped under `cool__section` headings. To add a
project, copy an existing card block and edit it. Styles are the
`.cool__*` / `.project__*` sections at the bottom of `main.css`.

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
(`facetGroup`, with optional sift box), the AND/OR combine footer, and the
search box. Opening one closes another; Escape closes and refocuses;
outside-click closes. State persists per page in `localStorage`.

**Deliberate duplication:** this kit is copy-pasted between `sotd.js` and
`movies.js` rather than extracted into a shared module, keeping each page
self-contained (one HTML file + one JS file + one JSON). The cost: a fix to
the toolbar machinery in one file must be mirrored in the other. Both file
headers carry this warning.

## Local dev & deploy

- `.claude/launch.json` defines `deets-site` (port 8787) — or any static
  server from the repo root works: `python -m http.server 8787`.
- Hosted on Cloudflare Pages; push to the connected branch and it deploys.
  The generated JSONs are committed, so a data refresh is: regenerate,
  commit, push. `scripts/healthcheck.sh` sanity-checks DNS/hosting.
- Posters are hotlinked from TMDB's CDN — the repo stores only URLs
  (~120 KB of JSON), nowhere near Cloudflare's 25 MB per-file cap.
