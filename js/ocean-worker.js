/* Ocean's swell painter — a hand port of DeetsMusic's src/ocean-texture.ts and
   src/ocean-worker.ts (the app's docs/features/OCEAN.md §3) to plain JS. Pure math,
   no DOM. Keep it in step with the app's painter; the neon album light (OCEAN.md §7)
   is not ported.

   One file, two ways in:
   - As a classic Worker (js/ocean.js starts it): a job in, { id, blob } out — the
     band as a PNG, painted on an OffscreenCanvas.
   - As a plain <script> on the page (js/ocean.js's fallback, for a browser with no
     Worker or no OffscreenCanvas): it only publishes self.DeetsOceanTexture, and the
     controller paints on the main thread.

   A row is one line of swell at a given distance. Its crest is a Gerstner (trochoidal)
   wave: sharp at the top, broad in the trough, the shape of a heavy sea. Under each
   crest the wave's body is painted in the water's own color, darkening into the
   trough, so a nearer swell hides the water behind it. Every row has a whole number of
   waves across the tile, so the tile repeats sideways with no seam and a box can roll
   by whole tiles. */
(function (self) {
  "use strict";

  /* The three depth bands. Each rolls at its own speed; the tile widths (CSS px) are
     wide so a crest's shape does not visibly repeat, and a near wave can be long. */
  var BANDS = [
    { name: "far", tile: 360 },
    { name: "mid", tile: 720 },
    { name: "near", tile: 1200 },
  ];

  /* The rows of a sea `height` CSS px tall, in perspective: close together and flat at
     the top (the horizon), each gap `growth` times the last, so the rows spread out,
     rise and lengthen toward the bottom (near). Far rows fade into haze. Each row
     belongs to the band of its depth. A row: y (rest line, CSS px from the top), amp
     (crest height), k (waves across the tile), steep (0–0.8), lit (0–1, crest
     brightness), body (how far the wave's body reaches below its crest), line (half
     width of the crest line). */
  function seaRows(height, growth, first) {
    growth = growth || 1.1;
    first = first || 6;
    var out = { far: [], mid: [], near: [] };
    var y = 3, gap = first;
    while (y < height + 60) {
      var t = Math.min(1, y / height); // 0 horizon … 1 bottom
      var band = t < 0.3 ? 0 : t < 0.62 ? 1 : 2;
      var tile = BANDS[band].tile;
      var wavelength = 40 + 300 * Math.pow(t, 1.2);
      out[BANDS[band].name].push({
        y: y,
        amp: 0.8 + 20 * Math.pow(t, 1.5),
        k: Math.max(1, Math.round(tile / wavelength)),
        steep: 0.45 + 0.35 * t,
        lit: 0.18 + 0.82 * Math.pow(t, 0.8),
        body: Math.max(4, gap * 0.9),
        line: 0.45 + 0.5 * t,
      });
      y += gap;
      gap *= growth;
    }
    return out;
  }

  /* A tiny seeded generator (mulberry32), so a layer is the same on every load. */
  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function smooth(e0, e1, x) {
    var t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  }

  /* Paint one depth band. s: { w, h (device px), px (device px per CSS px), rows, ink,
     top, bottom ([r, g, b] 0–255: the crest ink, the water at the top and at the bottom
     of the sea), shade (0–1, how much darker the trough is right under a crest), seed }.
     Rows are painted far to near (top to bottom), each over the last. */
  function swellLayer(s) {
    var w = s.w, h = s.h, px = s.px;
    var rand = rng(s.seed);
    var tau = Math.PI * 2;
    // premultiplied RGBA in floats while painting
    var r = new Float32Array(w * h), g = new Float32Array(w * h), b = new Float32Array(w * h), a = new Float32Array(w * h);
    function over(i, cr, cg, cb, ca) {
      var k = 1 - ca;
      r[i] = cr * ca + r[i] * k;
      g[i] = cg * ca + g[i] * k;
      b[i] = cb * ca + b[i] * k;
      a[i] = ca + a[i] * k;
    }
    var rows = s.rows.slice().sort(function (p, q) { return p.y - q.y; });
    for (var ri = 0; ri < rows.length; ri++) {
      var row = rows[ri];
      var ph = rand() * tau;
      // the crests rise and fall along the row in sets, as a real swell does
      var setK = 1 + Math.floor(rand() * 2);
      var setPh = rand() * tau;
      var y0 = row.y * px, amp = row.amp * px, body = row.body * px, line = row.line * px;
      var sq = Math.min(0.8, row.steep);
      for (var x = 0; x < w; x++) {
        // Gerstner: x = (θ − s·sin θ) / k, y = −A·cos θ. Solve θ for this column (Newton).
        var target = (tau * row.k * x) / w + ph;
        var th = target;
        for (var n = 0; n < 6; n++) th -= (th - sq * Math.sin(th) - target) / (1 - sq * Math.cos(th));
        var set = 0.62 + 0.38 * Math.sin((tau * setK * x) / w + setPh);
        var yc = y0 - amp * set * Math.cos(th);
        var lo = Math.max(0, Math.floor(yc - 4 * px)), hi = Math.min(h - 1, Math.ceil(yc + body));
        for (var y = lo; y <= hi; y++) {
          var d = y - yc;
          var i = y * w + x;
          var t = y / (h - 1);
          var wr = s.top[0] + (s.bottom[0] - s.top[0]) * t;
          var wg = s.top[1] + (s.bottom[1] - s.top[1]) * t;
          var wb = s.top[2] + (s.bottom[2] - s.top[2]) * t;
          if (d >= 0) {
            // the body: the water's own color, darkest just under the crest, fading out below
            var dark = 1 - s.shade * (1 - smooth(0, body * 0.8, d));
            over(i, wr * dark, wg * dark, wb * dark, 1 - smooth(body * 0.55, body, d));
          }
          // the crest line, with a faint light just above it
          var edge = Math.exp(-((d / line) * (d / line)));
          var halo = d < 0 ? 0.18 * Math.exp(d / (2.5 * px)) : 0;
          var la = row.lit * Math.max(edge, halo);
          if (la > 0.002) over(i, s.ink[0], s.ink[1], s.ink[2], la);
        }
      }
    }
    return unpremultiply(w, h, r, g, b, a);
  }

  /* Premultiplied float planes → straight RGBA bytes. */
  function unpremultiply(w, h, r, g, b, a) {
    var data = new Uint8ClampedArray(w * h * 4);
    for (var i = 0, j = 0; i < a.length; i++, j += 4) {
      var al = a[i];
      if (al <= 0) continue;
      data[j] = r[i] / al;
      data[j + 1] = g[i] / al;
      data[j + 2] = b[i] / al;
      data[j + 3] = al * 255;
    }
    return { w: w, h: h, data: data };
  }

  /* A job (js/ocean.js): { band, tile, height (CSS px), px, ink, top, bottom, shade,
     seed } → the band's pixels. The rows are laid out here, so the controller never
     needs the texture code. */
  function paintBand(job) {
    return swellLayer({
      w: Math.round(job.tile * job.px),
      h: Math.round(job.height * job.px),
      px: job.px,
      rows: seaRows(job.height)[job.band],
      ink: job.ink,
      top: job.top,
      bottom: job.bottom,
      shade: job.shade,
      seed: job.seed,
    });
  }

  var inWorker = typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope;
  if (!inWorker) {
    self.DeetsOceanTexture = { BANDS: BANDS, seaRows: seaRows, swellLayer: swellLayer, paintBand: paintBand };
    return;
  }

  /* In: { id, job }. Out: { id, blob } — the band as a PNG (blob null, err set, on a
     failure). A band takes tens of ms (more on a scaled display or a tall window), so
     it never runs on the thread that paints the page. */
  self.onmessage = function (e) {
    var id = e.data.id;
    try {
      var p = paintBand(e.data.job);
      var canvas = new OffscreenCanvas(p.w, p.h);
      canvas.getContext("2d").putImageData(new ImageData(p.data, p.w, p.h), 0, 0);
      canvas.convertToBlob({ type: "image/png" }).then(
        function (blob) { self.postMessage({ id: id, blob: blob }); },
        function (err) { self.postMessage({ id: id, blob: null, err: String(err) }); }
      );
    } catch (err) {
      self.postMessage({ id: id, blob: null, err: String(err) });
    }
  };
})(self);
