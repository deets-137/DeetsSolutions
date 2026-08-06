# DeetsTanks sprites

Empty on purpose. The game probes each stable filename below once at
load (`tanks/art.js`) and falls back to a geometric placeholder on a
miss, so the game is fully playable before a single sprite exists —
art ships by landing a file (docs/tanks.md, "Art").

| File | What |
| --- | --- |
| `hull.png` | one hull drawing, facing up, centred on its rotation pivot |
| `turret.png` | one turret drawing, centred on the pivot where it meets the hull |
| `bullet.png` | a shell |
| `mine.png` | a mine |
| `tile-floor.png` | one floor tile (~display size — do not upscale chunky art) |
| `tile-wall.png` | one indestructible wall tile |
| `tile-block.png` | one destructible block tile |

Source originals live in `art-src/tanks/` (512×512, solid magenta
`#FF00FF` background); `scripts/build-tanks-art.py` (to be written with
the art pass) chroma-keys, trims, recolors per enemy type and
downsamples into here. Enemy variants are RECOLORS of the two tank
drawings, never redraws — use flat fills.

## Per-level terrain art

A level names an art theme with a `theme` header line
(`theme snow`). A theme is just a **folder next to this one**:

```
assets/sprites/tanks/snow/tile-floor.png
                         /tile-floor-1.png   optional variants, 1..3
                         /tile-floor-2.png
                         /tile-floor-3.png
                         /tile-wall.png
                         /tile-block.png
                         /tile-hole.png
```

Everything is optional and probed once, the first time a level using
that theme loads. The fallback chain has three rungs and every rung is
playable on its own:

```
snow/tile-wall.png  ->  .tk[data-tk-theme="snow"] colours  ->  cork
```

So a theme can be **pure colour** (one CSS block in `tanks/tanks.css`,
no files at all), **pure art**, or a mix where only the floor is drawn.
Nothing has to be finished for anything to work, and no code changes
either way.

`tile-floor-1..3.png` give the ground variety: each cell picks one by a
hash of its coordinates, so it is textured but identical on every
client and nothing rides the wire. They are only probed if the base
`tile-floor.png` loaded, so a colour-only theme costs no extra 404s.

**Draw tiles at roughly display size (~64px). Do not upscale chunky
art** — a 16px tile blown up 4x reads at a different apparent
resolution from the downsampled tanks, and the eye catches it instantly
(docs/tanks.md, "Floor art and the one rule").

### Starting a pack

`cork/` is the reference set and it is already here — seven flat tiles
generated from the palette in `tanks/tanks.css`. `snow/`, `dusk/` and
`rust/` ship too, so every theme the CSS defines has a pack. They are
NOT hand-drawn; they are the thing to paint over.

To start another theme, open `tanks/designer.html`, type a name in the
**art** field and press **tile pack**. It copies the cork pack under
that name and downloads `<theme>-tiles.zip`; unzip it *into this
folder* and the `<theme>/` directory lands beside this README, already
wired up. Then edit the PNGs in place.

To regenerate a theme's tiles from its CSS colours instead (useful when
you have just added a colour block and want tiles that already match):

    python scripts/build-tanks-tiles.py <theme>

That **overwrites the folder**, so do not point it at a theme whose
hand art has landed unless you mean to reset the set.

Delete any tile you do not want and it falls back to the theme's CSS
colours, so a half-finished pack is fine.
