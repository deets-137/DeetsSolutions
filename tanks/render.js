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

  function create(canvas) {
    var ctx = canvas.getContext("2d");
    var level = null, blocks = null;
    var staticCv = document.createElement("canvas");
    var staticDirty = true;
    var tile = 32, ox = 0, oy = 0, dpr = 1;
    var pal = null;

    function palette() {
      if (pal) return pal;
      var cs = getComputedStyle(document.querySelector(".tk") || document.body);
      function c(name, fb) { var v = cs.getPropertyValue(name).trim(); return v || fb; }
      pal = {
        floorA: c("--tk-floor-a", "#d9c893"),
        floorB: c("--tk-floor-b", "#d2c084"),
        seam: c("--tk-seam", "rgba(90,70,40,0.16)"),
        wall: c("--tk-wall", "#8a7757"),
        wallTop: c("--tk-wall-top", "#a08c68"),
        block: c("--tk-block", "#b98a4e"),
        blockTop: c("--tk-block-top", "#cda05f"),
        enemy: c("--tk-enemy1", "#a3562c"),
        enemyDark: c("--tk-enemy1-dark", "#77401f"),
        track: c("--tk-track", "rgba(30,24,16,0.55)"),
        bullet: c("--tk-bullet", "#2e2820"),
        mine: c("--tk-mine", "#3a332a"),
        mineArm: c("--tk-mine-arm", "#d8442e"),
        boom: c("--tk-boom", "#e0862f"),
        aim: c("--tk-aim", "rgba(40,90,160,0.55)"),
        scorch: c("--tk-scorch", "rgba(40,30,20,0.35)")
      };
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
          s.fillStyle = (x + y) % 2 ? P.floorA : P.floorB;
          s.fillRect(X, Y, tile, tile);
          s.strokeStyle = P.seam;
          s.lineWidth = 1;
          s.strokeRect(X + 0.5, Y + 0.5, tile - 1, tile - 1);
          if (ch === "#") {
            s.fillStyle = P.wall;
            s.fillRect(X, Y, tile, tile);
            s.fillStyle = P.wallTop;
            s.fillRect(X + 1, Y + 1, tile - 2, Math.max(2, tile * 0.22));
          }
        }
      }
      staticDirty = false;
    }

    function drawTank(tk, color, dark) {
      var X = px(tk.x), Y = py(tk.y);
      var r = 0.34 * tile;
      var hullA = window.TanksEngine.dirAngle(tk.h || tk.hull || 1);
      ctx.save();
      ctx.translate(X, Y);
      ctx.rotate(hullA + Math.PI / 2);          // sprite convention: faces up
      // tracks
      ctx.fillStyle = palette().track;
      roundRect(-r * 1.18, -r, r * 0.42, r * 2, r * 0.16);
      roundRect(r * 0.76, -r, r * 0.42, r * 2, r * 0.16);
      // hull
      ctx.fillStyle = color;
      roundRect(-r * 0.8, -r * 0.92, r * 1.6, r * 1.84, r * 0.24);
      ctx.restore();
      // turret rotates freely, above the hull
      var ta = tk.tr != null ? tk.tr : tk.turret;
      ctx.save();
      ctx.translate(X, Y);
      ctx.rotate(ta);
      ctx.fillStyle = dark;
      ctx.fillRect(0, -0.055 * tile * 2, 0.52 * tile, 0.11 * tile * 2);
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.55, 0, Math.PI * 2);
      ctx.fill();
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
          ctx.fillStyle = P.block;
          ctx.fillRect(X + 1, Y + 1, tile - 2, tile - 2);
          ctx.fillStyle = P.blockTop;
          ctx.fillRect(X + 2, Y + 2, tile - 4, Math.max(2, tile * 0.2));
        }
      }
      // mines under the hulls
      (scene.mines || []).forEach(function (m) {
        ctx.beginPath();
        ctx.arc(px(m.x), py(m.y), tile * 0.16, 0, Math.PI * 2);
        ctx.fillStyle = P.mine;
        ctx.fill();
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
        } else { color = P.enemy; dark = P.enemyDark; }
        drawTank(tk, color, dark);
      });
      (scene.bullets || []).forEach(function (b) {
        ctx.beginPath();
        ctx.arc(px(b.x), py(b.y), Math.max(2, tile * 0.09), 0, Math.PI * 2);
        ctx.fillStyle = P.bullet;
        ctx.fill();
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
      setLevel: function (lv, blk) { level = lv; blocks = blk; staticDirty = true; resize(); },
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

  window.TanksRender = { create: create, preview: preview };
})();
