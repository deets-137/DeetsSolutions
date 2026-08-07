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

NAME ONE AND ONLY THAT ONE IS WRITTEN. The overwrite rule above used to
mean the whole set was untouchable the moment a single file had been
painted, which is the wrong shape for a set you finish one sprite at a
time. Pass sprite names to narrow it:

    python scripts/build-tanks-art.py               # the whole set
    python scripts/build-tanks-art.py bullet        # just that file
    python scripts/build-tanks-art.py hull-e3 turret-e3
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


def shell_colours():
    """The shell palette out of tanks.css, where the game-art carve-out
    lives - never a second copy of the hexes. Cork (the .tk block) is
    the reference set; a theme's own override is a runtime concern, and
    render.js reads it directly."""
    css = (ROOT / "tanks" / "tanks.css").read_text(encoding="utf-8")
    base = css.split(".tk {", 1)[-1].split("}", 1)[0]
    found = dict(re.findall(r"--tk-(bullet[a-z-]*)\s*:\s*(#[0-9a-fA-F]{6})", base))
    for key in ("bullet", "bullet-lit", "bullet-rim"):
        if key not in found:
            fail("no --tk-%s in tanks/tanks.css .tk block" % key)
    return found


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


def mix(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(4))


def sphere(size, body, lit, rim, frac):
    """A shell that reads as a BALL, not a pellet: a rim-darkened edge,
    light from the upper left, one tight specular.

    Mirrors render.js `drawShell` - the template he paints over has to
    be what the game would otherwise have drawn, same rule the tile
    templates follow. The gradient is stacked ellipses rather than a
    real radial ramp because PIL has no gradient fill and 48 steps at
    4x supersample is indistinguishable from one.

    NOTE the shadow is NOT here. It belongs to the board's lighting, so
    render.js drops it under whatever shell is drawn - bake one in and
    it would travel with the ball and double up on the real one."""
    im = Image.new("RGBA", (size * SS, size * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(im, "RGBA")
    c = size * SS / 2.0
    rad = frac * size * SS
    steps = 48
    for i in range(steps):
        t = i / (steps - 1.0)                  # 0 = outer edge, 1 = highlight
        r = rad * (1.0 - t * 0.94)
        cx, cy = c - rad * 0.34 * t, c - rad * 0.40 * t
        if t < 0.42:
            col = mix(rim, body, t / 0.42)
        else:
            col = mix(body, lit, (t - 0.42) / 0.58)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=col)
    # one tight specular. It is the thing that still reads at the ~8 px
    # the shell is actually played at, where the gradient alone has
    # collapsed back into a dot - so it is drawn, not implied.
    sx, sy, sr = c - rad * 0.34, c - rad * 0.40, rad * 0.26
    d.ellipse([sx - sr, sy - sr, sx + sr, sy + sr], fill=lit)
    return im.resize((size, size), Image.LANCZOS)


def dot(size, colour, frac):
    im = Image.new("RGBA", (size * SS, size * SS), (0, 0, 0, 0))
    d = ImageDraw.Draw(im, "RGBA")
    c = size * SS / 2.0
    rad = frac * size * SS
    d.ellipse([c - rad, c - rad, c + rad, c + rad], fill=colour)
    return im.resize((size, size), Image.LANCZOS)


WANT = set()          # empty = the whole set; otherwise only these names


def emit(name, make):
    """`make` is a thunk, so a sprite nobody asked for is never even
    drawn - and, more to the point, never written over his art."""
    if WANT and name not in WANT:
        return None
    make().save(OUT / (name + ".png"))
    return name


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for arg in sys.argv[1:]:
        WANT.add(arg[:-4] if arg.endswith(".png") else arg)
    seats = seat_colours()
    types = enemy_liveries()
    shell = shell_colours()
    written = []

    # the neutral master: mid-grey, so a runtime tint toward any seat
    # colour lands somewhere sane rather than fighting a hue
    neutral = (176, 176, 176, 255)
    written.append(emit("hull", lambda: hull_tile(neutral, (48, 42, 34, 210))))
    written.append(emit("turret", lambda: turret_tile(neutral, shade(neutral, 0.62))))

    # HIS CALL (chat 2026-08-05): player 1 blue, player 2 red. Note this
    # inverts the --gseat default order (seat 0 is red), which is fine
    # because these files are used verbatim - see the module docstring.
    for tag, hexv in (("p1", seats["1"]), ("p2", seats["0"])):
        body = hexrgb(hexv)
        written.append(emit("hull-" + tag, lambda b=body: hull_tile(b, (40, 34, 28, 215))))
        written.append(emit("turret-" + tag,
                            lambda b=body: turret_tile(b, shade(b, 0.62))))

    for digit in sorted(types, key=int):
        body = hexrgb(types[digit].get("art") or "#a3562c")
        written.append(emit("hull-e" + digit, lambda b=body: hull_tile(b, (36, 30, 24, 215))))
        written.append(emit("turret-e" + digit,
                            lambda b=body: turret_tile(b, shade(b, 0.62))))

    written.append(emit("bullet", lambda: sphere(
        96, hexrgb(shell["bullet"]), hexrgb(shell["bullet-lit"]),
        hexrgb(shell["bullet-rim"]), 0.18)))
    written.append(emit("mine", lambda: dot(96, (58, 51, 42, 255), 0.32)))

    written = [w for w in written if w]
    missed = sorted(WANT - set(written))
    if missed:
        fail("no such sprite: %s" % ", ".join(missed))
    print("ok  %d sprites -> %s  (%dpx, facing up)%s"
          % (len(written), OUT.relative_to(ROOT), BOX,
             "  [only: %s]" % ", ".join(written) if WANT else ""))
    if not WANT:
        print("    seats: p1=%s p2=%s   enemies: %s"
              % (seats["1"], seats["0"], ", ".join(sorted(types, key=int))))


if __name__ == "__main__":
    main()
