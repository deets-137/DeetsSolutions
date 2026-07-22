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
- **Resource glyphs** — **LIVE swap point**: `res-{wood,brick,wheat,sheep,
  ore}.png` here render automatically (same probe-once idiom as the robber):
  inline at text height inside every resource card's count/label (hand, deck
  rail, discard picker, monopoly/plenty pickers — a card never changes size,
  art or no art), as one 20×20 icon floating between a producing hex's
  number token and its top point, and as a 12×12 flag on a small backing
  disc off-map of each 2:1 port's dot (3:1 ports stay bare). **Starter files are committed**: 24×24
  white geometric glyphs (tree / bricks / wheat sheaf / sheep / ore diamond)
  for Aditya to pixel-edit in place — reshape them, keep the filenames.
- **Terrain hex art** — **LIVE swap point**: `hex-{wood,brick,wheat,sheep,
  ore,desert}.png` here replace that terrain's flat polygon fill (painted
  under a transparent polygon that keeps the click/hover/stroke surface).
  **Draw full-bleed: fill the whole canvas, edge to edge.** The board clips
  the image with the VECTOR hexagon, so the silhouette is always crisp —
  the PNG never draws its own edges (a hexagon-shaped PNG would show
  stair-stepped diagonals at board scale). Any canvas size works
  (`preserveAspectRatio: none` stretches it onto the hex). **Starter files
  are committed**: 52×60 solid color rectangles, to pixel-edit in place.
- **Dice** — **LIVE swap point**: `die-{1,2,3,4,5,6}.png` here replace each
  rolled die face in the dice tile (the `–` shown before the first roll stays
  a numeral — there is no face for it). Same probe-once idiom: `cities.js`
  probes all six once at load and swaps `die-N.png` in for the numeral the
  moment it exists. Each PNG is the **whole face** — it fills the 2.6rem die
  box edge to edge (the box's rounded corners clip it), so draw the face art,
  not just the pips (`image-rendering: pixelated`; the box drops its cream
  backing when a face loads). **Starter files are committed**: 24×24 cream
  faces (`--ctoken-bg`) with dark pips (`--ctoken-ink`) in the standard 1–6
  layout, to pixel-edit in place — reshape them, keep the filenames.
- **Robber** — **LIVE swap point**: `robber.png` here replaces the
  placeholder circle automatically — `cities.js` probes the path once at
  load and renders it into a 28×28 SVG box at the robber hex
  (`image-rendering: pixelated`, so any small pixel grid scales crisp;
  non-square images letterbox, preserving aspect). A **starter file is
  committed**: a 16×24 solid `#1a1a1a` vertical rectangle for Aditya to
  pixel-edit directly — reshape it, keep the filename. If the file is
  ever deleted, the circle returns as the fallback.

Stable filenames to target when the art is ready:

```
robber.png                    ← live: starter 16×24 rect, edit in place
die-{1,2,3,4,5,6}.png         ← live: 24×24 cream+pip face starters
res-{wood,brick,wheat,sheep,ore}.png   ← live: 24×24 white glyph starters
hex-{wood,brick,wheat,sheep,ore,desert}.png ← live: 52×60 colored hex starters
settlement-{red,blue,green,orange,purple,teal}.svg   (not wired yet)
city-{red,blue,green,orange,purple,teal}.svg         (not wired yet)
```
