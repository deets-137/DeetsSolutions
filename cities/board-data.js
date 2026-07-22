/* DeetsCities — static board definitions (docs/cities.md, "The two boards").

   Pure data: the two board frames and their component pools, restated from
   the classic base game and its 5–6 extension so the implementation never
   needs an outside reference. NO trademarks — resources are generic
   (wood/brick/wheat/sheep/ore), displayed names live in strings.js.

   Coordinates are pointy-top axial (q, r). Hex layout SHAPE and harbor
   POSITIONS are fixed here (matching the official frames); terrain, number
   tokens, and harbor TYPES are shuffled onto them at game start by engine.js
   (with the 6s-and-8s-never-adjacent rule). engine.js derives full vertex /
   edge adjacency from `hexes` at Start — this file lists no vertices itself.

   Harbor edges are canonical edge ids "q,r,DIR" (DIR ∈ NE|E|SE); a settlement
   on EITHER endpoint vertex of a harbor edge earns that harbor's rate. The
   fixed positions below were derived from each frame's coastal perimeter,
   spaced so no two harbors share a vertex (classic every-other-edge spacing).

   Harbor TYPE tokens: "any" = a 3:1 (any-resource) harbor; a resource name
   ("wood"|"brick"|"wheat"|"sheep"|"ore") = that resource's 2:1 harbor.

   VENDORED VERBATIM into the worker repo (../DeetsCities) — like engine.js and
   the wire protocol, the two copies are contract and must stay byte-identical.
   Browser: window.CITIES_BOARDS. Node (engine self-checks): module.exports. */
(function () {
  "use strict";

  var BOARDS = {
    /* ── Base board — 3–4 players (19 hexes) ───────────────────────
       Rows 3,4,5,4,3 — a regular radius-2 hex centred on (0,0). */
    base: {
      id: "base",
      minPlayers: 3,
      maxPlayers: 4,
      hexes: [
        { q: 0, r: -2 }, { q: 1, r: -2 }, { q: 2, r: -2 },
        { q: -1, r: -1 }, { q: 0, r: -1 }, { q: 1, r: -1 }, { q: 2, r: -1 },
        { q: -2, r: 0 }, { q: -1, r: 0 }, { q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 },
        { q: -2, r: 1 }, { q: -1, r: 1 }, { q: 0, r: 1 }, { q: 1, r: 1 },
        { q: -2, r: 2 }, { q: -1, r: 2 }, { q: 0, r: 2 }
      ],
      // 9 fixed harbor edges around the coast
      harborEdges: [
        "0,-2,NE", "2,-3,SE", "2,-1,E", "2,0,SE", "0,2,E",
        "-2,3,NE", "-3,2,E", "-3,1,NE", "-1,-2,SE"
      ],
      // 19 terrain hexes: 4 wood, 4 sheep, 4 wheat, 3 brick, 3 ore, 1 desert
      terrain: [
        "wood", "wood", "wood", "wood",
        "sheep", "sheep", "sheep", "sheep",
        "wheat", "wheat", "wheat", "wheat",
        "brick", "brick", "brick",
        "ore", "ore", "ore",
        "desert"
      ],
      // 18 number tokens: one 2, one 12, two each 3–6 and 8–11
      tokens: [2, 12, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11],
      // 9 harbor types: four 3:1 ("any"), one 2:1 per resource
      harborTypes: ["any", "any", "any", "any", "wood", "brick", "wheat", "sheep", "ore"],
      bank: 19,                       // per resource
      dev: { knight: 14, vp: 5, road: 2, plenty: 2, monopoly: 2 },   // 25
      pieces: { settlement: 5, city: 4, road: 15 },
      winVP: 10
    },

    /* ── Expanded board — 5–6 players (30 hexes) ───────────────────
       Rows 3,4,5,6,5,4,3 — the classic 5–6 extension frame. */
    expanded: {
      id: "expanded",
      minPlayers: 5,
      maxPlayers: 6,
      hexes: [
        { q: 1, r: -3 }, { q: 2, r: -3 }, { q: 3, r: -3 },
        { q: 0, r: -2 }, { q: 1, r: -2 }, { q: 2, r: -2 }, { q: 3, r: -2 },
        { q: -1, r: -1 }, { q: 0, r: -1 }, { q: 1, r: -1 }, { q: 2, r: -1 }, { q: 3, r: -1 },
        { q: -2, r: 0 }, { q: -1, r: 0 }, { q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }, { q: 3, r: 0 },
        { q: -2, r: 1 }, { q: -1, r: 1 }, { q: 0, r: 1 }, { q: 1, r: 1 }, { q: 2, r: 1 },
        { q: -2, r: 2 }, { q: -1, r: 2 }, { q: 0, r: 2 }, { q: 1, r: 2 },
        { q: -2, r: 3 }, { q: -1, r: 3 }, { q: 0, r: 3 }
      ],
      // 11 fixed harbor edges around the coast
      harborEdges: [
        "-2,-1,E", "-3,1,NE", "-3,3,NE", "-2,3,SE", "0,3,SE", "1,2,E",
        "3,0,E", "3,-1,NE", "3,-3,NE", "2,-4,SE", "0,-3,SE"
      ],
      // 30 terrain hexes: 6 wood, 6 sheep, 6 wheat, 5 brick, 5 ore, 2 desert
      terrain: [
        "wood", "wood", "wood", "wood", "wood", "wood",
        "sheep", "sheep", "sheep", "sheep", "sheep", "sheep",
        "wheat", "wheat", "wheat", "wheat", "wheat", "wheat",
        "brick", "brick", "brick", "brick", "brick",
        "ore", "ore", "ore", "ore", "ore",
        "desert", "desert"
      ],
      // 28 number tokens: base 18 + one more each of 2,3,4,5,6,8,9,10,11,12
      tokens: [
        2, 12, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11,
        2, 3, 4, 5, 6, 8, 9, 10, 11, 12
      ],
      // 11 harbor types: five 3:1 ("any"), six 2:1 (one per resource + a 2nd sheep)
      harborTypes: ["any", "any", "any", "any", "any", "wood", "brick", "wheat", "sheep", "ore", "sheep"],
      bank: 24,                       // per resource
      dev: { knight: 20, vp: 5, road: 3, plenty: 3, monopoly: 3 },   // 34
      pieces: { settlement: 5, city: 4, road: 15 },
      winVP: 10
    }
  };

  /* which frame a given seat count plays on (spec: 3–4 base, 5–6 expanded) */
  function frameFor(seatCount) {
    return seatCount >= 5 ? "expanded" : "base";
  }

  var API = { BOARDS: BOARDS, frameFor: frameFor };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.CITIES_BOARDS = API;
})();
