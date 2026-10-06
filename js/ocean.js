/* The Ocean sea — a hand port of DeetsMusic's src/ocean.ts (the app's
   docs/features/OCEAN.md §3) to plain JS: the swell and the glow from the deep. No
   heave, no ripples, no neon album light: those follow the app's player, and the site
   has none (docs/deetsmusic-page-pass.md §7).

   controls.js injects the layer (.ocean > .ocean__bob--{far,mid,near} >
   .ocean__train--*, then .ocean__glow) and loads this file the first time the skin is
   Ocean, so no page carries a script tag for it. CSS moves the layers (chrome.css
   §Ambient layers); this module gives them something to show:

   - The swell. ocean-worker.js paints three depth bands at the sea's height, in the
     theme's water and ink (skin.css's --ocean-* tokens). Each lands as a plain
     background. A theme change, a new sea height or a new display scale repaints them.
   - The glow from the deep, in the color of today's Song of the Day cover, set as
     --ocean-glow-color on .ocean (transparent with no cover, the app's "no album").

   The glow's source. The newest song in sotd/songs.json that has artwork is "today's".
   songs.json is large, so it is not fetched on every view: the derived color, the art
   URL and its date are kept in localStorage (GLOW_KEY) and the file is checked at most
   once per GLOW_TTL. The home page and the SOTD journal already load the file; they
   hand it over (DeetsAppearance.offerSotd in controls.js), which refreshes the cache
   with no second fetch. The color: the cover is loaded small from mzstatic (it sends
   Access-Control-Allow-Origin: *), its dominant colors are found, and the most
   colorful of them wins, the way the app's albumColor ranks Apple's palette.

   Painting falls back to the main thread (ocean-worker.js loaded as a plain script)
   where Worker or OffscreenCanvas is missing; each band is painted in its own task. */
