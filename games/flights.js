/* ============================================================
   games/flights.js — the chip-flight layer, shared by every game
   (docs/games.md, "Change radius": this is the SHARED tier).

   Cities and mahjong each grew their own copy of this loop, and
   mahjong's was already a corrected descendant of cities' — the
   two-pass frame below existed in one and not the other. Poker
   would have been the third copy, so it moved here instead. What
   is game-specific stays in the game: which events fly, what a
   chip looks like, and where a seat's chips live on screen.

   Browser shell only. NOT vendored into any worker (docs/games.md
   vendors table-do.js, colors.js and each engine.js — nothing
   here), so a change is one file in one repo.

   THE FOUR RULES this exists to keep identical across games:

   1. The layer is parented INSIDE the game's <section>, never on
      <body>. Every game palette is scoped to its section, and a
      body-parented layer resolves each chip's colour to nothing.
      `position: fixed` still anchors it to the viewport from
      there — that part is the game's CSS.
   2. Flights STEER. Every frame re-queries the destination, so a
      panel that re-renders, scrolls, or reflows mid-flight is
      tracked rather than missed. This is why a flight takes a
      FUNCTION for its target and not a point.
   3. Read all, then write all. Each `to()` is a querySelector plus
      getBoundingClientRect; resolving every destination before
      writing any transform keeps a read from forcing a synchronous
      layout in the middle of the write loop.
   4. Chips are born and caught, never evaporating: full opacity end
      to end, popping past 1 on the way in and shrinking INTO the
      target on the way out.

   Usage:
     var FLY = GameFlights.create({
       section: "section.pk", layerClass: "pk-flylayer",
       alive: function () { return !!model; },
       catchClass: "pk-catch"          // optional
     });
     FLY.push(function () { FLY.launch(node, fromFn, toFn, delay); });
     // ... after the render that creates the targets:
     FLY.flush();
   ============================================================ */
(function () {
  "use strict";

  function create(cfg) {
    cfg = cfg || {};
    var flights = [], raf = null, pending = [];
    var MS = cfg.ms || 800;            // nominal flight time
    var SPREAD = cfg.spread || 200;    // ± half of this, so a handful tumbles
    var JITTER = cfg.jitter || 12;     // ± half of this on the launch point
    var STEP = cfg.step || 90;         // stagger between chips in one payout
    var CAP = cfg.cap || 5;            // chips per flight — the log carries the true number

    /* The layer is created lazily and reused: a broadcast re-render wipes
       tile interiors, never this, so chips in the air survive it. */
    function layer() {
      var l = document.querySelector("." + cfg.layerClass);
      if (!l) {
        l = document.createElement("div");
        l.className = cfg.layerClass;
        (document.querySelector(cfg.section) || document.body).appendChild(l);
      }
      return l;
    }

    /* viewport centre of a node, or null when it isn't on screen — a
       zero-box element is one a re-render has taken away, and a flight
       aimed at it should fall back rather than fly to the origin */
    function point(elm) {
      if (!elm) return null;
      var r = elm.getBoundingClientRect();
      if (!r.width && !r.height) return null;
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, el: elm };
    }

    /* opts:
         onAbort()  the chip never launched (left the table, or its origin
                    vanished during the stagger delay) — undo anything the
                    caller armed synchronously, e.g. a held-back count
         onLand()   the chip reached its target and was removed        */
    function launch(node, fromFn, toFn, delay, opts) {
      opts = opts || {};
      setTimeout(function () {
        if (cfg.alive && !cfg.alive()) { if (opts.onAbort) opts.onAbort(); return; }
        var from = fromFn();
        if (!from) { if (opts.onAbort) opts.onAbort(); return; }
        var sx = from.x + (Math.random() - 0.5) * JITTER;
        var sy = from.y + (Math.random() - 0.5) * JITTER;
        node.style.transform = "translate(" + sx.toFixed(1) + "px," + sy.toFixed(1) + "px) scale(0)";
        layer().appendChild(node);
        flights.push({
          el: node, sx: sx, sy: sy, to: toFn, land: opts.onLand || null,
          t0: performance.now(), dur: MS + (Math.random() - 0.5) * SPREAD
        });
        if (raf == null) raf = requestAnimationFrame(step);
      }, delay || 0);
    }

    function step(now) {
      // rule 3: resolve every destination first, write every transform after
      var frame = flights.map(function (f) {
        return { f: f, p: Math.min(1, (now - f.t0) / f.dur), to: f.to() || { x: f.sx, y: f.sy } };
      });
      flights = [];
      frame.forEach(function (o) {
        var f = o.f, p = o.p, to = o.to;
        var e = 1 - Math.pow(1 - p, 3);                    // ease-out cubic
        // rule 4: born past 1, cruise, caught INTO the target
        var s;
        if (p < 0.12) s = (p / 0.12) * 1.2;
        else if (p < 0.24) s = 1.2 - ((p - 0.12) / 0.12) * 0.2;
        else if (p > 0.85) s = 1 - ((p - 0.85) / 0.15) * 0.7;
        else s = 1;
        f.el.style.transform =
          "translate(" + (f.sx + (to.x - f.sx) * e).toFixed(1) + "px," +
          (f.sy + (to.y - f.sy) * e).toFixed(1) + "px) scale(" + s.toFixed(3) + ")";
        if (p < 1) { flights.push(f); return; }
        if (f.el.parentNode) f.el.parentNode.removeChild(f.el);
        if (f.land) f.land();
        /* the catcher acknowledges the arrival. Opt-in per game: mahjong
           deliberately has none, because the pond's own entrance pop and
           the re-rendered zone already say "caught", and bumping the
           container scaled a whole panel — it read as a flinch every bot
           turn. */
        if (cfg.catchClass && to.el) {
          to.el.classList.remove(cfg.catchClass);
          void to.el.offsetWidth;                          // restart the one-shot
          to.el.classList.add(cfg.catchClass);
        }
      });
      raf = flights.length ? requestAnimationFrame(step) : null;
    }

    /* Collected during event replay, run after the render that creates
       their targets — a flight launched mid-replay would measure a DOM
       that hasn't caught up with the broadcast yet. */
    function push(fn) { pending.push(fn); }
    function flush() {
      var q = pending; pending = [];
      q.forEach(function (go) { go(); });
    }
    function clear() {
      flights.forEach(function (f) { if (f.el.parentNode) f.el.parentNode.removeChild(f.el); });
      flights = []; pending = [];
      if (raf != null) { cancelAnimationFrame(raf); raf = null; }
    }

    return {
      launch: launch, push: push, flush: flush, clear: clear,
      layer: layer, point: point,
      STEP: STEP, CAP: CAP
    };
  }

  window.GameFlights = { create: create };
})();
