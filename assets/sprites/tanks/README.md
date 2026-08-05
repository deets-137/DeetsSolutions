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
