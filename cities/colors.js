/* DeetsCities — seat-color contract (docs/cities.md, "Game palette").

   Pure, DOM-free, dependency-free — engine.js's contract rule applies: the
   Phase-2 worker (../DeetsCities) vendors this file VERBATIM, so the mock
   transport and the DO validate a `recolor` byte-identically. Keep it tiny.

   The six presets are the game palette's seat colors (main.css carve-out)
   and stay the auto-assigned defaults; a seated player may claim any hex
   from the lobby (seat dot → picker). The ONLY validation is seat-vs-seat
   distance — proximity to the board's terrain fills is deliberately
   unchecked (Aditya's call: hand-drawn tile texture plus road borders keep
   pieces readable; the risk is the picker's own).

   Browser: window.CitiesColors. Node (worker/self-checks): module.exports. */
(function () {
  "use strict";

  var PRESETS = ["#d94141", "#3b7dd8", "#2fae66", "#e08a2e", "#9457c9", "#22b0b0"];
  // legacy wire names (pre-hex seats the mock persisted) → preset hexes
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
  // first preset clashing with nothing in `taken`; falls back to preset 0
  // (6 seats can't exhaust 6 mutually-distant presets unless custom picks
  // crowd them — and then the picker itself is the escape hatch)
  function freePreset(taken) {
    for (var i = 0; i < PRESETS.length; i++) if (clash(PRESETS[i], taken) < 0) return PRESETS[i];
    return PRESETS[0];
  }

  var API = { PRESETS: PRESETS, LEGACY: LEGACY, MIN_DIST: MIN_DIST,
              norm: norm, dist: dist, clash: clash, freePreset: freePreset };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.CitiesColors = API;
})();
