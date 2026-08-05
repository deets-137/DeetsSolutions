/* DeetsTanks — sprite probe (docs/tanks.md, "Art").

   Art ships by landing a file: each stable filename is probed ONCE at
   load, and a missing sprite costs one quiet 404 and falls back to the
   renderer's geometric placeholder (the house pattern — games.md,
   "Conventions"). His hand-drawn pass swaps in with zero code.

   The 8 hull facings will be pre-rotated into an offscreen cache here
   when hull.png lands (docs/tanks.md, "Draw big, display small") —
   until then this is just the probe. window.TanksArt. */
(function () {
  "use strict";

  var BASE = "../assets/sprites/tanks/";
  var NAMES = ["hull", "turret", "bullet", "mine", "tile-floor", "tile-wall", "tile-block"];
  var imgs = {}, state = {};   // name -> "ok" | "miss"

  NAMES.forEach(function (name) {
    var im = new Image();
    im.onload = function () { state[name] = "ok"; imgs[name] = im; };
    im.onerror = function () { state[name] = "miss"; };
    im.src = BASE + name + ".png";
  });

  window.TanksArt = {
    has: function (name) { return state[name] === "ok"; },
    img: function (name) { return imgs[name] || null; }
  };
})();
