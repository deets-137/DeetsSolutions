"""Build the link-preview cards (og:image) for each section of the site.

Link previews (LinkedIn, Slack, iMessage...) read static Open Graph tags and
never run JS, so each card is a real 1200x630 JPEG (LinkedIn's 1.91:1). Every
card is composed the same way, with no words on it:

  1. a blurred, zoomed copy of the section's screenshot fills the canvas,
  2. the same screenshot sits on top as a rounded, shadowed window,
  3. the section's emblem (the DM icon, a game piece) rides the window's
     top-left corner as a tile, where the section has one,
  4. Deets and Happy (sprites vendored from DeetsLife) stand bottom-left,
     with the section's flourish (music notes, sparkles) floating above them.

Screenshots: DeetsMusic's come from assets/deetsmusic/shots/ (the app's own
shots runner); every other section's from scripts/capture-og-shots.js, which
writes them to <tmp>/deets-og-shots/. SOTD is not here: build-sotd-og.py
rebuilds its card nightly from the latest song.

    node scripts/capture-og-shots.js          # refresh the screenshots
    python scripts/build-og-cards.py [name ...]

After rebuilding a card, bump ?v= on its og:image so crawlers refetch.
"""

import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

REPO = Path(__file__).resolve().parent.parent
ASSETS = REPO / "assets"
SPRITES = ASSETS / "sprites"
CAPTURED = Path(tempfile.gettempdir()) / "deets-og-shots"

W, H = 1200, 630
WINDOW_SCALE = 0.86     # the screenshot window, as a fraction of the canvas width
SPRITE_FRACTION = 0.30  # Deets' height as a fraction of the canvas height

# The DM icon's two reds color the notes; the sparkles are two golds.
RED, WINE = (232, 56, 30, 255), (124, 26, 50, 255)
GOLD, PALE = (238, 178, 34, 255), (255, 214, 102, 255)

# Pixel flourishes, 1 = ink. Scaled NEAREST like the sprites.
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
SPARKLE = [
    "0001000",
    "0001000",
    "0010100",
    "1100011",
    "0010100",
    "0001000",
    "0001000",
]
TWINKLE = [
    "010",
    "111",
    "010",
]
FLOURISHES = {
    "notes":    [(NOTE, RED), (BEAMED, WINE), (NOTE, RED)],
    "sparkles": [(SPARKLE, GOLD), (TWINKLE, PALE), (SPARKLE, PALE)],
    None:       [],
}

# name -> screenshot, output card, corner emblem (layers, pixel-art?), flourish
CARDS = {
    "deetsmusic": {
        "shot": ASSETS / "deetsmusic" / "shots" / "max-full-player.lilac-glass.webp",
        "out": ASSETS / "deetsmusic" / "og.jpg",
        "emblem": ([ASSETS / "deetsmusic" / "icon.png"], False),
        "flourish": "notes",
    },
    "home":       {"flourish": "sparkles"},
    "cool-stuff": {"flourish": "sparkles"},
    "resume":     {"flourish": None},
    "movies":     {"flourish": "sparkles"},
    "league":     {"flourish": "sparkles"},
    "radio":      {"flourish": "notes"},
    "cities":     {"emblem": ([SPRITES / "cities" / "die-6.png"], True), "flourish": "sparkles"},
    "mahjong":    {"emblem": ([SPRITES / "mahjong" / "traditional" / "tile-dr.png"], True), "flourish": "sparkles"},
    "poker":      {"emblem": ([SPRITES / "poker" / "card-back.png"], True), "flourish": "sparkles"},
    "tanks":      {"emblem": ([SPRITES / "tanks" / "hull-p1.png", SPRITES / "tanks" / "turret-p1.png"], True), "flourish": "sparkles"},
}


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


def emblem_tile(layers, pixel, size=132):
    # A white tile holding the emblem: an app icon fills it, a game sprite
    # sits inside it at a whole-number NEAREST scale so its pixels stay crisp.
    # Layers stack bottom-up (the tank's hull, then its turret).
    art = Image.open(layers[0]).convert("RGBA")
    for layer in layers[1:]:
        art.alpha_composite(Image.open(layer).convert("RGBA"))
    tile = Image.new("RGBA", (size, size), (255, 255, 255, 255))
    if pixel:
        art = art.crop(art.getbbox())
        k = max(1, int(size * 0.72 // max(art.size)))
        art = art.resize((art.width * k, art.height * k), Image.NEAREST)
        if max(art.size) > size * 0.8:  # big sprites: smooth-fit instead
            f = size * 0.72 / max(art.size)
            art = art.resize((round(art.width * f), round(art.height * f)), Image.LANCZOS)
    else:
        art = art.resize((size, size), Image.LANCZOS)
    tile.alpha_composite(art, ((size - art.width) // 2, (size - art.height) // 2))
    return tile


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


def compose(shot, spec):
    card = backdrop(shot).convert("RGBA")

    # The window, nudged right so the sprites have room bottom-left.
    ww = round(W * WINDOW_SCALE)
    wh = round(shot.height * ww / shot.width)
    window = shot.resize((ww, wh), Image.LANCZOS).convert("RGBA")
    wx, wy = W - ww - 40, (H - wh) // 2
    paste_with_shadow(card, window, (wx, wy), radius=18)

    if spec.get("emblem"):
        tile = emblem_tile(*spec["emblem"])
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
    card.alpha_composite(happy, (dx + deets.width + gap, baseline - happy.height))

    # The flourish drifting up from them.
    n = scale
    top = baseline - deets.height
    spots = [
        (dx + deets.width - 2 * n, top - 12 * n),
        (dx + deets.width + 6 * n, top - 22 * n),
        (dx + 2 * n, top - 26 * n),
    ]
    for (rows, color), pos in zip(FLOURISHES[spec.get("flourish")], spots):
        card.alpha_composite(pixel_art(rows, n, color), pos)

    return card.convert("RGB")


def build(name):
    spec = CARDS[name]
    shot_path = spec.get("shot") or CAPTURED / f"{name}.png"
    out = spec.get("out") or ASSETS / "og" / f"{name}.jpg"
    if not shot_path.exists():
        raise SystemExit(f"{name}: no screenshot at {shot_path} (run scripts/capture-og-shots.js)")
    shot = Image.open(shot_path).convert("RGB")
    out.parent.mkdir(parents=True, exist_ok=True)
    compose(shot, spec).save(out, "JPEG", quality=90, optimize=True)
    print(f"wrote {out.relative_to(REPO)} ({out.stat().st_size // 1024} KB)")


def main():
    names = sys.argv[1:] or list(CARDS)
    for name in names:
        if name not in CARDS:
            raise SystemExit(f"unknown card: {name} (have: {', '.join(CARDS)})")
        build(name)


if __name__ == "__main__":
    main()
