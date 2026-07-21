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
- **Robber** — the `.cities-robber` circle in `renderBoard()`.

Stable filenames to target when the art is ready (nothing references them yet):

```
settlement-{red,blue,green,orange,purple,teal}.svg
city-{red,blue,green,orange,purple,teal}.svg
robber.svg
hex-{wood,brick,wheat,sheep,ore,desert}.svg
```
