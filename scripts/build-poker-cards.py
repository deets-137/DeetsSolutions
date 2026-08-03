# DeetsPoker card-back template generator (docs/poker.md, "Cards on the felt").
#
# Renders the card back into assets/sprites/poker/:
#   card-back.png   the back of a playing card — ONE image, used everywhere
#
# There is exactly one back, deliberately: a deck's backs are identical, and
# every place poker draws a face-down card is the same card seen from the
# same side — the deck in front of the dealer, the burn pile beside the
# board, a hand being pitched, a hand being mucked. Draw it once and all of
# them change together.
#
# There is no card FACE sprite. Faces are rank + suit glyphs in the page's
# own type (poker.js `cardEl`), so they follow the theme and the skin like
# every other piece of text, and 52 hand-drawn faces is not a thing anyone
# should have to sign up for.
#
# This is a TEMPLATE for Aditya to draw over in LibreSprite — re-running the
# script overwrites it, so don't once hand art has landed.
#
# Canvas is 4x the largest rendered size (the hand panel's --pk-card--big),
# same reasoning as the chips and the mahjong tiles: the page downscales
# with plain smooth filtering, never image-rendering: pixelated.
#
#   python scripts/build-poker-cards.py

import os
from PIL import Image, ImageDraw

SCALE = 4
CARD_W, CARD_H = 52 * SCALE, 72 * SCALE     # 4x the big card (2.1rem x 2.9rem at 1.5x)
ROOT = os.path.join(os.path.dirname(__file__), "..", "assets", "sprites", "poker")

BACK = (122, 53, 53)        # --pkback, the card-back weave
EDGE = (38, 68, 58)         # --pkfelt-edge, the border the CSS placeholder draws
INK = (94, 38, 38)          # the lattice, a shade down from the weave
RIM = (217, 207, 174)       # --pkface-edge, the pale hairline inside the border


def main():
    os.makedirs(ROOT, exist_ok=True)
    im = Image.new("RGBA", (CARD_W, CARD_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    r = 4 * SCALE
    d.rounded_rectangle([0, 0, CARD_W - 1, CARD_H - 1], radius=r, fill=BACK + (255,),
                        outline=EDGE + (255,), width=SCALE)
    # the pale inset rim every card back wears — it is what reads as "back"
    # rather than "red rectangle" at the 20px the felt draws these at
    inset = 4 * SCALE
    d.rounded_rectangle([inset, inset, CARD_W - 1 - inset, CARD_H - 1 - inset],
                        radius=r * 0.6, outline=RIM + (200,), width=max(1, SCALE // 2))
    # a diagonal lattice inside the rim: the cheapest thing that survives
    # being 20px tall and still says "patterned"
    step = 7 * SCALE
    pad = inset + SCALE
    box = (pad, pad, CARD_W - 1 - pad, CARD_H - 1 - pad)
    lat = Image.new("RGBA", (CARD_W, CARD_H), (0, 0, 0, 0))
    ld = ImageDraw.Draw(lat)
    for i in range(-CARD_H // step, (CARD_W + CARD_H) // step + 1):
        x = i * step
        ld.line([x, 0, x + CARD_H, CARD_H], fill=INK + (255,), width=max(1, SCALE // 2))
        ld.line([x, CARD_H, x + CARD_H, 0], fill=INK + (255,), width=max(1, SCALE // 2))
    mask = Image.new("L", (CARD_W, CARD_H), 0)
    ImageDraw.Draw(mask).rounded_rectangle(box, radius=r * 0.5, fill=255)
    im.paste(lat, (0, 0), Image.composite(mask, Image.new("L", mask.size, 0), lat.split()[3]))
    im.save(os.path.join(ROOT, "card-back.png"))
    print("wrote card-back.png (%dx%d) to %s" % (CARD_W, CARD_H, os.path.normpath(ROOT)))


if __name__ == "__main__":
    main()
