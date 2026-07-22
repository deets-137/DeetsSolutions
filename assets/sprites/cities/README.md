# cities sprites — swap points for Aditya's hand-drawn art

Until real sprites land, DeetsCities renders every art surface as a flat
geometric placeholder in the game palette (docs/cities.md, "All art ships as
geometric placeholders"). The swap points are deliberately narrow so a drawn
asset drops in without a code rewrite:

- **Terrain hex fills** — one CSS rule each: `--cterr-{wood,brick,wheat,sheep,
  ore,desert,sea}` in the game-palette carve-out block (`styles/main.css`).
  Swap a fill for a `url(...)` pattern or add a `<pattern>` to the board SVG.
- **Pieces** (settlement / city / road) — one function: `pieceShape()` in
  `cities/cities.js`. It returns the SVG node per piece + seat color; point it
  at an `<image href="assets/sprites/cities/<piece>-<color>.svg">` here.
- **Number tokens / resource cards** — flat circles / rectangles drawn inline
  (`renderBoard`, `renderHand`). Each reads a palette color; replace with a
  sprite when the art exists.
- **Robber** — **LIVE swap point**: drop `robber.png` (pixel art) in this
  directory and it replaces the placeholder circle automatically —
  `cities.js` probes the path once at load and renders it into a 28×28
  SVG box at the robber hex (`image-rendering: pixelated`, so any small
  pixel grid — 14×14, 28×28 — scales crisp). No code change needed; the
  circle stays the fallback while the file is absent.

Stable filenames to target when the art is ready (only `robber.png` is
referenced so far):

```
robber.png                    ← live: auto-detected by cities.js
settlement-{red,blue,green,orange,purple,teal}.svg
city-{red,blue,green,orange,purple,teal}.svg
hex-{wood,brick,wheat,sheep,ore,desert}.svg
```
