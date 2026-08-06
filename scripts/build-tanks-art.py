#!/usr/bin/env python3
"""DeetsTanks tank-sprite templates (docs/tanks.md, "Art").

Emits the hull / turret / shell / mine templates into
assets/sprites/tanks/ for Aditya to paint over:

    hull.png      turret.png       neutral master - TINTED to the seat
                                   colour at runtime, so the --gseat
                                   picker keeps working
    hull-p1.png   turret-p1.png    seat 0, blue - used VERBATIM
    hull-p2.png   turret-p2.png    seat 1, red  - used VERBATIM
    hull-e1.png   turret-e1.png    one pair per ENEMY_TYPES entry, in
      ... e7                       that type's own `art` colour
    bullet.png    mine.png

THE CONVENTION, and everything depends on it: every tank sprite FACES
UP. The renderer rotates by (angle + 90 degrees), the hull's 8 facings
land on 45-degree steps, and the turret free-rotates. Draw north.

THE SIZE: 192px, which is 3x a 64px tile, and the renderer draws each
sprite into a one-tile box. Drawing large and displaying small turns
resampling into supersampling and kills every rotation artifact - the
whole reason the art is high-res raster rather than pixel art. Do not
"fix" the size down to display resolution.

PER-SEAT FILES OVERRIDE THE COLOUR PICKER. hull-p1/p2 are used exactly
as drawn, so a seat with its own sprite stops following --gseat. Delete
them and that seat falls back to the neutral master, which IS tinted.
That is the trade, and it is opt-in per file.

Colours come from the places that own them - the seat palette from
styles/table.css, the enemy liveries from engine.js ENEMY_TYPES - never
retyped here.

Re-running OVERWRITES. Never run it once hand art has landed unless you
mean to reset the set (the rule build-poker-chips.py carries).

    python scripts/build-tanks-art.py
"""
import json
import re
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "sprites" / "tanks"
BOX = 192                      # 3x a 64px tile
R = 0.34 * BOX                 # TANK_R in engine.js, in template pixels
SS = 4                         # supersample factor for smooth edges


def fail(msg):
    print("FAIL: " + msg, file=sys.stderr)
    sys.exit(1)


def enemy_liveries():
    """ENEMY_TYPES straight out of engine.js - never a second copy."""
    js = ("var E=require(%s);"
          "process.stdout.write(JSON.stringify(E.ENEMY_TYPES));"
          % json.dumps(str(ROOT / "tanks" / "engine.js")))
    try:
        out = subprocess.run(["node", "-e", js], capture_output=True, text=True,
                             timeout=30, check=True).stdout
        return json.loads(out)
    except Exception as exc:
        fail("could not read ENEMY_TYPES: %s" % exc)


def seat_colours():
    css = (ROOT / "styles" / "table.css").read_text(encoding="utf-8")
    found = dict(re.findall(r"--gseat-(\d+)\s*:\s*(#[0-9a-fA-F]{6})", css))
    if "0" not in found or "1" not in found:
        fail("no --gseat-0/1 in styles/table.css")
    return found


def hexrgb(h, a=255):
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


def shade(c, f):
    return (min(255, int(c[0] * f)), min(255, int(c[1] * f)),
            min(255, int(c[2] * f)), c[3])


def canvas():
    return Image.new("RGBA", (BOX * SS, BOX * SS), (0, 0, 0, 0))


def done(im):
    return im.resize((BOX, BOX), Image.LANCZOS)


def rr(d, box, radius, fill):
    d.rounded_rectangle(box, radius=radius, fill=fill)


def hull_tile(body, track):
    """Mirrors render.js drawTank's hull + tracks, facing UP."""
    im = canvas()
    d = ImageDraw.Draw(im, "RGBA")
    c = BOX * SS / 2.0
    r = R * SS
    # tracks, left and right of the body
    for x0 in (-r * 1.18, r * 0.76):
        rr(d, [c + x0, c - r, c + x0 + r * 0.42, c + r], r * 0.16, track)
    # hull body
    rr(d, [c - r * 0.8, c - r * 0.92, c + r * 0.8, c + r * 0.92], r * 0.24, body)
    return done(im)


def turret_tile(body, dark):
    """Barrel + mantlet, facing UP, pivot at the sprite centre."""
    im = canvas()
    d = ImageDraw.Draw(im, "RGBA")
    c = BOX * SS / 2.0
    r = R * SS
    half = 0.11 * BOX * SS       # barrel half-width (render.js: 0.11 * tile)
    d.rectangle([c - half, c - r * 1.53, c + half, c], fill=dark)
    d.ellipse([c - r * 0.55, c - r * 0.55, c + r * 0.55, c + r * 0.55], fill=body)
    return done(im)


def dot(size, colour, frac):
    im = Image.new("RGBA", (size * SS, size * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(im, "RGBA")
    c = size * SS / 2.0
    rad = frac * size * SS
    d.ellipse([c - rad, c - rad, c + rad, c + rad], fill=colour)
    return im.resize((size, size), Image.LANCZOS)


def emit(name, im):
    im.save(OUT / (name + ".png"))
    return name


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    seats = seat_colours()
    types = enemy_liveries()
    written = []

    # the neutral master: mid-grey, so a runtime tint toward any seat
    # colour lands somewhere sane rather than fighting a hue
    neutral = (176, 176, 176, 255)
    written.append(emit("hull", hull_tile(neutral, (48, 42, 34, 210))))
    written.append(emit("turret", turret_tile(neutral, shade(neutral, 0.62))))

    # HIS CALL (chat 2026-08-05): player 1 blue, player 2 red. Note this
    # inverts the --gseat default order (seat 0 is red), which is fine
    # because these files are used verbatim - see the module docstring.
    for tag, hexv in (("p1", seats["1"]), ("p2", seats["0"])):
        body = hexrgb(hexv)
        written.append(emit("hull-" + tag, hull_tile(body, (40, 34, 28, 215))))
        written.append(emit("turret-" + tag, turret_tile(body, shade(body, 0.62))))

    for digit in sorted(types, key=int):
        art = types[digit].get("art") or "#a3562c"
        body = hexrgb(art)
        written.append(emit("hull-e" + digit, hull_tile(body, (36, 30, 24, 215))))
        written.append(emit("turret-e" + digit, turret_tile(body, shade(body, 0.62))))

    written.append(emit("bullet", dot(96, (46, 40, 32, 255), 0.18)))
    written.append(emit("mine", dot(96, (58, 51, 42, 255), 0.32)))

    print("ok  %d sprites -> %s  (%dpx, facing up)"
          % (len(written), OUT.relative_to(ROOT), BOX))
    print("    seats: p1=%s p2=%s   enemies: %s"
          % (seats["1"], seats["0"], ", ".join(sorted(types, key=int))))


if __name__ == "__main__":
    main()
