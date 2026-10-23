/* DeetsCovers — cover art the size it is drawn, and the first screen's
   cover wave. Shared chrome like toast.js: the home page and both journals
   load it, and a page with no covers never does. Ported from DeetsMusic's
   card reveal (its docs/architecture/UX-COVERUPS.md §7, his calls of
   2026-10-16), to the site's own pages.

   DeetsCovers.srcset(url)  → a srcset string, or "" when the host can't
     resize. Apple's artwork URLs carry their size in the path
     (…/600x600bb.jpg) and serve any size as WebP; TMDB's carry one of a
     fixed set of widths (/t/p/w342/). Pair it with `sizes` (a lazy image
     can say "auto"), and keep `src` as the fallback.

   DeetsCovers.reveal(container, selector)  → the hold, then the wave:
     - The tiles (container children matching `selector`) wait, invisible
       but in place, until every cover on the first screen is ready. Only
       what is on screen counts; a tile below the fold never holds it.
     - The cap (--reveal-cap) starts with the hold. At the cap the wave
       runs with what is ready, and a late cover fades in alone when it
       lands (.has-art, main.css).
     - A press or a wheel on the container ends the hold at once.
     - The wave: tile delay = (line + column) ÷ (lines + columns − 2) ×
       --reveal-span, so it runs left to right and top to bottom at once,
       and a 40-tile grid takes as long as a 6-tile row.
     - Tiles off the first screen show with no motion; they are not seen.
     - Reduced motion: the same hold, then everything shows at once.
     Call it on a first show (a page load, a view switch, a new month),
     never on a sort, a filter or a search: those keep their place. */
(function () {
  "use strict";

  var MZ = /\/\d+x\d+(bb)?\.(jpe?g|png|webp)$/i;
  var TMDB = /\/t\/p\/w\d+\//;

  function srcset(url) {
    if (!url) return "";
    if (MZ.test(url)) {
      return [200, 400, 600].map(function (w) {
        return url.replace(MZ, "/" + w + "x" + w + "bb.webp") + " " + w + "w";
      }).join(", ");
    }
    if (TMDB.test(url)) {
      return [185, 342, 500].map(function (w) {
        return url.replace(TMDB, "/t/p/w" + w + "/") + " " + w + "w";
      }).join(", ");
    }
    return "";
  }

  // A motion token in seconds ("1.5s", "500ms") as milliseconds.
  function token(name, fallback) {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    var n = parseFloat(v);
    if (isNaN(n)) return fallback;
    return /ms$/.test(v) ? n : n * 1000;
  }

  function reducedMotion() {
    try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
    catch (e) { return false; }
  }

  // On screen: inside the viewport and inside the container's own box (a
  // sideways strip clips the cards past its right edge).
  function onScreen(tile, box) {
    var r = tile.getBoundingClientRect();
    var top = Math.max(0, box.top), left = Math.max(0, box.left);
    var bottom = Math.min(window.innerHeight, box.bottom);
    var right = Math.min(window.innerWidth, box.right);
    return r.width > 0 && r.bottom > top && r.top < bottom && r.right > left && r.left < right;
  }

  function ready(img) {
    if (img.complete) {
      return img.naturalWidth && img.decode ? img.decode().catch(function () {}) : Promise.resolve();
    }
    return new Promise(function (res) {
      img.addEventListener("load", res, { once: true });
      img.addEventListener("error", res, { once: true });
    });
  }

  function reveal(container, selector) {
    if (!container) return;
    var tiles = Array.prototype.filter.call(container.children, function (n) {
      return n.matches(selector);
    });
    if (!tiles.length) return;
    tiles.forEach(function (t) { t.classList.remove("rv-in"); t.classList.add("rv-wait"); });

    var box = container.getBoundingClientRect();
    var first = tiles.filter(function (t) { return onScreen(t, box); });
    var waits = [];
    first.forEach(function (t) {
      t.querySelectorAll("img").forEach(function (img) { waits.push(ready(img)); });
    });

    var done = false;
    var timer = null;
    function go() {
      if (done) return;
      done = true;
      clearTimeout(timer);
      container.removeEventListener("pointerdown", go);
      container.removeEventListener("wheel", go);
      if (!tiles[0].isConnected) return;   // re-rendered while held: that render owns it
      wave(tiles, first);
    }
    container.addEventListener("pointerdown", go);
    container.addEventListener("wheel", go, { passive: true });
    timer = setTimeout(go, token("--reveal-cap", 1500));
    Promise.all(waits).then(go);
  }

  function wave(tiles, first) {
    var still = reducedMotion();
    tiles.forEach(function (t) {
      if (still || first.indexOf(t) < 0) t.classList.remove("rv-wait");
    });
    if (still || !first.length) return;

    // Lines by top edge: a tile whose top is within half a tile of the
    // line's first tile is on that line. Columns count from the left.
    var boxes = first.map(function (t) { return { t: t, r: t.getBoundingClientRect() }; });
    boxes.sort(function (a, b) { return a.r.top - b.r.top || a.r.left - b.r.left; });
    var lines = [];
    boxes.forEach(function (b) {
      var line = lines[lines.length - 1];
      if (line && Math.abs(b.r.top - line[0].r.top) < line[0].r.height / 2) line.push(b);
      else lines.push([b]);
    });
    var cols = 0;
    lines.forEach(function (line) {
      line.sort(function (a, b) { return a.r.left - b.r.left; });
      cols = Math.max(cols, line.length);
    });
    var span = token("--reveal-span", 500);
    var steps = Math.max(1, lines.length + cols - 2);
    lines.forEach(function (line, li) {
      line.forEach(function (b, ci) {
        var t = b.t;
        t.style.setProperty("--rv-delay", Math.round((li + ci) / steps * span) + "ms");
        t.classList.add("rv-in");
        t.classList.remove("rv-wait");
        t.addEventListener("animationend", function () {
          t.classList.remove("rv-in");
          t.style.removeProperty("--rv-delay");
        }, { once: true });
      });
    });
  }

  /* The `sizes` for a journal card's cover (sotd.js, movies.js), by view:
     Full is a grid column (one column on a phone), Small a cover beside its
     text, Line a thumb that grows to 9rem when the row opens. Named, not
     "auto": Chrome picked a cover for the window's width on a freshly built
     grid, and Firefox and Safari have no "auto" at all. */
  var JOURNAL_SIZES = {
    full:  "(max-width: 41rem) 100vw, 20rem",
    small: "10rem",
    line:  "9rem"
  };
  function journalSizes(view) { return JOURNAL_SIZES[view] || JOURNAL_SIZES.full; }

  window.DeetsCovers = { srcset: srcset, reveal: reveal, journalSizes: journalSizes };
})();
