# DeetsPoker chip-template generator (docs/poker.md, "Chips on the table").
#
# Renders the edge-on chip art into assets/sprites/poker/:
#   chip-side-{1..5}.png   one chip seen edge-on: the band
#
# A stack is this sprite tiled, all the way up — there is NO top-of-stack
# face sprite (his call, chat 2026-08-03: a face on the top chip read as odd
# against a stack of bands).
#
# The number is the chip's RANK in the ladder, not its value — the ladder's
# values are derived from the buy-in (docs/poker.md, "The settings cascade")
# but rank 1 is always the smallest chip and always white, so the filenames
# are stable across every table. Ranks 6-8 only exist on a hand-built ladder
# and fall back to the CSS bars.
#
# These are TEMPLATES for Aditya to draw over in LibreSprite — re-running the
# script overwrites the folder, so never run it once hand art has landed
# unless you mean to reset the set.
#
# Canvas is 4x the rendered size, as mahjong learned to do: the page
# downscales with plain smooth filtering (NO image-rendering: pixelated —
# at fractional sizes nearest-neighbor made identical tiles shimmer, which
# is exactly the failure a stack of identical chips shows worst).
#
#   python scripts/build-poker-chips.py

import os
from PIL import Image, ImageDraw

SCALE = 4
SIDE_W, SIDE_H = 24 * SCALE, 6 * SCALE     # 4:1 — one chip, edge-on
ROOT = os.path.join(os.path.dirname(__file__), "..", "assets", "sprites", "poker")

# RANK_HEX from transport-mock.js — rank 1 is the smallest chip on any table
RANKS = [
    ("1", (242, 239, 230)),   # white
    ("2", (217, 65, 65)),     # red
    ("3", (47, 174, 102)),    # green
    ("4", (59, 125, 216)),    # blue
    ("5", (38, 34, 31)),      # black
]


def shade(rgb, f):
    """lighten (f>1) or darken (f<1) a color, clamped"""
    return tuple(max(0, min(255, int(c * f))) for c in rgb)


def spots(draw, box, color, n=3):
    """the edge spots every real chip wears — the thing that makes a stack
    readable as chips rather than as a striped bar"""
    x0, y0, x1, y1 = box
    w = x1 - x0
    sw = w * 0.11
    for i in range(n):
        cx = x0 + w * (0.5 + (i - (n - 1) / 2) * 0.28)
        draw.rectangle([cx - sw / 2, y0, cx + sw / 2, y1], fill=color)


def build_side(rgb):
    im = Image.new("RGBA", (SIDE_W, SIDE_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    r = SIDE_H / 2
    d.rounded_rectangle([0, 0, SIDE_W - 1, SIDE_H - 1], radius=r, fill=rgb + (255,))
    # the spots ride the middle band, so they never touch the rounded ends
    spots(d, (SIDE_W * 0.1, SIDE_H * 0.18, SIDE_W * 0.9, SIDE_H * 0.82), shade(rgb, 0.62) + (255,))
    # a lit top edge and a shadowed bottom one give the band its thickness
    d.rounded_rectangle([0, 0, SIDE_W - 1, SIDE_H - 1], radius=r,
                        outline=shade(rgb, 0.45) + (255,), width=max(1, SCALE // 2))
    d.line([r, max(1, SCALE // 2), SIDE_W - 1 - r, max(1, SCALE // 2)],
           fill=shade(rgb, 1.35) + (150,), width=max(1, SCALE // 2))
    return im


def main():
    os.makedirs(ROOT, exist_ok=True)
    for name, rgb in RANKS:
        build_side(rgb).save(os.path.join(ROOT, "chip-side-%s.png" % name))
    print("wrote %d chip templates to %s" % (len(RANKS), os.path.normpath(ROOT)))


if __name__ == "__main__":
    main()
