# DeetsMahjong tile-template generator (docs/mahjong.md, "Art").
#
# Renders BOTH placeholder decks into assets/sprites/mahjong/{deck}/:
#   numeral/     big number + suit glyph (the CSS placeholder look)
#   traditional/ drawn pips, bamboo sticks, CJK characters
# 43 PNGs per deck: tile-{id}.png for every face + back.png.
#
# These are TEMPLATES for Aditya to draw over in LibreSprite — re-running
# the script overwrites whatever is in the output folders, so never run it
# once hand art has landed unless you mean to reset a deck.
#
# Canvas is 256x352 (4x the original 64x88 grid). The page downscales with
# plain smooth filtering (no image-rendering: pixelated), so a 4x source
# stays crisp at every tile size including HiDPI. Draw the WHOLE tile —
# face, border, bottom edge — the image fully replaces the CSS box's look.
#
#   python scripts/build-mahjong-tiles.py

import os
from PIL import Image, ImageDraw, ImageFont

W, H = 256, 352
RADIUS = 18
ROOT = os.path.join(os.path.dirname(__file__), "..", "assets", "sprites", "mahjong")

# the fixed mahjong palette carve-out (--mj* in styles/main.css)
FACE = (246, 239, 220, 255)       # --mjface
EDGE = (217, 207, 174, 255)       # --mjface-edge
BACK = (46, 110, 82, 255)         # --mjback
INK_M = (179, 55, 46, 255)        # --mjink-m  characters
INK_P = (43, 95, 163, 255)        # --mjink-p  dots
INK_S = (46, 125, 67, 255)        # --mjink-s  bamboo
INK_WIND = (35, 48, 63, 255)      # --mjink-wind
INK_DR = (192, 39, 31, 255)       # --mjink-dr
INK_DG = (31, 122, 61, 255)       # --mjink-dg
INK_DW = (138, 143, 152, 255)     # --mjink-dw
INK_FLOWER = (194, 112, 63, 255)  # --mjink-flower

def blend(base, top, k):
    """ImageDraw REPLACES alpha instead of compositing, so translucent
    strokes punch holes — pre-blend to opaque colors instead."""
    return tuple(round(b * (1 - k) + t * k) for b, t in zip(base[:3], top[:3])) + (255,)

BLACK, WHITE = (0, 0, 0, 255), (255, 255, 255, 255)
OUTLINE = blend(FACE, BLACK, .35)

FONT_PATH = "C:/Windows/Fonts/msyhbd.ttc"   # Microsoft YaHei Bold (CJK)
def font(px):
    return ImageFont.truetype(FONT_PATH, px)

CJK_NUM = ["一", "二", "三", "四", "五", "六", "七", "八", "九"]

def blank_face():
    """Ivory face with dark outline and the thicker bottom edge."""
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, W - 1, H - 1], RADIUS, fill=EDGE)          # edge shows at the bottom lip
    d.rounded_rectangle([0, 0, W - 1, H - 13], RADIUS, fill=FACE)
    d.rounded_rectangle([0, 0, W - 1, H - 1], RADIUS, outline=OUTLINE, width=4)
    return im, ImageDraw.Draw(im)

def text(d, xy, s, px, ink):
    d.text(xy, s, font=font(px), fill=ink, anchor="mm")

# ── traditional suit art ─────────────────────────────────────────────

# pip layouts as (x, y) in art-box fractions
PIP_POS = {
    1: [(.5, .5)],
    2: [(.5, .27), (.5, .73)],
    3: [(.26, .2), (.5, .5), (.74, .8)],
    4: [(.29, .26), (.71, .26), (.29, .74), (.71, .74)],
    5: [(.26, .22), (.74, .22), (.5, .5), (.26, .78), (.74, .78)],
    6: [(.3, .2), (.7, .2), (.3, .5), (.7, .5), (.3, .8), (.7, .8)],
    7: [(.24, .12), (.5, .18), (.76, .24), (.3, .55), (.7, .55), (.3, .84), (.7, .84)],
    8: [(.3, .14), (.7, .14), (.3, .38), (.7, .38), (.3, .62), (.7, .62), (.3, .86), (.7, .86)],
    9: [(.24, .2), (.5, .2), (.76, .2), (.24, .5), (.5, .5), (.76, .5), (.24, .8), (.5, .8), (.76, .8)],
}
ART = (30, 34, 226, 310)   # art box: x0, y0, x1, y1

