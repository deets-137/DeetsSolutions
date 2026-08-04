/* Deets games — the seat-color contract (docs/games.md, "Seat colors").

   ONE contract for every game table on the site: DeetsCities, DeetsMahjong,
   and whatever comes next. Cities and mahjong each carried their own copy of
   this file until the fundamentals pass; the two were identical but for the
   global name, which is exactly the kind of drift a shared file exists to
   prevent.

   Pure, DOM-free, dependency-free — engine.js's contract rule applies: every
   worker (../DeetsCities, ../DeetsMahjong, ...) vendors this file VERBATIM as
   src/colors.js, so the mock transport and the DO validate a `recolor`
   byte-identically. Keep it tiny.

   The six presets are the game palette's seat colors (the --gseat-* carve-out
   in main.css) and stay the auto-assigned defaults; a seated player may claim
   any hex from the lobby (seat dot → picker). The ONLY validation is
   seat-vs-seat distance — proximity to a game's own board/felt fills is
   deliberately unchecked (Aditya's call: hand-drawn art plus piece borders
   keep things readable; the risk is the picker's own).

   A game with six seats or fewer simply draws from the front of PRESETS.
   Past that (poker seats twelve) the auto-assign is `freeColor`, which
   generates one in a safe band instead — see the block above it.

   Browser: window.DeetsColors. Node (worker/self-checks): module.exports. */
(function () {
  "use strict";

  var PRESETS = ["#d94141", "#3b7dd8", "#2fae66", "#e08a2e", "#9457c9", "#22b0b0"];
  // legacy wire names (pre-hex seats early cities mocks persisted) → preset
  // hexes. Cities-only in practice; harmless everywhere else, and cheaper to
  // keep than to prove no stored table still carries one.
  var LEGACY = { red: PRESETS[0], blue: PRESETS[1], green: PRESETS[2],
                 orange: PRESETS[3], purple: PRESETS[4], teal: PRESETS[5] };
  var MIN_DIST = 60;   // redmean units; the presets sit ~100+ apart pairwise

  // any-case "#rrggbb" (bare "rrggbb" tolerated) → lowercase canonical, else null
  function norm(v) {
    if (typeof v !== "string") return null;
    var s = v.trim().toLowerCase();
    if (s.charAt(0) !== "#") s = "#" + s;
    return /^#[0-9a-f]{6}$/.test(s) ? s : null;
  }
  function rgb(hex) {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  }
  // redmean-weighted RGB distance — cheap, and plenty at seat-color scale
  function dist(a, b) {
    var A = rgb(a), B = rgb(b), rm = (A[0] + B[0]) / 2;
    var dr = A[0] - B[0], dg = A[1] - B[1], db = A[2] - B[2];
    return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
  }
  // index of the first color in `others` too close to `hex`, or -1
  // (holes in `others` are fine — pass null for the seat being recolored)
  function clash(hex, others) {
    for (var i = 0; i < others.length; i++) {
      if (others[i] != null && dist(hex, others[i]) < MIN_DIST) return i;
    }
    return -1;
  }
  // first preset clashing with nothing in `taken`; falls back to preset 0.
  // Kept for the ≤6-seat games, and it is the first half of freeColor —
  // but a table with more seats than presets must use freeColor, or every
  // seat past the sixth comes out the same red.
  function freePreset(taken) {
    for (var i = 0; i < PRESETS.length; i++) if (clash(PRESETS[i], taken) < 0) return PRESETS[i];
    return PRESETS[0];
  }

  /* ── past the presets ───────────────────────────────────────────
     Poker seats TWELVE and PRESETS holds six, so `freePreset` fell off
     its own fallback: seat 7 got preset 0, and so did 8, 9, 10, 11 and
     12. Add six bots to a full table and all six arrive wearing the same
     red — not a near-miss the clash test could catch, the identical hex.

     Two ideas fix it. First, a SAFE BAND: a generated seat color is built
     in HSL at a fixed mid saturation and lightness, never as a flat
     24-bit random. A raw random hex is near-black, near-white or mud
     about a third of the time, and a seat dot has to read on a light
     theme, on a dark one, and against a green felt. Fixing S and L also
     means hue distance stands in for perceived distance, which is what
     makes the second idea work.

     Second, placement by GAP rather than by luck: project the taken hues
     onto the circle, find the widest unoccupied arc, and land inside it.
     Retry-until-it-clears degrades exactly when you need it most — the
     twelfth seat is the one with the least room, so it is the one whose
     random tries all fail. Taking the widest gap has no failure mode:
     the last seat is simply the farthest thing from the other eleven
     that the circle still has. The jitter inside the gap is there so two
     tables don't march through an identical sequence. */
  var SEAT_SAT = 0.58;     // strong enough to read as a color, not neon
  var SEAT_LIGHT = 0.52;   // mid — legible on both the light and dark themes
  // ...and a step either side of it. Hue alone runs out: past six seats the
  // gaps subdivide, and three chartreuses 20° apart clear the distance test
  // while still reading as one color. Alternating the VALUE of successive
  // picks separates them by something the eye tracks independently of hue.
  var SEAT_LIGHT_STEP = 0.09;
  function hueOf(hex) {
    var c = rgb(hex), r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    if (!d) return 0;
    var h;
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    return (h % 360 + 360) % 360;
  }
  function hsl(h, s, l) {
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    var m = l - c / 2;
    var t = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
          : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    var out = "#";
    for (var i = 0; i < 3; i++) {
      var v = Math.round((t[i] + m) * 255);
      out += ("0" + Math.max(0, Math.min(255, v)).toString(16)).slice(-2);
    }
    return out;
  }
  // a color no seat in `taken` is already close to. `rand` is injectable so
  // a worker can pass its own source (and a test a fixed one); it defaults
  // to Math.random, and this file stays pure either way.
  function freeColor(taken, rand) {
    var others = taken || [];
    for (var i = 0; i < PRESETS.length; i++) {
      if (clash(PRESETS[i], others) < 0) return PRESETS[i];
    }
    var rnd = typeof rand === "function" ? rand : Math.random;
    var hues = [];
    for (var j = 0; j < others.length; j++) {
      var h = norm(others[j]);
      if (h) hues.push(hueOf(h));
    }
    hues.sort(function (a, b) { return a - b; });
    var at = rnd() * 360, widest = 0;
    for (var k = 0; k < hues.length; k++) {
      var next = k + 1 < hues.length ? hues[k + 1] : hues[0] + 360;
      var gap = next - hues[k];
      if (gap > widest) { widest = gap; at = hues[k] + gap / 2; }
    }
    at = ((at + (rnd() - 0.5) * (widest / 3)) % 360 + 360) % 360;
    var lit = SEAT_LIGHT + (hues.length % 2 ? -SEAT_LIGHT_STEP : SEAT_LIGHT_STEP);
    // the gap is the best hue available; if the clash test still refuses it
    // (a custom pick sitting at this S/L), step around rather than loop
    for (var step = 0; step < 24; step++) {
      var hex = hsl((at + step * 15) % 360, SEAT_SAT, lit);
      if (clash(hex, others) < 0) return hex;
    }
    return hsl(at, SEAT_SAT, lit);
  }

  var API = { PRESETS: PRESETS, LEGACY: LEGACY, MIN_DIST: MIN_DIST,
              norm: norm, dist: dist, clash: clash,
              freePreset: freePreset, freeColor: freeColor };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.DeetsColors = API;
})();
