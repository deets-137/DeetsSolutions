/* DeetsTanks — input (docs/tanks.md).

   WASD bitmask + mouse angle → the input struct the engine reads.
   Input is READ by the sim step (net.js's accumulator) and sent to the
   table at 20 Hz — never handled inside the render loop
   (docs/realtime.md, "Client-side rendering", trap 5).

   fire/mine are LATCHES: set on the press, consumed by whoever sends
   the next input packet, so a click between packets is never lost.
   Drive and aim are held state. window.TanksInput. */
(function () {
  "use strict";

  function create(canvas) {
    var keys = {};                    // code -> held
    var mouse = { x: 0, y: 0, in: false, down: false };
    var fireLatch = 0, mineLatch = 0;
    var enabled = false;

    /* drive 1..8 clockwise from north (engine DIRS), 0 = still */
    var DIR_OF = {
      "0,-1": 1, "1,-1": 2, "1,0": 3, "1,1": 4,
      "0,1": 5, "-1,1": 6, "-1,0": 7, "-1,-1": 8, "0,0": 0
    };
    function drive() {
      var ux = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
      var uy = (keys.KeyS ? 1 : 0) - (keys.KeyW ? 1 : 0);
      return DIR_OF[ux + "," + uy] || 0;
    }

    function onKeyDown(e) {
      if (!enabled) return;
      // never steal typing from a field (the code box, a rename)
      var t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (e.code === "Space") {
        if (!e.repeat) mineLatch = 1;
        e.preventDefault();           // space must not scroll the page
        return;
      }
      if (e.code === "KeyW" || e.code === "KeyA" || e.code === "KeyS" || e.code === "KeyD") {
        keys[e.code] = true;
        e.preventDefault();
      }
    }
    function onKeyUp(e) { delete keys[e.code]; }
    function onMove(e) {
      var r = canvas.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
      mouse.in = true;
    }
    function onDown(e) {
      if (!enabled || e.button !== 0) return;
      fireLatch = 1; mouse.down = true;
      e.preventDefault();
    }
    function onUp(e) { if (e.button === 0) mouse.down = false; }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);
    canvas.addEventListener("mouseleave", function () { mouse.in = false; });
    canvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });

    return {
      setEnabled: function (on) {
        enabled = !!on;
        if (!on) { keys = {}; fireLatch = 0; mineLatch = 0; mouse.down = false; }
      },
      drive: drive,
      mouse: mouse,
      /* a latch is waiting — the sender flushes on the spot rather
         than letting a click sit out the heartbeat interval */
      pending: function () { return !!(fireLatch || mineLatch); },
      /* one packet's worth: latches clear, held state repeats. Holding
         the button keeps firing at the engine's own 2/s cap. */
      consume: function () {
        var f = fireLatch || (mouse.down ? 1 : 0);
        var m = mineLatch;
        fireLatch = 0; mineLatch = 0;
        return { f: f, m: m };
      }
    };
  }

  window.TanksInput = { create: create };
})();