def art_xy(fx, fy):
    x0, y0, x1, y1 = ART
    return x0 + fx * (x1 - x0), y0 + fy * (y1 - y0)

def pip(d, cx, cy, r, ink):
    """A dot drawn as a ring + center dot, target-style."""
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=ink, width=max(4, r // 4))
    rr = max(4, r // 3)
    d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr], fill=ink)

def draw_dots(d, n):
    r = {1: 62, 2: 44, 3: 40, 4: 38, 5: 34, 6: 32, 7: 28, 8: 27, 9: 28}[n]
    for fx, fy in PIP_POS[n]:
        cx, cy = art_xy(fx, fy)
        pip(d, cx, cy, r, INK_P)

STICK_ROWS = {   # sticks per row, top to bottom
    1: [1], 2: [1, 1], 3: [1, 2], 4: [2, 2], 5: [2, 1, 2],
    6: [3, 3], 7: [1, 3, 3], 8: [3, 2, 3], 9: [3, 3, 3],
}

def stick(d, cx, cy, sw, sh, ink):
    """One bamboo stick: rounded bar with knot notches."""
    d.rounded_rectangle([cx - sw / 2, cy - sh / 2, cx + sw / 2, cy + sh / 2], sw // 2, fill=ink)
    for fy in (-.22, .22):   # knots
        y = cy + fy * sh
        d.line([cx - sw / 2 + 2, y, cx + sw / 2 - 2, y], fill=FACE, width=5)

def draw_sticks(d, n):
    rows = STICK_ROWS[n]
    if n == 1:                              # the lone big stick (a bird, one day)
        stick(d, *art_xy(.5, .5), 44, 200, INK_S)
        return
    nrows = len(rows)
    sh = {2: 108, 3: 78}[nrows]
    sw = 28 if n < 6 else 24
    for ri, cols in enumerate(rows):
        fy = (ri + .5) / nrows
        for ci in range(cols):
            fx = .5 if cols == 1 else (.28 if cols == 2 else .22) + ci * ((.44 if cols == 2 else .28))
            ink = INK_DR if (n == 5 and cols == 1) else INK_S   # 5 keeps its red center stick
            stick(d, *art_xy(fx, fy), sw, sh, ink)

def dw_frame(d, double):
    """The white dragon: an empty frame; traditional sets double it."""
    d.rounded_rectangle([52, 62, 204, 290], 10, outline=INK_DW, width=10)
    if double:
        d.rounded_rectangle([80, 96, 176, 256], 6, outline=INK_DW, width=6)

def draw_flower_mark(d, kind, n):
    """Traditional flowers/seasons: corner number + a simple drawn motif."""
    text(d, (52, 60), str(n), 64, INK_DR if kind == "f" else INK_DG)
    cx, cy = art_xy(.5, .58)
    if kind == "f":   # five petals around a heart
        for i in range(5):
            from math import cos, sin, pi
            a = -pi / 2 + i * 2 * pi / 5
            px_, py_ = cx + 52 * cos(a), cy + 52 * sin(a)
            d.ellipse([px_ - 30, py_ - 30, px_ + 30, py_ + 30], fill=INK_FLOWER)
        d.ellipse([cx - 24, cy - 24, cx + 24, cy + 24], fill=INK_DR)
    else:             # seasons: a leaf-ish diamond + stem
        d.polygon([(cx, cy - 74), (cx + 52, cy), (cx, cy + 74), (cx - 52, cy)], fill=INK_FLOWER)
        d.line([cx, cy - 74, cx, cy + 74], fill=FACE, width=6)

# ── the two decks ────────────────────────────────────────────────────

def numeral_tile(t):
    im, d = blank_face()
    kind, v = t[0], t[1]
    if kind in "mps":
        ink = {"m": INK_M, "p": INK_P, "s": INK_S}[kind]
        text(d, (W / 2, 118), v, 150, ink)
        text(d, (W / 2, 252), {"m": "萬", "p": "筒", "s": "條"}[kind], 110, ink)
    elif kind == "w":
        text(d, (W / 2, H / 2 - 8), {"e": "東", "s": "南", "w": "西", "n": "北"}[v], 168, INK_WIND)
    elif kind == "d":
        if v == "w": dw_frame(d, double=False)
        else: text(d, (W / 2, H / 2 - 8), {"r": "中", "g": "發"}[v], 168, {"r": INK_DR, "g": INK_DG}[v])
    else:   # flowers f1-4 / seasons g1-4
        text(d, (W / 2, 118), v, 130, INK_FLOWER)
        text(d, (W / 2, 250), {"f": "花", "g": "季"}[kind], 104, INK_FLOWER)
    return im

def traditional_tile(t):
    im, d = blank_face()
    kind, v = t[0], t[1]
    if kind == "p": draw_dots(d, int(v))
    elif kind == "s": draw_sticks(d, int(v))
    elif kind == "m":
        text(d, (W / 2, 106), CJK_NUM[int(v) - 1], 128, INK_WIND)
        text(d, (W / 2, 248), "萬", 124, INK_M)
    elif kind == "w":
        text(d, (W / 2, H / 2 - 8), {"e": "東", "s": "南", "w": "西", "n": "北"}[v], 168, INK_WIND)
    elif kind == "d":
        if v == "w": dw_frame(d, double=True)
        else: text(d, (W / 2, H / 2 - 8), {"r": "中", "g": "發"}[v], 168, {"r": INK_DR, "g": INK_DG}[v])
    else:
        draw_flower_mark(d, kind, int(v))
    return im

def back_tile():
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, W - 1, H - 1], RADIUS, fill=blend(BACK, BLACK, .45))   # dark bottom lip
    d.rounded_rectangle([0, 0, W - 1, H - 13], RADIUS, fill=BACK)
    weave = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    wd = ImageDraw.Draw(weave)
    for x in range(-H, W, 26):                                                        # faint weave
        wd.line([x, 0, x + H, H], fill=blend(BACK, WHITE, .07), width=6)
        wd.line([x + H, 0, x, H], fill=blend(BACK, WHITE, .07), width=6)
    mask = Image.new("L", (W, H), 0)                                                  # clip to the face
    ImageDraw.Draw(mask).rounded_rectangle([8, 8, W - 9, H - 21], RADIUS, fill=255)
    im.paste(weave, (0, 0), Image.composite(weave.getchannel("A"), mask, mask))
    d.rounded_rectangle([14, 14, W - 15, H - 27], 8, outline=blend(BACK, WHITE, .35), width=4)
    d.rounded_rectangle([0, 0, W - 1, H - 1], RADIUS, outline=blend(BACK, BLACK, .4), width=4)
    return im

TILES = ([k + str(n) for k in "mps" for n in range(1, 10)]
         + ["w" + w for w in "eswn"] + ["d" + c for c in "rgw"]
         + [k + str(n) for k in "fg" for n in range(1, 5)])

def main():
    back = back_tile()
    for deck, fn in (("numeral", numeral_tile), ("traditional", traditional_tile)):
        out = os.path.join(ROOT, deck)
        os.makedirs(out, exist_ok=True)
        for t in TILES:
            fn(t).save(os.path.join(out, "tile-" + t + ".png"))
        back.save(os.path.join(out, "back.png"))
        print(deck + ": " + str(len(TILES) + 1) + " PNGs -> " + out)

if __name__ == "__main__":
    main()
