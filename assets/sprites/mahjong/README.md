# DeetsMahjong sprites

Hand-drawn tile art for the mahjong tab (docs/mahjong.md, "Art").
Two deck styles ship, one folder each — the host picks the table's deck
in the lobby settings (`settings.deck`, synced to everyone):

| folder | deck |
| --- | --- |
| `numeral/` | big number + suit glyph (the CSS placeholder look) |
| `traditional/` | drawn pips, bamboo sticks, character tiles |

`mahjong/mahjong.js` probes every file of BOTH folders ONCE at page load
and swaps art in over the glyph placeholder the moment a file exists —
draw over these templates one at a time and only that tile changes.
Deleting a file falls back to the CSS glyph placeholder for that face.

The 43 PNGs per folder are **generated templates** from
`scripts/build-mahjong-tiles.py` (re-running it RESETS both folders —
don't once hand art has landed), meant to be drawn over in LibreSprite.

## Naming scheme (exact, all lowercase, same in both folders)

| file | tile |
| --- | --- |
| `tile-m1.png` … `tile-m9.png` | Characters (萬) 1–9 |
| `tile-p1.png` … `tile-p9.png` | Dots (筒) 1–9 |
| `tile-s1.png` … `tile-s9.png` | Bamboo (條) 1–9 |
| `tile-we.png` `tile-ws.png` `tile-ww.png` `tile-wn.png` | Winds 東 南 西 北 |
| `tile-dr.png` `tile-dg.png` `tile-dw.png` | Dragons 中 發 白 (white = blank frame) |
| `tile-f1.png` … `tile-f4.png` | Flowers 花 1–4 (seat-numbered E=1 … N=4) |
| `tile-g1.png` … `tile-g4.png` | Seasons 季 1–4 (seat-numbered E=1 … N=4) |
| `back.png` | the face-down tile back (wall, opponents' hands, concealed kongs) |

## Canvas

Templates are **256 × 352 px** — 4× the 64 × 88 grid, matching the board
tile's 1.25 × 1.7 rem ratio. The CSS scales with `object-fit: contain`
and plain smooth filtering (no `image-rendering: pixelated` — at
fractional rem sizes nearest-neighbor made identical tiles shimmer), so
ship at 4× for crispness: draw at 64 × 88 in LibreSprite if you like,
then export at 400% (Export File → Resize). Draw the WHOLE tile — face,
border, and bottom edge — the image fully replaces the CSS box's
styling. Sideways tiles (walls, side players' racks) reuse the same
portrait art; the CSS rotates it.

Suit ink colors, if you want to stay on palette (`--mj*` in main.css):
characters `#b3372e` · dots `#2b5fa3` · bamboo `#2e7d43` · winds
`#23303f` · red dragon `#c0271f` · green `#1f7a3d` · white `#8a8f98` ·
flowers/seasons `#c2703f` · face ivory `#f6efdc` · back green `#2e6e52`.
