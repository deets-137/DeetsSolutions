# Deets.Solutions

Personal website — a static site, no build step. Plain HTML/CSS/JS with a
two-axis appearance system ported from the DeetsMusic app.

## Appearance: two orthogonal axes

- **Theme = color** (`data-theme`): Fairy, Glade, Sepia, Moonlight, Hornet, Viper
- **Skin = shape/type/motion** (`data-skin`): Vanilla, Desk, Ocean, Glass, CyberStorm

Any theme pairs with any skin (6 × 5 = 30 combos). The choice is picked from
the ◑ settings menu in the header and persists per-visitor in `localStorage`.
Tokens cascade in tiers — nothing hardcodes a color or a geometry value:

```
palette.css  →  raw --paint-* hexes
themes.css   →  color roles (--canvas, --title, --text …) per [data-theme]
skin.css     →  non-color tokens (type, shape, material, motion) per [data-skin]
main.css     →  site rules, referencing only the semantic tokens above
```

## Structure

```
index.html            home
sotd/                 Song of the Day
  index.html          page shell (sticky control bar + grid)
  sotd.js             fetches songs.json, builds cards, drives the controls
  songs.json          generated journal data (from DeetsOTD)
cool-stuff/           Cool Stuff I Did — project grid
styles/               fonts · palette · themes · skin · main
js/controls.js        settings menu + storm layer injection
assets/fonts/         bundled faces (Liberation Serif + skin fonts, SIL OFL)
```

## Song of the Day

The `sotd/` page renders a Song-of-the-Day journal scraped from a Discord channel
by [DeetsOTD](../DeetsOTD), a separate tool that exports `songs.json` (display data
only — no private Discord ids) which is committed here and served flat. `sotd.js`
fetches it and builds the card grid with no framework.

A sticky control bar carries four controls, all working client-side over the loaded
array:

- **Sort** — added date · release date · artist · uploader · length, with a
  direction toggle (missing values sink to the bottom).
- **View** — Full cards · Small (horizontal, square cover) · Line (compact list).
- **Filter** — a soft "password" gate (locked shows only Deets' picks; a word
  unlocks everyone), then Uploader / Genre / Month facets (OR within a facet, an
  AND/OR toggle across them). Genre and Month have a sift box.
- **Search** — live substring over title / artist / album / genre / uploader.

View, sort, filter, and the unlock all persist per-visitor in `localStorage`. To
refresh the data, regenerate `songs.json` with DeetsOTD (`scan.py --web`) and commit
it — Cloudflare rebuilds on push.

## Run locally

Any static server works, e.g.:

```
python -m http.server 8787
```

Then open http://localhost:8787.

## Deploy

Hosted as a static site (Cloudflare Pages). Push to the connected branch and it
auto-builds; the `Deets.Solutions` domain points at it via DNS.
