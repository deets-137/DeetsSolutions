/* DeetsTanks — sprite probe (docs/tanks.md, "Art").

   Art ships by landing a file: each stable filename is probed ONCE at
   load, and a missing sprite costs one quiet 404 and falls back to the
   renderer's geometric placeholder (the house pattern — games.md,
   "Conventions"). His hand-drawn pass swaps in with zero code.

   PER-LEVEL TERRAIN ART. A level names a `theme`, and a theme is just
   a folder: assets/sprites/tanks/<theme>/tile-floor.png and friends.
   The probe is lazy — a theme is only asked for when a level using it
   loads — and the fallback chain has three rungs, so every rung is
   playable on its own:

       <theme>/tile-wall.png   →  the theme's CSS colours  →  cork

   That means a theme can be pure colour (one CSS block, no files), or
   pure art, or a mix where only the floor is drawn. Nothing has to be
   finished for anything to work.

   FLOOR VARIANTS. tile-floor-1.png … -3.png, if present, are picked
   per cell by a hash of its coordinates — texture across the ground
   without any randomness, so every client draws the identical floor
   and nothing rides the wire. Variants are only probed when the base
   floor tile actually loaded, so a colour-only theme costs no 404s
   beyond its four base tiles.

   The 8 hull facings will be pre-rotated into an offscreen cache here
   when hull.png lands (docs/tanks.md, "Draw big, display small") —
   until then this is just the probe. window.TanksArt. */
(function () {
  "use strict";

  var BASE = "../assets/sprites/tanks/";
  /* Tank sprites, per actor. `hull`/`turret` are the neutral master and
     get TINTED to the seat colour; `hull-p1`/`-p2` and `hull-eN` are
     used verbatim, already in their own colour. All of them FACE UP —
     the renderer rotates by (angle + 90°). */
  var NAMES = ["hull", "turret", "bullet", "mine"];
  for (var s = 1; s <= 2; s++) NAMES.push("hull-p" + s, "turret-p" + s);
  for (var e = 1; e <= 9; e++) NAMES.push("hull-e" + e, "turret-e" + e);
  var TILES = ["tile-floor", "tile-wall", "tile-block", "tile-hole"];
  var FLOOR_VARIANTS = 3;

  var imgs = {}, state = {};   // key -> "ok" | "miss"
  var themes = {};             // theme -> { probed: true, floors: n }

  function probe(key, url, onOk) {
    if (state[key]) return;
    state[key] = "pending";
    var im = new Image();
    im.onload = function () { state[key] = "ok"; imgs[key] = im; if (onOk) onOk(); };
    im.onerror = function () { state[key] = "miss"; };
    im.src = url;
  }

  NAMES.forEach(function (n) { probe(n, BASE + n + ".png"); });
  // the themeless tiles stay probed for backward compatibility: a level
  // with no theme draws cork, and cork's art may sit at the top level
  TILES.forEach(function (n) { probe(n, BASE + n + ".png"); });

  function key(theme, name) { return theme + "/" + name; }

  /* Ask for a theme's tiles. Idempotent and lazy — called by the
     renderer on setLevel, so a theme nobody plays costs nothing. */
  function useTheme(theme) {
    if (!theme || themes[theme]) return;
    themes[theme] = { floors: 0 };
    TILES.forEach(function (n) {
      probe(key(theme, n), BASE + theme + "/" + n + ".png",
        n === "tile-floor" ? function () { probeVariants(theme); } : null);
    });
  }
  function probeVariants(theme) {
    for (var v = 1; v <= FLOOR_VARIANTS; v++) {
      (function (n) {
        probe(key(theme, "tile-floor-" + n), BASE + theme + "/tile-floor-" + n + ".png",
          function () { if (themes[theme].floors < n) themes[theme].floors = n; });
      })(v);
    }
  }

  /* The tile to draw for this cell, or null to fall back to colour.
     `x`/`y` only matter for the floor, and only to pick a variant. */
  function tile(theme, name, x, y) {
    var k = theme ? key(theme, name) : null;
    if (name === "tile-floor" && k && state[k] === "ok") {
      var n = (themes[theme] && themes[theme].floors) || 0;
      if (n > 0) {
        // a cheap deterministic spread — same cell, same tile, every client
        var h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
        var pick = h % (n + 1);
        if (pick > 0) {
          var vk = key(theme, "tile-floor-" + pick);
          if (state[vk] === "ok") return imgs[vk];
        }
      }
      return imgs[k];
    }
    if (k && state[k] === "ok") return imgs[k];
    return state[name] === "ok" ? imgs[name] : null;   // themeless fallback
  }

  /* Tint the neutral master toward a seat colour, cached per pairing.
     `source-atop` paints only where the sprite already has pixels, so
     the silhouette survives; the alpha keeps his shading readable
     underneath instead of flooding it flat. This is what lets the
     --gseat picker keep working over hand-drawn art — a per-seat file
     opts out of it by being used verbatim. */
  var tints = {};
  function tinted(name, hex) {
    var im = imgs[name];
    if (!im || !hex) return im || null;
    var k = name + "|" + hex;
    if (tints[k]) return tints[k];
    var cv = document.createElement("canvas");
    cv.width = im.width; cv.height = im.height;
    var c = cv.getContext("2d");
    c.drawImage(im, 0, 0);
    c.globalCompositeOperation = "source-atop";
    c.globalAlpha = 0.72;
    c.fillStyle = hex;
    c.fillRect(0, 0, cv.width, cv.height);
    tints[k] = cv;
    return cv;
  }

  /* The sprite for one tank, or null to fall back to the geometry.
     Per-actor file first, neutral master (tinted) second. */
  function tankArt(kind, seat, type, hex) {
    var own = seat != null ? kind + "-p" + (seat + 1) : kind + "-e" + type;
    if (state[own] === "ok") return imgs[own];
    if (state[kind] === "ok") return tinted(kind, hex);
    return null;
  }

  window.TanksArt = {
    has: function (name) { return state[name] === "ok"; },
    img: function (name) { return imgs[name] || null; },
    useTheme: useTheme,
    tile: tile,
    tankArt: tankArt
  };
})();
