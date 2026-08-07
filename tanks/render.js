/* DeetsTanks — the layered canvas renderer (docs/tanks.md, "Renderer").

   One visible <canvas>, one offscreen static canvas. The static layer
   (floor + indestructible walls) renders ONCE at level load and blits
   with a single drawImage per frame; everything that changes draws on
   top in paint order: blocks, mines, hulls, turrets, bullets, effects,
   overlays. Native resolution, letterboxed to the grid — no camera.

   Player tanks wear their SEAT color (the --gseat contract — the hex
   rides the seat view). Everything else is the game's art carve-out:
   the --tk* literals live in tanks.css on the .tk root and are read
   here via getComputedStyle, so the palette stays in CSS even though
   canvas can't use var(). Geometric placeholders throughout until his
   sprites land (art.js probes). window.TanksRender. */
(function () {
  "use strict";

  /* ── the tile primitives ─────────────────────────────────────────
     ONE definition of what each terrain cell looks like, used by the
     renderer AND by the designer's theme-pack export. The sharing is
     the point: the PNG template he paints over is pixel-for-pixel what
     the game would otherwise have drawn, so a half-finished pack never
     disagrees with the flat-colour tiles sitting next to it. */
  function drawFloor(c, X, Y, s, P, alt) {
    c.fillStyle = alt ? P.floorA : P.floorB;
    c.fillRect(X, Y, s, s);
    c.strokeStyle = P.seam;
    c.lineWidth = 1;
    c.strokeRect(X + 0.5, Y + 0.5, s - 1, s - 1);
  }
  function drawWall(c, X, Y, s, P) {
    c.fillStyle = P.wall;
    c.fillRect(X, Y, s, s);
    c.fillStyle = P.wallTop;
    c.fillRect(X + 1, Y + 1, s - 2, Math.max(2, s * 0.22));
  }
  function drawHole(c, X, Y, s, P) {
    // a hole reads as depth, not as an object: the cork is cut away, so
    // it must never carry the wall's lit top edge
    c.fillStyle = P.hole;
    c.fillRect(X, Y, s, s);
    c.fillStyle = P.holeRim;
    c.fillRect(X, Y, s, Math.max(2, s * 0.16));
  }
  /* ── the shell ───────────────────────────────────────────────────
     Wii Play's shells are BALLS resting on the board, and two things
     do that work: the sphere is lit from one side (so it has a near
     edge and a far edge instead of being a filled circle), and it
     drops a contact shadow slightly off it (so it sits ABOVE the cork
     rather than being a hole in it). A flat disc has neither and reads
     as a pellet no matter what size it is.

     The shadow is the renderer's, never the sprite's: it belongs to
     the board's lighting, so it must not rotate or travel with the
     art, and a hand-drawn bullet.png gets one for free.

     Same recipe as build-tanks-art.py's `sphere` — the template he
     paints over is what the game would otherwise have drawn, exactly
     like the tile primitives above. */
  function drawShellShadow(c, X, Y, d, P) {
    c.beginPath();
    c.ellipse(X + d * 0.12, Y + d * 0.18, d * 0.48, d * 0.36, 0, 0, Math.PI * 2);
    c.fillStyle = P.shadow;
    c.fill();
  }
  function drawShell(c, X, Y, d, P) {
    var r = d / 2, lx = X - r * 0.34, ly = Y - r * 0.40;
    var g = c.createRadialGradient(lx, ly, r * 0.06, X, Y, r * 1.06);
    g.addColorStop(0, P.bulletLit);
    g.addColorStop(0.42, P.bullet);
    g.addColorStop(1, P.bulletRim);
    c.beginPath();
    c.arc(X, Y, r, 0, Math.PI * 2);
    c.fillStyle = g;
    c.fill();
    // one tight specular — the highlight is what says "polished", and
    // it is why this reads as a ball at 6 px across
    c.beginPath();
    c.arc(lx, ly, r * 0.26, 0, Math.PI * 2);
    c.fillStyle = P.bulletLit;
    c.fill();
  }
  function drawBlock(c, X, Y, s, P) {
    c.fillStyle = P.block;
    c.fillRect(X + 1, Y + 1, s - 2, s - 2);
    c.fillStyle = P.blockTop;
    c.fillRect(X + 2, Y + 2, s - 4, Math.max(2, s * 0.2));
  }

  /* ── the turret's outline (his ask, 2026-08-07) ──────────────────
     The turret wears the hull's own colour and sits directly on it, so
     at a glance the barrel dissolves into the body and you cannot tell
     where the tank is pointing — the one thing you must read
     instantly. A rim fixes it.

     It is built from the SPRITE'S OWN SILHOUETTE rather than baked
     into the PNG: draw the art ringed around the origin, keep only the
     alpha, flood that with the rim colour, then the art on top. That
     way it costs nothing when his hand-drawn turret lands (no second
     file to redraw, no rim to hand-draw again for every enemy livery),
     it follows the theme's own colour, and the geometric fallback in
     drawTank gets the same treatment from the same token.

     Module scope, not per-renderer, so the lobby preview — which
     builds a fresh renderer every time it draws — shares the cache
     with the arena. Keyed by sprite in a WeakMap, then by colour, so
     a tint that falls out of use is collectable along with its rim. */
  var RIM_W = 0.035;                   // of the sprite's own width
  var RD = Math.SQRT1_2;
  var RIM_RING = [[1, 0], [-1, 0], [0, 1], [0, -1],
                  [RD, RD], [RD, -RD], [-RD, RD], [-RD, -RD]];
  var rims = (typeof WeakMap === "function") ? new WeakMap() : null;
  function rimmed(img, hex) {
    if (!img || !hex || !rims) return null;
    var per = rims.get(img);
    if (per && per[hex]) return per[hex];
    var w = Math.max(1, Math.round(img.width * RIM_W));
    var cv = document.createElement("canvas");
    cv.width = img.width + w * 2; cv.height = img.height + w * 2;
    var c = cv.getContext("2d");
    RIM_RING.forEach(function (d) { c.drawImage(img, w + d[0] * w, w + d[1] * w); });
    c.globalCompositeOperation = "source-in";     // keep the silhouette only
    c.fillStyle = hex;
    c.fillRect(0, 0, cv.width, cv.height);
    c.globalCompositeOperation = "source-over";
    c.drawImage(img, w, w);
    if (!per) { per = {}; rims.set(img, per); }
    per[hex] = cv;
    return cv;
  }

  function readPalette() {
    var cs = getComputedStyle(document.querySelector(".tk") || document.body);
    function c(name, fb) { var v = cs.getPropertyValue(name).trim(); return v || fb; }
    return {
      floorA: c("--tk-floor-a", "#d9c893"),
      floorB: c("--tk-floor-b", "#d2c084"),
      seam: c("--tk-seam", "rgba(90,70,40,0.16)"),
      wall: c("--tk-wall", "#8a7757"),
      hole: c("--tk-hole", "#4a4034"),
      holeRim: c("--tk-hole-rim", "#332c23"),
      wallTop: c("--tk-wall-top", "#a08c68"),
      block: c("--tk-block", "#b98a4e"),
      blockTop: c("--tk-block-top", "#cda05f"),
      enemy: c("--tk-enemy1", "#a3562c"),
      enemyDark: c("--tk-enemy1-dark", "#77401f"),
      track: c("--tk-track", "rgba(30,24,16,0.55)"),
      bullet: c("--tk-bullet", "#2e2820"),
      bulletLit: c("--tk-bullet-lit", "#cdbfa4"),
      bulletRim: c("--tk-bullet-rim", "#14110c"),
      shadow: c("--tk-shadow", "rgba(40,30,18,0.28)"),
      turretRim: c("--tk-turret-rim", "rgba(22,17,11,0.85)"),
      mine: c("--tk-mine", "#3a332a"),
      mineArm: c("--tk-mine-arm", "#d8442e"),
      boom: c("--tk-boom", "#e0862f"),
      aim: c("--tk-aim", "rgba(40,90,160,0.55)"),
      scorch: c("--tk-scorch", "rgba(40,30,20,0.35)")
    };
  }
  /* Read a theme's colours WITHOUT disturbing what is on screen: stamp,
     read, put back exactly what was there (including nothing). */
  function paletteFor(theme) {
    var root = document.querySelector(".tk");
    if (!root) return readPalette();
    var prev = root.getAttribute("data-tk-theme");
    root.setAttribute("data-tk-theme", theme || "cork");
    var P = readPalette();
    if (prev === null) root.removeAttribute("data-tk-theme");
    else root.setAttribute("data-tk-theme", prev);
    return P;
  }

  function create(canvas) {
    var ctx = canvas.getContext("2d");
    var level = null, blocks = null;
    var staticCv = document.createElement("canvas");
    var staticDirty = true;
    var tile = 32, ox = 0, oy = 0, dpr = 1;
    var pal = null;

    /* The theme is stamped on the .tk root and the palette re-read from
       it. Canvas cannot use var(), but getComputedStyle can — so the
       colours stay in CSS where the rest of the game art lives, and a
       new look is a CSS block rather than a JS registry that has to be
       kept in sync with one (docs/tanks.md, "Per-level art"). */
    function applyTheme() {
      var root = document.querySelector(".tk");
      var t = (level && level.theme) || "cork";
      if (root && root.getAttribute("data-tk-theme") !== t) {
        root.setAttribute("data-tk-theme", t);
        pal = null;                       // colours changed under us
      }
      if (window.TanksArt) window.TanksArt.useTheme(t);
    }
    function palette() {
      if (!pal) pal = readPalette();
      return pal;
    }

    function resize() {
      var w = canvas.clientWidth, h = canvas.clientHeight;
      if (!w || !h) return;
      dpr = window.devicePixelRatio || 1;
      var pw = Math.round(w * dpr), ph = Math.round(h * dpr);
      if (canvas.width !== pw || canvas.height !== ph) {
        canvas.width = pw; canvas.height = ph;
        staticDirty = true;
      }
      if (!level) return;
      tile = Math.floor(Math.min(pw / level.w, ph / level.h));
      ox = Math.floor((pw - tile * level.w) / 2);
      oy = Math.floor((ph - tile * level.h) / 2);
    }

    function px(wx) { return ox + wx * tile; }
    function py(wy) { return oy + wy * tile; }

    /* A theme's tile art, or null to fall back to its colours. Every
       cell asks; art.js answers from whatever has actually landed, so
       a half-drawn theme renders half-drawn rather than not at all. */
    function art(name, x, y) {
      var A = window.TanksArt;
      if (!A || !A.tile) return null;
      return A.tile((level && level.theme) || "cork", name, x, y);
    }
    function paintStatic() {
      var P = palette();
      staticCv.width = canvas.width; staticCv.height = canvas.height;
      var s = staticCv.getContext("2d");
      s.clearRect(0, 0, staticCv.width, staticCv.height);
      for (var y = 0; y < level.h; y++) {
        for (var x = 0; x < level.w; x++) {
          var ch = level.cells[y][x];
          var X = px(x), Y = py(y);
          // cork-board floor under everything, visible seams (on-style)
          var fi = art("tile-floor", x, y);
          if (fi) s.drawImage(fi, X, Y, tile, tile);
          else drawFloor(s, X, Y, tile, P, (x + y) % 2);
          if (ch === "#") {
            var wi = art("tile-wall", x, y);
            if (wi) s.drawImage(wi, X, Y, tile, tile);
            else drawWall(s, X, Y, tile, P);
          } else if (ch === "o") {
            var hi = art("tile-hole", x, y);
            if (hi) s.drawImage(hi, X, Y, tile, tile);
            else drawHole(s, X, Y, tile, P);
          }
        }
      }
      staticDirty = false;
    }

    /* Hulls and turrets: hand-drawn sprite when one has landed, the
       geometric placeholder when it has not, decided per tank rather
       than per game — so a half-finished cast renders half-finished
       instead of all-or-nothing, exactly like the terrain tiles.

       ALL SPRITES FACE UP, so both rotate by (angle + 90°). No
       pre-rotated facing cache: the hull's 8 headings are DISCRETE, so
       a given facing resamples to the identical pixels every frame and
       cannot crawl — crawl comes from angles that change slightly
       frame to frame, which is the turret, and the turret is
       oversampled 3x for exactly that reason. A cache would buy a
       little CPU on a canvas that draws at most eight tanks. */
    function tankSprite(kind, tk, hex) {
      var A = window.TanksArt;
      if (!A || !A.tankArt) return null;
      return A.tankArt(kind, tk.seat != null ? tk.seat : null, tk.type, hex);
    }

    function drawTank(tk, color, dark) {
      var X = px(tk.x), Y = py(tk.y);
      var r = 0.34 * tile;
      var hullA = window.TanksEngine.dirAngle(tk.h || tk.hull || 1);
      var hi = tankSprite("hull", tk, color);
      ctx.save();
      ctx.translate(X, Y);
      ctx.rotate(hullA + Math.PI / 2);          // sprite convention: faces up
      if (hi) {
        ctx.drawImage(hi, -tile / 2, -tile / 2, tile, tile);
      } else {
        // tracks
        ctx.fillStyle = palette().track;
        roundRect(-r * 1.18, -r, r * 0.42, r * 2, r * 0.16);
        roundRect(r * 0.76, -r, r * 0.42, r * 2, r * 0.16);
        // hull
        ctx.fillStyle = color;
        roundRect(-r * 0.8, -r * 0.92, r * 1.6, r * 1.84, r * 0.24);
      }
      ctx.restore();
      // turret rotates freely, above the hull
      var ta = tk.tr != null ? tk.tr : tk.turret;
      var ti = tankSprite("turret", tk, color);
      ctx.save();
      ctx.translate(X, Y);
      if (ti) {
        ctx.rotate(ta + Math.PI / 2);           // the sprite points up
        var ri = rimmed(ti, palette().turretRim);
        if (ri) {
          // the rim grows the sprite box, so the art inside stays one tile
          var k = ri.width / ti.width;
          ctx.drawImage(ri, -tile * k / 2, -tile * k / 2, tile * k, tile * k);
        } else {
          ctx.drawImage(ti, -tile / 2, -tile / 2, tile, tile);
        }
      } else {
        ctx.rotate(ta);
        ctx.lineWidth = Math.max(1, tile * 0.045);
        ctx.strokeStyle = palette().turretRim;
        ctx.lineJoin = "round";
        // barrel first, mantlet over it — so the barrel's inner edge is
        // covered rather than drawn as a seam across the turret
        ctx.fillStyle = dark;
        ctx.beginPath();
        ctx.rect(0, -0.11 * tile, 0.52 * tile, 0.22 * tile);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
    function roundRect(x, y, w, h, rr) {
      ctx.beginPath();
      ctx.moveTo(x + rr, y);
      ctx.arcTo(x + w, y, x + w, y + h, rr);
      ctx.arcTo(x + w, y + h, x, y + h, rr);
      ctx.arcTo(x, y + h, x, y, rr);
      ctx.arcTo(x, y, x + w, y, rr);
      ctx.fill();
    }
    function shade(hex, f) {
      var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
      if (!m) return hex;
      var n = parseInt(m[1], 16);
      var r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f);
      return "rgb(" + r + "," + g + "," + b + ")";
    }

    /* scene: { tanks, bullets, mines, effects, aim } — net.js's frame */
    function draw(scene, seatColors) {
      if (!level) return;
      resize();
      var P = palette();
      if (staticDirty) paintStatic();
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(staticCv, 0, 0);

      // destructible blocks (dynamic — they can vanish mid-level)
      for (var y = 0; y < level.h; y++) {
        for (var x = 0; x < level.w; x++) {
          if (level.cells[y][x] !== "=" || !blocks || blocks[y * level.w + x] !== 1) continue;
          var X = px(x), Y = py(y);
          var bi = art("tile-block", x, y);
          if (bi) ctx.drawImage(bi, X, Y, tile, tile);
          else drawBlock(ctx, X, Y, tile, P);
        }
      }
      // mines under the hulls
      var mineImg = window.TanksArt && window.TanksArt.img("mine");
      (scene.mines || []).forEach(function (m) {
        if (mineImg) {
          var ms = tile * 0.5;
          ctx.drawImage(mineImg, px(m.x) - ms / 2, py(m.y) - ms / 2, ms, ms);
        } else {
          ctx.beginPath();
          ctx.arc(px(m.x), py(m.y), tile * 0.16, 0, Math.PI * 2);
          ctx.fillStyle = P.mine;
          ctx.fill();
        }
        if (m.a) {                         // armed: the classic blink
          var on = Math.floor(performance.now() / 300) % 2 === 0;
          ctx.beginPath();
          ctx.arc(px(m.x), py(m.y), tile * 0.06, 0, Math.PI * 2);
          ctx.fillStyle = on ? P.mineArm : P.mine;
          ctx.fill();
        }
      });
      // aim line beneath the tanks, above the ground
      if (scene.aim && scene.aim.length > 1) {
        ctx.save();
        ctx.strokeStyle = P.aim;
        ctx.lineWidth = Math.max(1, tile * 0.06);
        ctx.setLineDash([tile * 0.22, tile * 0.22]);
        ctx.beginPath();
        ctx.moveTo(px(scene.aim[0].x), py(scene.aim[0].y));
        for (var i = 1; i < scene.aim.length; i++) ctx.lineTo(px(scene.aim[i].x), py(scene.aim[i].y));
        ctx.stroke();
        ctx.restore();
      }
      // hulls + turrets — the lethal object (bullets) stays on top
      (scene.tanks || []).forEach(function (tk) {
        if (!tk.al && !tk.alive) return;
        var color, dark;
        if (tk.seat != null) {
          color = (seatColors && seatColors[tk.seat]) || "#888";
          dark = shade(color, 0.62);
        } else {
          // enemy livery comes from the TYPE REGISTRY, so a new type is
          // visible the moment it exists — no renderer edit, no CSS edit
          var ty = window.TanksEngine.ENEMY_TYPES[tk.type];
          color = (ty && ty.art) || P.enemy;
          dark = shade(color, 0.62);
        }
        drawTank(tk, color, dark);
      });
      /* Shells last, over everything: the lethal object must always
         stay legible. The shadow goes down first for every shell, so a
         ball never lands on top of its neighbour's shadow. `d` is the
         ball's DISPLAY diameter either way — 0.18 tiles, the engine's
         BULLET_R doubled — so what you see is exactly the hitbox, and
         a sprite's own art occupies the same fraction of its box. */
      var shell = window.TanksArt && window.TanksArt.img("bullet");
      var bd = Math.max(3, tile * 0.18);
      (scene.bullets || []).forEach(function (b) {
        drawShellShadow(ctx, px(b.x), py(b.y), bd, P);
      });
      (scene.bullets || []).forEach(function (b) {
        if (shell) {
          var sz = tile * 0.5;
          ctx.drawImage(shell, px(b.x) - sz / 2, py(b.y) - sz / 2, sz, sz);
          return;
        }
        drawShell(ctx, px(b.x), py(b.y), bd, P);
      });
      // effects: expanding boom rings, ~350 ms of theater
      var now = performance.now();
      (scene.effects || []).forEach(function (fx) {
        var t = (now - fx.at) / (fx.big ? 500 : 350);
        if (t < 0 || t > 1) return;
        ctx.beginPath();
        ctx.arc(px(fx.x), py(fx.y), tile * (fx.big ? 1.15 : 0.35) * t, 0, Math.PI * 2);
        ctx.strokeStyle = P.boom;
        ctx.globalAlpha = 1 - t;
        ctx.lineWidth = Math.max(2, tile * 0.08);
        ctx.stroke();
        ctx.globalAlpha = 1;
      });
    }

    return {
      setLevel: function (lv, blk) {
        level = lv; blocks = blk; staticDirty = true;
        applyTheme();                     // before resize: it may drop `pal`
        resize();
      },
      setBlocks: function (blk) { blocks = blk; },
      resize: function () { resize(); staticDirty = true; },
      draw: draw,
      /* canvas px → world tiles (input's mouse → an aim angle) */
      toWorld: function (cx, cy) {
        return { x: (cx * dpr - ox) / tile, y: (cy * dpr - oy) / tile };
      }
    };
  }

  /* the lobby's static level preview: same geometry, its own tiny
     canvas, spawns and enemies as dots — the renderer on the real level
     file, nothing invented (docs/tanks.md, "Page layout") */
  function preview(canvas, src, seatColors) {
    var E = window.TanksEngine;
    var lv;
    try { lv = E.parseLevel(src); } catch (e) { return; }
    var r = create(canvas);
    r.setLevel(lv, lv.cells.join("").split("").map(function (ch) { return ch === "=" ? 1 : 0; }));
    var scene = { tanks: [], bullets: [], mines: [], effects: [] };
    lv.spawns.forEach(function (s, i) {
      scene.tanks.push({ x: s.x, y: s.y, h: 1, tr: E.dirAngle(1), al: 1, seat: i });
    });
    lv.enemies.forEach(function (e) {
      scene.tanks.push({ x: e.x, y: e.y, h: 5, tr: E.dirAngle(5), al: 1, seat: null, type: e.type });
    });
    r.draw(scene, seatColors || []);
  }

  /* ── theme-pack templates (docs/tanks.md, "Per-level art") ──────
     Render one tile at display size from a theme's colours, using the
     SAME primitives the game draws with. The designer packs these into
     a zip so a new theme starts as something to paint over rather than
     a blank canvas — which is also why walls and blocks are drawn on
     top of their floor here: the template is a complete, opaque tile,
     and he can erase back to transparency if he wants the floor to
     show through. */
  var TILE_KINDS = ["tile-floor", "tile-floor-1", "tile-floor-2", "tile-floor-3",
                    "tile-wall", "tile-block", "tile-hole"];
  function tileTemplate(kind, size, theme) {
    var cv = document.createElement("canvas");
    cv.width = cv.height = size || 64;
    var c = cv.getContext("2d"), s = cv.width, P = paletteFor(theme);
    if (kind.indexOf("tile-floor") === 0) { drawFloor(c, 0, 0, s, P, false); return cv; }
    drawFloor(c, 0, 0, s, P, false);
    if (kind === "tile-wall") drawWall(c, 0, 0, s, P);
    else if (kind === "tile-block") drawBlock(c, 0, 0, s, P);
    else if (kind === "tile-hole") { c.clearRect(0, 0, s, s); drawHole(c, 0, 0, s, P); }
    return cv;
  }

  window.TanksRender = {
    create: create, preview: preview,
    TILE_KINDS: TILE_KINDS, tileTemplate: tileTemplate, paletteFor: paletteFor
  };
})();
