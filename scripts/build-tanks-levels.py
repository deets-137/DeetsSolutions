#!/usr/bin/env python3
"""DeetsTanks — level build (docs/tanks.md, "The level format").

Reads every tanks/levels/*.txt (sorted — the filename order IS the
campaign order), validates each, and inlines them all into
tanks/levels.js as strings. A static site has no directory listing, so
the manifest is needed anyway; inlining also means zero fetches at
runtime and validation at build time, not only in the designer.

Validation mirrors engine.js's validateLevel (the engine's parser stays
the authority — this is the build-time gate, failing LOUDLY):
  - grid rectangular, border fully walled
  - only known cells: . # = o P 1..9
  - at least one player spawn and one enemy
  - every enemy reachable from the first spawn (flood fill; destructible
    blocks count as passable — a shell opens them; HOLES do not, they
    stop a tank as surely as a wall)
  - every `tune` key exists in engine.js TUNE_SPEC and carries a number

Usage: python scripts/build-tanks-levels.py
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "tanks" / "levels"
OUT = ROOT / "tanks" / "levels.js"
def engine_facts():
    """Ask engine.js itself what it knows.

    This used to be a hardcoded set with a "keep in sync" comment, which
    is exactly the duplication the house rule forbids: adding an enemy
    meant two edits and a silent build failure when you forgot the
    second. Node is already required to run the engine self-checks, so
    the registry is read straight from the source of truth."""
    import json, subprocess
    js = (
        "var E=require(%s);"
        "process.stdout.write(JSON.stringify({"
        "types:Object.keys(E.ENEMY_TYPES),"
        "tune:Object.keys(E.TUNE_SPEC)}));"
    ) % json.dumps(str(ROOT / "tanks" / "engine.js"))
    try:
        out = subprocess.run(["node", "-e", js], capture_output=True, text=True,
                             timeout=30, check=True).stdout
        f = json.loads(out)
        return set(f["types"]), set(f["tune"])
    except Exception as exc:                     # node missing / engine broken
        fail("engine.js", f"could not read the registries: {exc}")


def parse(text, name):
    """Returns (grid rows, tune lines). Mirrors engine.js parseLevel."""
    rows, tune, in_grid, in_tune = [], [], False, False
    for raw in text.splitlines():
        line = raw.rstrip()
        if in_grid:
            if line:
                rows.append(line)
            continue
        t = line.strip()
        if t == "grid":
            in_grid, in_tune = True, False
            continue
        if t == "tune":
            in_tune = True
            continue
        if in_tune and t:
            tune.append(t)
    if not rows:
        fail(name, "no grid block")
    w = len(rows[0])
    for i, r in enumerate(rows):
        if len(r) != w:
            fail(name, f"grid not rectangular at row {i}")
    return rows, tune


def fail(name, msg):
    print(f"FAIL {name}: {msg}", file=sys.stderr)
    sys.exit(1)


SCOPED = re.compile(r"^(?:(player|enemy[1-9])\.)?([A-Za-z]+)$")


def validate_tune(tune, name, tune_keys):
    for line in tune:
        parts = line.split()
        if len(parts) != 2:
            fail(name, f"tune line is not `key value`: {line!r}")
        m = SCOPED.match(parts[0])
        if not m or m.group(2) not in tune_keys:
            fail(name, f"unknown tune key {parts[0]!r}")
        try:
            float(parts[1])
        except ValueError:
            fail(name, f"tune value for {parts[0]} is not a number: {parts[1]!r}")


def validate(rows, name, known_types):
    w, h = len(rows[0]), len(rows)
    spawns, enemies = [], []
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch == "P":
                spawns.append((x, y))
            elif ch.isdigit():
                if ch not in known_types:
                    fail(name, f"unknown enemy type {ch} at {x},{y}")
                enemies.append((x, y))
            elif ch not in ".#=o":
                fail(name, f"unknown cell '{ch}' at {x},{y}")
    if not spawns:
        fail(name, "no player spawn")
    if not enemies:
        fail(name, "no enemies")
    for x in range(w):
        if rows[0][x] != "#" or rows[h - 1][x] != "#":
            fail(name, "open border (top/bottom)")
    for y in range(h):
        if rows[y][0] != "#" or rows[y][w - 1] != "#":
            fail(name, "open border (left/right)")
    seen, stack = {spawns[0]}, [spawns[0]]
    while stack:
        cx, cy = stack.pop()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nx, ny = cx + dx, cy + dy
            if 0 <= nx < w and 0 <= ny < h and (nx, ny) not in seen and rows[ny][nx] not in "#o":
                seen.add((nx, ny))
                stack.append((nx, ny))
    for i, e in enumerate(enemies):
        if e not in seen:
            fail(name, f"enemy {i} at {e} unreachable from spawn")


def main():
    known_types, tune_keys = engine_facts()
    files = sorted(SRC.glob("*.txt"))
    if not files:
        fail("levels", f"no level files in {SRC}")
    sources = []
    for f in files:
        # utf-8-SIG: Notepad and the designer's download both happily
        # write a BOM, and a BOM riding into levels.js is a stray
        # character at the head of the first `name` line — invisible in
        # an editor, and enough to make a byte comparison against the
        # committed level disagree with an identical one.
        text = f.read_text(encoding="utf-8-sig")
        rows, tune = parse(text, f.name)
        validate(rows, f.name, known_types)
        validate_tune(tune, f.name, tune_keys)
        sources.append(text.replace("\r\n", "\n").rstrip("\n"))
        print(f"ok  {f.name}  ({len(rows[0])}x{len(rows)})")
    body = ",\n".join(
        "  " + repr_js(src) for src in sources
    )
    OUT.write_text(
        "/* GENERATED by scripts/build-tanks-levels.py — DO NOT HAND-EDIT.\n"
        "   Source of truth: tanks/levels/*.txt (docs/tanks.md). Filename\n"
        "   order is campaign order. Regenerate:\n"
        "     python scripts/build-tanks-levels.py */\n"
        "(function () {\n"
        "  \"use strict\";\n"
        "  var LEVELS = [\n" + body + "\n  ];\n"
        "  if (typeof module !== \"undefined\" && module.exports) module.exports = LEVELS;\n"
        "  if (typeof window !== \"undefined\") window.TANKS_LEVELS = LEVELS;\n"
        "})();\n",
        encoding="utf-8",
    )
    print(f"wrote {OUT.relative_to(ROOT)} ({len(sources)} levels)")


def repr_js(s):
    return '"' + s.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n") + '"'


if __name__ == "__main__":
    main()
