"""Metric-matched fallback faces for the bundled skin fonts.

The faces load with font-display: fallback (styles/fonts.css), so on a cold
first visit a page can paint in the stand-in font (Georgia, Arial ...) and
swap ~100+ ms later. The stand-in's different widths and line heights then
reflow the page: on Home the left column grew and the right column's rows
stretched with it (a 41 px push, 2026-11-24). Each "<Face> Fallback" here is
the stand-in scaled (size-adjust) and given the real face's ascent, descent
and line gap, so the swap changes the glyphs but not the layout.

Prints the @font-face blocks; paste them into the generated section at the
end of styles/fonts.css, and keep each "<Face> Fallback" right after its face
in skin.css's font stacks. Rerun when a face changes.

    python3 scripts/build-font-fallbacks.py [--sys DIR]

Needs fontTools (pip install fonttools). The stand-ins are read from the
macOS system fonts by default; every one of them also ships with Windows
under the same names, which is what local() matches.
"""
import argparse
from pathlib import Path

from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
FONTS = ROOT / "assets" / "fonts"

# Ordinary English, letter mix as it reads on the site. Widths are averaged
# over it, so size-adjust matches a line of real text, not one glyph.
SAMPLE = (
    "The quick brown fox jumps over the lazy dog. Song of the Day, Movies, "
    "DeetsMusic release notes and the projects I have built along the way. "
    "Everything I've been learning, from project to project, 2026."
)

# (family, weight, our file, stand-in file, local() names for the stand-in)
FACES = [
    ("Liberation Serif", 400, "LiberationSerif-Regular.ttf", "Times New Roman.ttf", ["Times New Roman", "TimesNewRomanPSMT"]),
    ("Liberation Serif", 700, "LiberationSerif-Bold.ttf", "Times New Roman Bold.ttf", ["Times New Roman Bold", "TimesNewRomanPS-BoldMT"]),
    ("Anton", 400, "Anton-Regular.woff2", "Impact.ttf", ["Impact"]),
    ("IBM Plex Mono", 400, "IBMPlexMono-Regular.woff2", "Courier New.ttf", ["Courier New", "CourierNewPSMT"]),
    ("IBM Plex Mono", 700, "IBMPlexMono-SemiBold.woff2", "Courier New Bold.ttf", ["Courier New Bold", "CourierNewPS-BoldMT"]),
    ("Cinzel", 600, "Cinzel-SemiBold.woff2", "Georgia Bold.ttf", ["Georgia Bold", "Georgia-Bold"]),
    ("Spectral", 400, "Spectral-Regular.woff2", "Georgia.ttf", ["Georgia"]),
    ("Orbitron", 700, "Orbitron-Bold.woff2", "Arial Bold.ttf", ["Arial Bold", "Arial-BoldMT"]),
    ("Rajdhani", 500, "Rajdhani-Medium.woff2", "Arial.ttf", ["Arial", "ArialMT"]),
    ("Rajdhani", 700, "Rajdhani-Bold.woff2", "Arial Bold.ttf", ["Arial Bold", "Arial-BoldMT"]),
]


def avg_width(font, text):
    """Mean advance per character over text, in em."""
    cmap = font.getBestCmap()
    hmtx = font["hmtx"]
    upm = font["head"].unitsPerEm
    total, n = 0, 0
    for ch in text:
        g = cmap.get(ord(ch))
        if g is None:
            continue
        total += hmtx[g][0]
        n += 1
    return total / n / upm


def vmetrics(font):
    """Ascent, descent, line gap in em, the hhea numbers Chromium lays out with."""
    upm = font["head"].unitsPerEm
    h = font["hhea"]
    return h.ascent / upm, abs(h.descent) / upm, h.lineGap / upm


def pct(x):
    return f"{x * 100:.2f}%"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sys", default="/System/Library/Fonts/Supplemental", help="folder holding the stand-in fonts")
    args = ap.parse_args()
    sysdir = Path(args.sys)

    out = []
    for family, weight, ours, standin, names in FACES:
        web = TTFont(FONTS / ours)
        fb = TTFont(sysdir / standin)
        # Cinzel has no lowercase of its own (its "lowercase" are small
        # caps), so its sample reads in capitals like it does on the page
        text = SAMPLE.upper() if family == "Cinzel" else SAMPLE
        size = avg_width(web, text) / avg_width(fb, text)
        asc, desc, gap = vmetrics(web)
        src = ", ".join(f'local("{n}")' for n in names)
        out.append(
            "@font-face {\n"
            f'  font-family: "{family} Fallback";\n'
            "  font-style: normal;\n"
            f"  font-weight: {weight};\n"
            f"  src: {src};\n"
            f"  size-adjust: {pct(size)};\n"
            f"  ascent-override: {pct(asc / size)};\n"
            f"  descent-override: {pct(desc / size)};\n"
            f"  line-gap-override: {pct(gap / size)};\n"
            "}"
        )
    print("\n".join(out))


if __name__ == "__main__":
    main()
