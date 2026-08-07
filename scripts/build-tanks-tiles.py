#!/usr/bin/env python3
"""DeetsTanks terrain-tile generator (docs/tanks.md, "Per-level art").

Renders one theme's terrain tiles into assets/sprites/tanks/<theme>/:

    tile-floor.png      the ground
    tile-floor-1..3     variants, picked per cell by a hash of its position
    tile-wall.png       indestructible wall
    tile-block.png      destructible block
    tile-hole.png       hole - tanks blocked, shells fly over

THE COLOURS ARE NOT WRITTEN HERE. They are read out of tanks/tanks.css,
which is the game's art carve-out and the one place the palette lives
(CLAUDE.md forbids a second copy). `.tk` is cork; every
`.tk[data-tk-theme="x"]` block is a theme, inheriting whatever it does
not override. Add a block there, name it here, done.

These are TEMPLATES for Aditya to draw over. Re-running overwrites the
folder, so never run it against a theme whose art has landed unless you
mean to reset that set — the same rule build-poker-chips.py carries.

The geometry below mirrors render.js's drawFloor / drawWall / drawHole /
drawBlock. That duplication is deliberate and bounded: it is a dozen
rectangles, it is what makes the seed pack match the flat-colour tiles
it replaces, and it runs once per theme rather than per frame. The
designer's "tile pack" button does NOT re-derive it — it copies the
cork pack, so this script is the only place the shapes are authored.

    python scripts/build-tanks-tiles.py            # cork + snow
    python scripts/build-tanks-tiles.py dusk rust  # any named themes
"""
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
CSS = ROOT / "tanks" / "tanks.css"
OUT = ROOT / "assets" / "sprites" / "tanks"
SIZE = 64                      # display size — do NOT upscale chunky art
DEFAULT_THEMES = ["cork", "snow"]


# ── the palette, read from the CSS that owns it ──────────────────────
def parse_css():
    text = CSS.read_text(encoding="utf-8")
    themes = {}

    def grab(selector):
        m = re.search(re.escape(selector) + r"\s*\{(.*?)\}", text, re.S)
        if not m:
            return None
        return dict(re.findall(r"(--tk-[a-z0-9-]+)\s*:\s*([^;]+);", m.group(1)))

    base = grab(".tk")
    if not base:
        sys.exit("FAIL: no .tk block in tanks/tanks.css")
    themes["cork"] = base
    for name in re.findall(r'\.tk\[data-tk-theme="([a-z0-9-]+)"\]', text):
        over = grab('.tk[data-tk-theme="%s"]' % name) or {}
        merged = dict(base)
        merged.update(over)
        themes[name] = merged
    return themes


def rgba(value, fallback=(0, 0, 0, 255)):
    """#rrggbb or rgba(r, g, b, a) -> an 8-bit RGBA tuple."""
    v = value.strip()
    m = re.match(r"^#([0-9a-fA-F]{6})$", v)
    if m:
        n = int(m.group(1), 16)
        return ((n >> 16) & 255, (n >> 8) & 255, n & 255, 255)
    m = re.match(r"^rgba?\(([^)]+)\)$", v)
    if m:
        parts = [p.strip() for p in m.group(1).split(",")]
        r, g, b = (int(float(p)) for p in parts[:3])
        a = int(float(parts[3]) * 255) if len(parts) > 3 else 255
        return (r, g, b, a)
    return fallback


def shade(c, f):
    return (min(255, int(c[0] * f)), min(255, int(c[1] * f)),
            min(255, int(c[2] * f)), c[3])


# ── the tiles (mirrors render.js) ────────────────────────────────────
def new_tile():
    return Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))


def floor_tile(P, base, seam=True):
    im = new_tile()
    d = ImageDraw.Draw(im, "RGBA")
    d.rectangle([0, 0, SIZE - 1, SIZE - 1], fill=base)
    if seam:
        d.rectangle([0, 0, SIZE - 1, SIZE - 1], outline=P["seam"], width=1)
    return im


def wall_tile(P):
    im = new_tile()
    d = ImageDraw.Draw(im, "RGBA")
    d.rectangle([0, 0, SIZE - 1, SIZE - 1], fill=P["wall"])
    band = max(2, int(SIZE * 0.22))
    d.rectangle([1, 1, SIZE - 2, band], fill=P["wallTop"])
    return im


def hole_tile(P):
    im = new_tile()
    d = ImageDraw.Draw(im, "RGBA")
    d.rectangle([0, 0, SIZE - 1, SIZE - 1], fill=P["hole"])
    band = max(2, int(SIZE * 0.16))
    d.rectangle([0, 0, SIZE - 1, band], fill=P["holeRim"])
    return im


def block_tile(P):
    im = floor_tile(P, P["floorA"])          # the 1px floor border shows
    d = ImageDraw.Draw(im, "RGBA")
    d.rectangle([1, 1, SIZE - 2, SIZE - 2], fill=P["block"])
    band = max(2, int(SIZE * 0.2))
    d.rectangle([2, 2, SIZE - 3, 1 + band], fill=P["blockTop"])
    return im


def build(theme, raw):
    P = {
        "floorA": rgba(raw.get("--tk-floor-a", "#d9c893")),
        "floorB": rgba(raw.get("--tk-floor-b", "#d2c084")),
        "seam": rgba(raw.get("--tk-seam", "rgba(90,70,40,0.16)")),
        "wall": rgba(raw.get("--tk-wall", "#8a7757")),
        "wallTop": rgba(raw.get("--tk-wall-top", "#a08c68")),
        "block": rgba(raw.get("--tk-block", "#b98a4e")),
        "blockTop": rgba(raw.get("--tk-block-top", "#cda05f")),
        "hole": rgba(raw.get("--tk-hole", "#4a4034")),
        "holeRim": rgba(raw.get("--tk-hole-rim", "#332c23")),
    }
    # the four floors differ so the ground has texture out of the box and
    # each variant is a distinct thing to paint rather than a duplicate
    tiles = {
        "tile-floor": floor_tile(P, P["floorA"]),
        "tile-floor-1": floor_tile(P, P["floorB"]),
        "tile-floor-2": floor_tile(P, shade(P["floorA"], 0.96)),
        "tile-floor-3": floor_tile(P, shade(P["floorB"], 1.03)),
        "tile-wall": wall_tile(P),
        "tile-block": block_tile(P),
        "tile-hole": hole_tile(P),
    }
    folder = OUT / theme
    folder.mkdir(parents=True, exist_ok=True)
    for name, im in tiles.items():
        im.save(folder / (name + ".png"))
    print("ok  %-6s -> %s  (%d tiles, %dx%d)"
          % (theme, folder.relative_to(ROOT), len(tiles), SIZE, SIZE))


def main():
    wanted = sys.argv[1:] or DEFAULT_THEMES
    themes = parse_css()
    for t in wanted:
        if t not in themes:
            sys.exit("FAIL: no theme %r in tanks/tanks.css "
                     "(add a .tk[data-tk-theme=\"%s\"] block first)" % (t, t))
        build(t, themes[t])
    print("themes available in tanks.css: " + ", ".join(sorted(themes)))


if __name__ == "__main__":
    main()
