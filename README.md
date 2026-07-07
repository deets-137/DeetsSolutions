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
cool-stuff/           Cool Stuff I Did
styles/               fonts · palette · themes · skin · main
js/controls.js        settings menu + storm layer injection
assets/fonts/         bundled faces (Liberation Serif + skin fonts, SIL OFL)
```

## Run locally

Any static server works, e.g.:

```
python -m http.server 8787
```

Then open http://localhost:8787.

## Deploy

Hosted as a static site (Cloudflare Pages). Push to the connected branch and it
auto-builds; the `Deets.Solutions` domain points at it via DNS.
