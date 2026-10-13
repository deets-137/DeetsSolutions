"""Build assets/deetsmusic/og.jpg - the link-preview card for /deetsmusic/.

The DeetsMusic sibling of build-sotd-og.py. Link previews (LinkedIn, Slack,
iMessage...) read static Open Graph tags and never run JS, so the card is a
real file. It is composed from the page's own art, with no words on it:

  1. a blurred, zoomed copy of a screenshot from assets/deetsmusic/shots/ fills
     the 1200x630 canvas (LinkedIn's 1.91:1),
  2. the same screenshot sits on top as a rounded, shadowed window,
  3. the DM icon rides the top-left corner as a tile,
  4. Deets and Happy (sprites vendored from DeetsLife) stand bottom-left,
     with a few pixel music notes floating above them.

Not nightly: the inputs only change when the shots are rerun. After running
it, bump ?v= on og:image in deetsmusic/index.html and deetsmusic/demo/index.html
so crawlers refetch.

    python scripts/build-deetsmusic-og.py [shot-name]

shot-name defaults to max-full-player.lilac-glass (the light default look).
"""

import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

REPO = Path(__file__).resolve().parent.parent
ASSETS = REPO / "assets"
SHOTS = ASSETS / "deetsmusic" / "shots"
ICON = ASSETS / "deetsmusic" / "icon.png"
SPRITES = ASSETS / "sprites"
OUT = ASSETS / "deetsmusic" / "og.jpg"

W, H = 1200, 630
WINDOW_SCALE = 0.86     # the screenshot window, as a fraction of the canvas width
SPRITE_FRACTION = 0.30  # Deets' height as a fraction of the canvas height

# A pixel eighth note and a beamed pair, 1 = ink. Scaled NEAREST like the sprites.
NOTE = [
    "0011100",
    "0010110",
    "0010011",
    "0010001",
    "0010000",
    "0010000",
    "1110000",
    "1110000",
]
BEAMED = [
    "011111111",
    "011111111",
    "010000001",
    "010000001",
    "010000001",
    "010000001",
    "110000111",
    "110000111",
]


def rounded_mask(size, radius):
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius, fill=255)
    return mask


def backdrop(shot):
    # Cover-fit the shot, then blur it into a wash of the look's own colors.
    scale = max(W / shot.width, H / shot.height) * 1.15
    big = shot.resize((round(shot.width * scale), round(shot.height * scale)), Image.LANCZOS)
    left, top = (big.width - W) // 2, (big.height - H) // 2
    return big.crop((left, top, left + W, top + H)).filter(ImageFilter.GaussianBlur(28))


def paste_with_shadow(card, img, pos, radius, blur=18, offset=(0, 10), alpha=110):
    mask = rounded_mask(img.size, radius)
    shadow = Image.new("RGBA", card.size, (0, 0, 0, 0))
    silhouette = Image.new("RGBA", img.size, (20, 10, 40, alpha))
    shadow.paste(silhouette, (pos[0] + offset[0], pos[1] + offset[1]), mask)
    card.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(blur)))
    card.paste(img, pos, mask)


def load_sprite(name, pose):
    img = Image.open(SPRITES / name / f"{pose}.png").convert("RGBA")
    return img.crop(img.getbbox())  # trim transparent padding


def pixel_art(rows, scale, color):
    img = Image.new("RGBA", (len(rows[0]), len(rows)), (0, 0, 0, 0))
    for y, row in enumerate(rows):
        for x, bit in enumerate(row):
            if bit == "1":
                img.putpixel((x, y), color)
    return img.resize((img.width * scale, img.height * scale), Image.NEAREST)


def compose(shot):
    card = backdrop(shot).convert("RGBA")

    # The app window, nudged right so the sprites have room bottom-left.
    ww = round(W * WINDOW_SCALE)
    wh = round(shot.height * ww / shot.width)
    window = shot.resize((ww, wh), Image.LANCZOS).convert("RGBA")
    wx, wy = W - ww - 40, (H - wh) // 2
    paste_with_shadow(card, window, (wx, wy), radius=18)

    # The DM icon as a tile over the window's top-left corner.
    icon = Image.open(ICON).convert("RGBA").resize((132, 132), Image.LANCZOS)
    tile = Image.new("RGBA", icon.size, (255, 255, 255, 255))  # the icon's own white field
    tile.alpha_composite(icon)
    paste_with_shadow(card, tile, (wx - 52, wy - 30), radius=26, blur=12, offset=(0, 6))

    # Deets standing, Happy sitting beside Deets, on the canvas floor.
    deets = load_sprite("deets", "idle_down")
    happy = load_sprite("happy", "sit_side")
    scale = max(1, round(H * SPRITE_FRACTION / deets.height))

    def up(img):
        return img.resize((img.width * scale, img.height * scale), Image.NEAREST)

    deets, happy = up(deets), up(happy)  # sit_side faces left, toward Deets
    margin, gap = 4 * scale, 1 * scale
    baseline = H - 3 * scale
    dx = margin
    card.alpha_composite(deets, (dx, baseline - deets.height))
    hx = dx + deets.width + gap
    card.alpha_composite(happy, (hx, baseline - happy.height))

    # Notes drifting up from them, in the icon's two reds.
    n = scale
    notes = [
        (NOTE, (232, 56, 30, 255), (dx + deets.width - 2 * n, baseline - deets.height - 12 * n)),
        (BEAMED, (124, 26, 50, 255), (dx + deets.width + 6 * n, baseline - deets.height - 22 * n)),
        (NOTE, (232, 56, 30, 255), (dx + 2 * n, baseline - deets.height - 26 * n)),
    ]
    for rows, color, pos in notes:
        card.alpha_composite(pixel_art(rows, n, color), pos)

    return card.convert("RGB")


def main():
    name = sys.argv[1] if len(sys.argv) > 1 else "max-full-player.lilac-glass"
    shot = Image.open(SHOTS / f"{name}.webp").convert("RGB")
    card = compose(shot)
    card.save(OUT, "JPEG", quality=90, optimize=True)
    print(f"wrote {OUT} ({W}x{H}, {OUT.stat().st_size // 1024} KB) from {name}")


if __name__ == "__main__":
    main()