(function () {
  "use strict";
  if (window.DeetsOcean) return;

  var root = document.documentElement;
  var sea = document.querySelector('body > .ocean:not([data-sea="classic"])');
  if (!sea) return;

  /* The three depth bands (ocean-worker.js BANDS; tile widths in CSS px). */
  var BANDS = [
    { name: "far", tile: 360 },
    { name: "mid", tile: 720 },
    { name: "near", tile: 1200 },
  ];
  /* A height change smaller than this keeps the painted bands (they stretch a little). */
  var REPAINT_PX = 24;
  /* The glow's cache, and how long a check of songs.json holds. */
  var GLOW_KEY = "deets-ocean-glow";
  var GLOW_TTL = 20 * 60 * 60 * 1000;
  /* With a stale cache, wait this long before fetching songs.json, so a page that
     loads it anyway (home, SOTD) can hand it over first. */
  var FETCH_DELAY = 3000;

  /* Paths resolve from this script's own URL (pages sit at different depths), with the
     same ?v= query, so a deploy's cache-busting carries over. */
  var me = document.currentScript || document.querySelector('script[src*="js/ocean.js"]');
  var base = me ? me.src : location.href;
  var query = base.indexOf("?") >= 0 ? base.slice(base.indexOf("?")) : "";
  function asset(rel) { return new URL(rel, base).href.split("?")[0] + query; }

  var active = function () { return root.getAttribute("data-skin") === "ocean"; };

  // ── color math (sRGB ⇄ OKLCH; the app's src/album-slots.ts) ───────────────────────
  function lin(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function gam(c) { return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; }
  function clamp01(x) { return Math.min(1, Math.max(0, x)); }
  function toOKLCH(c) {
    var lr = lin(c[0]), lg = lin(c[1]), lb = lin(c[2]);
    var l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
    var m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
    var s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
    var L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    var a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    var bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    return [L, Math.hypot(a, bb), Math.atan2(bb, a)];
  }
  function fromOKLCH(lch) {
    var L = lch[0], a = lch[1] * Math.cos(lch[2]), bb = lch[1] * Math.sin(lch[2]);
    var l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * bb, 3);
    var m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * bb, 3);
    var s = Math.pow(L - 0.0894841775 * a - 1.291485548 * bb, 3);
    return [
      gam(clamp01(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
      gam(clamp01(-1.2684380046 * l + 2.6097574011 * m - 0.6368000104 * s)),
      gam(clamp01(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
    ];
  }

  // Any CSS color (color-mix, light-dark, var) → sRGB 0–1, through a 1×1 canvas: the
  // computed style of a color-mix is `color(srgb …)`.
  var swatch = document.createElement("canvas");
  swatch.width = swatch.height = 1;
  var sctx = swatch.getContext("2d", { willReadFrequently: true });
  function toRGB(css) {
    sctx.clearRect(0, 0, 1, 1);
    sctx.fillStyle = "#000";
    sctx.fillStyle = css;
    sctx.fillRect(0, 0, 1, 1);
    var p = sctx.getImageData(0, 0, 1, 1).data;
    return p[3] ? [p[0] / 255, p[1] / 255, p[2] / 255] : null;
  }
  var probe = null;
  /* A token resolved inside the sea (so skin and theme both apply) to sRGB. */
  function resolve(expr) {
    if (!probe) {
      probe = document.createElement("span");
      probe.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
      sea.appendChild(probe);
    }
    probe.style.color = "";
    probe.style.color = expr;
    return toRGB(getComputedStyle(probe).color);
  }
  function to255(c) { return c.map(function (v) { return Math.round(clamp01(v) * 255); }); }
  function cssRGB(c) { return "rgb(" + to255(c).join(" ") + ")"; }
  function isDark(c) { return toOKLCH(c)[0] < 0.55; }

  /* Album color → a glow far under the surface: hue kept, chroma capped, a middle
     lightness (brighter reads as a lamp, darker vanishes into the deep water). */
  // The site's lift (his call, 2026-10-06): a song-of-the-day cover is often
  // dull where the app's album palettes are vivid, so the chroma is scaled up
  // (never invented: a grey cover stays muted) and the lightness sits a step
  // higher than the app's, so the glow reads on dark water.
  function asGlow(c, darkWater) {
    var lch = toOKLCH(c);
    var L = darkWater ? Math.min(Math.max(lch[0], 0.5), 0.66) : Math.min(Math.max(lch[0], 0.55), 0.72);
    return fromOKLCH([L, Math.min(lch[1] * 1.8, 0.16), lch[2]]);
  }

  // ── the bands ──────────────────────────────────────────────────────────────────
  var worker = null, workerFailed = false, jobSeq = 0;
  var pending = {};
  var canWork = typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined" &&
                typeof OffscreenCanvas.prototype.convertToBlob === "function";

  function startWorker() {
    if (worker || workerFailed || !canWork) return worker;
    try {
      worker = new Worker(asset("ocean-worker.js"));
    } catch (e) {
      workerFailed = true;
      return null;
    }
    worker.onmessage = function (e) {
      var done = pending[e.data.id];
      delete pending[e.data.id];
      if (e.data.err && window.console) console.warn("ocean: paint failed", e.data.err);
      if (done) done(e.data.blob || null);
    };
    // The worker would not start (a blocked script, say): paint the rest at home.
    worker.onerror = function (e) {
      if (e && e.preventDefault) e.preventDefault();
      workerFailed = true;
      worker = null;
      var jobs = pending;
      pending = {};
      Object.keys(jobs).forEach(function (id) { jobs[id].retry(); });
    };
    return worker;
  }

  // The fallback: the painter as a plain script on this page.
  var texture = null;
  function loadTexture(cb) {
    if (window.DeetsOceanTexture) return cb(window.DeetsOceanTexture);
    if (!texture) {
      texture = [];
      var s = document.createElement("script");
      s.src = asset("ocean-worker.js");
      s.onload = function () { var q = texture; texture = null; q.forEach(function (f) { f(window.DeetsOceanTexture || null); }); };
      s.onerror = s.onload;
      document.head.appendChild(s);
    }
    texture.push(cb);
  }
  function drawHere(job, cb) {
    loadTexture(function (T) {
      if (!T) return cb(null);
      setTimeout(function () {   // one band per task, so the page keeps answering
        try {
          var p = T.paintBand(job);
          var c = document.createElement("canvas");
          c.width = p.w;
          c.height = p.h;
          c.getContext("2d").putImageData(new ImageData(p.data, p.w, p.h), 0, 0);
          c.toBlob(function (b) { cb(b || null); }, "image/png");
        } catch (e) {
          cb(null);
        }
      }, 0);
    });
  }

  function draw(job, cb) {
    var w = startWorker();
    if (!w) return drawHere(job, cb);
    var id = ++jobSeq;
    var done = function (blob) { cb(blob); };
    done.retry = function () { drawHere(job, cb); };
    pending[id] = done;
    w.postMessage({ id: id, job: job });
  }

  /* Blob URLs in use, per box, so a replaced one is released. */
  var urls = new WeakMap();
  /* Put a blob on a box as its background, once decoded (no half-drawn frame), and
     release the box's old one. */
  function setImage(el, blob, size, cb) {
    var url = URL.createObjectURL(blob);
    var img = new Image();
    var put = function () {
      var old = urls.get(el);
      el.style.backgroundImage = 'url("' + url + '")';
      el.style.backgroundSize = size;
      urls.set(el, url);
      if (old) URL.revokeObjectURL(old);
      cb();
    };
    img.src = url;
    if (img.decode) img.decode().then(put, put);
    else img.onload = img.onerror = put;
  }

  var paintSeq = 0, paintedHeight = 0, paintedDpr = 0;

  function paintSwell() {
    if (!active()) return;
    var height = sea.clientHeight;
    if (height < 40) return;   // hidden (another skin, the radio shell) or not laid out
    var mine = ++paintSeq;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    paintedHeight = height;
    paintedDpr = dpr;
    var top = resolve("var(--ocean-water-top)") || [0, 0, 0];
    var bottom = resolve("var(--ocean-water-bottom)") || top;
    var ink = resolve("var(--ocean-swell-ink)") || [0.5, 0.5, 0.5];
    var css = getComputedStyle(sea);
    var shade = parseFloat(css.getPropertyValue(isDark(bottom) ? "--ocean-trough" : "--ocean-trough-light")) || 0.2;
    BANDS.forEach(function (band, i) {
      draw({
        band: band.name,
        tile: band.tile,
        height: height,
        px: dpr,
        ink: to255(ink),
        top: to255(top),
        bottom: to255(bottom),
        shade: shade,
        seed: 3 + i * 8,
      }, function (blob) {
        var el = sea.querySelector(".ocean__train--" + band.name);
        if (!blob || !el || mine !== paintSeq) return;
        el.style.setProperty("--tw", band.tile + "px");
        setImage(el, blob, band.tile + "px 100%", function () {
          if (mine === paintSeq) el.setAttribute("data-on", "");
        });
      });
    });
  }

  // ── the glow from the deep ─────────────────────────────────────────────────────
  var glowSource = null;   // [r, g, b] 0–1, the cover's color; null = no cover

  function applyGlow() {
    if (!glowSource) {
      sea.style.setProperty("--ocean-glow-color", "transparent");
      return;
    }
    var water = resolve("var(--ocean-water-bottom)") || [0, 0, 0];
    sea.style.setProperty("--ocean-glow-color", cssRGB(asGlow(glowSource, isDark(water))));
  }

  function readCache() {
    try { return JSON.parse(localStorage.getItem(GLOW_KEY)) || null; } catch (e) { return null; }
  }
  function writeCache(c) {
    try { localStorage.setItem(GLOW_KEY, JSON.stringify(c)); } catch (e) {}
  }

  /* The newest song with artwork (songs.json lists oldest first). */
  function latest(songs) {
    for (var i = (songs || []).length - 1; i >= 0; i--) {
      if (songs[i] && songs[i].artwork_url) return songs[i];
    }
    return null;
  }

  /* The cover's color: its dominant colors (3 bits a channel), the most colorful of
     those that cover at least MIN_SHARE of it (or of the top three, on a busy cover).
     A grey cover gives its least-grey color, so it stays grey: asGlow caps the chroma
     and never invents it. */
  var MIN_SHARE = 0.04;
  function coverColor(art, cb) {
    var img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = function () {
      try {
        var n = 40;
        var c = document.createElement("canvas");
        c.width = c.height = n;
        var ctx = c.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, n, n);
        var px = ctx.getImageData(0, 0, n, n).data;
        var bins = {};
        for (var i = 0; i < px.length; i += 4) {
          if (px[i + 3] < 128) continue;
          var k = (px[i] >> 5) * 64 + (px[i + 1] >> 5) * 8 + (px[i + 2] >> 5);
          var b = bins[k] || (bins[k] = { n: 0, r: 0, g: 0, b: 0 });
          b.n++; b.r += px[i]; b.g += px[i + 1]; b.b += px[i + 2];
        }
        var all = Object.keys(bins).map(function (k) { return bins[k]; })
          .sort(function (p, q) { return q.n - p.n; });
        var total = n * n;
        var picks = all.filter(function (b) { return b.n >= total * MIN_SHARE; }).slice(0, 6);
        if (picks.length < 3) picks = all.slice(0, 3);
        var best = null, bestC = -1;
        picks.forEach(function (b) {
          var rgb = [b.r / b.n / 255, b.g / b.n / 255, b.b / b.n / 255];
          var ch = toOKLCH(rgb)[1];
          if (ch > bestC) { bestC = ch; best = rgb; }
        });
        cb(best ? best.map(function (v) { return Math.round(v * 1000) / 1000; }) : null);
      } catch (e) {
        cb(null);   // a tainted canvas (no CORS) or no canvas: no glow
      }
    };
    img.onerror = function () { cb(null); };
    // ask mzstatic for a small copy (…/600x600bb.jpg → …/60x60bb.jpg)
    img.src = String(art).replace(/\/\d+x\d+(bb)?\.(jpe?g|png|webp)$/i, "/60x60bb.jpg");
  }

  /* A song from songs.json (the newest with art): refresh the cache, and find the
     cover's color when the cover is new. */
  function useSong(song) {
    var c = readCache() || {};
    var now = Date.now();
    if (!song) {
      writeCache({ at: now, art: null, date: null, rgb: null });
      glowSource = null;
      applyGlow();
      return;
    }
    if (c.art === song.artwork_url && c.rgb) {
      c.at = now;
      c.date = song.date || c.date || null;
      writeCache(c);
      if (String(c.rgb) !== String(glowSource)) { glowSource = c.rgb; applyGlow(); }
      return;
    }
    coverColor(song.artwork_url, function (rgb) {
      writeCache({ at: Date.now(), art: song.artwork_url, date: song.date || null, rgb: rgb });
      glowSource = rgb;
      applyGlow();
    });
  }

  var fetching = false, fetchTimer = 0;
  function fetchSongs() {
    var c = readCache();
    if (c && Date.now() - c.at < GLOW_TTL) return;   // a page handed it over meanwhile
    var held = window.DeetsAppearance && DeetsAppearance.heldSotd && DeetsAppearance.heldSotd();
    if (held) return useSong(latest(held));
    if (fetching) return;
    fetching = true;
    fetch(new URL("../sotd/songs.json", base).href)
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(function (data) { fetching = false; useSong(latest(data && data.songs)); })
      .catch(function () { fetching = false; });
  }

  function followSotd() {
    var c = readCache();
    glowSource = (c && c.rgb) || null;
    applyGlow();
    if (c && Date.now() - c.at < GLOW_TTL) return;
    clearTimeout(fetchTimer);
    fetchTimer = setTimeout(fetchSongs, FETCH_DELAY);
  }

  // ── wiring ─────────────────────────────────────────────────────────────────────
  function enter() {
    // after the skin's tokens apply, so the sea has its size and colors
    requestAnimationFrame(function () {
      paintSwell();
      followSotd();
    });
  }

  window.DeetsOcean = {
    /* The home page or the SOTD journal loaded songs.json (controls.js passes it on). */
    offer: function (songs) {
      if (active()) useSong(latest(songs));
    },
  };

  if (active()) enter();

  // A skin change in or out; a theme change re-tints the water, the ink and the glow.
  new MutationObserver(function (list) {
    var skin = list.some(function (m) { return m.attributeName === "data-skin"; });
    requestAnimationFrame(function () {
      if (!active()) return;
      if (skin) followSotd();
      paintSwell();
      applyGlow();
    });
  }).observe(root, { attributes: true, attributeFilter: ["data-theme", "data-skin"] });

  // The rows are laid out for the sea's height: a taller or shorter window repaints
  // them, once it settles (the bands stretch to fit meanwhile). Showing the sea again
  // (the radio shell closes) is a height change too.
  if (typeof ResizeObserver !== "undefined") {
    var resizeTimer = 0;
    new ResizeObserver(function () {
      if (!active() || Math.abs(sea.clientHeight - paintedHeight) < REPAINT_PX) return;
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(paintSwell, 300);
    }).observe(sea);
  }

  // A move to a display with another scale: repaint at its pixel density (capped at 2).
  function watchDpr() {
    if (!window.matchMedia) return;
    var mq = window.matchMedia("(resolution: " + window.devicePixelRatio + "dppx)");
    var on = function () {
      if (mq.removeEventListener) mq.removeEventListener("change", on);
      if (active() && Math.min(2, window.devicePixelRatio || 1) !== paintedDpr) paintSwell();
      watchDpr();
    };
    if (mq.addEventListener) mq.addEventListener("change", on);
  }
  watchDpr();
})();
